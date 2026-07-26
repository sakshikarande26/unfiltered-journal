import { existsSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MID_W30,
  W30,
  harness,
  jpeg,
  json,
  multipartBody,
  type Harness,
} from "./testApp.js";
import { photosDir } from "../store/paths.js";
import { join } from "node:path";

let h: Harness;

beforeEach(async () => {
  h = await harness(MID_W30);
});

afterEach(async () => {
  await h.close();
  rmSync(h.dataDir, { recursive: true, force: true });
});

const put = (payload: object) =>
  h.app.inject({ method: "PUT", url: `/api/draft?week=${W30}`, payload });

const upload = async () =>
  h.app.inject({
    method: "POST",
    url: `/api/draft/photos?week=${W30}`,
    ...multipartBody(await jpeg()),
  });

describe("the current week", () => {
  it("reports an empty week without creating anything", async () => {
    const res = json(await h.app.inject({ url: "/api/draft" }));
    expect(res).toMatchObject({ weekId: W30, state: "empty", entry: null });
    expect(existsSync(join(h.dataDir, "entries", W30))).toBe(false);
  });

  it("creates the entry on first write and keeps one per week", async () => {
    await put({ title: "First" });
    await put({ description: "Second write, same week" });
    const draft = json(await h.app.inject({ url: "/api/draft" }));
    expect(draft.state).toBe("draft");
    expect(draft.entry).toMatchObject({
      title: "First",
      description: "Second write, same week",
    });

    const list = json(await h.app.inject({ url: "/api/entries" }));
    expect(list).toHaveLength(1);
  });

  it("requires the week to be named", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/draft",
      payload: { title: "No week given" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("publishing", () => {
  it("happens once", async () => {
    await put({ title: "Ready" });
    const first = await h.app.inject({
      method: "POST",
      url: `/api/draft/publish?week=${W30}`,
    });
    const second = await h.app.inject({
      method: "POST",
      url: `/api/draft/publish?week=${W30}`,
    });
    expect(first.statusCode).toBe(200);
    expect(json(first).state).toBe("published");
    expect(second.statusCode).toBe(409);
    expect(json(second).error.code).toBe("ALREADY_PUBLISHED");
  });

  it("leaves prose editable until the week ends", async () => {
    await put({ title: "Ready" });
    await h.app.inject({
      method: "POST",
      url: `/api/draft/publish?week=${W30}`,
    });
    const res = await put({ title: "Second thoughts" });
    expect(res.statusCode).toBe(200);
    expect(json(res).title).toBe("Second thoughts");
  });

  it("refuses to publish a week that was never started", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: `/api/draft/publish?week=${W30}`,
    });
    expect(res.statusCode).toBe(404);
    expect(json(res).error.code).toBe("NO_DRAFT");
  });
});

describe("photos", () => {
  it("measures the image server side and writes a thumbnail", async () => {
    await put({ title: "With a photo" });
    const res = await upload();
    expect(res.statusCode).toBe(200);
    const photo = json(res).photos[0];
    expect(photo).toMatchObject({ position: 0, width: 800, height: 600 });
    expect(existsSync(join(photosDir(h.dataDir, W30), "00.jpg"))).toBe(true);
    expect(
      existsSync(join(photosDir(h.dataDir, W30), "thumbs", "00.webp")),
    ).toBe(true);
  });

  it("treats the first photo as the cover", async () => {
    await put({ title: "Cover" });
    await upload();
    await upload();
    const entry = json(await h.app.inject({ url: `/api/entries/${W30}` }));
    expect(entry.cover.position).toBe(0);
    expect(entry.photos).toHaveLength(2);
  });

  it("caps an entry at five", async () => {
    await put({ title: "Lots" });
    for (let i = 0; i < 5; i++) expect((await upload()).statusCode).toBe(200);
    const sixth = await upload();
    expect(sixth.statusCode).toBe(413);
    expect(json(sixth).error.code).toBe("MAX_PHOTOS");
  });

  it("renumbers after a delete so position 0 stays the cover", async () => {
    await put({ title: "Delete" });
    await upload();
    await upload();
    const res = await h.app.inject({
      method: "DELETE",
      url: `/api/draft/photos/0?week=${W30}`,
    });
    expect(res.statusCode).toBe(200);
    expect(json(res).photos).toHaveLength(1);
    expect(json(res).photos[0].position).toBe(0);
  });

  it("rejects an upload that is not a decodable image", async () => {
    await put({ title: "Not an image" });
    const res = await h.app.inject({
      method: "POST",
      url: `/api/draft/photos?week=${W30}`,
      ...multipartBody(Buffer.from("this is not a jpeg"), "notes.txt"),
    });
    expect(res.statusCode).toBe(415);
    expect(json(res).error.code).toBe("NOT_AN_IMAGE");
  });

  it("lets the user rewrite the AI description", async () => {
    await put({ title: "Describe" });
    await upload();
    const res = await h.app.inject({
      method: "PUT",
      url: `/api/draft/photos/0/description?week=${W30}`,
      payload: { aiDescription: "My own words about the photo" },
    });
    expect(res.statusCode).toBe(200);
    expect(json(res).photos[0].aiDescription).toBe(
      "My own words about the photo",
    );
  });
});

describe("history ordering", () => {
  it("puts pinned first, then newest first, and hides archived", async () => {
    await put({ title: "Week 30" });
    h.setNow(new Date("2026-08-03T10:00:00+05:30")); // 2026-W32
    await h.app.inject({
      method: "PUT",
      url: "/api/draft?week=2026-W32",
      payload: { title: "Week 32" },
    });

    let list = json(await h.app.inject({ url: "/api/entries" }));
    expect(list.map((e: { weekId: string }) => e.weekId)).toEqual([
      "2026-W32",
      "2026-W30",
    ]);

    await h.app.inject({
      method: "PUT",
      url: `/api/entries/${W30}/pinned`,
      payload: { pinned: true },
    });
    list = json(await h.app.inject({ url: "/api/entries" }));
    expect(list[0].weekId).toBe(W30);

    await h.app.inject({
      method: "PUT",
      url: `/api/entries/${W30}/archived`,
      payload: { archived: true },
    });
    list = json(await h.app.inject({ url: "/api/entries" }));
    expect(list.map((e: { weekId: string }) => e.weekId)).toEqual(["2026-W32"]);

    // Archiving hides. It does not delete.
    list = json(await h.app.inject({ url: "/api/entries?archived=true" }));
    expect(list).toHaveLength(2);
    expect((await h.app.inject({ url: `/api/entries/${W30}` })).statusCode).toBe(
      200,
    );
  });
});
