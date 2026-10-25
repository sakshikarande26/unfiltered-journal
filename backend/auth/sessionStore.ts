import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * data/session.json - who this archive is signed in as, and the token the
 * sync layer sends. It is a file, not a table: the index is rebuildable from
 * data/entries/, and a rebuild must never sign anyone out.
 *
 * data/owner.json - the user id this archive belongs to. One archive, one
 * owner: signing in as a different user refuses rather than interleaving two
 * people's weeks in one archive.
 */
const sessionSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  accessToken: z.string(),
  refreshToken: z.string().nullable(),
  /** ISO instant the access token expires; null for non-expiring dev tokens. */
  expiresAt: z.string().nullable(),
  mode: z.enum(["supabase", "dev"]),
});

const ownerSchema = z.object({ userId: z.string().uuid() });

export type Session = z.infer<typeof sessionSchema>;

export function sessionPath(dataDir: string): string {
  return join(dataDir, "session.json");
}

export function ownerPath(dataDir: string): string {
  return join(dataDir, "owner.json");
}

export function readSession(dataDir: string): Session | null {
  const path = sessionPath(dataDir);
  if (!existsSync(path)) return null;
  const parsed = sessionSchema.safeParse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  return parsed.success ? parsed.data : null;
}

export function writeSession(dataDir: string, session: Session): void {
  const tmp = `${sessionPath(dataDir)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(session, null, 2)}\n`);
  renameSync(tmp, sessionPath(dataDir));
}

export function clearSession(dataDir: string): void {
  try {
    unlinkSync(sessionPath(dataDir));
  } catch {
    /* already absent */
  }
}

/**
 * Returns the owner user id, binding the archive to `userId` on first sign-in.
 * Throws when the archive belongs to someone else.
 */
export function bindOwner(dataDir: string, userId: string): string {
  const path = ownerPath(dataDir);
  if (existsSync(path)) {
    const existing = ownerSchema.parse(
      JSON.parse(readFileSync(path, "utf8")),
    );
    if (existing.userId !== userId) {
      throw new ArchiveOwnerMismatch(existing.userId);
    }
    return existing.userId;
  }
  writeFileSync(path, `${JSON.stringify({ userId }, null, 2)}\n`);
  return userId;
}

export class ArchiveOwnerMismatch extends Error {
  constructor(readonly ownerUserId: string) {
    super("This archive belongs to a different account.");
    this.name = "ArchiveOwnerMismatch";
  }
}
