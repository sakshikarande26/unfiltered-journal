import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveDataDir } from "../backend/config.js";
import { openDb } from "../backend/db/open.js";
import { RebuildFailed, rebuild } from "../backend/store/reindex.js";

/**
 * Drops the index and rebuilds it from disk.
 *
 * Deleting the database and running this must always work - that is the test
 * of whether the filesystem is really the source of truth.
 */
const root = process.cwd();
const dataDir = resolveDataDir();
const dbPath = join(dataDir, "index.db");

mkdirSync(join(dataDir, "entries"), { recursive: true });

const { journalTz } = loadConfig(root);

// The database file is deliberately not deleted first. rebuild() drops and
// recreates every table inside one transaction, so a reset that fails
// validation leaves the previous index intact rather than leaving the user
// with no index at all. SQLite rolls back DDL like anything else.
const db = openDb(dbPath);
try {
  const result = rebuild(dataDir, db, journalTz);
  console.log(
    `Indexed ${result.weeks} week(s) from ${dataDir} using ${journalTz}: ` +
      `${result.photos} photo(s), ${result.goals} goal(s), ` +
      `${result.completions} completion(s).`,
  );
} catch (e) {
  if (e instanceof RebuildFailed) {
    console.error(e.message);
    console.error("\nNothing was written. Fix the folders above and re-run.");
    process.exit(1);
  }
  throw e;
} finally {
  db.close();
}
