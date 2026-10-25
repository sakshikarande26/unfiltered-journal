import type { FastifyInstance } from "fastify";
import type { SyncEngine } from "../../sync/engine.js";
import type { Ctx } from "../context.js";

/**
 * Sync control for the UI: a status read and a manual kick. The engine also
 * runs on a timer from index.ts; this route exists because "sync now" is a
 * thing a person wants to press, not because it is needed.
 */
export function syncRoutes(
  app: FastifyInstance,
  _ctx: Ctx,
  engine: SyncEngine,
): void {
  app.get("/api/sync/status", async () => engine.status());

  app.post("/api/sync/now", async (req) => {
    await engine.runOnce();
    return engine.status();
  });
}
