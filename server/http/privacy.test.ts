import { readFileSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LOCKED_W30,
  MID_W30,
  W30,
  harness,
  json,
  seedPublishedWeek,
  type Harness,
} from "./testApp.js";
import { goalsJsonPath } from "../store/paths.js";

/**
 * Goal text and goal photos are private permanently. These tests attack that
 * boundary from the outside: they take the literal strings that exist on disk
 * and assert they appear in exactly one response body in the whole API.
 */

const SECRETS = ["Swim twice", "Call Dad", "Read 50pp"];

let h: Harness;
let goalIds: string[];

beforeEach(async () => {
  h = await harness(MID_W30);
  goalIds = await seedPublishedWeek(h);
});

afterEach(async () => {
  await h.close();
  rmSync(h.dataDir, { recursive: true, force: true });
});

const leaks = (body: string) => SECRETS.filter((s) => body.includes(s));

describe("goal text never appears in the entry shape", () => {
  it("is absent from the history list", async () => {
    const res = await h.app.inject({ url: "/api/entries" });
    expect(leaks(res.body)).toEqual([]);
    expect(json(res)[0].goals).toEqual({
      done: 1,
      total: 3,
      completedPositions: [0],
    });
  });

  it("is absent from a single entry", async () => {
    const res = await h.app.inject({ url: `/api/entries/${W30}` });
    expect(leaks(res.body)).toEqual([]);
  });

  it("is absent from a locked entry", async () => {
    h.setNow(LOCKED_W30);
    for (const url of ["/api/entries", `/api/entries/${W30}`]) {
      expect(leaks((await h.app.inject({ url })).body), url).toEqual([]);
    }
  });

  it("is absent after disclosure is turned on", async () => {
    await h.app.inject({
      method: "PUT",
      url: `/api/entries/${W30}/disclosure`,
      payload: { disclosed: true },
    });
    const res = await h.app.inject({ url: `/api/entries/${W30}` });
    expect(leaks(res.body)).toEqual([]);
    expect(json(res).goalsDisclosed).toBe(true);
  });

  it("has no field capable of holding it", async () => {
    const entry = json(await h.app.inject({ url: `/api/entries/${W30}` }));
    expect(Object.keys(entry.goals).sort()).toEqual([
      "completedPositions",
      "done",
      "total",
    ]);
    expect(entry).not.toHaveProperty("goalTexts");
    expect(entry).not.toHaveProperty("unfinished");
    expect(entry).not.toHaveProperty("unfinishedCount");
  });
});

describe("no query parameter opts into goal text", () => {
  it("ignores every plausible escape hatch", async () => {
    const baseline = (await h.app.inject({ url: `/api/entries/${W30}` })).body;
    for (const qs of [
      "?includeGoals=true",
      "?full=1",
      "?disclose=all",
      "?goals=text",
      "?expand=goals",
      "?fields=*",
      "?private=true",
    ]) {
      const res = await h.app.inject({ url: `/api/entries/${W30}${qs}` });
      expect(leaks(res.body), qs).toEqual([]);
      expect(res.body, qs).toBe(baseline);
    }
  });

  it("ignores them on the list too", async () => {
    for (const qs of ["?includeGoals=true", "?full=1"]) {
      const res = await h.app.inject({ url: `/api/entries${qs}` });
      expect(leaks(res.body), qs).toEqual([]);
    }
  });
});

describe("exactly one route returns goal text", () => {
  it("is GET /api/entries/:weekId/goals, and nothing else", async () => {
    const routes = [
      "/api/profile",
      "/api/draft",
      "/api/entries",
      `/api/entries/${W30}`,
    ];
    for (const url of routes) {
      expect(leaks((await h.app.inject({ url })).body), url).toEqual([]);
    }

    const owner = await h.app.inject({ url: `/api/entries/${W30}/goals` });
    expect(leaks(owner.body).sort()).toEqual([...SECRETS].sort());
  });

  it("still returns text to the owner once the entry is locked", async () => {
    // The owner has to see their own goals to complete them, forever.
    h.setNow(LOCKED_W30);
    const res = await h.app.inject({ url: `/api/entries/${W30}/goals` });
    expect(res.statusCode).toBe(200);
    expect(json(res).writable).toBe(false);
    expect(leaks(res.body)).toHaveLength(3);
  });
});

describe("goal photos are never served", () => {
  it("has no URL that reaches goal-photos/", async () => {
    for (const url of [
      `/media/${W30}/goal-photos/g.jpg`,
      `/media/${W30}/photos/../../${W30}/goal-photos/g.jpg`,
      `/media/${W30}/goal-photos/`,
      `/media/${W30}/goals.json`,
      `/media/${W30}/progress.json`,
    ]) {
      const res = await h.app.inject({ url });
      expect(res.statusCode, url).toBeGreaterThanOrEqual(400);
    }
  });

  it("serves entry photos", async () => {
    const entry = json(await h.app.inject({ url: `/api/entries/${W30}` }));
    const res = await h.app.inject({ url: entry.cover.url });
    expect(res.statusCode).toBe(200);
  });
});

describe("disclosure", () => {
  it("is refused when nothing is completed", async () => {
    await h.app.inject({
      method: "DELETE",
      url: `/api/entries/${W30}/goals/${goalIds[0]}/completion`,
    });
    const res = await h.app.inject({
      method: "PUT",
      url: `/api/entries/${W30}/disclosure`,
      payload: { disclosed: true },
    });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe("DISCLOSURE_NOT_OFFERABLE");
  });

  it("turns itself off if the last completion is undone", async () => {
    await h.app.inject({
      method: "PUT",
      url: `/api/entries/${W30}/disclosure`,
      payload: { disclosed: true },
    });
    await h.app.inject({
      method: "DELETE",
      url: `/api/entries/${W30}/goals/${goalIds[0]}/completion`,
    });
    const entry = json(await h.app.inject({ url: `/api/entries/${W30}` }));
    // A disclosed entry showing 0/3 is a state disclosure is never offered
    // for, so it must not be reachable by undoing a completion either.
    expect(entry.goalsDisclosed).toBe(false);
    expect(entry.goals.done).toBe(0);
  });

  it("never reveals unfinished goals as a count", async () => {
    const entry = json(await h.app.inject({ url: `/api/entries/${W30}` }));
    expect(entry.goals).toEqual({
      done: 1,
      total: 3,
      completedPositions: [0],
    });
    // The two unfinished goals are not named, not counted, not positioned.
    expect(entry.goals.completedPositions).not.toContain(1);
    expect(entry.goals.completedPositions).not.toContain(2);
  });
});

describe("the archive on disk still holds the text", () => {
  it("keeps goal text in goals.json, only the API withholds it", async () => {
    // Worth asserting: privacy here is a property of the projection, not of
    // deletion. The owner's own files are complete.
    const raw = readFileSync(goalsJsonPath(h.dataDir, W30), "utf8");
    expect(leaks(raw).sort()).toEqual([...SECRETS].sort());
  });
});
