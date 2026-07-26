import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { openDb } from "./db/open.js";
import { buildApp } from "./http/app.js";
import { rebuild } from "./store/reindex.js";

const root = process.cwd();
const dataDir = join(root, "data");
mkdirSync(join(dataDir, "entries"), { recursive: true });

const { journalTz } = loadConfig(root);
const db = openDb(join(dataDir, "index.db"));

// The index is rebuilt from disk on every boot. It holds nothing
// authoritative, so this is always safe, and running the rebuild constantly
// means the path stays exercised rather than rotting until it is needed.
rebuild(dataDir, db, journalTz);

const { app } = await buildApp({ dataDir, db, tz: journalTz });
const port = Number(process.env.PORT ?? 5174);
await app.listen({ port, host: "127.0.0.1" });
console.log(`the-unfiltered-journal on http://127.0.0.1:${port} (${journalTz})`);
