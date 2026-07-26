/**
 * One error shape for the whole API: { error: { code, message } }.
 *
 * The codes are the product rules, named. A test asserting ENTRY_LOCKED is
 * asserting the rule, not a status number that several rules happen to share.
 */
export type ErrorCode =
  /** The week has ended. Nothing unlocks it. */
  | "ENTRY_LOCKED"
  /** The entry is published, so goal text and goal photos are frozen. */
  | "GOALS_FROZEN"
  /** publishedAt is already set. Publishing happens once. */
  | "ALREADY_PUBLISHED"
  /** No draft exists for the current week yet. */
  | "NO_DRAFT"
  /** The week rolled over between the client reading the draft and writing to
   *  it. The write is refused rather than silently landing in the new week. */
  | "WEEK_ROLLED"
  | "ENTRY_NOT_FOUND"
  | "GOAL_NOT_FOUND"
  | "MAX_PHOTOS"
  | "MAX_GOALS"
  /** Disclosure is only offerable once at least one goal is completed. */
  | "DISCLOSURE_NOT_OFFERABLE"
  | "NOT_AN_IMAGE"
  | "INVALID_BODY"
  | "INVALID_WEEK_ID";

const status: Record<ErrorCode, number> = {
  ENTRY_LOCKED: 403,
  GOALS_FROZEN: 403,
  ALREADY_PUBLISHED: 409,
  NO_DRAFT: 404,
  WEEK_ROLLED: 409,
  ENTRY_NOT_FOUND: 404,
  GOAL_NOT_FOUND: 404,
  MAX_PHOTOS: 413,
  MAX_GOALS: 400,
  DISCLOSURE_NOT_OFFERABLE: 409,
  NOT_AN_IMAGE: 415,
  INVALID_BODY: 400,
  INVALID_WEEK_ID: 400,
};

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get statusCode(): number {
    return status[this.code];
  }

  toBody() {
    return { error: { code: this.code, message: this.message } };
  }
}

export const locked = () =>
  new ApiError(
    "ENTRY_LOCKED",
    "This week has ended and the entry is permanently locked.",
  );

export const goalsFrozen = () =>
  new ApiError(
    "GOALS_FROZEN",
    "Goals froze when this entry was published and cannot be changed.",
  );
