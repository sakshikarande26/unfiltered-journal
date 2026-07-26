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
import { progressJsonPath } from "../store/paths.js";

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

describe("no route adds, edits or deletes a goal after publish", () => {
  it("has exactly one goal-writing route, and it refuses once published", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: `/api/draft/goals?week=${W30}`,
      payload: { goals: [{ text: "A fourth goal" }] },
    });
    expect(res.statusCode).toBe(403);
    expect(json(res).error.code).toBe("GOALS_FROZEN");
  });

  it("offers no add, edit or delete route at all", async () => {
    for (const [method, url] of [
      ["POST", `/api/draft/goals`],
      ["PATCH", `/api/draft/goals`],
      ["DELETE", `/api/draft/goals`],
      ["POST", `/api/entries/${W30}/goals`],
      ["PUT", `/api/entries/${W30}/goals/${goalIds[0]}`],
      ["PATCH", `/api/entries/${W30}/goals/${goalIds[0]}`],
      ["DELETE", `/api/entries/${W30}/goals/${goalIds[0]}`],
      ["PUT", `/api/entries/${W30}/goals/${goalIds[0]}/text`],
    ] as const) {
      const res = await h.app.inject({ method, url, payload: { text: "x" } });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it("leaves goals.json untouched by a refused write", async () => {
    const before = readFileSync(
      `${h.dataDir}/entries/${W30}/goals.json`,
      "utf8",
    );
    await h.app.inject({
      method: "PUT",
      url: `/api/draft/goals?week=${W30}`,
      payload: { goals: [{ text: "Replacement" }] },
    });
    expect(readFileSync(`${h.dataDir}/entries/${W30}/goals.json`, "utf8")).toBe(
      before,
    );
  });

  it("writes goals freely while the entry is still a draft", async () => {
    h.setNow(new Date("2026-08-03T10:00:00+05:30")); // 2026-W32
    const week = "2026-W32";
    await h.app.inject({
      method: "PUT",
      url: `/api/draft?week=${week}`,
      payload: { title: "Open" },
    });
    const first = await h.app.inject({
      method: "PUT",
      url: `/api/draft/goals?week=${week}`,
      payload: { goals: [{ text: "One" }] },
    });
    const second = await h.app.inject({
      method: "PUT",
      url: `/api/draft/goals?week=${week}`,
      payload: { goals: [{ text: "One" }, { text: "Two" }] },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(json(second).goals).toHaveLength(2);
  });

  it("refuses a sixth goal", async () => {
    h.setNow(new Date("2026-08-03T10:00:00+05:30"));
    await h.app.inject({
      method: "PUT",
      url: "/api/draft?week=2026-W32",
      payload: { title: "Open" },
    });
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/draft/goals?week=2026-W32",
      payload: {
        goals: [1, 2, 3, 4, 5, 6].map((n) => ({ text: `Goal ${n}` })),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe("MAX_GOALS");
  });
});

describe("completion round-trips through disk and the index", () => {
  it("writes progress.json and shows up in entry_goal_counts", async () => {
    h.setNow(LOCKED_W30);
    await h.app.inject({
      method: "PUT",
      url: `/api/entries/${W30}/goals/${goalIds[1]}/completion`,
    });

    const progress = JSON.parse(
      readFileSync(progressJsonPath(h.dataDir, W30), "utf8"),
    );
    expect(Object.keys(progress.completions).sort()).toEqual(
      [goalIds[0], goalIds[1]].sort(),
    );

    const row = h.db
      .prepare("SELECT done, total FROM entry_goal_counts WHERE week_id = ?")
      .get(W30);
    expect(row).toEqual({ done: 2, total: 3 });
  });

  it("is idempotent", async () => {
    for (let i = 0; i < 3; i++) {
      await h.app.inject({
        method: "PUT",
        url: `/api/entries/${W30}/goals/${goalIds[1]}/completion`,
      });
    }
    const row = h.db
      .prepare("SELECT done, total FROM entry_goal_counts WHERE week_id = ?")
      .get(W30);
    expect(row).toEqual({ done: 2, total: 3 });
  });

  it("404s for a goal that does not exist", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: `/api/entries/${W30}/goals/not-a-goal/completion`,
    });
    expect(res.statusCode).toBe(404);
    expect(json(res).error.code).toBe("GOAL_NOT_FOUND");
  });

  it("404s for a week with no entry", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: `/api/entries/2026-W31/goals/${goalIds[0]}/completion`,
    });
    expect(res.statusCode).toBe(404);
    expect(json(res).error.code).toBe("ENTRY_NOT_FOUND");
  });
});
