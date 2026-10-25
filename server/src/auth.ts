import { SignJWT, jwtVerify } from "jose";

/**
 * The one identity rule of the whole system: the user id comes from the JWT,
 * never from the request. Every sync route calls requireUser; nothing reads a
 * user_id field a client could write.
 *
 * Tokens are HS256 JWTs. In production that is the Supabase project's JWT
 * secret; in local dev it is whatever TUJ_JWT_SECRET the server and the local
 * app's dev issuer share.
 */
export interface AuthUser {
  userId: string;
  email: string;
}

export async function verifyToken(
  secret: string,
  token: string,
): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
    );
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return null;
    }
    return {
      userId: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
    };
  } catch {
    return null;
  }
}

/**
 * Dev-mode issuer, shared with the local app's DevAuthClient so a full
 * signup -> sync loop can run without GoTrue. Never wired in production:
 * the local app only uses it when TUJ_AUTH_MODE=dev.
 */
export async function issueDevToken(
  secret: string,
  userId: string,
  email: string,
): Promise<string> {
  return new SignJWT({ email, aud: "authenticated", role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(secret));
}
