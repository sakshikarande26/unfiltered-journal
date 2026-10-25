import { join } from "node:path";
import postgres from "postgres";
import { DEV_JWT_SECRET } from "../../shared/sync.js";
import { buildServerApp } from "./app.js";
import { FsStorage, SupabaseRestStorage } from "./storage.js";

/**
 * The sync mirror's entrypoint.
 *
 * Env:
 *   DATABASE_URL           postgres connection string (required)
 *   TUJ_JWT_SECRET         HS256 secret = the Supabase project's JWT secret.
 *                          Falls back to the shared dev secret, which only
 *                          ever mints/verifies dev tokens.
 *   SUPABASE_URL + SUPABASE_SERVICE_KEY + STORAGE_BUCKET
 *                          when set, photos go to that private bucket;
 *                          otherwise bytes land under STORAGE_DIR (dev).
 *   STORAGE_DIR            dev storage root (default ./storage-data)
 *   PORT                   default 8787
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const sql = postgres(databaseUrl);

const storage =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? new SupabaseRestStorage(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY,
        process.env.STORAGE_BUCKET ?? "journal-photos",
      )
    : new FsStorage(
        process.env.STORAGE_DIR ?? join(process.cwd(), "storage-data"),
      );

const app = await buildServerApp({
  sql,
  storage,
  jwtSecret: process.env.TUJ_JWT_SECRET ?? DEV_JWT_SECRET,
});

const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "0.0.0.0" });
console.log(`unfiltered-journal sync on http://0.0.0.0:${port}`);
