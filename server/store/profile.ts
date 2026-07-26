import { readFileSync } from "node:fs";
import {
  emptyProfile,
  profileSchema,
  type Profile,
} from "../../shared/types.js";
import { profileJsonPath } from "./paths.js";

/**
 * Single local user, stored as one file. There is no profile table: a record
 * with exactly one row has nothing to index, and adding one would mean
 * inventing a rebuild path for data that cannot be queried usefully anyway.
 */
export function readProfile(dataDir: string): Profile {
  try {
    const raw = readFileSync(profileJsonPath(dataDir), "utf8");
    return profileSchema.parse(JSON.parse(raw));
  } catch {
    return { ...emptyProfile, currently: { ...emptyProfile.currently } };
  }
}
