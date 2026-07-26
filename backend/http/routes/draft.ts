import type { FastifyInstance } from "fastify";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_PHOTOS,
  descriptionPutSchema,
  draftPatchSchema,
  goalsPutSchema,
  type DraftView,
  type EntryFile,
} from "../../../shared/types.js";
import { NotAnImageError, storePhoto } from "../../photos.js";
import { goalsAreFrozen } from "../../state.js";
import { photosDir, thumbsDir } from "../../store/paths.js";
import { writeEntryFile, writeGoalsFile } from "../../store/writeFiles.js";
import { assertWritableWeek, requireDraft, type Ctx } from "../context.js";
import { ApiError, goalsFrozen } from "../errors.js";
import { entryDetail, goalsOwnerView, ownerGoalView } from "../views.js";

type WeekQuery = { Querystring: { week?: string } };

/**
 * Everything that writes entry content.
 *
 * No route here takes a week id in its path. Each takes ?week=, which the
 * client echoes back from GET /api/draft rather than computing - see
 * assertWritableWeek for why that indirection exists. A past week is always
 * locked, so backfilling is refused by the same check that refuses editing a
 * locked entry.
 */
export function draftRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get("/api/draft", async () => {
    const weekId = ctx.currentWeek();
    const { entry, goals, progress } = ctx.load(weekId);
    const detail = entry
      ? entryDetail(weekId, entry, goals, progress, ctx.tz, ctx.now())
      : null;
    const view: DraftView = {
      weekId,
      state: detail?.state ?? "empty",
      entry: detail,
      goals: ownerGoalView(goals, progress),
      goalsWritable: !goalsAreFrozen(entry?.publishedAt ?? null),
    };
    return view;
  });

  // Creates the entry on first write. One entry per week falls out of the file
  // either existing or not - there is no second week id it could target.
  app.put<WeekQuery>("/api/draft", async (req) => {
    const patch = parse(draftPatchSchema, req.body);
    return ctx.serialise(() => {
      const weekId = assertWritableWeek(ctx, req.query.week);
      const { entry, goals, progress } = ctx.load(weekId);
      const base: EntryFile = entry ?? {
        title: "",
        description: "",
        liked: "",
        challenging: "",
        createdAt: ctx.now().toISOString(),
        publishedAt: null,
        createdTz: ctx.tz,
        photos: [],
      };
      const next: EntryFile = {
        ...base,
        title: patch.title ?? base.title,
        description: patch.description ?? base.description,
        liked: patch.liked ?? base.liked,
        challenging: patch.challenging ?? base.challenging,
      };
      writeEntryFile(ctx.dataDir, weekId, next);
      ctx.reindex();
      return entryDetail(weekId, next, goals, progress, ctx.tz, ctx.now());
    });
  });

  // Publishing happens once, and it is the moment goals freeze.
  app.post<WeekQuery>("/api/draft/publish", async (req) =>
    ctx.serialise(() => {
      const { weekId, entry, goals, progress } = requireDraft(ctx, req.query.week);
      if (entry.publishedAt !== null) {
        throw new ApiError(
          "ALREADY_PUBLISHED",
          "This entry was already published. Publishing happens once.",
        );
      }
      const next: EntryFile = { ...entry, publishedAt: ctx.now().toISOString() };
      writeEntryFile(ctx.dataDir, weekId, next);
      ctx.reindex();
      return entryDetail(weekId, next, goals, progress, ctx.tz, ctx.now());
    }),
  );

  /**
   * The only route in the system that writes goal text or goal photos.
   *
   * It replaces the whole list rather than offering add/edit/delete, so the
   * publish freeze is checked in exactly one place. After publish this route is
   * the only thing that could change a goal, and it refuses.
   */
  app.put<WeekQuery>("/api/draft/goals", async (req) => {
    const body = parse(goalsPutSchema, req.body);
    return ctx.serialise(() => {
      const { weekId, entry, progress } = requireDraft(ctx, req.query.week);
      if (goalsAreFrozen(entry.publishedAt)) throw goalsFrozen();
      const goals = {
        goals: body.goals.map((g) => ({
          id: ctx.newGoalId(),
          text: g.text,
          photoFilename: g.photoFilename,
        })),
      };
      writeGoalsFile(ctx.dataDir, weekId, goals);
      ctx.reindex();
      return goalsOwnerView(weekId, entry, goals, progress);
    });
  });

  app.post<WeekQuery>("/api/draft/photos", async (req) => {
    const file = await req.file();
    if (!file) throw new ApiError("INVALID_BODY", "No file in the upload.");
    const bytes = await file.toBuffer();

    return ctx.serialise(async () => {
      const { weekId, entry, goals, progress } = requireDraft(
        ctx,
        req.query.week,
      );
      if (entry.photos.length >= MAX_PHOTOS) {
        throw new ApiError(
          "MAX_PHOTOS",
          `An entry holds at most ${MAX_PHOTOS} photos.`,
        );
      }
      let photo;
      try {
        photo = await storePhoto(ctx.dataDir, weekId, entry.photos.length, bytes);
      } catch (e) {
        if (e instanceof NotAnImageError) {
          throw new ApiError("NOT_AN_IMAGE", e.message);
        }
        throw e;
      }
      const next: EntryFile = { ...entry, photos: [...entry.photos, photo] };
      writeEntryFile(ctx.dataDir, weekId, next);
      ctx.reindex();
      return entryDetail(weekId, next, goals, progress, ctx.tz, ctx.now());
    });
  });

  // Removing a photo renumbers the rest so position 0 stays the cover.
  app.delete<WeekQuery & { Params: { position: string } }>(
    "/api/draft/photos/:position",
    async (req) =>
      ctx.serialise(() => {
        const { weekId, entry, goals, progress } = requireDraft(
          ctx,
          req.query.week,
        );
        const position = Number(req.params.position);
        const target = entry.photos[position];
        if (!target) {
          throw new ApiError("INVALID_BODY", `No photo at position ${position}.`);
        }
        for (const [dir, name] of [
          [photosDir(ctx.dataDir, weekId), target.filename],
          [thumbsDir(ctx.dataDir, weekId), target.thumbFilename],
        ] as const) {
          try {
            unlinkSync(join(dir, name));
          } catch {
            // Already gone. The manifest is what matters.
          }
        }
        const next: EntryFile = {
          ...entry,
          photos: entry.photos.filter((_, i) => i !== position),
        };
        writeEntryFile(ctx.dataDir, weekId, next);
        ctx.reindex();
        return entryDetail(weekId, next, goals, progress, ctx.tz, ctx.now());
      }),
  );

  // The user editing the one AI-written field. Nothing else in an entry is AI
  // generated, and this route cannot touch anything else.
  app.put<WeekQuery & { Params: { position: string } }>(
    "/api/draft/photos/:position/description",
    async (req) => {
      const body = parse(descriptionPutSchema, req.body);
      return ctx.serialise(() => {
        const { weekId, entry, goals, progress } = requireDraft(
          ctx,
          req.query.week,
        );
        const position = Number(req.params.position);
        if (!entry.photos[position]) {
          throw new ApiError("INVALID_BODY", `No photo at position ${position}.`);
        }
        const next: EntryFile = {
          ...entry,
          photos: entry.photos.map((p, i) =>
            i === position ? { ...p, aiDescription: body.aiDescription } : p,
          ),
        };
        writeEntryFile(ctx.dataDir, weekId, next);
        ctx.reindex();
        return entryDetail(weekId, next, goals, progress, ctx.tz, ctx.now());
      });
    },
  );
}

export function parse<T>(
  schema: {
    safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown };
  },
  body: unknown,
): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success || result.data === undefined) {
    const issues = result.error as {
      issues?: { path: unknown[]; message: string }[];
    };
    const detail = issues?.issues
      ?.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ApiError(
      detail?.includes("at most 5 element") ? "MAX_GOALS" : "INVALID_BODY",
      detail ?? "Invalid request body.",
    );
  }
  return result.data;
}
