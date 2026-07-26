import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WeekId } from "../../shared/types.js";
import { createSchema, openDb, type Db } from "../db/open.js";
import { RebuildFailed, rebuild } from "./reindex.js";
import { goalsJsonPath, progressJsonPath } from "./paths.js";
import {
  corrupt,
  goal,
  makeArchiveDir,
  photo,
  writeWeek,
} from "./testArchive.js";

const TZ = "Asia/Kolkata";
const W30 = "2026-W30" as WeekId;
const W31 = "2026-W31" as WeekId;

let dataDir: string;
let db: Db;

beforeEach(() => {
  dataDir = makeArchiveDir();
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const count = (table: string) =>
  (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;

/** A representative archive: one week with photos, goals and a completion. */
function seedGoodArchive(): void {
  writeWeek(dataDir, W30, {
    entry: { title: "Rain week", photos: [photo(1), photo(2)] },
    goals: {
      goals: [goal("g1", "Swim twice"), goal("g2", "Call Dad"), goal("g3", "Read 50pp")],
    },
    progress: {
      completions: { g1: "2026-08-02T18:00:00+05:30" },
      goalsDisclosed: true,
    },
  });
  writeWeek(dataDir, W31, {
    entry: {
      title: "Quiet week",
      createdAt: "2026-07-27T09:00:00+05:30",
      publishedAt: "2026-07-29T09:00:00+05:30",
      photos: [photo(1)],
    },
  });
}

describe("rebuild", () => {
  it("indexes an archive", () => {
    seedGoodArchive();
    const result = rebuild(dataDir, db, TZ);

    expect(result).toEqual({ weeks: 2, photos: 3, goals: 3, completions: 1 });
    expect(count("entries")).toBe(2);
    expect(count("goals")).toBe(3);
    expect(count("goal_completions")).toBe(1);
  });

  it("indexes nothing when there are no entries at all", () => {
    expect(rebuild(dataDir, db, TZ).weeks).toBe(0);
    expect(count("entries")).toBe(0);
  });

  it("is idempotent - the archive alone reconstructs the same index", () => {
    seedGoodArchive();
    rebuild(dataDir, db, TZ);
    const first = db
      .prepare("SELECT * FROM entries ORDER BY week_id")
      .all();
    const firstGoals = db.prepare("SELECT * FROM goals ORDER BY goal_id").all();

    rebuild(dataDir, db, TZ);

    expect(db.prepare("SELECT * FROM entries ORDER BY week_id").all()).toEqual(
      first,
    );
    expect(db.prepare("SELECT * FROM goals ORDER BY goal_id").all()).toEqual(
      firstGoals,
    );
  });

  it("carries progress.json flags onto the entry", () => {
    writeWeek(dataDir, W30, {
      goals: { goals: [goal("g1", "Swim")] },
      progress: {
        completions: { g1: "2026-08-01T10:00:00+05:30" },
        goalsDisclosed: true,
        pinned: true,
        archived: true,
      },
    });
    rebuild(dataDir, db, TZ);

    expect(
      db.prepare("SELECT pinned, archived, goals_disclosed FROM entries").get(),
    ).toEqual({ pinned: 1, archived: 1, goals_disclosed: 1 });
  });

  it("treats a week with no goals.json as a week with no goals", () => {
    writeWeek(dataDir, W30, {});
    rmSync(goalsJsonPath(dataDir, W30));
    rmSync(progressJsonPath(dataDir, W30));

    expect(rebuild(dataDir, db, TZ).goals).toBe(0);
    expect(count("entries")).toBe(1);
  });
});

describe("entry_goal_counts", () => {
  it("derives done and total", () => {
    seedGoodArchive();
    rebuild(dataDir, db, TZ);

    const rows = db
      .prepare("SELECT week_id, done, total FROM entry_goal_counts ORDER BY week_id")
      .all();
    expect(rows).toEqual([
      { week_id: "2026-W30", done: 1, total: 3 },
      { week_id: "2026-W31", done: 0, total: 0 },
    ]);
  });

  it("has no stored count column that could go stale", () => {
    seedGoodArchive();
    rebuild(dataDir, db, TZ);

    const columns = (
      db.prepare("PRAGMA table_info(entries)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(columns).not.toContain("done");
    expect(columns).not.toContain("total");
    expect(columns).not.toContain("completed_count");
  });

  it("keeps goal text out of the goals table's shareable projection", () => {
    // The count comes from joining goals, so the risk is a projection that
    // grabs g.* along the way. This asserts the shape a shared view must use.
    seedGoodArchive();
    rebuild(dataDir, db, TZ);

    const row = db
      .prepare(
        `SELECT c.week_id, c.done, c.total,
                (SELECT group_concat(g.position)
                   FROM goals g
                   JOIN goal_completions gc ON gc.goal_id = g.goal_id
                  WHERE g.week_id = c.week_id) AS completed_positions
           FROM entry_goal_counts c WHERE c.week_id = ?`,
      )
      .get("2026-W30") as Record<string, unknown>;

    expect(row).toEqual({
      week_id: "2026-W30",
      done: 1,
      total: 3,
      completed_positions: "0",
    });
    expect(Object.keys(row)).not.toContain("text");
    expect(JSON.stringify(row)).not.toContain("Swim twice");
  });
});

describe("rebuild rejects a malformed archive", () => {
  let before: unknown[];

  // A good index exists before each case, so every assertion below also
  // proves the failed rebuild left the previous index intact.
  beforeEach(() => {
    seedGoodArchive();
    rebuild(dataDir, db, TZ);
    before = db.prepare("SELECT * FROM entries ORDER BY week_id").all();
  });

  /** Every case here must abort the whole rebuild and leave the index alone. */
  function expectRejected(match: RegExp): RebuildFailed {
    let thrown: unknown;
    try {
      rebuild(dataDir, db, TZ);
    } catch (e) {
      thrown = e;
    }

    expect(thrown, "expected rebuild to throw").toBeInstanceOf(RebuildFailed);
    const failure = thrown as RebuildFailed;
    expect(failure.message).toMatch(match);
    expect(
      db.prepare("SELECT * FROM entries ORDER BY week_id").all(),
      "index must be untouched after a failed rebuild",
    ).toEqual(before);
    return failure;
  }

  it("rejects a folder that is not a week id", () => {
    writeWeek(dataDir, "2026-W7" as WeekId);
    const failure = expectRejected(/not a valid ISO week id/);
    expect(failure.problems[0]?.folder).toBe("2026-W7");
  });

  it("rejects a week number that does not exist in its year", () => {
    writeWeek(dataDir, "2025-W53" as WeekId);
    expectRejected(/not a valid ISO week id/);
  });

  it("rejects more than five goals", () => {
    writeWeek(dataDir, "2026-W20" as WeekId, {
      entry: {
        createdAt: "2026-05-11T09:00:00+05:30",
        publishedAt: "2026-05-13T09:00:00+05:30",
      },
      goals: {
        goals: [1, 2, 3, 4, 5, 6].map((n) => goal(`x${n}`, `Goal ${n}`)),
      },
    });
    expectRejected(/at most 5 element|6 goals/);
  });

  it("rejects more than five photos", () => {
    writeWeek(dataDir, "2026-W20" as WeekId, {
      entry: {
        createdAt: "2026-05-11T09:00:00+05:30",
        publishedAt: "2026-05-13T09:00:00+05:30",
        photos: [1, 2, 3, 4, 5, 6].map(photo),
      },
    });
    expectRejected(/at most 5 element|6 photos/);
  });

  it("rejects a completion pointing at a goal that does not exist", () => {
    writeWeek(dataDir, "2026-W20" as WeekId, {
      entry: {
        createdAt: "2026-05-11T09:00:00+05:30",
        publishedAt: "2026-05-13T09:00:00+05:30",
      },
      goals: { goals: [goal("real", "Exists")] },
      progress: { completions: { ghost: "2026-05-14T10:00:00+05:30" } },
    });
    expectRejected(/completes goal "ghost"/);
  });

  it("rejects disclosure with zero completions", () => {
    writeWeek(dataDir, "2026-W20" as WeekId, {
      entry: {
        createdAt: "2026-05-11T09:00:00+05:30",
        publishedAt: "2026-05-13T09:00:00+05:30",
      },
      goals: { goals: [goal("g1", "Swim")] },
      progress: { goalsDisclosed: true },
    });
    expectRejected(/goalsDisclosed with zero completed goals/);
  });

  it("rejects completions on an unpublished draft", () => {
    writeWeek(dataDir, "2026-W20" as WeekId, {
      entry: { createdAt: "2026-05-11T09:00:00+05:30", publishedAt: null },
      goals: { goals: [goal("g1", "Swim")] },
      progress: { completions: { g1: "2026-05-14T10:00:00+05:30" } },
    });
    expectRejected(/unpublished draft but has completed goals/);
  });

  it("rejects publishedAt outside its own week", () => {
    writeWeek(dataDir, "2026-W20" as WeekId, {
      entry: {
        createdAt: "2026-05-11T09:00:00+05:30",
        publishedAt: "2026-06-01T09:00:00+05:30",
      },
    });
    expectRejected(/falls outside 2026-W20/);
  });

  it("rejects a manifest pointing at a missing photo file", () => {
    writeWeek(dataDir, "2026-W20" as WeekId, {
      entry: {
        createdAt: "2026-05-11T09:00:00+05:30",
        publishedAt: "2026-05-13T09:00:00+05:30",
        photos: [photo(1)],
      },
      omitPhotoFiles: true,
    });
    expectRejected(/missing file photos\/01\.jpg/);
  });

  it("rejects unparseable JSON", () => {
    writeWeek(dataDir, "2026-W20" as WeekId, {
      entry: {
        createdAt: "2026-05-11T09:00:00+05:30",
        publishedAt: "2026-05-13T09:00:00+05:30",
      },
    });
    corrupt(goalsJsonPath(dataDir, "2026-W20" as WeekId), "{ not json");
    expectRejected(/not valid JSON/);
  });

  it("reports every bad folder at once, not just the first", () => {
    writeWeek(dataDir, "2026-W7" as WeekId);
    writeWeek(dataDir, "2026-W20" as WeekId, {
      entry: {
        createdAt: "2026-05-11T09:00:00+05:30",
        publishedAt: "2026-05-13T09:00:00+05:30",
      },
      goals: { goals: [goal("g1", "Swim")] },
      progress: { goalsDisclosed: true },
    });
    const failure = expectRejected(/2 problem/);
    expect(failure.problems.map((p) => p.folder).sort()).toEqual([
      "2026-W20",
      "2026-W7",
    ]);
  });
});

describe("schema constraints", () => {
  it("refuses a sixth photo even if a caller forgets to check", () => {
    createSchema(db);
    db.prepare(
      `INSERT INTO entries (week_id, created_at, created_tz)
       VALUES ('2026-W30', '2026-07-20T09:00:00+05:30', 'Asia/Kolkata')`,
    ).run();
    const insert = db.prepare(
      `INSERT INTO photos (week_id, position, filename, thumb_filename, width, height)
       VALUES ('2026-W30', ?, 'x.jpg', 'x.webp', 1, 1)`,
    );
    for (let i = 0; i < 5; i++) insert.run(i);
    expect(() => insert.run(5)).toThrow(/CHECK constraint/);
  });

  it("refuses two entries for the same week", () => {
    createSchema(db);
    const insert = db.prepare(
      `INSERT INTO entries (week_id, created_at, created_tz)
       VALUES ('2026-W30', '2026-07-20T09:00:00+05:30', 'Asia/Kolkata')`,
    );
    insert.run();
    expect(() => insert.run()).toThrow(/UNIQUE constraint/);
  });

  it("refuses a completion for a goal that does not exist", () => {
    createSchema(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO goal_completions (goal_id, completed_at)
           VALUES ('nope', '2026-07-20T09:00:00+05:30')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint/);
  });
});
