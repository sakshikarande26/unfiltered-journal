import type { FastifyInstance } from "fastify";
import type { WeekId } from "../../../shared/types.js";
import { writeProgressFile } from "../../store/writeFiles.js";
import { parseWeekId } from "../../week.js";
import { requireEntry, type Ctx } from "../context.js";
import { ApiError } from "../errors.js";
import { goalsOwnerView } from "../views.js";

/**
 * Goal completion. This is the one write to an entry's goals that is permitted
 * after the entry locks, and coming back later to finish something is the
 * point of the product rather than an edge case.
 *
 * These handlers deliberately never call assertNotLocked. That is the whole
 * reason completion lives in its own file, writes to its own file on disk
 * (progress.json) and its own table in the index (goal_completions): the
 * permitted write and the forbidden ones share no code path that a future
 * refactor could unify.
 */
export function completionRoutes(app: FastifyInstance, ctx: Ctx): void {
  const apply = (
    weekIdRaw: string,
    goalId: string,
    completedAt: string | null,
  ) =>
    ctx.serialise(() => {
      const weekId = parseWeekId(weekIdRaw);
      if (!weekId) {
        throw new ApiError(
          "INVALID_WEEK_ID",
          `"${weekIdRaw}" is not an ISO week id.`,
        );
      }
      const { entry, goals, progress } = requireEntry(ctx, weekId as WeekId);
      if (!goals.goals.some((g) => g.id === goalId)) {
        throw new ApiError(
          "GOAL_NOT_FOUND",
          `No goal ${goalId} in ${weekId}.`,
        );
      }
      const completions = { ...progress.completions };
      if (completedAt === null) delete completions[goalId];
      else completions[goalId] = completedAt;

      // Un-completing the last goal would leave a disclosed entry with a
      // 0/n count, which is a state disclosure is never offered for.
      const stillDisclosed =
        progress.goalsDisclosed && Object.keys(completions).length > 0;

      const next = {
        ...progress,
        completions,
        goalsDisclosed: stillDisclosed,
      };
      writeProgressFile(ctx.dataDir, weekId as WeekId, next);
      ctx.reindex();
      return goalsOwnerView(weekId as WeekId, entry, goals, next);
    });

  app.put<{ Params: { weekId: string; goalId: string } }>(
    "/api/entries/:weekId/goals/:goalId/completion",
    async (req) =>
      apply(req.params.weekId, req.params.goalId, ctx.now().toISOString()),
  );

  app.delete<{ Params: { weekId: string; goalId: string } }>(
    "/api/entries/:weekId/goals/:goalId/completion",
    async (req) => apply(req.params.weekId, req.params.goalId, null),
  );
}
