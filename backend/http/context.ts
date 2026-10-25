import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  EntryFile,
  GoalsFile,
  ProgressFile,
  WeekId,
} from "../../shared/types.js";
import { emptyProgress } from "../../shared/types.js";
import type { Db } from "../db/open.js";
import { entryState } from "../state.js";
import { isLocked, parseWeekId, weekIdAt } from "../../shared/week.js";
import {
  readEntryFile,
  readGoalsFile,
  readProgressFile,
} from "../store/entryFiles.js";
import { entryJsonPath } from "../store/paths.js";
import { rebuild } from "../store/reindex.js";
import { ApiError, locked } from "./errors.js";

export interface AppOptions {
  dataDir: string;
  db: Db;
  tz: string;
  /** Injected so tests can stand on either side of Sunday 11:59pm without
   *  touching the system clock. Every lock decision reads this. */
  now?: () => Date;
  /** Optional: absent in tests that exercise the archive alone. */
  sync?: {
    auth: import("../auth/client.js").AuthClient;
    engine: import("../sync/engine.js").SyncEngine;
  };
}

export interface Ctx {
  dataDir: string;
  db: Db;
  tz: string;
  now: () => Date;
  /** The week id the clock says it is, right now. The client never sends one
   *  for a write, so backfilling cannot be expressed. */
  currentWeek(): WeekId;
  entryExists(weekId: WeekId): boolean;
  load(weekId: WeekId): {
    entry: EntryFile | null;
    goals: GoalsFile;
    progress: ProgressFile;
  };
  /** Reindexes from disk. Called after every write. */
  reindex(): void;
  /** Serialises writes so an upload cannot interleave with a draft save. */
  serialise<T>(fn: () => Promise<T> | T): Promise<T>;
  newGoalId(): string;
}

export function makeCtx(options: AppOptions): Ctx {
  const now = options.now ?? (() => new Date());
  let queue: Promise<unknown> = Promise.resolve();

  return {
    dataDir: options.dataDir,
    db: options.db,
    tz: options.tz,
    now,
    currentWeek: () => weekIdAt(now(), options.tz),
    entryExists: (weekId) =>
      existsSync(entryJsonPath(options.dataDir, weekId)),
    load(weekId) {
      const exists = existsSync(entryJsonPath(options.dataDir, weekId));
      return {
        entry: exists ? readEntryFile(options.dataDir, weekId) : null,
        goals: readGoalsFile(options.dataDir, weekId),
        progress: exists
          ? readProgressFile(options.dataDir, weekId)
          : { ...emptyProgress },
      };
    },
    reindex: () => {
      rebuild(options.dataDir, options.db, options.tz);
    },
    async serialise<T>(fn: () => Promise<T> | T): Promise<T> {
      const run = queue.then(
        () => fn(),
        () => fn(),
      );
      queue = run.catch(() => undefined);
      return run;
    },
    newGoalId: () => randomUUID(),
  };
}

/**
 * The lock gate for every write that touches entry content.
 *
 * The caller must name the week it believes it is editing, echoing the id the
 * server handed it in GET /api/draft. The client still never *computes* a week
 * id - it repeats one back - and that repetition is what makes the lock check
 * reachable at all.
 *
 * Without it, a content write would simply target whatever week the clock says
 * it is now, and the failure mode is nasty rather than loud: a composer open at
 * Sunday 23:59:59 whose save lands at 00:00:00.001 would silently open *next*
 * week's entry pre-filled with last week's writing. Naming the week converts
 * that into a 403 on a locked entry, or a 409 if the week merely rolled.
 *
 * A past week is always locked, so this rejects backfilling too.
 *
 * Goal completion, pinning, archiving and disclosure deliberately never call
 * this.
 */
export function assertWritableWeek(ctx: Ctx, raw: string | undefined): WeekId {
  if (!raw) {
    throw new ApiError(
      "INVALID_BODY",
      "A ?week= parameter is required, echoing the id from GET /api/draft.",
    );
  }
  const weekId = parseWeekId(raw);
  if (!weekId) {
    throw new ApiError("INVALID_WEEK_ID", `"${raw}" is not an ISO week id.`);
  }
  if (isLocked(weekId, ctx.tz, ctx.now())) throw locked();
  if (weekId !== ctx.currentWeek()) {
    throw new ApiError(
      "WEEK_ROLLED",
      `${weekId} is not the current week. Reload the draft.`,
    );
  }
  return weekId;
}

/** Loads the named week's draft, or throws if there is not one yet. */
export function requireDraft(
  ctx: Ctx,
  raw: string | undefined,
): {
  weekId: WeekId;
  entry: EntryFile;
  goals: GoalsFile;
  progress: ProgressFile;
} {
  const weekId = assertWritableWeek(ctx, raw);
  const { entry, goals, progress } = ctx.load(weekId);
  if (!entry) {
    throw new ApiError("NO_DRAFT", "No entry has been started this week yet.");
  }
  return { weekId, entry, goals, progress };
}

export function requireEntry(
  ctx: Ctx,
  weekId: WeekId,
): { entry: EntryFile; goals: GoalsFile; progress: ProgressFile } {
  const loaded = ctx.load(weekId);
  if (!loaded.entry) {
    throw new ApiError("ENTRY_NOT_FOUND", `No entry exists for ${weekId}.`);
  }
  return { entry: loaded.entry, goals: loaded.goals, progress: loaded.progress };
}

export { entryState };
