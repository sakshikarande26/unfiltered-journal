import type {
  DraftView,
  EntryDetail,
  EntrySummary,
  GoalsOwnerView,
  Profile,
  WeekId,
} from "../../../shared/types.js";
import type {
  AuthStatus,
  SyncStatusView,
  YearGridView,
} from "../../../shared/sync.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let code = "HTTP_" + res.status;
    let message = `${res.url} -> ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message);
  }
  return res.json() as Promise<T>;
}

async function getJson<T>(url: string): Promise<T> {
  return parse<T>(await fetch(url));
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return parse<T>(await fetch(url, init));
}

/* ---- journal ---- */

export const getProfile = (): Promise<Profile> => getJson("/api/profile");

export const getEntries = (): Promise<EntrySummary[]> => getJson("/api/entries");

export const getEntry = (weekId: WeekId): Promise<EntryDetail> =>
  getJson(`/api/entries/${weekId}`);

export const getGoals = (weekId: WeekId): Promise<GoalsOwnerView> =>
  getJson(`/api/entries/${weekId}/goals`);

export const completeGoal = (weekId: WeekId, goalId: string): Promise<GoalsOwnerView> =>
  send(`/api/entries/${weekId}/goals/${goalId}/completion`, "PUT");

export const uncompleteGoal = (weekId: WeekId, goalId: string): Promise<GoalsOwnerView> =>
  send(`/api/entries/${weekId}/goals/${goalId}/completion`, "DELETE");

/* ---- draft composer ---- */

export const getDraft = (): Promise<DraftView> => getJson("/api/draft");

export const saveDraft = (
  weekId: WeekId,
  patch: { title?: string; description?: string; liked?: string; challenging?: string },
): Promise<EntryDetail> =>
  send(`/api/draft?week=${encodeURIComponent(weekId)}`, "PUT", patch);

export const publishDraft = (weekId: WeekId): Promise<EntryDetail> =>
  send(`/api/draft/publish?week=${encodeURIComponent(weekId)}`, "POST");

export const saveGoals = (
  weekId: WeekId,
  goals: { text: string; photoFilename?: string | null }[],
): Promise<GoalsOwnerView> =>
  send(`/api/draft/goals?week=${encodeURIComponent(weekId)}`, "PUT", { goals });

export const uploadPhoto = async (weekId: WeekId, file: File): Promise<EntryDetail> => {
  const form = new FormData();
  form.append("file", file);
  return parse<EntryDetail>(
    await fetch(`/api/draft/photos?week=${encodeURIComponent(weekId)}`, {
      method: "POST",
      body: form,
    }),
  );
};

export const deletePhoto = (weekId: WeekId, position: number): Promise<EntryDetail> =>
  send(`/api/draft/photos/${position}?week=${encodeURIComponent(weekId)}`, "DELETE");

/* ---- year grid ---- */

export const getYear = (year: number): Promise<YearGridView> =>
  getJson(`/api/year?year=${year}`);

/* ---- auth + sync ---- */

export const getAuthStatus = (): Promise<AuthStatus> => getJson("/api/auth/status");

export const signUp = (email: string, password: string): Promise<AuthStatus> =>
  send("/api/auth/signup", "POST", { email, password });

export const login = (email: string, password: string): Promise<AuthStatus> =>
  send("/api/auth/login", "POST", { email, password });

export const logout = (): Promise<AuthStatus> => send("/api/auth/logout", "POST");

/** 404 when the backend runs without sync wiring - treat as "no sync". */
export const getSyncStatus = async (): Promise<SyncStatusView | null> => {
  try {
    return await getJson("/api/sync/status");
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
};

export const syncNow = (): Promise<SyncStatusView> => send("/api/sync/now", "POST");
