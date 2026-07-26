import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCKED_W30, harness, json, type Harness } from "./testApp.js";

let h: Harness;

beforeEach(async () => {
  h = await harness();
});

afterEach(async () => {
  await h.close();
  rmSync(h.dataDir, { recursive: true, force: true });
});

const profile = {
  name: "Sakshi",
  bio: "Making things and writing them down.",
  currently: {
    reading: "Klara and the Sun",
    into: "Long walks with no destination",
    location: "Pune",
  },
};

describe("profile", () => {
  it("returns empty defaults before anything is written", async () => {
    const res = await h.app.inject({ url: "/api/profile" });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({
      name: "",
      bio: "",
      currently: { reading: "", into: "", location: "" },
    });
  });

  it("round-trips", async () => {
    const put = await h.app.inject({
      method: "PUT",
      url: "/api/profile",
      payload: profile,
    });
    expect(put.statusCode).toBe(200);
    expect(json(await h.app.inject({ url: "/api/profile" }))).toEqual(profile);
  });

  it("has no lock - it describes you now, not a past week", async () => {
    h.setNow(LOCKED_W30);
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/profile",
      payload: { ...profile, name: "Changed later" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects a malformed body", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/profile",
      payload: { name: "Missing the rest" },
    });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe("INVALID_BODY");
  });
});
