import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { DateTime } from "luxon";

/**
 * The journal timezone.
 *
 * Week math uses this, never the live system zone. If it used the system zone,
 * a locked week's boundaries would depend on where the user happened to be
 * standing when they asked, and flying east on a Saturday would quietly hand
 * them extra hours of draft time. Changing this value is an explicit act.
 */
const configSchema = z.object({
  journalTz: z.string().min(1),
});

export type Config = z.infer<typeof configSchema>;

export function systemTz(): string {
  return DateTime.local().zoneName ?? "UTC";
}

export function configPath(root: string): string {
  return join(root, "config.json");
}

/** Reads config.json, creating it seeded from the system zone on first run. */
export function loadConfig(root: string): Config {
  const path = configPath(root);
  if (!existsSync(path)) {
    const seeded: Config = { journalTz: systemTz() };
    writeFileSync(path, `${JSON.stringify(seeded, null, 2)}\n`);
    return seeded;
  }
  return configSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Where the real archive lives. Never inside the repo: a `rm -rf`, `git
 * clean`, or careless script running from the project directory should not
 * be able to reach it.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.TUJ_DATA_DIR ?? join(homedir(), ".the-unfiltered-journal");
}

/**
 * Throws if `dir` resolves to the real archive path. Called by anything that
 * builds a throwaway archive (tests, future seeding scripts) so a bug that
 * accidentally points a scratch helper at production fails loudly instead of
 * writing into someone's real journal.
 */
export function assertNotRealArchive(dir: string): void {
  const real = resolve(resolveDataDir());
  if (resolve(dir) === real) {
    throw new Error(
      `Refusing to use the real archive (${real}) as a throwaway directory. ` +
        "Tests and seeding must use an isolated directory.",
    );
  }
}
