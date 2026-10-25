import { z } from "zod";
import { MAX_GOALS, MAX_PHOTOS, weekIdPattern } from "./types.js";

/**
 * Sync wire shapes - the records that travel between a device and the mirror.
 *
 * Everything mirrors the on-disk files, not the SQLite index: a push is the
 * archive's current truth, a pull is applied back onto the archive. The only
 * write legal forever is a goal completion, which carries `changedAt` so two
 * devices toggling the same goal resolve last-write-wins.
 *
 * `sync_seq` is server-assigned (one shared sequence across tables), so a pull
 * cursor never depends on a client clock.
 */

const isoInstant = z.string().datetime({ offset: true });
const weekId = z.string().regex(weekIdPattern);

/**
 * Shared secret for local development only - the local app's dev auth issuer
 * and the dev sync server both default to it so the loop works with zero
 * setup. It is deliberately insecure and must never appear in a real
 * deployment: production sets TUJ_JWT_SECRET to the Supabase project secret.
 */
export const DEV_JWT_SECRET = "tuj-dev-insecure-jwt-secret";

export const syncEntrySchema = z.object({
  weekId,
  title: z.string().max(120),
  description: z.string().max(300),
  liked: z.string().max(2000),
  challenging: z.string().max(2000),
  createdAt: isoInstant,
  /** Null while the entry is a draft. Once set on the mirror, content
   *  fields are immutable. */
  publishedAt: isoInstant.nullable(),
  pinned: z.boolean(),
  archived: z.boolean(),
  goalsDisclosed: z.boolean(),
});

export const syncPhotoSchema = z.object({
  weekId,
  position: z.number().int().min(0).max(MAX_PHOTOS - 1),
  /** Bytes live in object storage; only the reference syncs. */
  storagePath: z.string().min(1),
  thumbStoragePath: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aiDescription: z.string().max(1000).nullable(),
});

export const syncGoalSchema = z.object({
  goalId: z.string().uuid(),
  weekId,
  position: z.number().int().min(0).max(MAX_GOALS - 1),
  text: z.string().min(1).max(200),
  /** Private permanently; syncs for the owner only. */
  photoStoragePath: z.string().min(1).nullable(),
});

export const syncCompletionSchema = z.object({
  goalId: z.string().uuid(),
  weekId,
  /** Null = toggled off. The row still syncs so an un-completion on one
   *  device reaches the others. */
  completedAt: isoInstant.nullable(),
  changedAt: isoInstant,
});

export const syncPushSchema = z.object({
  /** The device's journal timezone, so the mirror can evaluate the same
   *  entry lock the device does. */
  journalTz: z.string().min(1),
  entries: z.array(syncEntrySchema).max(200),
  photos: z.array(syncPhotoSchema).max(2000),
  goals: z.array(syncGoalSchema).max(2000),
  completions: z.array(syncCompletionSchema).max(2000),
});

export type SyncEntry = z.infer<typeof syncEntrySchema>;
export type SyncPhoto = z.infer<typeof syncPhotoSchema>;
export type SyncGoal = z.infer<typeof syncGoalSchema>;
export type SyncCompletion = z.infer<typeof syncCompletionSchema>;
export type SyncPush = z.infer<typeof syncPushSchema>;

/** A pull response row carries the cursor position it was read at. */
export interface SyncPulled<T> {
  seq: number;
  record: T;
}

export interface SyncPull {
  /** Highest seq seen; the next pull starts after this. */
  seq: number;
  entries: SyncPulled<SyncEntry>[];
  photos: SyncPulled<SyncPhoto>[];
  goals: SyncPulled<SyncGoal>[];
  completions: SyncPulled<SyncCompletion>[];
}

/* ---- local app <-> client wire shapes for auth + sync + year grid ---- */

export const authCredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export interface AuthStatus {
  /** "supabase" talks to a real project; "dev" mints local tokens for
   *  development without GoTrue. */
  mode: "supabase" | "dev";
  signedIn: boolean;
  email: string | null;
  userId: string | null;
}

export interface SyncStatusView {
  state: "signed-out" | "idle" | "syncing" | "error";
  /** Pending weeks + photo uploads, a rough "is it saved" signal. */
  pending: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface YearGridCell {
  weekId: WeekIdLoose;
  /** filled = entry exists; missed = week ended with no entry;
   *  current = the open week; upcoming = not started yet. */
  state: "filled" | "missed" | "current" | "upcoming";
  coverUrl: string | null;
  publishedAt: string | null;
}

type WeekIdLoose = string;

export interface YearGridView {
  year: number;
  weeks: YearGridCell[];
}
