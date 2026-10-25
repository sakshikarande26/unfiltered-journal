import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  EntryFile,
  GoalsFile,
  ProgressFile,
  WeekId,
} from "../../shared/types.js";
import { emptyProgress } from "../../shared/types.js";
import type {
  SyncCompletion,
  SyncEntry,
  SyncGoal,
  SyncPhoto,
  SyncPull,
  SyncPush,
  SyncStatusView,
} from "../../shared/sync.js";
import type { AuthClient } from "../auth/client.js";
import {
  readSession,
  writeSession,
  type Session,
} from "../auth/sessionStore.js";
import { readEntryFile, readGoalsFile, readProgressFile } from "../store/entryFiles.js";
import {
  entryJsonPath,
  entriesDir,
  goalPhotosDir,
  goalsJsonPath,
  photosDir,
  progressJsonPath,
  thumbsDir,
} from "../store/paths.js";
import { ensureWeekDirs, writeEntryFile, writeGoalsFile, writeProgressFile } from "../store/writeFiles.js";

/**
 * The sync engine: the device's half of the protocol.
 *
 * Order is pull -> apply -> upload photo bytes -> push. Pull first so a week
 * another device published arrives before this device's draft pushes (a
 * published mirror row would reject the draft's content anyway). Uploads
 * before push so a pushed storage_path always points at bytes that exist.
 *
 * Sync state is a file, not a table: the SQLite index is rebuildable from
 * data/entries/, and a rebuild must not turn into a full re-push.
 */

const STATE_FILE = "sync-state.json";

interface SyncState {
  /** Pull cursor: the server's global seq watermark. */
  lastSeq: number;
  /** weekId -> hash of the three files, as last pushed or applied. */
  weeks: Record<string, string>;
  /** Relative object path -> uploaded. e.g. "2026-W30/photos/00.jpg" */
  uploads: Record<string, true>;
  lastSyncAt: string | null;
}

const emptyState: SyncState = {
  lastSeq: 0,
  weeks: {},
  uploads: {},
  lastSyncAt: null,
};

export interface EngineDeps {
  dataDir: string;
  tz: () => string;
  syncUrl: string;
  auth: AuthClient;
  /** Reindex after applying pulled weeks. */
  reindex: () => void;
  fetchImpl?: typeof fetch;
}

function statePath(dataDir: string): string {
  return join(dataDir, STATE_FILE);
}

function readState(dataDir: string): SyncState {
  const path = statePath(dataDir);
  if (!existsSync(path)) return { ...emptyState, weeks: {}, uploads: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SyncState>;
    return {
      lastSeq: parsed.lastSeq ?? 0,
      weeks: parsed.weeks ?? {},
      uploads: parsed.uploads ?? {},
      lastSyncAt: parsed.lastSyncAt ?? null,
    };
  } catch {
    return { ...emptyState, weeks: {}, uploads: {} };
  }
}

function writeState(dataDir: string, state: SyncState): void {
  const tmp = `${statePath(dataDir)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, statePath(dataDir));
}

/** sha256 over the three per-week files - the "did anything change" signal. */
function weekHash(dataDir: string, weekId: WeekId): string {
  const h = createHash("sha256");
  for (const p of [
    entryJsonPath(dataDir, weekId),
    goalsJsonPath(dataDir, weekId),
    progressJsonPath(dataDir, weekId),
  ]) {
    h.update(existsSync(p) ? readFileSync(p) : "");
  }
  return h.digest("hex");
}

function localWeeks(dataDir: string): WeekId[] {
  const root = entriesDir(dataDir);
  return existsSync(root)
    ? (readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name) as WeekId[])
    : [];
}

const photoObjectPaths = (
  dataDir: string,
  weekId: WeekId,
): { rel: string; abs: string }[] => {
  const out: { rel: string; abs: string }[] = [];
  const collect = (rel: string, dir: string) => {
    if (!existsSync(dir)) return;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (!d.isFile() || d.name.startsWith(".")) continue;
      out.push({ rel: `${rel}/${d.name}`, abs: join(dir, d.name) });
    }
  };
  collect(`${weekId}/photos`, photosDir(dataDir, weekId));
  collect(`${weekId}/photos/thumbs`, thumbsDir(dataDir, weekId));
  collect(`${weekId}/goal-photos`, goalPhotosDir(dataDir, weekId));
  return out;
};

export class SyncEngine {
  private state: "idle" | "syncing" | "error" = "idle";
  private lastError: string | null = null;
  private running: Promise<void> | null = null;
  private readonly fetch: typeof fetch;

  constructor(private readonly deps: EngineDeps) {
    this.fetch = deps.fetchImpl ?? fetch;
  }

  status(): SyncStatusView {
    const session = readSession(this.deps.dataDir);
    if (!session) {
      return {
        state: "signed-out",
        pending: 0,
        lastSyncAt: null,
        lastError: null,
      };
    }
    return {
      state: this.state === "syncing" ? "syncing" : this.state,
      pending: this.pendingCount(),
      lastSyncAt: readState(this.deps.dataDir).lastSyncAt,
      lastError: this.lastError,
    };
  }

  private pendingCount(): number {
    const state = readState(this.deps.dataDir);
    let n = 0;
    for (const weekId of localWeeks(this.deps.dataDir)) {
      if (state.weeks[weekId] !== weekHash(this.deps.dataDir, weekId)) n += 1;
      for (const o of photoObjectPaths(this.deps.dataDir, weekId)) {
        if (!state.uploads[o.rel]) n += 1;
      }
    }
    return n;
  }

  /** Serialised: only one sync at a time, callers all await the same one. */
  runOnce(): Promise<void> {
    this.running ??= this.run()
      .catch(() => undefined)
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async token(): Promise<string | null> {
    const session = readSession(this.deps.dataDir);
    if (!session) return null;
    if (
      session.expiresAt !== null &&
      Date.parse(session.expiresAt) <= Date.now() + 30_000
    ) {
      const next = await this.deps.auth.refresh(session);
      writeSession(this.deps.dataDir, next);
      return next.accessToken;
    }
    return session.accessToken;
  }

  private async call<T>(
    path: string,
    init: RequestInit,
    token: string,
  ): Promise<T> {
    const res = await this.fetch(`${this.deps.syncUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}`);
    }
    return (await res.json()) as T;
  }

  private async run(): Promise<void> {
    const token = await this.token();
    if (token === null) return;
    this.state = "syncing";
    try {
      const state = readState(this.deps.dataDir);
      await this.pullAll(state, token);
      await this.downloadPhotos(token);
      await this.uploadPhotos(state, token);
      await this.pushDirty(state, token);
      state.lastSyncAt = new Date().toISOString();
      writeState(this.deps.dataDir, state);
      this.deps.reindex();
      this.state = "idle";
      this.lastError = null;
    } catch (e) {
      this.state = "error";
      this.lastError = e instanceof Error ? e.message : String(e);
    }
  }

  /* ---- pull ---- */

  private async pullAll(state: SyncState, token: string): Promise<void> {
    for (;;) {
      const page = await this.call<SyncPull>(
        `/sync/pull?since=${state.lastSeq}`,
        {},
        token,
      );
      if (
        page.entries.length === 0 &&
        page.photos.length === 0 &&
        page.goals.length === 0 &&
        page.completions.length === 0
      ) {
        state.lastSeq = page.seq;
        return;
      }
      this.applyPull(page);
      for (const w of new Set([
        ...page.entries.map((p) => p.record.weekId),
        ...page.photos.map((p) => p.record.weekId),
        ...page.goals.map((p) => p.record.weekId),
        ...page.completions.map((p) => p.record.weekId),
      ])) {
        state.weeks[w] = weekHash(this.deps.dataDir, w as WeekId);
      }
      state.lastSeq = page.seq;
    }
  }

  /**
   * The merge. Only entries, photos, goals and completions travel; the merge
   * rules encode who owns what:
   *
   * - a week only one side has: that side's truth
   * - remote published beats local unpublished (someone else finished it;
   *   the publish froze its goals)
   * - both published or both drafts: local draft stays authoritative on this
   *   device - content churn across devices on one open week is out of scope
   * - progress.json fields: remote applies (pin/archive/disclose/completions)
   *   because the mirror already resolved them last-write-wins
   */
  private applyPull(page: SyncPull): void {
    const byWeek = new Map<
      string,
      { entry?: SyncEntry; photos: SyncPhoto[]; goals: SyncGoal[] }
    >();
    const group = (weekId: string) => {
      let g = byWeek.get(weekId);
      if (!g) {
        g = { photos: [], goals: [] };
        byWeek.set(weekId, g);
      }
      return g;
    };
    for (const p of page.entries) group(p.record.weekId).entry = p.record;
    for (const p of page.photos) group(p.record.weekId).photos.push(p.record);
    for (const p of page.goals) group(p.record.weekId).goals.push(p.record);

    for (const [weekId, g] of byWeek) {
      this.mergeWeek(weekId as WeekId, g);
    }
    this.applyCompletions(page.completions.map((p) => p.record));
  }

  private mergeWeek(
    weekId: WeekId,
    pulled: { entry?: SyncEntry; photos: SyncPhoto[]; goals: SyncGoal[] },
  ): void {
    const dir = this.deps.dataDir;
    const exists = existsSync(entryJsonPath(dir, weekId));
    const local = exists
      ? {
          entry: readEntryFile(dir, weekId),
          goals: readGoalsFile(dir, weekId),
          progress: readProgressFile(dir, weekId),
        }
      : null;

    const remotePublished = pulled.entry?.publishedAt != null;
    const localPublished = local?.entry.publishedAt != null;
    const takeRemote = !local || (remotePublished && !localPublished);
    const remoteIsStale = local != null && localPublished && !remotePublished;

    if (takeRemote && pulled.entry) {
      const e = pulled.entry;
      const photos = pulled.photos
        .sort((a, b) => a.position - b.position)
        .map((p) => ({
          filename: p.storagePath.split("/").pop()!,
          thumbFilename: p.thumbStoragePath.split("/").pop()!,
          width: p.width,
          height: p.height,
          aiDescription: p.aiDescription,
        }));
      const entryFile: EntryFile = {
        title: e.title,
        description: e.description,
        liked: e.liked,
        challenging: e.challenging,
        publishedAt: e.publishedAt,
        createdAt: e.createdAt,
        createdTz: this.deps.tz(),
        photos,
      };
      const goalsFile: GoalsFile = {
        goals: pulled.goals
          .sort((a, b) => a.position - b.position)
          .map((g) => ({
            id: g.goalId,
            text: g.text,
            photoFilename: g.photoStoragePath
              ? g.photoStoragePath.split("/").pop()!
              : null,
          })),
      };
      const existing = local?.progress ?? emptyProgress;
      const progress: ProgressFile = {
        ...existing,
        pinned: e.pinned,
        archived: e.archived,
        goalsDisclosed: e.goalsDisclosed,
      };
      writeEntryFile(dir, weekId, entryFile);
      if (goalsFile.goals.length > 0 || existsSync(goalsJsonPath(dir, weekId))) {
        writeGoalsFile(dir, weekId, goalsFile);
      }
      writeProgressFile(dir, weekId, progress);
    } else if (!remoteIsStale && pulled.entry && local) {
      // Content stays local; the state fields still apply - they are the
      // writes that never freeze, resolved on the mirror.
      const next: ProgressFile = {
        ...local.progress,
        pinned: pulled.entry.pinned,
        archived: pulled.entry.archived,
        goalsDisclosed: pulled.entry.goalsDisclosed,
      };
      writeProgressFile(dir, weekId, next);
    }

    // Photo bytes: anything the manifest references that is not on disk.
    const photosToFetch = takeRemote
      ? pulled.photos.flatMap((p) => [p.storagePath, p.thumbStoragePath])
      : [];
    const goalPhotosToFetch =
      takeRemote
        ? pulled.goals
            .map((g) => g.photoStoragePath)
            .filter((p): p is string => p !== null)
        : [];
    this.pendingDownloads = [
      ...this.pendingDownloads,
      ...photosToFetch,
      ...goalPhotosToFetch,
    ];
  }

  private pendingDownloads: string[] = [];

  private applyCompletions(pulled: SyncCompletion[]): void {
    const dir = this.deps.dataDir;
    const byWeek = new Map<string, SyncCompletion[]>();
    for (const c of pulled) {
      const list = byWeek.get(c.weekId) ?? [];
      list.push(c);
      byWeek.set(c.weekId, list);
    }
    for (const [weekIdRaw, list] of byWeek) {
      const weekId = weekIdRaw as WeekId;
      if (!existsSync(progressJsonPath(dir, weekId))) continue;
      const progress = readProgressFile(dir, weekId);
      const completions = { ...progress.completions };
      const completionChangedAt = { ...progress.completionChangedAt };
      let touched = false;
      for (const c of list) {
        const localChanged = completionChangedAt[c.goalId];
        if (localChanged && Date.parse(localChanged) >= Date.parse(c.changedAt))
          continue;
        completionChangedAt[c.goalId] = c.changedAt;
        if (c.completedAt === null) delete completions[c.goalId];
        else completions[c.goalId] = c.completedAt;
        touched = true;
      }
      if (touched) {
        writeProgressFile(dir, weekId, {
          ...progress,
          completions,
          completionChangedAt,
          goalsDisclosed:
            progress.goalsDisclosed && Object.keys(completions).length > 0,
        });
      }
    }
  }

  private async downloadPhotos(token: string): Promise<void> {
    for (const storagePath of this.pendingDownloads) {
      // storage_path on the mirror is <weekId>/photos/... - relative to the
      // user. Tolerate a leading userId segment in case a server records it.
      const rel = /^\d{4}-W\d{2}\//.test(storagePath)
        ? storagePath
        : storagePath.split("/").slice(1).join("/");
      const weekId = rel.split("/")[0] as WeekId;
      const sub = rel.includes("/photos/")
        ? photosDir(this.deps.dataDir, weekId)
        : goalPhotosDir(this.deps.dataDir, weekId);
      const dir = rel.includes("/thumbs/")
        ? thumbsDir(this.deps.dataDir, weekId)
        : sub;
      const dest = join(dir, rel.split("/").pop()!);
      if (existsSync(dest)) continue;
      const res = await this.fetch(
        `${this.deps.syncUrl}/sync/media?path=${encodeURIComponent(rel)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!res.ok) continue; // a missing object is not worth stalling sync for
      ensureWeekDirs(this.deps.dataDir, weekId);
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    }
    this.pendingDownloads = [];
  }

  /* ---- push ---- */

  private async uploadPhotos(state: SyncState, token: string): Promise<void> {
    for (const weekId of localWeeks(this.deps.dataDir)) {
      for (const o of photoObjectPaths(this.deps.dataDir, weekId)) {
        if (state.uploads[o.rel]) continue;
        const bytes = readFileSync(o.abs);
        const form = new FormData();
        form.append(
          "file",
          new Blob([new Uint8Array(bytes)], {
            type: o.rel.endsWith(".webp") ? "image/webp" : "image/jpeg",
          }),
          o.rel.split("/").pop()!,
        );
        const res = await this.fetch(
          `${this.deps.syncUrl}/sync/photos?path=${encodeURIComponent(o.rel)}`,
          {
            method: "PUT",
            headers: { authorization: `Bearer ${token}` },
            body: form,
          },
        );
        if (!res.ok) {
          throw new Error(`photo upload ${o.rel} -> ${res.status}`);
        }
        state.uploads[o.rel] = true;
      }
    }
  }

  private buildWeekPush(weekId: WeekId): {
    entry: SyncEntry;
    photos: SyncPhoto[];
    goals: SyncGoal[];
    completions: SyncCompletion[];
  } | null {
    const dir = this.deps.dataDir;
    if (!existsSync(entryJsonPath(dir, weekId))) return null;
    const entry = readEntryFile(dir, weekId);
    const goals = readGoalsFile(dir, weekId);
    const progress = readProgressFile(dir, weekId);
    return {
      entry: {
        weekId,
        title: entry.title,
        description: entry.description,
        liked: entry.liked,
        challenging: entry.challenging,
        createdAt: entry.createdAt,
        publishedAt: entry.publishedAt,
        pinned: progress.pinned,
        archived: progress.archived,
        goalsDisclosed: progress.goalsDisclosed,
      },
      photos: entry.photos.map((p, position) => ({
        weekId,
        position,
        storagePath: `${weekId}/photos/${p.filename}`,
        thumbStoragePath: `${weekId}/photos/thumbs/${p.thumbFilename}`,
        width: p.width,
        height: p.height,
        aiDescription: p.aiDescription,
      })),
      goals: goals.goals.map((g, position) => ({
        goalId: g.id,
        weekId,
        position,
        text: g.text,
        photoStoragePath: g.photoFilename
          ? `${weekId}/goal-photos/${g.photoFilename}`
          : null,
      })),
      completions: Object.entries(progress.completionChangedAt).map(
        ([goalId, changedAt]) => ({
          goalId,
          weekId,
          completedAt: progress.completions[goalId] ?? null,
          changedAt,
        }),
      ),
    };
  }

  private async pushDirty(state: SyncState, token: string): Promise<void> {
    const dirty = localWeeks(this.deps.dataDir).filter(
      (w) => state.weeks[w] !== weekHash(this.deps.dataDir, w),
    );
    if (dirty.length === 0) return;

    const payload: SyncPush = {
      journalTz: this.deps.tz(),
      entries: [],
      photos: [],
      goals: [],
      completions: [],
    };
    for (const weekId of dirty) {
      const w = this.buildWeekPush(weekId);
      if (!w) continue;
      payload.entries.push(w.entry);
      payload.photos.push(...w.photos);
      payload.goals.push(...w.goals);
      payload.completions.push(...w.completions);
    }

    const report = await this.call<{
      applied: Record<string, number>;
      rejected: {
        key: string;
        weekId: string;
        code: string;
        message: string;
      }[];
    }>("/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }, token);

    // Weeks the mirror refused stay dirty - they will retry next sync. A
    // rejection that will never heal (frozen content) is surfaced via
    // lastError so the UI can say so instead of pretending it synced.
    const rejectedWeeks = new Set(report.rejected.map((r) => r.weekId));
    for (const weekId of dirty) {
      if (!rejectedWeeks.has(weekId)) {
        state.weeks[weekId] = weekHash(this.deps.dataDir, weekId);
      }
    }
    if (report.rejected.length > 0) {
      throw new Error(
        `push rejected: ${report.rejected.map((r) => `${r.key} ${r.code}`).join(", ")}`,
      );
    }
  }
}
