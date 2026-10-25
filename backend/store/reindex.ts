import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_GOALS,
  MAX_PHOTOS,
  type EntryFile,
  type GoalsFile,
  type ProgressFile,
  type WeekId,
} from "../../shared/types.js";
import { SCHEMA_VERSION, createSchema, type Db } from "../db/open.js";
import { parseWeekId, weekBounds } from "../../shared/week.js";
import {
  EntryFileError,
  readEntryFile,
  readGoalsFile,
  readProgressFile,
} from "./entryFiles.js";
import { entriesDir, goalPhotosDir, photosDir, weekDir } from "./paths.js";

export interface RebuildProblem {
  folder: string;
  reason: string;
}

export class RebuildFailed extends Error {
  constructor(readonly problems: RebuildProblem[]) {
    super(
      `Reindex aborted with ${problems.length} problem(s):\n` +
        problems.map((p) => `  ${p.folder}\n    ${p.reason}`).join("\n"),
    );
    this.name = "RebuildFailed";
  }
}

export interface RebuildResult {
  weeks: number;
  photos: number;
  goals: number;
  completions: number;
}

interface LoadedWeek {
  weekId: WeekId;
  entry: EntryFile;
  goals: GoalsFile;
  progress: ProgressFile;
}

/**
 * Rebuilds the whole index from data/entries/.
 *
 * Runs on `npm run db:reset` and on every boot. A full rebuild is affordable -
 * 52 folders a year - and running the same code path constantly means the
 * rebuild is exercised continuously, rather than being a rescue script that
 * has quietly rotted by the time it is needed.
 *
 * Validation is strict about things the writer should have prevented, and any
 * failure aborts the whole rebuild rather than skipping a folder. A silently
 * dropped week would disappear from a history whose entire premise is that
 * the gaps are honest.
 */
export function rebuild(dataDir: string, db: Db, tz: string): RebuildResult {
  const problems: RebuildProblem[] = [];
  const loaded: LoadedWeek[] = [];

  const root = entriesDir(dataDir);
  const folders = existsSync(root)
    ? readdirSync(root)
        .filter((name) => statSync(join(root, name)).isDirectory())
        .sort()
    : [];

  for (const folder of folders) {
    const weekId = parseWeekId(folder);
    if (!weekId) {
      problems.push({
        folder,
        reason:
          "folder name is not a valid ISO week id (expected e.g. 2026-W30)",
      });
      continue;
    }
    const week = load(dataDir, weekId, problems);
    if (week) {
      validate(dataDir, week, tz, problems);
      loaded.push(week);
    }
  }

  if (problems.length > 0) throw new RebuildFailed(problems);

  return write(db, loaded, tz);
}

function load(
  dataDir: string,
  weekId: WeekId,
  problems: RebuildProblem[],
): LoadedWeek | null {
  try {
    return {
      weekId,
      entry: readEntryFile(dataDir, weekId),
      goals: readGoalsFile(dataDir, weekId),
      progress: readProgressFile(dataDir, weekId),
    };
  } catch (e) {
    problems.push({
      folder: weekId,
      reason:
        e instanceof EntryFileError
          ? `${e.file}: ${e.message}`
          : (e as Error).message,
    });
    return null;
  }
}

/** Cross-file checks that no single zod schema can express. */
function validate(
  dataDir: string,
  week: LoadedWeek,
  tz: string,
  problems: RebuildProblem[],
): void {
  const { weekId, entry, goals, progress } = week;
  const fail = (reason: string) => problems.push({ folder: weekId, reason });

  if (entry.photos.length > MAX_PHOTOS) {
    fail(`${entry.photos.length} photos, max is ${MAX_PHOTOS}`);
  }
  if (goals.goals.length > MAX_GOALS) {
    fail(`${goals.goals.length} goals, max is ${MAX_GOALS}`);
  }

  const goalIds = new Set(goals.goals.map((g) => g.id));
  if (goalIds.size !== goals.goals.length) {
    fail("duplicate goal ids in goals.json");
  }

  for (const id of Object.keys(progress.completions)) {
    if (!goalIds.has(id)) {
      fail(`progress.json completes goal "${id}", which is not in goals.json`);
    }
  }

  // Disclosure only becomes available once something is completed, so a
  // disclosed entry with no completions is a state the app cannot have
  // produced.
  const done = Object.keys(progress.completions).length;
  if (progress.goalsDisclosed && done === 0) {
    fail("progress.json sets goalsDisclosed with zero completed goals");
  }

  // Goals freeze at publish, so a draft can never have completions: there is
  // nothing to complete until the goals exist in final form.
  if (entry.publishedAt === null && done > 0) {
    fail("entry is an unpublished draft but has completed goals");
  }

  if (entry.publishedAt !== null) {
    const { start, endExclusive } = weekBounds(weekId, tz);
    const published = new Date(entry.publishedAt).getTime();
    if (published < start.getTime() || published >= endExclusive.getTime()) {
      fail(
        `publishedAt ${entry.publishedAt} falls outside ${weekId} ` +
          `(${start.toISOString()} .. ${endExclusive.toISOString()})`,
      );
    }
  }

  for (const [i, photo] of entry.photos.entries()) {
    const dir = photosDir(dataDir, weekId);
    if (!existsSync(join(dir, photo.filename))) {
      fail(`photo ${i} references missing file photos/${photo.filename}`);
    }
  }

  for (const goal of goals.goals) {
    if (
      goal.photoFilename !== null &&
      !existsSync(join(goalPhotosDir(dataDir, weekId), goal.photoFilename))
    ) {
      fail(
        `goal "${goal.id}" references missing file ` +
          `goal-photos/${goal.photoFilename}`,
      );
    }
  }

  if (!existsSync(weekDir(dataDir, weekId))) {
    fail("week directory vanished during reindex");
  }
}

function write(db: Db, loaded: LoadedWeek[], tz: string): RebuildResult {
  const result: RebuildResult = {
    weeks: loaded.length,
    photos: 0,
    goals: 0,
    completions: 0,
  };

  const run = db.transaction(() => {
    createSchema(db);

    const insertEntry = db.prepare(`
      INSERT INTO entries (week_id, title, description, liked, challenging,
                           created_at, published_at, created_tz,
                           pinned, archived, goals_disclosed)
      VALUES (@week_id, @title, @description, @liked, @challenging,
              @created_at, @published_at, @created_tz,
              @pinned, @archived, @goals_disclosed)
    `);
    const insertPhoto = db.prepare(`
      INSERT INTO photos (week_id, position, filename, thumb_filename,
                          width, height, ai_description)
      VALUES (@week_id, @position, @filename, @thumb_filename,
              @width, @height, @ai_description)
    `);
    const insertGoal = db.prepare(`
      INSERT INTO goals (goal_id, week_id, position, text, photo_filename)
      VALUES (@goal_id, @week_id, @position, @text, @photo_filename)
    `);
    const insertCompletion = db.prepare(`
      INSERT INTO goal_completions (goal_id, completed_at)
      VALUES (@goal_id, @completed_at)
    `);

    for (const { weekId, entry, goals, progress } of loaded) {
      insertEntry.run({
        week_id: weekId,
        title: entry.title,
        description: entry.description,
        liked: entry.liked,
        challenging: entry.challenging,
        created_at: entry.createdAt,
        published_at: entry.publishedAt,
        created_tz: entry.createdTz,
        pinned: progress.pinned ? 1 : 0,
        archived: progress.archived ? 1 : 0,
        goals_disclosed: progress.goalsDisclosed ? 1 : 0,
      });

      for (const [position, photo] of entry.photos.entries()) {
        insertPhoto.run({
          week_id: weekId,
          position,
          filename: photo.filename,
          thumb_filename: photo.thumbFilename,
          width: photo.width,
          height: photo.height,
          ai_description: photo.aiDescription,
        });
        result.photos += 1;
      }

      for (const [position, goal] of goals.goals.entries()) {
        insertGoal.run({
          goal_id: goal.id,
          week_id: weekId,
          position,
          text: goal.text,
          photo_filename: goal.photoFilename,
        });
        result.goals += 1;
      }

      for (const [goalId, completedAt] of Object.entries(
        progress.completions,
      )) {
        insertCompletion.run({ goal_id: goalId, completed_at: completedAt });
        result.completions += 1;
      }
    }

    db.prepare(
      `INSERT INTO index_meta (id, schema_version, indexed_at, journal_tz)
       VALUES (1, @v, @at, @tz)`,
    ).run({ v: SCHEMA_VERSION, at: new Date().toISOString(), tz });
  });

  run();
  return result;
}
