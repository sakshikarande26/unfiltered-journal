import type { FastifyInstance } from "fastify";
import { profileSchema } from "../../../shared/types.js";
import { readProfile } from "../../store/profile.js";
import { writeProfile } from "../../store/writeFiles.js";
import type { Ctx } from "../context.js";
import { parse } from "./draft.js";

/**
 * Single local user. No accounts, no auth, no server-side user record - the
 * profile is one file and there is exactly one of it.
 *
 * The profile has no lock. It describes who you are now, not what happened in
 * a given week, so freezing it would be meaningless.
 */
export function profileRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get("/api/profile", async () => readProfile(ctx.dataDir));

  app.put("/api/profile", async (req) => {
    const profile = parse(profileSchema, req.body);
    return ctx.serialise(() => {
      writeProfile(ctx.dataDir, profile);
      return profile;
    });
  });
}
