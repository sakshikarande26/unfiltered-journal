import { createHash } from "node:crypto";
import { DEV_JWT_SECRET } from "../../shared/sync.js";
import type { Session } from "./sessionStore.js";

/**
 * How the local app signs a user in.
 *
 * SupabaseAuthClient talks to a real project's GoTrue REST API. DevAuthClient
 * mints the same HS256 token shape locally so the whole signup -> sync loop
 * runs with no GoTrue at all - selected by TUJ_AUTH_MODE (or by whether
 * TUJ_SUPABASE_URL is set).
 */
export interface AuthClient {
  readonly mode: "supabase" | "dev";
  signUp(email: string, password: string): Promise<Session>;
  signIn(email: string, password: string): Promise<Session>;
  refresh(session: Session): Promise<Session>;
}

export class AuthFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthFailed";
  }
}

/** A deterministic uuid for a dev account - the same email always maps to the
 *  same user id across devices, which is what lets dev sync merge archives. */
function devUserId(email: string): string {
  const hex = createHash("sha256")
    .update(`tuj-dev:${email.toLowerCase()}`)
    .digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "4" + hex.slice(13, 16),
    "8" + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");
}

async function devSession(secret: string, email: string): Promise<Session> {
  const { SignJWT } = await import("jose");
  const userId = devUserId(email);
  const accessToken = await new SignJWT({
    email,
    aud: "authenticated",
    role: "authenticated",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(secret));
  return {
    userId,
    email,
    accessToken,
    refreshToken: null,
    expiresAt: null,
    mode: "dev",
  };
}

export class DevAuthClient implements AuthClient {
  readonly mode = "dev";
  constructor(private readonly secret: string = DEV_JWT_SECRET) {}

  signUp(email: string, _password: string): Promise<Session> {
    return devSession(this.secret, email);
  }

  signIn(email: string, _password: string): Promise<Session> {
    return devSession(this.secret, email);
  }

  refresh(session: Session): Promise<Session> {
    return devSession(this.secret, session.email);
  }
}

interface GoTrueTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email?: string };
}

export class SupabaseAuthClient implements AuthClient {
  readonly mode = "supabase";
  constructor(
    private readonly url: string,
    private readonly anonKey: string,
  ) {}

  private async token(path: string, body: unknown): Promise<Session> {
    const res = await fetch(`${this.url}/auth/v1${path}`, {
      method: "POST",
      headers: {
        apikey: this.anonKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new AuthFailed(`${res.status}: ${text.slice(0, 200)}`);
    }
    const t = (await res.json()) as GoTrueTokenResponse;
    return {
      userId: t.user.id,
      email: t.user.email ?? "",
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      mode: "supabase",
    };
  }

  signUp(email: string, password: string): Promise<Session> {
    return this.token("/signup", { email, password });
  }

  signIn(email: string, password: string): Promise<Session> {
    return this.token("/token?grant_type=password", { email, password });
  }

  refresh(session: Session): Promise<Session> {
    if (!session.refreshToken) {
      throw new AuthFailed("no refresh token");
    }
    return this.token("/token?grant_type=refresh_token", {
      refresh_token: session.refreshToken,
    });
  }
}
