import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DEV_JWT_SECRET } from "../shared/sync.js";
import { DevAuthClient, SupabaseAuthClient } from "./auth/client.js";
import { loadConfig, resolveDataDir } from "./config.js";
import { openDb } from "./db/open.js";
import { buildApp } from "./http/app.js";
import { rebuild } from "./store/reindex.js";
import { SyncEngine } from "./sync/engine.js";

const root = process.cwd();
const dataDir = resolveDataDir();
mkdirSync(join(dataDir, "entries"), { recursive: true });

const { journalTz } = loadConfig(root);
const db = openDb(join(dataDir, "index.db"));

// The index is rebuilt from disk on every boot. It holds nothing
// authoritative, so this is always safe, and running the rebuild constantly
// means the path stays exercised rather than rotting until it is needed.
rebuild(dataDir, db, journalTz);

/**
 * Auth + sync wiring.
 *
 * TUJ_SUPABASE_URL + TUJ_SUPABASE_ANON_KEY set -> real Supabase Auth against
 * that project. Otherwise dev mode: the app mints its own HS256 tokens with
 * TUJ_JWT_SECRET (the same default the dev sync server uses), so the whole
 * loop runs with zero external services.
 *
 * TUJ_SYNC_URL is where the mirror lives; default is a local dev server.
 */
const supabaseUrl = process.env.TUJ_SUPABASE_URL;
const supabaseAnonKey = process.env.TUJ_SUPABASE_ANON_KEY;
const auth =
  supabaseUrl && supabaseAnonKey
    ? new SupabaseAuthClient(supabaseUrl, supabaseAnonKey)
    : new DevAuthClient(process.env.TUJ_JWT_SECRET ?? DEV_JWT_SECRET);

const engine = new SyncEngine({
  dataDir,
  tz: () => journalTz,
  syncUrl: process.env.TUJ_SYNC_URL ?? "http://127.0.0.1:8787",
  auth,
  reindex: () => rebuild(dataDir, db, journalTz),
});

const { app } = await buildApp({
  dataDir,
  db,
  tz: journalTz,
  sync: { auth, engine },
});
const port = Number(process.env.PORT ?? 5174);
await app.listen({ port, host: "127.0.0.1" });

// Periodic sync plus a kick on boot. Both are no-ops signed out or offline -
// the engine reports state for the UI rather than throwing.
const intervalMs = Number(process.env.TUJ_SYNC_INTERVAL_MS ?? 60_000);
setInterval(() => void engine.runOnce(), intervalMs).unref();
void engine.runOnce();

console.log(
  `the-unfiltered-journal on http://127.0.0.1:${port} (${journalTz}, auth=${auth.mode})`,
);
