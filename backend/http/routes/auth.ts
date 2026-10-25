import type { FastifyInstance } from "fastify";
import { authCredentialsSchema, type AuthStatus } from "../../../shared/sync.js";
import type { AuthClient } from "../../auth/client.js";
import { AuthFailed } from "../../auth/client.js";
import {
  ArchiveOwnerMismatch,
  bindOwner,
  clearSession,
  readSession,
  writeSession,
} from "../../auth/sessionStore.js";
import type { Ctx } from "../context.js";
import { ApiError } from "../errors.js";
import { parse } from "./draft.js";

/**
 * Sign-in binds the local archive to an account. The app itself stays usable
 * signed-out - local-first means the archive is real with or without a
 * network - but sync only ever runs for the bound owner.
 */
export function authRoutes(
  app: FastifyInstance,
  ctx: Ctx,
  auth: AuthClient,
): void {
  const status = (): AuthStatus => {
    const session = readSession(ctx.dataDir);
    return {
      mode: auth.mode,
      signedIn: session !== null,
      email: session?.email ?? null,
      userId: session?.userId ?? null,
    };
  };

  app.get("/api/auth/status", async () => status());

  const signIn = async (
    kind: "signup" | "login",
    body: unknown,
  ): Promise<AuthStatus> => {
    const { email, password } = parse(authCredentialsSchema, body);
    try {
      const session =
        kind === "signup"
          ? await auth.signUp(email, password)
          : await auth.signIn(email, password);
      bindOwner(ctx.dataDir, session.userId);
      writeSession(ctx.dataDir, session);
      return status();
    } catch (e) {
      if (e instanceof ArchiveOwnerMismatch) {
        throw new ApiError(
          "ARCHIVE_OWNED",
          e.message +
            " Sign back in as that account, or move the archive first.",
        );
      }
      if (e instanceof AuthFailed) {
        throw new ApiError("AUTH_FAILED", e.message);
      }
      throw e;
    }
  };

  app.post("/api/auth/signup", async (req) => signIn("signup", req.body));
  app.post("/api/auth/login", async (req) => signIn("login", req.body));

  app.post("/api/auth/logout", async () => {
    clearSession(ctx.dataDir);
    return status();
  });
}
