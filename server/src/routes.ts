import type { FastifyInstance, FastifyRequest } from "fastify";
import { syncPushSchema } from "../../shared/sync.js";
import { ApiError } from "./errors.js";
import type { Storage } from "./storage.js";
import { applyPush, pull, type Sql } from "./store.js";
import type { AuthUser } from "./auth.js";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser;
  }
}

/**
 * Storage paths are always relative to the caller: `<weekId>/photos/...` or
 * `<weekId>/goal-photos/...`. The server prepends the JWT's user id, so the
 * path namespace is per-user and one user can never name another's objects -
 * the same single check the bucket policy makes.
 */
const OBJECT_PATH =
  /^\d{4}-W\d{2}\/(photos\/(thumbs\/)?|goal-photos\/)[A-Za-z0-9._-]+$/;

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function userId(req: FastifyRequest): string {
  return req.user.userId;
}

export function syncRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; storage: Storage; now: () => Date },
): void {
  app.post("/sync/push", async (req) => {
    const parsed = syncPushSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError("INVALID_BODY", parsed.error.message);
    }
    return applyPush(
      deps.sql,
      userId(req),
      req.user.email,
      parsed.data,
      deps.now(),
    );
  });

  app.get<{ Querystring: { since?: string } }>("/sync/pull", async (req) => {
    const since = Number(req.query.since ?? "0");
    if (!Number.isInteger(since) || since < 0) {
      throw new ApiError("INVALID_BODY", "?since= must be a seq integer");
    }
    return pull(deps.sql, userId(req), since);
  });

  /**
   * Photo upload: bytes to object storage, then the photo row arrives in the
   * next push carrying the same storage_path. Never the reverse order - a row
   * referencing an object that is not there yet is exactly the half-synced
   * state this ordering avoids.
   */
  app.put<{ Querystring: { path?: string } }>(
    "/sync/photos",
    async (req, reply) => {
      const path = req.query.path ?? "";
      if (!OBJECT_PATH.test(path)) {
        throw new ApiError(
          "INVALID_BODY",
          "?path must look like <weekId>/photos/<file> or <weekId>/goal-photos/<file>",
        );
      }
      const data = await req.file();
      if (!data) throw new ApiError("INVALID_BODY", "a file is required");
      const bytes = await data.toBuffer();
      await deps.storage.put(
        `${userId(req)}/${path}`,
        bytes,
        data.mimetype,
      );
      return reply.send({ storagePath: `${userId(req)}/${path}` });
    },
  );

  /** The pull side of photos: stream an object back to its owner. */
  app.get<{ Querystring: { path?: string } }>(
    "/sync/media",
    async (req, reply) => {
      const path = req.query.path ?? "";
      if (!OBJECT_PATH.test(path)) {
        throw new ApiError("INVALID_BODY", "invalid path");
      }
      const bytes = await deps.storage.get(`${userId(req)}/${path}`);
      if (!bytes) {
        return reply.code(404).send({ error: { code: "NOT_FOUND" } });
      }
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      return reply
        .type(CONTENT_TYPES[ext] ?? "application/octet-stream")
        .send(bytes);
    },
  );
}
