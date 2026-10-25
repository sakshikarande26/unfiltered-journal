import { mkdtempSync, rmSync } from "node:fs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEV_JWT_SECRET } from "../../shared/sync.js";
import { buildServerApp } from "../../server/src/app.js";
import { FsStorage } from "../../server/src/storage.js";
import { DevAuthClient } from "../auth/client.js";
import { writeSession } from "../auth/sessionStore.js";
import { openDb } from "../db/open.js";
import { rebuild } from "../store/reindex.js";
import { photosDir, thumbsDir } from "../store/paths.js";
import {
  ensureWeekDirs,
  writeEntryFile,
  writeGoalsFile,
  writeProgressFile,
} from "../store/writeFiles.js";
import { emptyProgress } from "../../shared/types.js";
import type { WeekId } from "../../shared/types.js";
import { readProgressFile } from "../store/entryFiles.js";
import { SyncEngine } from "./engine.js";

/**
 * End-to-end sync: two "devices" (two data dirs), one account, the real sync
 * server on a real Postgres. Needs TUJ_TEST_DATABASE_URL; skipped without it
 * rather than faked.
 */
const DB = process.env.TUJ_TEST_DATABASE_URL;
const run = DB ? describe : describe.skip;

const TZ = "Asia/Kolkata";
const W30 = "2026-W30" as WeekId;
const GOAL = "33333333-3333-4333-8333-333333333333";

run("sync engine", () => {
  let server: Awaited<ReturnType<typeof buildServerApp>>;
  let syncUrl = "";
  const dirs: string[] = [];

  const device = () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tuj-device-"));
    dirs.push(dataDir);
    mkdirSync(join(dataDir, "entries"), { recursive: true });
    const db = openDb(":memory:");
    const engine = new SyncEngine({
      dataDir,
      tz: () => TZ,
      syncUrl,
      auth: new DevAuthClient(),
      reindex: () => void rebuild(dataDir, db, TZ),
    });
    return { dataDir, engine };
  };

  const signIn = async (dataDir: string) => {
    const session = await new DevAuthClient().signIn("sakshi@x.dev", "pw");
    writeSession(dataDir, session);
  };

  beforeAll(async () => {
    const sql = postgres(DB!, { max: 4 });
    for (const t of [
      "goal_completions",
      "goals",
      "photos",
      "entries",
      "users",
    ]) {
      await sql.unsafe(`TRUNCATE public.${t} CASCADE`);
    }
    server = await buildServerApp({
      sql,
      storage: new FsStorage(mkdtempSync(join(tmpdir(), "tuj-storage-"))),
      jwtSecret: DEV_JWT_SECRET,
    });
    await server.listen({ port: 0, host: "127.0.0.1" });
    const addr = server.server.address();
    syncUrl =
      typeof addr === "object" && addr
        ? `http://127.0.0.1:${addr.port}`
        : "http://127.0.0.1:8787";
  });

  afterAll(async () => {
    await server.close();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("device A drafts+posts offline, device B pulls it, a completion syncs back", async () => {
    const A = device();
    await signIn(A.dataDir);

    // Offline work on A: a published week with one photo and one goal.
    ensureWeekDirs(A.dataDir, W30);
    writeFileSync(
      join(photosDir(A.dataDir, W30), "00.jpg"),
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
    );
    writeFileSync(
      join(thumbsDir(A.dataDir, W30), "00.webp"),
      Buffer.from([1, 2, 3, 4]),
    );
    writeEntryFile(A.dataDir, W30, {
      title: "week thirty",
      description: "a week",
      liked: "rain",
      challenging: "sleep",
      publishedAt: "2026-07-24T12:00:00+05:30",
      createdAt: "2026-07-22T10:00:00+05:30",
      createdTz: TZ,
      photos: [
        {
          filename: "00.jpg",
          thumbFilename: "00.webp",
          width: 10,
          height: 10,
          aiDescription: null,
        },
      ],
    });
    writeGoalsFile(A.dataDir, W30, {
      goals: [{ id: GOAL, text: "run a 10k", photoFilename: null }],
    });
    writeProgressFile(A.dataDir, W30, { ...emptyProgress });

    await A.engine.runOnce();
    expect(A.engine.status().state).toBe("idle");
    expect(A.engine.status().pending).toBe(0);

    // Device B: same account, empty archive -> the whole week arrives.
    const B = device();
    await signIn(B.dataDir);
    await B.engine.runOnce();
    expect(B.engine.status().state).toBe("idle");

    expect(existsSync(join(B.dataDir, "entries", W30, "entry.json"))).toBe(true);
    expect(
      existsSync(join(B.dataDir, "entries", W30, "photos", "00.jpg")),
    ).toBe(true);
    const bEntry = JSON.parse(
      readFileSync(join(B.dataDir, "entries", W30, "entry.json"), "utf8"),
    ) as { title: string; publishedAt: string | null };
    expect(bEntry.title).toBe("week thirty");
    expect(bEntry.publishedAt).not.toBeNull();

    // B completes the goal on the pulled entry.
    const progress = readProgressFile(B.dataDir, W30);
    writeProgressFile(B.dataDir, W30, {
      ...progress,
      completions: { [GOAL]: "2026-07-25T09:00:00+05:30" },
      completionChangedAt: { [GOAL]: "2026-07-25T09:00:00+05:30" },
    });
    await B.engine.runOnce();
    expect(B.engine.status().state).toBe("idle");

    // A pulls again -> the completion lands in its progress.json.
    await A.engine.runOnce();
    const aProgress = readProgressFile(A.dataDir, W30);
    // Same instant; Postgres returns timestamptz in UTC, not +05:30.
    expect(Date.parse(aProgress.completions[GOAL] ?? "")).toBe(
      Date.parse("2026-07-25T09:00:00+05:30"),
    );
  }, 30_000);
});
