import { describe, expect, it } from "vitest";
import {
  InvalidTimezoneError,
  assertWeekId,
  isLocked,
  parseWeekId,
  previousWeekId,
  weekBounds,
  weekIdAt,
} from "./week.js";
import type { WeekId } from "../shared/types.js";

const KOLKATA = "Asia/Kolkata"; // no DST, +05:30
const NEW_YORK = "America/New_York"; // DST

const w = (s: string) => s as WeekId;

/** Build an instant from wall-clock time in a zone, without using week.ts. */
function at(local: string, offset: string): Date {
  return new Date(`${local}${offset}`);
}

const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

describe("parseWeekId", () => {
  it("accepts a well formed id", () => {
    expect(parseWeekId("2026-W30")).toBe("2026-W30");
    expect(parseWeekId("2026-W01")).toBe("2026-W01");
  });

  it("knows which years have 53 weeks", () => {
    // 2026 ends on a Thursday, so it has a 53rd ISO week. 2025 does not.
    expect(parseWeekId("2026-W53")).toBe("2026-W53");
    expect(parseWeekId("2025-W53")).toBeNull();
  });

  it("rejects malformed and out of range ids", () => {
    for (const bad of [
      "2026-W00",
      "2026-W54",
      "2026-30",
      "2026-w30",
      "26-W30",
      "2026-W3",
      "",
      "not-a-week",
    ]) {
      expect(parseWeekId(bad), bad).toBeNull();
    }
  });

  it("assertWeekId throws where parseWeekId returns null", () => {
    expect(() => assertWeekId("2025-W53")).toThrow();
  });
});

describe("weekIdAt", () => {
  it("stamps the ISO week for an ordinary day", () => {
    // Monday 20 July 2026 is the start of 2026-W30.
    expect(weekIdAt(at("2026-07-20T09:00:00", "+05:30"), KOLKATA)).toBe(
      "2026-W30",
    );
    expect(weekIdAt(at("2026-07-26T23:00:00", "+05:30"), KOLKATA)).toBe(
      "2026-W30",
    );
  });

  it("puts late December into the next year's week 1", () => {
    // 1 Jan 2026 is a Thursday, so ISO week 1 of 2026 opens Mon 29 Dec 2025.
    expect(weekIdAt(at("2025-12-29T00:00:00", "+05:30"), KOLKATA)).toBe(
      "2026-W01",
    );
  });

  it("puts early January into the previous year's week 53", () => {
    // 31 Dec 2026 is a Thursday, so that week is 2026-W53 and it runs into
    // January. The first week of 2027 does not open until Mon 4 Jan.
    expect(weekIdAt(at("2027-01-01T12:00:00", "+05:30"), KOLKATA)).toBe(
      "2026-W53",
    );
    expect(weekIdAt(at("2027-01-04T00:00:00", "+05:30"), KOLKATA)).toBe(
      "2027-W01",
    );
  });
});

describe("week boundaries", () => {
  // The two cases CLAUDE.md requires by name.
  it("Sunday 11:59pm is still inside the week", () => {
    const end = at("2026-07-26T23:59:59.999", "+05:30");
    expect(weekIdAt(end, KOLKATA)).toBe("2026-W30");
    expect(isLocked(w("2026-W30"), KOLKATA, end)).toBe(false);
  });

  it("Monday 12:00am opens the next week and locks the last one", () => {
    const start = at("2026-07-27T00:00:00.000", "+05:30");
    expect(weekIdAt(start, KOLKATA)).toBe("2026-W31");
    expect(isLocked(w("2026-W30"), KOLKATA, start)).toBe(true);
    expect(isLocked(w("2026-W31"), KOLKATA, start)).toBe(false);
  });

  it("leaves no gap between Sunday 11:59pm and Monday midnight", () => {
    // The 59 seconds after 23:59:00 belong to the week too. This is why the
    // upper bound is exclusive rather than a literal 23:59.
    const { endExclusive } = weekBounds(w("2026-W30"), KOLKATA);
    const lastMillisecond = new Date(endExclusive.getTime() - 1);
    expect(weekIdAt(lastMillisecond, KOLKATA)).toBe("2026-W30");
    expect(isLocked(w("2026-W30"), KOLKATA, lastMillisecond)).toBe(false);
    expect(isLocked(w("2026-W30"), KOLKATA, endExclusive)).toBe(true);
  });

  it("starts on Monday and ends on the next Monday", () => {
    const { start, endExclusive } = weekBounds(w("2026-W30"), KOLKATA);
    expect(start.toISOString()).toBe("2026-07-19T18:30:00.000Z"); // Mon 00:00 IST
    expect(endExclusive.toISOString()).toBe("2026-07-26T18:30:00.000Z");
  });

  it("previousWeekId crosses the year boundary", () => {
    expect(previousWeekId(w("2027-W01"), KOLKATA)).toBe("2026-W53");
    expect(previousWeekId(w("2026-W01"), KOLKATA)).toBe("2025-W52");
  });
});

describe("timezone", () => {
  it("gives different week ids for the same instant in different zones", () => {
    // Mon 27 Jul 2026, 02:00 IST is still Sun 26 Jul, 16:30 in New York.
    const instant = at("2026-07-27T02:00:00", "+05:30");
    expect(weekIdAt(instant, KOLKATA)).toBe("2026-W31");
    expect(weekIdAt(instant, NEW_YORK)).toBe("2026-W30");
  });

  it("locks a week at a different instant in each zone", () => {
    const instant = at("2026-07-27T02:00:00", "+05:30");
    expect(isLocked(w("2026-W30"), KOLKATA, instant)).toBe(true);
    expect(isLocked(w("2026-W30"), NEW_YORK, instant)).toBe(false);
  });

  it("moves a locked week's bounds if the journal timezone changes", () => {
    // This is the reason journalTz is configuration and not the live system
    // zone: the bounds of a past week must not shift because the user opened
    // the app in another country. Changing the config is an explicit act, and
    // this test documents exactly what that act costs.
    const kolkata = weekBounds(w("2026-W30"), KOLKATA);
    const newYork = weekBounds(w("2026-W30"), NEW_YORK);
    expect(kolkata.start.toISOString()).not.toBe(newYork.start.toISOString());
    expect(hours(kolkata.start, newYork.start)).toBe(9.5);
  });

  it("rejects a bogus timezone instead of silently using UTC", () => {
    expect(() => weekIdAt(new Date(), "Mars/Olympus_Mons")).toThrow(
      InvalidTimezoneError,
    );
  });
});

describe("daylight saving", () => {
  it("a spring forward week is 167 hours, not 168", () => {
    // US DST begins Sun 8 Mar 2026, inside 2026-W10 (Mon 2 Mar - Sun 8 Mar).
    const { start, endExclusive } = weekBounds(w("2026-W10"), NEW_YORK);
    expect(hours(start, endExclusive)).toBe(167);
  });

  it("a fall back week is 169 hours", () => {
    // US DST ends Sun 1 Nov 2026, inside 2026-W44 (Mon 26 Oct - Sun 1 Nov).
    const { start, endExclusive } = weekBounds(w("2026-W44"), NEW_YORK);
    expect(hours(start, endExclusive)).toBe(169);
  });

  it("does not lock a DST week early", () => {
    // Adding a fixed 7 * 24h to the start of a 167 hour week would land at
    // Sunday 23:00 and lock the entry an hour before the week actually ends.
    const { start, endExclusive } = weekBounds(w("2026-W10"), NEW_YORK);
    const naive = new Date(start.getTime() + 7 * 24 * 3_600_000);
    expect(naive.getTime()).toBeGreaterThan(endExclusive.getTime());

    const sundayLateEvening = at("2026-03-08T23:30:00", "-04:00"); // EDT
    expect(weekIdAt(sundayLateEvening, NEW_YORK)).toBe("2026-W10");
    expect(isLocked(w("2026-W10"), NEW_YORK, sundayLateEvening)).toBe(false);
  });

  it("still starts the week at local midnight either side of a shift", () => {
    const w10 = weekBounds(w("2026-W10"), NEW_YORK);
    const w44 = weekBounds(w("2026-W44"), NEW_YORK);
    expect(w10.start.toISOString()).toBe("2026-03-02T05:00:00.000Z"); // EST
    expect(w44.start.toISOString()).toBe("2026-10-26T04:00:00.000Z"); // EDT
  });
});
