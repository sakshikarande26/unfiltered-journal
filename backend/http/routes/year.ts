import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { YearGridCell, YearGridView } from "../../../shared/sync.js";
import type { WeekId } from "../../../shared/types.js";
import { isLocked, weekIdAt, weekIdsOfYear } from "../../../shared/week.js";
import { entryJsonPath } from "../../store/paths.js";
import { ApiError } from "../errors.js";
import type { Ctx } from "../context.js";
import { photoUrlOf } from "../views.js";

/**
 * The private year grid: filled weeks, missed weeks, upcoming weeks. A missed
 * week is a real cell in the grid - the gap is part of the record, which is
 * the whole point of the app.
 */
export function yearRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get<{ Querystring: { year?: string } }>("/api/year", async (req) => {
    const year = Number(req.query.year ?? new Date().getFullYear());
    if (!Number.isInteger(year) || year < 1970 || year > 2100) {
      throw new ApiError("INVALID_BODY", "?year= must be a real year");
    }
    const current = weekIdAt(ctx.now(), ctx.tz);
    const weeks: YearGridCell[] = weekIdsOfYear(year).map((weekId: WeekId) => {
      const hasEntry = existsSync(entryJsonPath(ctx.dataDir, weekId));
      const { entry } = ctx.load(weekId);
      let state: YearGridCell["state"];
      if (hasEntry) state = "filled";
      else if (weekId === current) state = "current";
      else if (isLocked(weekId, ctx.tz, ctx.now())) state = "missed";
      else state = "upcoming";
      return {
        weekId,
        state,
        coverUrl:
          entry && entry.photos.length > 0
            ? photoUrlOf(weekId, entry.photos[0]!.thumbFilename, true)
            : null,
        publishedAt: entry?.publishedAt ?? null,
      };
    });
    const view: YearGridView = { year, weeks };
    return view;
  });
}
