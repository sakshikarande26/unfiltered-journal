import { DateTime } from "luxon";
import { weekIdPattern, type WeekId } from "../shared/types.js";

/**
 * All week logic in the app lives here. The client never computes a week id.
 *
 * Every function takes the timezone explicitly rather than reading config or
 * process.env.TZ, so tests can exercise a zone change without mutating global
 * state, and so no caller can accidentally compute a week in the wrong zone.
 */

export class InvalidWeekIdError extends Error {}
export class InvalidTimezoneError extends Error {}

function zoned(tz: string): void {
  if (!DateTime.now().setZone(tz).isValid) {
    throw new InvalidTimezoneError(`Not a valid IANA timezone: ${tz}`);
  }
}

function format(weekYear: number, weekNumber: number): WeekId {
  return `${String(weekYear).padStart(4, "0")}-W${String(weekNumber).padStart(
    2,
    "0",
  )}` as WeekId;
}

/**
 * Parses a week id, rejecting week numbers that do not exist in that ISO
 * week-year. 2026 has 53 weeks, 2025 has 52, so "2026-W53" is real and
 * "2025-W53" is not. Returns null rather than throwing so callers scanning a
 * directory can report every bad folder at once.
 */
export function parseWeekId(s: string): WeekId | null {
  const m = weekIdPattern.exec(s);
  if (!m) return null;
  const weekYear = Number(m[1]);
  const weekNumber = Number(m[2]);
  if (weekNumber < 1) return null;
  const probe = DateTime.fromObject({ weekYear, weekNumber: 1, weekday: 1 });
  if (!probe.isValid) return null;
  if (weekNumber > probe.weeksInWeekYear) return null;
  return format(weekYear, weekNumber);
}

export function assertWeekId(s: string): WeekId {
  const id = parseWeekId(s);
  if (!id) throw new InvalidWeekIdError(`Not a valid ISO week id: ${s}`);
  return id;
}

/** The week id an instant falls in, for a given zone. */
export function weekIdAt(instant: Date, tz: string): WeekId {
  zoned(tz);
  const dt = DateTime.fromJSDate(instant, { zone: tz });
  return format(dt.weekYear, dt.weekNumber);
}

/**
 * Monday 00:00:00.000 local, and the following Monday 00:00:00.000 local.
 *
 * The upper bound is exclusive on purpose. PRODUCT.md says a week runs to
 * "Sunday 11:59pm", which is prose for end-of-week; taking it literally would
 * leave the last 59 seconds of Sunday belonging to no week at all.
 *
 * The end is computed with calendar arithmetic, never by adding 7 * 24h. A
 * week containing a DST spring-forward is 167 hours long, and a fixed offset
 * would land an hour inside Sunday and lock the entry early.
 */
export function weekBounds(
  id: WeekId,
  tz: string,
): { start: Date; endExclusive: Date } {
  zoned(tz);
  const m = weekIdPattern.exec(id);
  if (!m) throw new InvalidWeekIdError(`Not a valid ISO week id: ${id}`);
  const start = DateTime.fromObject(
    { weekYear: Number(m[1]), weekNumber: Number(m[2]), weekday: 1 },
    { zone: tz },
  ).startOf("day");
  if (!start.isValid) {
    throw new InvalidWeekIdError(`Not a valid ISO week id: ${id}`);
  }
  return {
    start: start.toJSDate(),
    endExclusive: start.plus({ weeks: 1 }).toJSDate(),
  };
}

/**
 * A week is locked once its final moment has passed. Nothing unlocks it, and
 * no stored flag says so - it is a function of the week id and the clock.
 */
export function isLocked(id: WeekId, tz: string, now: Date): boolean {
  return now.getTime() >= weekBounds(id, tz).endExclusive.getTime();
}

export function isCurrentWeek(id: WeekId, tz: string, now: Date): boolean {
  return weekIdAt(now, tz) === id;
}

/**
 * The week id immediately before the given one. Used to walk history; never
 * used to create anything, since backfilling is not permitted.
 */
export function previousWeekId(id: WeekId, tz: string): WeekId {
  const { start } = weekBounds(id, tz);
  return weekIdAt(
    DateTime.fromJSDate(start, { zone: tz }).minus({ weeks: 1 }).toJSDate(),
    tz,
  );
}
