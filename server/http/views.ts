import type {
  EntryDetail,
  EntryFile,
  EntrySummary,
  GoalDisclosure,
  GoalsFile,
  GoalsOwnerView,
  PhotoView,
  ProgressFile,
  WeekId,
} from "../../shared/types.js";
import { entryState, goalsAreFrozen } from "../state.js";

/**
 * Projections from on-disk files to wire shapes.
 *
 * The privacy boundary lives here. Two builders produce goal information and
 * both return GoalDisclosure, a type with no field capable of holding goal
 * text or a goal photo path:
 *
 *   ownerGoalView   - always populated; what the owner sees about their own
 *                     entry, regardless of whether they opted into disclosure
 *   goalDisclosure  - in server/state.ts, gated on opt-in and done >= 1; what
 *                     a future share route uses
 *
 * Goal text has exactly one exit from this module, goalsOwnerView(), and it is
 * only ever called by GET /api/entries/:weekId/goals.
 */

// Mirrors the on-disk layout under data/entries/, which is what @fastify/static
// serves. goal-photos/ lives beside photos/ on disk and has no URL at all.
function photoUrl(weekId: WeekId, filename: string): string {
  return `/media/${weekId}/photos/${filename}`;
}

function thumbUrl(weekId: WeekId, filename: string): string {
  return `/media/${weekId}/photos/thumbs/${filename}`;
}

export function photoViews(weekId: WeekId, entry: EntryFile): PhotoView[] {
  return entry.photos.map((p, position) => ({
    position,
    url: photoUrl(weekId, p.filename),
    thumbUrl: thumbUrl(weekId, p.thumbFilename),
    width: p.width,
    height: p.height,
    aiDescription: p.aiDescription,
  }));
}

/**
 * The owner's view of their own goal counts. Not gated on disclosure: opting
 * in governs what other people see, and the owner already knows all of it.
 * Still returns GoalDisclosure, so it carries no text either way.
 */
export function ownerGoalView(
  goals: GoalsFile,
  progress: ProgressFile,
): GoalDisclosure {
  const completedPositions = goals.goals
    .map((g, position) => (progress.completions[g.id] ? position : -1))
    .filter((position) => position >= 0);
  return {
    done: completedPositions.length,
    total: goals.goals.length,
    completedPositions,
  };
}

export function entrySummary(
  weekId: WeekId,
  entry: EntryFile,
  goals: GoalsFile,
  progress: ProgressFile,
  tz: string,
  now: Date,
): EntrySummary {
  const photos = photoViews(weekId, entry);
  return {
    weekId,
    state: entryState(weekId, entry.publishedAt, tz, now),
    title: entry.title,
    description: entry.description,
    cover: photos[0] ?? null,
    publishedAt: entry.publishedAt,
    pinned: progress.pinned,
    archived: progress.archived,
    goalsDisclosed: progress.goalsDisclosed,
    goals: ownerGoalView(goals, progress),
  };
}

export function entryDetail(
  weekId: WeekId,
  entry: EntryFile,
  goals: GoalsFile,
  progress: ProgressFile,
  tz: string,
  now: Date,
): EntryDetail {
  return {
    ...entrySummary(weekId, entry, goals, progress, tz, now),
    liked: entry.liked,
    challenging: entry.challenging,
    photos: photoViews(weekId, entry),
  };
}

/**
 * The only projection that carries goal text. Called from exactly one route.
 */
export function goalsOwnerView(
  weekId: WeekId,
  entry: EntryFile | null,
  goals: GoalsFile,
  progress: ProgressFile,
): GoalsOwnerView {
  return {
    weekId,
    writable: !goalsAreFrozen(entry?.publishedAt ?? null),
    goals: goals.goals.map((g, position) => ({
      id: g.id,
      position,
      text: g.text,
      photoFilename: g.photoFilename,
      completedAt: progress.completions[g.id] ?? null,
    })),
  };
}
