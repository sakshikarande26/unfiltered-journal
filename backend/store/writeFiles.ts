import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import type { z } from "zod";
import {
  entryFileSchema,
  goalsFileSchema,
  profileSchema,
  progressFileSchema,
  type EntryFile,
  type GoalsFile,
  type Profile,
  type ProgressFile,
  type WeekId,
} from "../../shared/types.js";
import {
  entryJsonPath,
  goalPhotosDir,
  goalsJsonPath,
  photosDir,
  profileJsonPath,
  progressJsonPath,
  thumbsDir,
  weekDir,
} from "./paths.js";

/**
 * Writers for the three per-week files and the profile.
 *
 * Every write is atomic: serialise to <path>.tmp, then rename() over the
 * target. A crash mid-write leaves the previous file intact rather than a
 * half-written one, which matters more here than usual because these files are
 * the source of truth and the database is only an index of them.
 *
 * Each writer validates against the same schema the reader uses, so a value
 * that reindex.ts would reject can never reach disk in the first place.
 */
function writeJsonAtomic<T>(path: string, schema: z.ZodType<T>, value: T): void {
  const validated = schema.parse(value);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(validated, null, 2)}\n`);
  renameSync(tmp, path);
}

/** Creates the week's directory tree. Safe to call repeatedly. */
export function ensureWeekDirs(dataDir: string, weekId: WeekId): void {
  mkdirSync(weekDir(dataDir, weekId), { recursive: true });
  mkdirSync(thumbsDir(dataDir, weekId), { recursive: true });
  mkdirSync(photosDir(dataDir, weekId), { recursive: true });
  mkdirSync(goalPhotosDir(dataDir, weekId), { recursive: true });
}

export function writeEntryFile(
  dataDir: string,
  weekId: WeekId,
  entry: EntryFile,
): void {
  ensureWeekDirs(dataDir, weekId);
  writeJsonAtomic(entryJsonPath(dataDir, weekId), entryFileSchema, entry);
}

export function writeGoalsFile(
  dataDir: string,
  weekId: WeekId,
  goals: GoalsFile,
): void {
  ensureWeekDirs(dataDir, weekId);
  writeJsonAtomic(goalsJsonPath(dataDir, weekId), goalsFileSchema, goals);
}

export function writeProgressFile(
  dataDir: string,
  weekId: WeekId,
  progress: ProgressFile,
): void {
  ensureWeekDirs(dataDir, weekId);
  writeJsonAtomic(
    progressJsonPath(dataDir, weekId),
    progressFileSchema,
    progress,
  );
}

export function writeProfile(dataDir: string, profile: Profile): void {
  mkdirSync(dataDir, { recursive: true });
  writeJsonAtomic(profileJsonPath(dataDir), profileSchema, profile);
}
