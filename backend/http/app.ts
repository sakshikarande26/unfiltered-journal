import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { mkdirSync } from "node:fs";
import { entriesDir } from "../store/paths.js";
import type { AuthClient } from "../auth/client.js";
import type { SyncEngine } from "../sync/engine.js";
import { makeCtx, type AppOptions, type Ctx } from "./context.js";
import { ApiError } from "./errors.js";
import { completionRoutes } from "./routes/completion.js";
import { draftRoutes } from "./routes/draft.js";
import { entryRoutes } from "./routes/entries.js";
import { profileRoutes } from "./routes/profile.js";
import { authRoutes } from "./routes/auth.js";
import { syncRoutes } from "./routes/sync.js";
import { yearRoutes } from "./routes/year.js";
import { InvalidWeekIdError } from "../../shared/week.js";
import { EntryFileError } from "../store/entryFiles.js";

export async function buildApp(
  options: AppOptions,
): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const ctx = makeCtx(options);
  mkdirSync(entriesDir(options.dataDir), { recursive: true });

  const app = Fastify({ logger: false });

  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  });

  /**
   * Entry photos are served. goal-photos/ is not registered here and has no
   * route anywhere - goal photos are private permanently, so there is no URL
   * that reaches them.
   */
  await app.register(fastifyStatic, {
    root: entriesDir(options.dataDir),
    prefix: "/media/",
    index: false,
    list: false,
    // Only the two served directories. A request for goal-photos/ 404s
    // because it does not match, not because a check rejected it.
    allowedPath: (path) =>
      /^\/[0-9]{4}-W[0-9]{2}\/photos\/(thumbs\/)?[^/]+$/.test(path),
  });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send(error.toBody());
    }
    if (error instanceof InvalidWeekIdError) {
      return reply
        .code(400)
        .send({ error: { code: "INVALID_WEEK_ID", message: error.message } });
    }
    if (error instanceof EntryFileError) {
      return reply
        .code(500)
        .send({ error: { code: "CORRUPT_ARCHIVE", message: error.message } });
    }
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(500).send({ error: { code: "INTERNAL", message } });
  });

  profileRoutes(app, ctx);
  draftRoutes(app, ctx);
  entryRoutes(app, ctx);
  completionRoutes(app, ctx);
  yearRoutes(app, ctx);
  if (options.sync) {
    authRoutes(app, ctx, options.sync.auth);
    syncRoutes(app, ctx, options.sync.engine);
  }

  return { app, ctx };
}
