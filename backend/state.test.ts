import { describe, expect, it } from "vitest";
import type { WeekId } from "../shared/types.js";
import {
  disclosureIsOfferable,
  entryIsFrozen,
  entryState,
  goalDisclosure,
  goalsAreFrozen,
} from "./state.js";

const TZ = "Asia/Kolkata";
const W30 = "2026-W30" as WeekId; // Mon 20 Jul - Sun 26 Jul 2026
const at = (s: string) => new Date(`${s}+05:30`);

describe("entryState", () => {
  it("is a draft before publish", () => {
    expect(entryState(W30, null, TZ, at("2026-07-21T10:00:00"))).toBe("draft");
  });

  it("is published after publish, while the week is still running", () => {
    expect(
      entryState(W30, "2026-07-22T10:00:00+05:30", TZ, at("2026-07-24T10:00:00")),
    ).toBe("published");
  });

  it("locks when the week ends, published or not", () => {
    const monday = at("2026-07-27T00:00:00");
    expect(entryState(W30, "2026-07-22T10:00:00+05:30", TZ, monday)).toBe("locked");
    // A draft never published still locks. There is no backfilling.
    expect(entryState(W30, null, TZ, monday)).toBe("locked");
  });
});

describe("the two freeze points are independent", () => {
  const publishedWednesday = "2026-07-22T10:00:00+05:30";
  const thursday = at("2026-07-23T10:00:00");

  it("freezes goals at publish while the entry is still editable", () => {
    expect(goalsAreFrozen(publishedWednesday)).toBe(true);
    expect(entryIsFrozen(W30, TZ, thursday)).toBe(false);
  });

  it("leaves goals writable in an unpublished draft", () => {
    expect(goalsAreFrozen(null)).toBe(false);
    expect(entryIsFrozen(W30, TZ, thursday)).toBe(false);
  });

  it("has no grace window after publish", () => {
    // Freezing is at the publish transaction, not publish plus a timer.
    expect(goalsAreFrozen(publishedWednesday)).toBe(true);
  });
});

describe("goal disclosure", () => {
  it("is not offerable until something is completed", () => {
    expect(disclosureIsOfferable(0)).toBe(false);
    expect(disclosureIsOfferable(1)).toBe(true);
  });

  it("returns nothing when the user has not opted in", () => {
    expect(goalDisclosure(false, 3, 5, [0, 1, 2])).toBeNull();
  });

  it("returns nothing when opted in but nothing is done", () => {
    expect(goalDisclosure(true, 0, 5, [])).toBeNull();
  });

  it("returns the count, the total and which goals are ticked", () => {
    expect(goalDisclosure(true, 3, 5, [2, 0, 1])).toEqual({
      done: 3,
      total: 5,
      completedPositions: [0, 1, 2],
    });
  });

  it("never carries goal text or photo paths", () => {
    const disclosed = goalDisclosure(true, 1, 5, [0]);
    expect(Object.keys(disclosed ?? {}).sort()).toEqual([
      "completedPositions",
      "done",
      "total",
    ]);
  });

  it("identifies no unfinished goal", () => {
    // 2 of 5 done. The two ticked positions are named; the three unfinished
    // ones are not, and there is no field that enumerates or labels them.
    const disclosed = goalDisclosure(true, 2, 5, [1, 4]);
    expect(disclosed?.completedPositions).toEqual([1, 4]);
    expect(disclosed).not.toHaveProperty("unfinished");
    expect(disclosed).not.toHaveProperty("unfinishedCount");
    expect(disclosed).not.toHaveProperty("pending");
  });
});
