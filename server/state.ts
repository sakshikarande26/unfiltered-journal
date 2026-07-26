import type { EntryState, GoalDisclosure, WeekId } from "../shared/types.js";
import { isLocked } from "./week.js";

/**
 * Entry state is derived, never stored. Nothing writes "locked" anywhere; the
 * calendar decides.
 */
export function entryState(
  weekId: WeekId,
  publishedAt: string | null,
  tz: string,
  now: Date,
): Exclude<EntryState, "empty"> {
  if (isLocked(weekId, tz, now)) return "locked";
  return publishedAt === null ? "draft" : "published";
}

/** True once the week has ended. The gate for every write except goal
 *  completion, pinning and archiving. */
export function entryIsFrozen(weekId: WeekId, tz: string, now: Date): boolean {
  return isLocked(weekId, tz, now);
}

/**
 * True once the entry is published. The gate for goal text and goal photos,
 * which freeze at publish rather than at lock, with no grace window.
 */
export function goalsAreFrozen(publishedAt: string | null): boolean {
  return publishedAt !== null;
}

/**
 * Disclosure is opt-in per entry and only becomes available once at least one
 * goal in that entry is completed. An entry with zero completions has no
 * disclosure state to offer.
 */
export function disclosureIsOfferable(done: number): boolean {
  return done >= 1;
}

/**
 * Everything a shared view may know about an entry's goals.
 *
 * Returns null when the user has not opted in, or when there is nothing to
 * disclose. There is no branch here that returns goal text or goal photo
 * paths, and no parameter that could ask for them.
 */
export function goalDisclosure(
  goalsDisclosed: boolean,
  done: number,
  total: number,
  completedPositions: number[],
): GoalDisclosure | null {
  if (!goalsDisclosed || !disclosureIsOfferable(done)) return null;
  return { done, total, completedPositions: [...completedPositions].sort() };
}
