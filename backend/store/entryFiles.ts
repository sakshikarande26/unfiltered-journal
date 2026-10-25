import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  emptyProgress,
  entryFileSchema,
  goalsFileSchema,
  progressFileSchema,
  type EntryFile,
  type GoalsFile,
  type ProgressFile,
  type WeekId,
} from "../../shared/types.js";
import { entryJsonPath, goalsJsonPath, progressJsonPath } from "./paths.js";

export class EntryFileError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(message);
  }
}

function readJson<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new EntryFileError(path, `cannot read: ${(e as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new EntryFileError(path, `not valid JSON: ${(e as Error).message}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new EntryFileError(path, issues);
  }
  return result.data;
}

export function readEntryFile(dataDir: string, weekId: WeekId): EntryFile {
  return readJson(entryJsonPath(dataDir, weekId), entryFileSchema);
}

/** Absent goals.json means the entry simply has no goals. Goals are optional. */
export function readGoalsFile(dataDir: string, weekId: WeekId): GoalsFile {
  const path = goalsJsonPath(dataDir, weekId);
  try {
    readFileSync(path);
  } catch {
    return { goals: [] };
  }
  return readJson(path, goalsFileSchema);
}

/** Absent progress.json means nothing has happened yet: no completions, not
 *  disclosed, not pinned, not archived. */
export function readProgressFile(
  dataDir: string,
  weekId: WeekId,
): ProgressFile {
  const path = progressJsonPath(dataDir, weekId);
  try {
    readFileSync(path);
  } catch {
    return { ...emptyProgress };
  }
  return readJson(path, progressFileSchema);
}
