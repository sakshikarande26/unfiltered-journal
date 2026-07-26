import type { EntryDetail, EntrySummary, Profile, WeekId } from "../../../shared/types.js";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const getProfile = (): Promise<Profile> => getJson("/api/profile");

export const getEntries = (): Promise<EntrySummary[]> => getJson("/api/entries");

export const getEntry = (weekId: WeekId): Promise<EntryDetail> =>
  getJson(`/api/entries/${weekId}`);
