import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  EntryFile,
  GoalsFile,
  ProgressFile,
  WeekId,
} from "../../shared/types.js";
import { emptyProgress } from "../../shared/types.js";
import {
  entryJsonPath,
  goalPhotosDir,
  goalsJsonPath,
  photosDir,
  progressJsonPath,
  thumbsDir,
  weekDir,
} from "./paths.js";

/**
 * Builds a throwaway on-disk archive for tests. Photo bytes are irrelevant to
 * the data layer - only the presence of the file matters - so these are
 * placeholders.
 */
export function makeArchiveDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tuj-"));
  mkdirSync(join(dir, "entries"), { recursive: true });
  return dir;
}

export interface WeekFixture {
  entry?: Partial<EntryFile>;
  goals?: GoalsFile;
  progress?: Partial<ProgressFile>;
  /** Skip writing the placeholder files the manifests point at. */
  omitPhotoFiles?: boolean;
}

export function writeWeek(
  dataDir: string,
  weekId: WeekId,
  fixture: WeekFixture = {},
): void {
  const entry: EntryFile = {
    title: "A week",
    description: "Short line.",
    liked: "The light in the afternoon.",
    challenging: "Getting out of bed.",
    createdAt: "2026-07-20T09:00:00+05:30",
    publishedAt: "2026-07-22T10:00:00+05:30",
    createdTz: "Asia/Kolkata",
    photos: [],
    ...fixture.entry,
  };
  const goals: GoalsFile = fixture.goals ?? { goals: [] };
  const progress: ProgressFile = { ...emptyProgress, ...fixture.progress };

  mkdirSync(weekDir(dataDir, weekId), { recursive: true });
  mkdirSync(thumbsDir(dataDir, weekId), { recursive: true });
  mkdirSync(goalPhotosDir(dataDir, weekId), { recursive: true });

  if (!fixture.omitPhotoFiles) {
    for (const photo of entry.photos) {
      writeFileSync(join(photosDir(dataDir, weekId), photo.filename), "jpg");
      writeFileSync(join(thumbsDir(dataDir, weekId), photo.thumbFilename), "w");
    }
    for (const goal of goals.goals) {
      if (goal.photoFilename) {
        writeFileSync(
          join(goalPhotosDir(dataDir, weekId), goal.photoFilename),
          "jpg",
        );
      }
    }
  }

  const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  writeFileSync(entryJsonPath(dataDir, weekId), json(entry));
  writeFileSync(goalsJsonPath(dataDir, weekId), json(goals));
  writeFileSync(progressJsonPath(dataDir, weekId), json(progress));
}

/** Writes raw text over one of a week's files, to test malformed input. */
export function corrupt(path: string, contents: string): void {
  writeFileSync(path, contents);
}

export function photo(n: number) {
  return {
    filename: `0${n}.jpg`,
    thumbFilename: `0${n}.webp`,
    width: 1600,
    height: 1200,
    aiDescription: null,
  };
}

export function goal(id: string, text: string) {
  return { id, text, photoFilename: null };
}
