import type { FastifyInstance } from "fastify";
import { readdirSync } from "node:fs";
import {
  archivedPutSchema,
  disclosurePutSchema,
  pinnedPutSchema,
  type EntrySummary,
  type WeekId,
} from "../../../shared/types.js";
import { disclosureIsOfferable } from "../../state.js";
import { entriesDir } from "../../store/paths.js";
import { writeProgressFile } from "../../store/writeFiles.js";
import { parseWeekId } from "../../../shared/week.js";
import { requireEntry, type Ctx } from "../context.js";
import { ApiError } from "../errors.js";
import { entryDetail, entrySummary, goalsOwnerView, ownerGoalView } from "../views.js";
import { parse } from "./draft.js";

function weekParam(raw: string): WeekId {
  const weekId = parseWeekId(raw);
  if (!weekId) {
    throw new ApiError("INVALID_WEEK_ID", `"${raw}" is not an ISO week id.`);
  }
  return weekId;
}

/**
 * Reads over history, plus the writes that stay legal forever.
 *
 * Note what is absent: there is no DELETE for an entry and no route here that
 * edits prose, a photo or a goal by week id. Immutability after the week ends
 * is a property of this table, not of a guard inside a handler.
 */
export function entryRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get<{ Querystring: { archived?: string } }>(
    "/api/entries",
    async (req) => {
      const includeArchived = req.query.archived === "true";
      const weeks = readdirSync(entriesDir(ctx.dataDir), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => parseWeekId(d.name))
        .filter((w): w is WeekId => w !== null);

      const summaries: EntrySummary[] = [];
      for (const weekId of weeks) {
        const { entry, goals, progress } = ctx.load(weekId);
        if (!entry) continue;
        if (progress.archived && !includeArchived) continue;
        summaries.push(
          entrySummary(weekId, entry, goals, progress, ctx.tz, ctx.now()),
        );
      }
      // Pinned first, then newest first. Week ids sort correctly as strings.
      return summaries.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.weekId.localeCompare(a.weekId);
      });
    },
  );

  app.get<{ Params: { weekId: string } }>(
    "/api/entries/:weekId",
    async (req) => {
      const weekId = weekParam(req.params.weekId);
      const { entry, goals, progress } = requireEntry(ctx, weekId);
      return entryDetail(weekId, entry, goals, progress, ctx.tz, ctx.now());
    },
  );

  /**
   * The only route that returns goal text. Never listed, never embedded in
   * another response, no query parameter anywhere else opts into it.
   */
  app.get<{ Params: { weekId: string } }>(
    "/api/entries/:weekId/goals",
    async (req) => {
      const weekId = weekParam(req.params.weekId);
      const { entry, goals, progress } = requireEntry(ctx, weekId);
      return goalsOwnerView(weekId, entry, goals, progress);
    },
  );

  /* ---- writes that are legal on a locked entry ---- */

  // Pinning and archiving are presentation metadata, not entry content, and
  // pinning is only meaningful on an old chapter. Neither consults the lock.
  app.put<{ Params: { weekId: string } }>(
    "/api/entries/:weekId/pinned",
    async (req) => {
      const body = parse(pinnedPutSchema, req.body);
      return ctx.serialise(() => {
        const weekId = weekParam(req.params.weekId);
        const { entry, goals, progress } = requireEntry(ctx, weekId);
        const next = { ...progress, pinned: body.pinned };
        writeProgressFile(ctx.dataDir, weekId, next);
        ctx.reindex();
        return entrySummary(weekId, entry, goals, next, ctx.tz, ctx.now());
      });
    },
  );

  // Archiving hides from history. It does not delete - nothing deletes.
  app.put<{ Params: { weekId: string } }>(
    "/api/entries/:weekId/archived",
    async (req) => {
      const body = parse(archivedPutSchema, req.body);
      return ctx.serialise(() => {
        const weekId = weekParam(req.params.weekId);
        const { entry, goals, progress } = requireEntry(ctx, weekId);
        const next = { ...progress, archived: body.archived };
        writeProgressFile(ctx.dataDir, weekId, next);
        ctx.reindex();
        return entrySummary(weekId, entry, goals, next, ctx.tz, ctx.now());
      });
    },
  );

  // Opt-in per entry, and only offerable once something has been completed.
  app.put<{ Params: { weekId: string } }>(
    "/api/entries/:weekId/disclosure",
    async (req) => {
      const body = parse(disclosurePutSchema, req.body);
      return ctx.serialise(() => {
        const weekId = weekParam(req.params.weekId);
        const { goals, progress } = requireEntry(ctx, weekId);
        const counts = ownerGoalView(goals, progress);
        if (body.disclosed && !disclosureIsOfferable(counts.done)) {
          throw new ApiError(
            "DISCLOSURE_NOT_OFFERABLE",
            "Disclosure becomes available once at least one goal is completed.",
          );
        }
        const next = { ...progress, goalsDisclosed: body.disclosed };
        writeProgressFile(ctx.dataDir, weekId, next);
        ctx.reindex();
        return counts;
      });
    },
  );
}
