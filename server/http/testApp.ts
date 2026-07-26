import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import type { WeekId } from "../../shared/types.js";
import { openDb, type Db } from "../db/open.js";
import { buildApp } from "./app.js";
import { makeArchiveDir } from "../store/testArchive.js";

export const TZ = "Asia/Kolkata";

/** 2026-W30 runs Mon 20 Jul - Sun 26 Jul 2026 in Asia/Kolkata. */
export const W30 = "2026-W30" as WeekId;
export const W31 = "2026-W31" as WeekId;

export const ist = (local: string) => new Date(`${local}+05:30`);

/** Wednesday of 2026-W30 - mid-week, entry open and unpublished. */
export const MID_W30 = ist("2026-07-22T10:00:00");
/** The last instant of 2026-W30. Everything is still writable here. */
export const LAST_MS_W30 = ist("2026-07-26T23:59:59.999");
/** One millisecond later. 2026-W30 is locked forever. */
export const LOCKED_W30 = ist("2026-07-27T00:00:00.000");

export interface Harness {
  app: FastifyInstance;
  db: Db;
  dataDir: string;
  /** Move the clock. Every lock decision reads this. */
  setNow(when: Date): void;
  close(): Promise<void>;
}

export async function harness(start: Date = MID_W30): Promise<Harness> {
  const dataDir = makeArchiveDir();
  const db = openDb(":memory:");
  let current = start;
  const { app } = await buildApp({
    dataDir,
    db,
    tz: TZ,
    now: () => current,
  });
  await app.ready();
  return {
    app,
    db,
    dataDir,
    setNow: (when) => {
      current = when;
    },
    close: async () => {
      await app.close();
      db.close();
    },
  };
}

export const json = (res: { body: string }) => JSON.parse(res.body);

export async function jpeg(width = 800, height = 600): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: "#8899aa" },
  })
    .jpeg()
    .toBuffer();
}

/** Builds a multipart body by hand - no extra dependency needed for one field. */
export function multipartBody(bytes: Buffer, filename = "photo.jpg") {
  const boundary = "----tujboundary";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, bytes, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

/**
 * Gets a published entry with goals and one completion into 2026-W30, with
 * the clock still inside the week. Callers then move the clock to lock it.
 */
export async function seedPublishedWeek(
  h: Harness,
  week: string = W30,
): Promise<string[]> {
  await h.app.inject({
    method: "PUT",
    url: `/api/draft?week=${week}`,
    payload: { title: "Rain week", description: "Wet.", liked: "The smell." },
  });
  await h.app.inject({
    method: "POST",
    url: `/api/draft/photos?week=${week}`,
    ...multipartBody(await jpeg()),
  });
  const goalsRes = await h.app.inject({
    method: "PUT",
    url: `/api/draft/goals?week=${week}`,
    payload: {
      goals: [
        { text: "Swim twice" },
        { text: "Call Dad" },
        { text: "Read 50pp" },
      ],
    },
  });
  const goalIds: string[] = json(goalsRes).goals.map(
    (g: { id: string }) => g.id,
  );
  await h.app.inject({ method: "POST", url: `/api/draft/publish?week=${week}` });
  await h.app.inject({
    method: "PUT",
    url: `/api/entries/${W30}/goals/${goalIds[0]}/completion`,
  });
  return goalIds;
}
