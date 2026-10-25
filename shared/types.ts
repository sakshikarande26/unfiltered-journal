import { z } from "zod";

/**
 * An ISO week id, e.g. "2026-W30". This is the only temporal key in the
 * system. Nothing stores a bare date and derives the week later.
 */
export type WeekId = string & { readonly __brand: "WeekId" };

export const MAX_PHOTOS = 5;
export const MAX_GOALS = 5;

/** Shape only. Whether the week number exists in that year is checked by
 *  parseWeekId in server/week.ts, which knows about 53-week years. */
export const weekIdPattern = /^(\d{4})-W(\d{2})$/;

const isoInstant = z.string().datetime({ offset: true });

/**
 * entry.json - the prose of a chapter. Mutable until the week ends, then the
 * file is never opened for write again.
 */
export const photoSchema = z.object({
  filename: z.string().min(1),
  thumbFilename: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** The one AI-written field in the system. User editable until lock. */
  aiDescription: z.string().nullable(),
});

export const entryFileSchema = z.object({
  title: z.string(),
  description: z.string(),
  liked: z.string(),
  challenging: z.string(),
  /** Null while the entry is a draft. Set once, at publish. */
  publishedAt: isoInstant.nullable(),
  createdAt: isoInstant,
  /** The journal timezone in force when this entry was created. Recorded for
   *  audit; week math always uses the configured tz, never this field. */
  createdTz: z.string().min(1),
  /** Ordered. Index 0 is the cover. */
  photos: z.array(photoSchema).max(MAX_PHOTOS),
});

/**
 * goals.json - frozen at publish, not at lock. No edits, additions or
 * removals afterwards, and no grace window.
 */
export const goalSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  /** Lives under goal-photos/, never under photos/. Private permanently. */
  photoFilename: z.string().min(1).nullable(),
});

export const goalsFileSchema = z.object({
  goals: z.array(goalSchema).max(MAX_GOALS),
});

/**
 * progress.json - the only file that stays mutable after a freeze. Everything
 * here is a write that is legal on a locked entry.
 */
export const progressFileSchema = z.object({
  /** goal id -> completion instant. Absent key means not done. */
  completions: z.record(z.string(), isoInstant),
  /** goal id -> last change instant, including toggles off. The ordering
   *  field that lets two devices resolve the same goal last-write-wins;
   *  keys stay here even after an un-completion removes them from
   *  `completions`. */
  completionChangedAt: z.record(z.string(), isoInstant).default({}),
  /** Opt-in per entry, only offerable once at least one goal is done. */
  goalsDisclosed: z.boolean(),
  pinned: z.boolean(),
  archived: z.boolean(),
});

export type Photo = z.infer<typeof photoSchema>;
export type EntryFile = z.infer<typeof entryFileSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type GoalsFile = z.infer<typeof goalsFileSchema>;
export type ProgressFile = z.infer<typeof progressFileSchema>;

export const emptyProgress: ProgressFile = {
  completions: {},
  completionChangedAt: {},
  goalsDisclosed: false,
  pinned: false,
  archived: false,
};

/** Derived from publishedAt plus the clock. Never stored. */
export type EntryState = "empty" | "draft" | "published" | "locked";

/**
 * What a shared view is allowed to know about an entry's goals. There is
 * deliberately no field here that identifies or counts unfinished goals.
 */
export interface GoalDisclosure {
  done: number;
  total: number;
  /** Positions of completed goals, for rendering ticks. */
  completedPositions: number[];
}

/* ------------------------------------------------------------------ *
 * Wire shapes
 * ------------------------------------------------------------------ */

/** Single local user. No accounts, no auth, no server-side user record. */
export const profileSchema = z.object({
  name: z.string().max(80),
  bio: z.string().max(200),
  currently: z.object({
    reading: z.string().max(120),
    into: z.string().max(120),
    location: z.string().max(120),
  }),
});

export type Profile = z.infer<typeof profileSchema>;

export const emptyProfile: Profile = {
  name: "",
  bio: "",
  currently: { reading: "", into: "", location: "" },
};

/**
 * How a photo appears on the wire. `filename` is resolved to a URL under
 * /photos/<weekId>/; goal photos have no equivalent and are never served.
 */
export interface PhotoView {
  position: number;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  aiDescription: string | null;
}

/**
 * A chapter as it appears in history.
 *
 * `goals` is typed GoalDisclosure, which has no field capable of holding goal
 * text or a goal photo path. Leaking either would require changing this type,
 * not merely spreading the wrong object into a response.
 */
export interface EntrySummary {
  weekId: WeekId;
  state: EntryState;
  title: string;
  description: string;
  cover: PhotoView | null;
  /** Ordered, index 0 is the cover. Powers the card's layered photo stack. */
  photos: PhotoView[];
  publishedAt: string | null;
  pinned: boolean;
  archived: boolean;
  goalsDisclosed: boolean;
  goals: GoalDisclosure;
}

export interface EntryDetail extends EntrySummary {
  liked: string;
  challenging: string;
}

/** A single goal as its owner sees it. Never appears inside EntrySummary or
 *  EntryDetail - only in the response of GET /api/entries/:weekId/goals. */
export interface GoalOwnerView {
  id: string;
  position: number;
  text: string;
  photoFilename: string | null;
  completedAt: string | null;
}

export interface GoalsOwnerView {
  weekId: WeekId;
  /** Whether goal text is still writable. False once published. */
  writable: boolean;
  goals: GoalOwnerView[];
}

/**
 * The composer's view of the current week.
 *
 * `goals` is GoalDisclosure here too, not GoalsOwnerView: goal text has
 * exactly one route in the whole API, and adding a second one for the
 * composer's convenience would mean the invariant is "two routes, for now".
 * The composer fetches GET /api/entries/:weekId/goals when it needs the text.
 */
export interface DraftView {
  weekId: WeekId;
  state: EntryState;
  entry: EntryDetail | null;
  goals: GoalDisclosure;
  /** Whether goal text is still writable. False once published. */
  goalsWritable: boolean;
}

/* ---- request bodies ---- */

export const draftPatchSchema = z.object({
  title: z.string().max(120).optional(),
  description: z.string().max(300).optional(),
  liked: z.string().max(2000).optional(),
  challenging: z.string().max(2000).optional(),
});

export const goalsPutSchema = z.object({
  goals: z
    .array(
      z.object({
        text: z.string().min(1).max(200),
        photoFilename: z.string().min(1).nullable().default(null),
      }),
    )
    .max(MAX_GOALS),
});

export const descriptionPutSchema = z.object({
  aiDescription: z.string().max(1000).nullable(),
});

export const pinnedPutSchema = z.object({ pinned: z.boolean() });
export const archivedPutSchema = z.object({ archived: z.boolean() });
export const disclosurePutSchema = z.object({ disclosed: z.boolean() });
