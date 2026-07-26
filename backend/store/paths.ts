import { join } from "node:path";
import type { WeekId } from "../../shared/types.js";

/**
 * Every path in the app is derived here. Nothing concatenates data paths ad
 * hoc, so the goal-photos boundary below cannot be dissolved by a stray
 * join() somewhere else.
 *
 * data/entries/2026-W30/
 *   entry.json      mutable until the week ends, then never opened for write
 *   goals.json      mutable until publish, then never opened for write
 *   progress.json   mutable forever
 *   photos/         served
 *   goal-photos/    never served
 *
 * The three JSON files exist because there are three different mutability
 * rules. Which file you opened answers "is this write allowed", instead of a
 * conditional a future caller can forget.
 */

export const ENTRY_JSON = "entry.json";
export const GOALS_JSON = "goals.json";
export const PROGRESS_JSON = "progress.json";

export function entriesDir(dataDir: string): string {
  return join(dataDir, "entries");
}

/** The single local user's profile. Not indexed in SQLite - one record has
 *  nothing to index. */
export function profileJsonPath(dataDir: string): string {
  return join(dataDir, "profile.json");
}

export function weekDir(dataDir: string, weekId: WeekId): string {
  return join(entriesDir(dataDir), weekId);
}

export function entryJsonPath(dataDir: string, weekId: WeekId): string {
  return join(weekDir(dataDir, weekId), ENTRY_JSON);
}

export function goalsJsonPath(dataDir: string, weekId: WeekId): string {
  return join(weekDir(dataDir, weekId), GOALS_JSON);
}

export function progressJsonPath(dataDir: string, weekId: WeekId): string {
  return join(weekDir(dataDir, weekId), PROGRESS_JSON);
}

/** Entry photos. This directory is safe to serve. */
export function photosDir(dataDir: string, weekId: WeekId): string {
  return join(weekDir(dataDir, weekId), "photos");
}

export function thumbsDir(dataDir: string, weekId: WeekId): string {
  return join(photosDir(dataDir, weekId), "thumbs");
}

/**
 * Goal photos. Private permanently - no setting, flag or query parameter
 * discloses these. It is a sibling of photos/ rather than a subdirectory so
 * that a static handler pointed at photosDir() cannot reach it by traversal
 * or by a glob widening later.
 */
export function goalPhotosDir(dataDir: string, weekId: WeekId): string {
  return join(weekDir(dataDir, weekId), "goal-photos");
}
