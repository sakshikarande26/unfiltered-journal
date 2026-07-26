import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Db = Database.Database;

/** Bump when schema.sql changes. A mismatch forces a rebuild from disk, which
 *  is always safe because the database holds nothing authoritative. */
export const SCHEMA_VERSION = 1;

const here = dirname(fileURLToPath(import.meta.url));
const schemaSql = () => readFileSync(join(here, "schema.sql"), "utf8");

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

/** Drops every table and view and recreates them. Callers run this inside the
 *  reindex transaction so a failed rebuild leaves the old index untouched. */
export function createSchema(db: Db): void {
  db.exec(`
    DROP VIEW  IF EXISTS entry_goal_counts;
    DROP TABLE IF EXISTS goal_completions;
    DROP TABLE IF EXISTS goals;
    DROP TABLE IF EXISTS photos;
    DROP TABLE IF EXISTS entries;
    DROP TABLE IF EXISTS index_meta;
  `);
  db.exec(schemaSql());
}

export function schemaVersionOf(db: Db): number | null {
  try {
    const row = db
      .prepare("SELECT schema_version FROM index_meta WHERE id = 1")
      .get() as { schema_version: number } | undefined;
    return row?.schema_version ?? null;
  } catch {
    return null; // table absent - never indexed
  }
}
