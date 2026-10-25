import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { verifyToken } from "./auth.js";
import { ApiError } from "./errors.js";
import { syncRoutes } from "./routes.js";
import type { Storage } from "./storage.js";
import type { Sql } from "./store.js";

export interface ServerOptions {
  sql: Sql;
  storage: Storage;
  /** HS256 secret - the Supabase project's JWT secret in production. */
  jwtSecret: string;
  now?: () => Date;
}

export async function buildServerApp(
  options: ServerOptions,
): Promise<FastifyInstance> {
  const now = options.now ?? (() => new Date());
  const app = Fastify({ logger: false });

  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  });

  app.get("/health", async () => ({ ok: true }));

  // Auth: every /sync/* route requires a bearer token; the verified sub is
  // the only source of user identity anywhere below.
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/sync")) return;
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const user = token ? await verifyToken(options.jwtSecret, token) : null;
    if (!user) {
      return reply
        .code(401)
        .send({ error: { code: "UNAUTHORIZED", message: "sign in required" } });
    }
    req.user = user;
  });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send(error.toBody());
    }
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(500).send({ error: { code: "INTERNAL", message } });
  });

  syncRoutes(app, { sql: options.sql, storage: options.storage, now });
  return app;
}
