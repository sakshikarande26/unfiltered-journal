import type postgres from "postgres";
import type {
  SyncCompletion,
  SyncEntry,
  SyncGoal,
  SyncPhoto,
  SyncPull,
  SyncPulled,
} from "../../shared/sync.js";
import type { WeekId } from "../../shared/types.js";
import { isLocked, weekBounds } from "../../shared/week.js";

export type Sql = postgres.Sql;

/**
 * The mirror's write rules, mirroring the device's own freeze moments:
 *
 * - goal text/photos freeze at publish        -> writes rejected once the
 *   parent entry's published_at is set
 * - entry content + entry photos freeze at    -> writes rejected once the
 *   week end (in the user's journal tz)         week locks
 * - pinned/archived/goalsDisclosed and goal   -> writable forever
 *   completions
 *
 * The server does not trust a client-supplied user id: every query is scoped
 * to the JWT's sub, threaded through as `userId`.
 */

export class SyncRejected extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SyncRejected";
  }
}

export interface PushReport {
  applied: {
    entries: number;
    photos: number;
    goals: number;
    completions: number;
  };
  rejected: {
    kind: string;
    key: string;
    weekId: string;
    code: string;
    message: string;
  }[];
}

const CONTENT_FIELDS = [
  "title",
  "description",
  "liked",
  "challenging",
] as const;

export async function upsertUser(
  sql: Sql,
  user: { id: string; email: string; journalTz: string },
): Promise<void> {
  await sql`
    INSERT INTO public.users (id, email, journal_tz)
    VALUES (${user.id}, ${user.email}, ${user.journalTz})
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email,
          journal_tz = EXCLUDED.journal_tz,
          updated_at = now()
  `;
}

async function entryRow(
  sql: Sql,
  userId: string,
  weekId: string,
): Promise<
  | {
      published_at: Date | null;
      title: string;
      description: string;
      liked: string;
      challenging: string;
    }
  | undefined
> {
  const rows = await sql`
    SELECT published_at, title, description, liked, challenging
    FROM public.entries
    WHERE user_id = ${userId} AND week_id = ${weekId}
  `;
  return rows[0] as never;
}

function contentDiffers(
  incoming: SyncEntry,
  existing: {
    title: string;
    description: string;
    liked: string;
    challenging: string;
  },
): string | null {
  for (const f of CONTENT_FIELDS) {
    if (incoming[f] !== existing[f]) return f;
  }
  return null;
}

async function pushEntry(
  sql: Sql,
  userId: string,
  tz: string,
  now: Date,
  e: SyncEntry,
): Promise<void> {
  const locked = isLocked(e.weekId as WeekId, tz, now);
  const existing = await entryRow(sql, userId, e.weekId);
  const publishedAt = e.publishedAt === null ? null : new Date(e.publishedAt);

  if (publishedAt !== null) {
    const { endExclusive } = weekBounds(e.weekId as WeekId, tz);
    if (publishedAt.getTime() >= endExclusive.getTime()) {
      throw new SyncRejected(
        "PUBLISH_AFTER_LOCK",
        `${e.weekId} was published after the week ended. A missed week stays a gap.`,
      );
    }
  }

  if (!existing) {
    await sql`
      INSERT INTO public.entries
        (user_id, week_id, title, description, liked, challenging,
         created_at, published_at, pinned, archived, goals_disclosed)
      VALUES
        (${userId}, ${e.weekId}, ${e.title}, ${e.description}, ${e.liked},
         ${e.challenging}, ${e.createdAt},
         ${publishedAt?.toISOString() ?? null},
         ${e.pinned}, ${e.archived}, ${e.goalsDisclosed})
    `;
    return;
  }

  if (existing.published_at !== null) {
    const pushedIso = publishedAt?.toISOString() ?? null;
    const existingIso = existing.published_at!.toISOString();
    if (pushedIso !== existingIso) {
      throw new SyncRejected(
        "ENTRY_FROZEN",
        `${e.weekId} is already published; its publish moment cannot change.`,
      );
    }
  }
  // Entry content stays editable until the week ends even when published -
  // only goals freeze at publish. The lock is the freeze point here.
  if (locked && contentDiffers(e, existing)) {
    throw new SyncRejected(
      "ENTRY_FROZEN",
      `${e.weekId} content is frozen; the week has ended.`,
    );
  }

  await sql`
    UPDATE public.entries SET
      title           = ${e.title},
      description     = ${e.description},
      liked           = ${e.liked},
      challenging     = ${e.challenging},
      published_at    = COALESCE(published_at, ${publishedAt?.toISOString() ?? null}),
      pinned          = ${e.pinned},
      archived        = ${e.archived},
      goals_disclosed = ${e.goalsDisclosed},
      updated_at      = now(),
      sync_seq        = nextval('public.sync_seq')
    WHERE user_id = ${userId} AND week_id = ${e.weekId}
  `;
}

async function pushPhoto(
  sql: Sql,
  userId: string,
  tz: string,
  now: Date,
  p: SyncPhoto,
): Promise<void> {
  const existing = await entryRow(sql, userId, p.weekId);
  if (!existing) {
    throw new SyncRejected(
      "ENTRY_NOT_FOUND",
      `photo for unknown entry ${p.weekId}`,
    );
  }
  // Photos deliberately have no lock check. The mirror cannot tell a photo
  // added after the week ended from one that existed all along and is only
  // now reaching the server - the freeze is enforced on the device, and the
  // mirror must let a late first sync of a photo entry converge.
  void tz;
  void now;
  await sql`
    INSERT INTO public.photos
      (user_id, week_id, position, storage_path, thumb_storage_path,
       width, height, ai_description)
    VALUES
      (${userId}, ${p.weekId}, ${p.position}, ${p.storagePath},
       ${p.thumbStoragePath}, ${p.width}, ${p.height}, ${p.aiDescription})
    ON CONFLICT (user_id, week_id, position) DO UPDATE SET
      storage_path       = EXCLUDED.storage_path,
      thumb_storage_path = EXCLUDED.thumb_storage_path,
      width              = EXCLUDED.width,
      height             = EXCLUDED.height,
      ai_description     = EXCLUDED.ai_description,
      updated_at         = now(),
      sync_seq           = nextval('public.sync_seq')
  `;
}

async function pushGoal(
  sql: Sql,
  userId: string,
  g: SyncGoal,
): Promise<void> {
  const existing = await entryRow(sql, userId, g.weekId);
  if (!existing) {
    throw new SyncRejected(
      "ENTRY_NOT_FOUND",
      `goal for unknown entry ${g.weekId}`,
    );
  }
  const [prior] = await sql<{ text: string }[]>`
    SELECT text FROM public.goals WHERE goal_id = ${g.goalId} LIMIT 1`;
  // Goals freeze at publish: a *changed* row on a published entry is rejected.
  // Inserts and identical re-pushes still go through - the device stops
  // sending new goals at publish, and a first-time sync of an already
  // published entry must converge.
  if (existing.published_at !== null && prior && prior.text !== g.text) {
    throw new SyncRejected(
      "GOALS_FROZEN",
      `${g.weekId} is published; goals froze at publish.`,
    );
  }
  await sql`
    INSERT INTO public.goals
      (goal_id, user_id, week_id, position, text, photo_storage_path)
    VALUES
      (${g.goalId}, ${userId}, ${g.weekId}, ${g.position}, ${g.text},
       ${g.photoStoragePath})
    ON CONFLICT (goal_id) DO UPDATE SET
      position           = EXCLUDED.position,
      text               = EXCLUDED.text,
      photo_storage_path = EXCLUDED.photo_storage_path,
      updated_at         = now(),
      sync_seq           = nextval('public.sync_seq')
  `;
}

async function pushCompletion(
  sql: Sql,
  userId: string,
  c: SyncCompletion,
): Promise<void> {
  // Last-write-wins on changed_at: the only mutable field after lock.
  const res = await sql`
    INSERT INTO public.goal_completions
      (goal_id, user_id, week_id, completed_at, changed_at)
    VALUES
      (${c.goalId}, ${userId}, ${c.weekId}, ${c.completedAt}, ${c.changedAt})
    ON CONFLICT (goal_id) DO UPDATE SET
      completed_at = EXCLUDED.completed_at,
      changed_at   = EXCLUDED.changed_at,
      sync_seq     = nextval('public.sync_seq')
    WHERE EXCLUDED.changed_at > goal_completions.changed_at
    RETURNING goal_id
  `;
  if (res.length === 0) {
    const exists = await sql`
      SELECT 1 FROM public.goal_completions WHERE goal_id = ${c.goalId}
    `;
    if (exists.length === 0) {
      throw new SyncRejected(
        "GOAL_NOT_FOUND",
        `completion for unknown goal ${c.goalId}`,
      );
    }
    // Otherwise a newer change already won; that is LWW working, not an error.
  }
}

/** One push: apply what passes, report what the freeze rules rejected. */
export async function applyPush(
  sql: Sql,
  userId: string,
  email: string,
  body: {
    journalTz: string;
    entries: SyncEntry[];
    photos: SyncPhoto[];
    goals: SyncGoal[];
    completions: SyncCompletion[];
  },
  now: Date,
): Promise<PushReport> {
  const tz = body.journalTz;
  await upsertUser(sql, { id: userId, email, journalTz: tz });

  const report: PushReport = {
    applied: { entries: 0, photos: 0, goals: 0, completions: 0 },
    rejected: [],
  };

  // Order matters: parents before children so FK checks and freeze checks see
  // the entry rows this push itself created.
  const jobs: readonly (readonly [
    keyof PushReport["applied"],
    string,
    string,
    () => Promise<void>,
  ])[] =
    [
      ...body.entries.map(
        (e) =>
          ["entries", e.weekId, e.weekId, () => pushEntry(sql, userId, tz, now, e)] as const,
      ),
      ...body.photos.map(
        (p) =>
          [
            "photos",
            `${p.weekId}#${p.position}`,
            p.weekId,
            () => pushPhoto(sql, userId, tz, now, p),
          ] as const,
      ),
      ...body.goals.map(
        (g) =>
          ["goals", g.goalId, g.weekId, () => pushGoal(sql, userId, g)] as const,
      ),
      ...body.completions.map(
        (c) =>
          [
            "completions",
            c.goalId,
            c.weekId,
            () => pushCompletion(sql, userId, c),
          ] as const,
      ),
    ];

  for (const [kind, key, weekId, fn] of jobs) {
    try {
      await fn();
      report.applied[kind] += 1;
    } catch (err) {
      if (err instanceof SyncRejected) {
        report.rejected.push({
          kind,
          key,
          weekId,
          code: err.code,
          message: err.message,
        });
      } else {
        throw err;
      }
    }
  }
  return report;
}

interface PulledRow {
  sync_seq: string | number;
  [k: string]: unknown;
}

function pulled<T>(rows: PulledRow[], map: (r: PulledRow) => T): SyncPulled<T>[] {
  return rows.map((r) => ({ seq: Number(r.sync_seq), record: map(r) }));
}

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : (v as Date).toISOString();

export async function pull(
  sql: Sql,
  userId: string,
  since: number,
  limit = 500,
): Promise<SyncPull> {
  const [entries, photos, goals, completions] = await Promise.all([
    sql<PulledRow[]>`
      SELECT * FROM public.entries
      WHERE user_id = ${userId} AND sync_seq > ${since}
      ORDER BY sync_seq LIMIT ${limit}
    `,
    sql<PulledRow[]>`
      SELECT * FROM public.photos
      WHERE user_id = ${userId} AND sync_seq > ${since}
      ORDER BY sync_seq LIMIT ${limit}
    `,
    sql<PulledRow[]>`
      SELECT * FROM public.goals
      WHERE user_id = ${userId} AND sync_seq > ${since}
      ORDER BY sync_seq LIMIT ${limit}
    `,
    sql<PulledRow[]>`
      SELECT * FROM public.goal_completions
      WHERE user_id = ${userId} AND sync_seq > ${since}
      ORDER BY sync_seq LIMIT ${limit}
    `,
  ]);

  const result: SyncPull = {
    seq: since,
    entries: pulled(entries, (r) => ({
      weekId: String(r.week_id),
      title: String(r.title),
      description: String(r.description),
      liked: String(r.liked),
      challenging: String(r.challenging),
      createdAt: iso(r.created_at)!,
      publishedAt: iso(r.published_at),
      pinned: Boolean(r.pinned),
      archived: Boolean(r.archived),
      goalsDisclosed: Boolean(r.goals_disclosed),
    })),
    photos: pulled(photos, (r) => ({
      weekId: String(r.week_id),
      position: Number(r.position),
      storagePath: String(r.storage_path),
      thumbStoragePath: String(r.thumb_storage_path),
      width: Number(r.width),
      height: Number(r.height),
      aiDescription: (r.ai_description as string | null) ?? null,
    })),
    goals: pulled(goals, (r) => ({
      goalId: String(r.goal_id),
      weekId: String(r.week_id),
      position: Number(r.position),
      text: String(r.text),
      photoStoragePath: (r.photo_storage_path as string | null) ?? null,
    })),
    completions: pulled(completions, (r) => ({
      goalId: String(r.goal_id),
      weekId: String(r.week_id),
      completedAt: iso(r.completed_at),
      changedAt: iso(r.changed_at)!,
    })),
  };

  result.seq = Math.max(
    since,
    ...result.entries.map((p) => p.seq),
    ...result.photos.map((p) => p.seq),
    ...result.goals.map((p) => p.seq),
    ...result.completions.map((p) => p.seq),
  );
  return result;
}
