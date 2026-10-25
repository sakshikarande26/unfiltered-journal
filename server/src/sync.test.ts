import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEV_JWT_SECRET, type SyncPull } from "../../shared/sync.js";
import { buildServerApp } from "./app.js";
import { issueDevToken } from "./auth.js";
import { FsStorage } from "./storage.js";
import type { Sql } from "./store.js";

/**
 * Integration tests against a real Postgres - the freeze rules are the
 * mirror's half of the product contract and are only honest when the actual
 * constraints fire.
 *
 * Needs TUJ_TEST_DATABASE_URL pointing at a database the migration has been
 * applied to. Skipped without it rather than faked, because a fake Postgres
 * proves nothing.
 */
const DB = process.env.TUJ_TEST_DATABASE_URL;

const run = DB ? describe : describe.skip;

/** Asia/Kolkata: 2026-W30 = Mon 20 Jul - Sun 26 Jul 2026. */
const W30 = "2026-W30";
const W20 = "2026-W20"; // ended 2026-05-17 - always locked
const TZ = "Asia/Kolkata";
const MID_W30 = new Date("2026-07-22T10:00:00+05:30");

run("sync api", () => {
  let sql: Sql;
  let app: Awaited<ReturnType<typeof buildServerApp>>;
  let tokenA: string;
  let tokenB: string;
  let storageDir: string;
  const now = { t: MID_W30 };

  const userA = "11111111-1111-4111-8111-111111111111";
  const userB = "22222222-2222-4222-8222-222222222222";
  const goalA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  beforeAll(async () => {
    sql = postgres(DB!, { max: 4 });
    for (const t of [
      "goal_completions",
      "goals",
      "photos",
      "entries",
      "users",
    ]) {
      await sql.unsafe(`TRUNCATE public.${t} CASCADE`);
    }
    storageDir = mkdtempSync(join(tmpdir(), "tuj-storage-"));
    app = await buildServerApp({
      sql,
      storage: new FsStorage(storageDir),
      jwtSecret: DEV_JWT_SECRET,
      now: () => now.t,
    });
    tokenA = await issueDevToken(DEV_JWT_SECRET, userA, "a@x.dev");
    tokenB = await issueDevToken(DEV_JWT_SECRET, userB, "b@x.dev");
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    rmSync(storageDir, { recursive: true, force: true });
  });

  const push = (token: string, body: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: "/sync/push",
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });

  const pull = (token: string, since = 0) =>
    app.inject({
      method: "GET",
      url: `/sync/pull?since=${since}`,
      headers: { authorization: `Bearer ${token}` },
    });

  const entry = (over: Record<string, unknown> = {}) => ({
    weekId: W30,
    title: "week thirty",
    description: "a week",
    liked: "rain",
    challenging: "sleep",
    createdAt: "2026-07-22T10:00:00+05:30",
    publishedAt: null,
    pinned: false,
    archived: false,
    goalsDisclosed: false,
    ...over,
  });

  it("rejects requests without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/sync/pull" });
    expect(res.statusCode).toBe(401);
  });

  it("pushes a draft entry and pulls it back", async () => {
    const res = await push(tokenA, {
      journalTz: TZ,
      entries: [entry()],
      photos: [],
      goals: [],
      completions: [],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().applied.entries).toBe(1);

    const pulled = (await pull(tokenA)).json() as SyncPull;
    expect(pulled.entries).toHaveLength(1);
    expect(pulled.entries[0]!.record.weekId).toBe(W30);
    expect(pulled.seq).toBeGreaterThan(0);
  });

  it("scopes every row to the JWT user - other users see nothing", async () => {
    const pulled = (await pull(tokenB)).json() as SyncPull;
    expect(pulled.entries).toHaveLength(0);
  });

  it("accepts goal and completion pushes and survives re-push idempotently", async () => {
    const res = await push(tokenA, {
      journalTz: TZ,
      entries: [],
      photos: [],
      goals: [
        {
          goalId: goalA,
          weekId: W30,
          position: 0,
          text: "run a 10k",
          photoStoragePath: null,
        },
      ],
      completions: [
        {
          goalId: goalA,
          weekId: W30,
          completedAt: "2026-07-23T09:00:00+05:30",
          changedAt: "2026-07-23T09:00:00+05:30",
        },
      ],
    });
    expect(res.json().rejected).toEqual([]);

    const again = await push(tokenA, {
      journalTz: TZ,
      entries: [entry()],
      photos: [],
      goals: [],
      completions: [],
    });
    expect(again.json().rejected).toEqual([]);
  });

  it("freezes goal text at publish but keeps entry content writable until week end", async () => {
    const publish = await push(tokenA, {
      journalTz: TZ,
      entries: [entry({ publishedAt: "2026-07-24T12:00:00+05:30" })],
      photos: [],
      goals: [
        {
          goalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          weekId: W30,
          position: 1,
          text: "original goal",
          photoStoragePath: null,
        },
      ],
      completions: [],
    });
    // Goals arrive with the already-published entry on a first sync.
    expect(publish.json().rejected).toEqual([]);

    const goalWrite = await push(tokenA, {
      journalTz: TZ,
      entries: [],
      photos: [],
      goals: [
        {
          goalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          weekId: W30,
          position: 1,
          text: "edited goal",
          photoStoragePath: null,
        },
      ],
      completions: [],
    });
    expect(goalWrite.json().rejected[0]?.code).toBe("GOALS_FROZEN");

    const contentEdit = await push(tokenA, {
      journalTz: TZ,
      entries: [entry({ title: "edited friday", publishedAt: "2026-07-24T12:00:00+05:30" })],
      photos: [],
      goals: [],
      completions: [],
    });
    expect(contentEdit.json().rejected).toEqual([]);
  });

  it("rejects published pushes for a week that already ended", async () => {
    const res = await push(tokenA, {
      journalTz: TZ,
      entries: [
        entry({
          weekId: W20,
          publishedAt: "2026-05-18T12:00:00+05:30",
          createdAt: "2026-05-18T12:00:00+05:30",
        }),
      ],
      photos: [],
      goals: [],
      completions: [],
    });
    expect(res.json().rejected[0]?.code).toBe("PUBLISH_AFTER_LOCK");
  });

  it("freezes all content once the week ends; completions still apply", async () => {
    now.t = new Date("2026-07-27T00:00:01+05:30"); // W30 just locked
    const edit = await push(tokenA, {
      journalTz: TZ,
      entries: [entry({ title: "post-lock edit", publishedAt: "2026-07-24T12:00:00+05:30" })],
      photos: [],
      goals: [],
      completions: [],
    });
    expect(edit.json().rejected[0]?.code).toBe("ENTRY_FROZEN");

    const completion = await push(tokenA, {
      journalTz: TZ,
      entries: [],
      photos: [],
      goals: [],
      completions: [
        {
          goalId: goalA,
          weekId: W30,
          completedAt: null,
          changedAt: "2026-07-28T09:00:00+05:30",
        },
      ],
    });
    expect(completion.json().rejected).toEqual([]);
    now.t = MID_W30;
  });

  it("resolves completions last-write-wins, including toggles off", async () => {
    const pulled = (await pull(tokenA)).json() as SyncPull;
    const comp = pulled.completions.find((c) => c.record.goalId === goalA);
    // The 07-28 toggle-off beat the 07-23 completion.
    expect(comp!.record.completedAt).toBeNull();
  });

  it("round-trips a photo upload and serves it back", async () => {
    const boundary = "----tujboundary";
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="00.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await app.inject({
      method: "PUT",
      url: `/sync/photos?path=${W30}/photos/00.jpg`,
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(up.statusCode).toBe(200);
    expect(up.json().storagePath).toBe(`${userA}/${W30}/photos/00.jpg`);

    const down = await app.inject({
      method: "GET",
      url: `/sync/media?path=${W30}/photos/00.jpg`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(down.statusCode).toBe(200);
    expect(down.headers["content-type"]).toContain("image/jpeg");

    const other = await app.inject({
      method: "GET",
      url: `/sync/media?path=${W30}/photos/00.jpg`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(other.statusCode).toBe(404);
  });

  it("pull paginates by cursor: since=<last seq> returns only newer rows", async () => {
    const first = (await pull(tokenA, 0)).json() as SyncPull;
    const second = (await pull(tokenA, first.seq)).json() as SyncPull;
    expect(second.entries).toHaveLength(0);
    expect(second.completions).toHaveLength(0);
    expect(second.seq).toBe(first.seq);
  });
});
