import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LAST_MS_W30,
  LOCKED_W30,
  MID_W30,
  W30,
  harness,
  jpeg,
  json,
  multipartBody,
  seedPublishedWeek,
  type Harness,
} from "./testApp.js";

/**
 * Every illegal write, attempted, expecting a rejection.
 *
 * The archive is seeded with a published entry in 2026-W30, then the clock is
 * moved past Sunday 11:59pm. Nothing else changes between the passing and
 * failing cases - the difference is one millisecond of wall clock.
 */

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

/** Every write that touches the content of 2026-W30. */
async function contentWritesToW30() {
  return [
    {
      what: "PUT /api/draft (prose)",
      res: await h.app.inject({
        method: "PUT",
        url: `/api/draft?week=${W30}`,
        payload: { title: "Edited after the fact" },
      }),
    },
    {
      what: "POST /api/draft/publish",
      res: await h.app.inject({
        method: "POST",
        url: `/api/draft/publish?week=${W30}`,
      }),
    },
    {
      what: "PUT /api/draft/goals",
      res: await h.app.inject({
        method: "PUT",
        url: `/api/draft/goals?week=${W30}`,
        payload: { goals: [{ text: "Snuck in later" }] },
      }),
    },
    {
      what: "POST /api/draft/photos",
      res: await h.app.inject({
        method: "POST",
        url: `/api/draft/photos?week=${W30}`,
        ...multipartBody(await jpeg()),
      }),
    },
    {
      what: "DELETE /api/draft/photos/0",
      res: await h.app.inject({
        method: "DELETE",
        url: `/api/draft/photos/0?week=${W30}`,
      }),
    },
    {
      what: "PUT /api/draft/photos/0/description",
      res: await h.app.inject({
        method: "PUT",
        url: `/api/draft/photos/0/description?week=${W30}`,
        payload: { aiDescription: "rewritten" },
      }),
    },
  ];
}

describe("writes rejected on a locked entry", () => {
  beforeEach(() => h.setNow(LOCKED_W30));

  it("rejects every write that touches entry content", async () => {
    for (const { what, res } of await contentWritesToW30()) {
      expect(res.statusCode, what).toBe(403);
      expect(json(res).error.code, what).toBe("ENTRY_LOCKED");
    }
  });

  it("has no route that could edit a locked entry by week id", async () => {
    // The absence of these routes is the primary guarantee. The lock check is
    // the second line of defence, for the week that locks mid-session.
    for (const [method, url] of [
      ["PUT", `/api/entries/${W30}`],
      ["PATCH", `/api/entries/${W30}`],
      ["DELETE", `/api/entries/${W30}`],
      ["PUT", `/api/entries/${W30}/goals`],
      ["POST", `/api/entries/${W30}/goals`],
      ["DELETE", `/api/entries/${W30}/goals/${goalIds[0]}`],
      ["PUT", `/api/entries/${W30}/title`],
    ] as const) {
      const res = await h.app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it("does not silently divert a stale save into the new week", async () => {
    // The composer was open on Sunday night and the save landed after
    // midnight. The write must be refused, not applied to 2026-W31 with last
    // week's title still in the form.
    const res = await h.app.inject({
      method: "PUT",
      url: `/api/draft?week=${W30}`,
      payload: { title: "Written on Sunday, saved on Monday" },
    });
    expect(res.statusCode).toBe(403);

    const nextWeek = json(await h.app.inject({ url: "/api/draft" }));
    expect(nextWeek.weekId).toBe("2026-W31");
    expect(nextWeek.entry, "no entry should have been created").toBeNull();

    const old = json(await h.app.inject({ url: `/api/entries/${W30}` }));
    expect(old.title).toBe("Rain week");
  });
});

describe("writes permitted on a locked entry", () => {
  beforeEach(() => h.setNow(LOCKED_W30));

  it("completes a goal", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: `/api/entries/${W30}/goals/${goalIds[1]}/completion`,
    });
    expect(res.statusCode).toBe(200);
    const goal = json(res).goals.find((g: { id: string }) => g.id === goalIds[1]);
    expect(goal.completedAt).not.toBeNull();
  });

  it("un-completes a goal", async () => {
    const res = await h.app.inject({
      method: "DELETE",
      url: `/api/entries/${W30}/goals/${goalIds[0]}/completion`,
    });
    expect(res.statusCode).toBe(200);
    const goal = json(res).goals.find((g: { id: string }) => g.id === goalIds[0]);
    expect(goal.completedAt).toBeNull();
  });

  it("completes a goal years after the week locked", async () => {
    // Coming back later is the point of the product, not an edge case.
    h.setNow(new Date("2029-03-01T12:00:00+05:30"));
    const res = await h.app.inject({
      method: "PUT",
      url: `/api/entries/${W30}/goals/${goalIds[2]}/completion`,
    });
    expect(res.statusCode).toBe(200);
    const done = json(res).goals.filter(
      (g: { completedAt: string | null }) => g.completedAt,
    );
    expect(done).toHaveLength(2);
  });

  it("pins, archives and sets disclosure", async () => {
    for (const [url, payload] of [
      [`/api/entries/${W30}/pinned`, { pinned: true }],
      [`/api/entries/${W30}/archived`, { archived: true }],
      [`/api/entries/${W30}/disclosure`, { disclosed: true }],
    ] as const) {
      const res = await h.app.inject({ method: "PUT", url, payload });
      expect(res.statusCode, url).toBe(200);
    }
  });
});

describe("the boundary is one millisecond wide", () => {
  it("permits every content write at Sunday 23:59:59.999", async () => {
    h.setNow(LAST_MS_W30);
    for (const { what, res } of await contentWritesToW30()) {
      // Two writes are refused here for reasons that have nothing to do with
      // the lock, and the codes say so: the entry was published on Wednesday,
      // which already froze the goals and used up the one publish.
      const expected = what.includes("goals")
        ? 403
        : what.includes("publish")
          ? 409
          : 200;
      expect(res.statusCode, what).toBe(expected);
      if (res.statusCode === 403) {
        expect(json(res).error.code, what).toBe("GOALS_FROZEN");
      }
    }
  });

  it("rejects every content write one millisecond later", async () => {
    h.setNow(LOCKED_W30);
    for (const { what, res } of await contentWritesToW30()) {
      expect(res.statusCode, what).toBe(403);
      expect(json(res).error.code, what).toBe("ENTRY_LOCKED");
    }
  });

  it("permits completion on both sides of the boundary", async () => {
    h.setNow(LAST_MS_W30);
    const before = await h.app.inject({
      method: "PUT",
      url: `/api/entries/${W30}/goals/${goalIds[1]}/completion`,
    });
    h.setNow(LOCKED_W30);
    const after = await h.app.inject({
      method: "PUT",
      url: `/api/entries/${W30}/goals/${goalIds[2]}/completion`,
    });
    expect([before.statusCode, after.statusCode]).toEqual([200, 200]);
  });
});

describe("the two freeze points are independent", () => {
  it("freezes goals at publish while prose stays editable", async () => {
    // Still Wednesday. The entry is published but the week has not ended.
    const goals = await h.app.inject({
      method: "PUT",
      url: `/api/draft/goals?week=${W30}`,
      payload: { goals: [{ text: "Added after publishing" }] },
    });
    expect(goals.statusCode).toBe(403);
    expect(json(goals).error.code).toBe("GOALS_FROZEN");

    const prose = await h.app.inject({
      method: "PUT",
      url: `/api/draft?week=${W30}`,
      payload: { title: "Retitled on Thursday" },
    });
    expect(prose.statusCode).toBe(200);
    expect(json(prose).title).toBe("Retitled on Thursday");
  });

  it("gives no grace window after publish", async () => {
    // A fresh week, published and then written to with no time passing at
    // all. The freeze is the publish transaction, not publish plus a timer.
    h.setNow(new Date("2026-08-03T10:00:00+05:30")); // Monday, 2026-W32
    const week = "2026-W32";
    await h.app.inject({
      method: "PUT",
      url: `/api/draft?week=${week}`,
      payload: { title: "New week" },
    });
    await h.app.inject({
      method: "PUT",
      url: `/api/draft/goals?week=${week}`,
      payload: { goals: [{ text: "Original" }] },
    });
    const publish = await h.app.inject({
      method: "POST",
      url: `/api/draft/publish?week=${week}`,
    });
    expect(publish.statusCode).toBe(200);

    const res = await h.app.inject({
      method: "PUT",
      url: `/api/draft/goals?week=${week}`,
      payload: { goals: [{ text: "Changed my mind" }] },
    });
    expect(res.statusCode).toBe(403);
    expect(json(res).error.code).toBe("GOALS_FROZEN");
  });
});

describe("no backfilling", () => {
  it("refuses a write naming a past week", async () => {
    h.setNow(new Date("2026-08-03T10:00:00+05:30")); // 2026-W32
    const res = await h.app.inject({
      method: "PUT",
      url: `/api/draft?week=${W30}`,
      payload: { title: "Filling in a gap" },
    });
    expect(res.statusCode).toBe(403);
    expect(json(res).error.code).toBe("ENTRY_LOCKED");
  });

  it("refuses a write naming a future week", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/draft?week=2026-W40",
      payload: { title: "Getting ahead" },
    });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe("WEEK_ROLLED");
  });

  it("leaves a skipped week empty forever", async () => {
    h.setNow(new Date("2026-08-10T10:00:00+05:30")); // 2026-W33
    const res = await h.app.inject({ url: "/api/entries/2026-W31" });
    expect(res.statusCode).toBe(404);
    expect(json(res).error.code).toBe("ENTRY_NOT_FOUND");
  });
});
