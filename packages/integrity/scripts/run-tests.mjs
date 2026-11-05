#!/usr/bin/env node
/**
 * T001 — the test runner of `@specstride/integrity`.
 *
 * Runs the package's own tests (`packages/integrity/test/`) and the fixtures'
 * tests of feature 116 under `tests/integrity/116/` (T066 to T068), so that
 * `npm test` of the workspace and `npm test -w @specstride/integrity` reach
 * both. The workspace-level `npm test` runs every workspace script through
 * `tests/isolate.ts` from the package directory (`package.json`), which is the
 * host-safety rule of the campaign (owner ruling 2026-10-02); this script is
 * always started under that wrapper and only collects files and spawns
 * `node --test` on them.
 *
 * `tests/integrity/116/` fills as the later tasks of the feature land; while it
 * holds no test file yet, the runner says so and exits 0, so the phase-1 wiring
 * is provable without faking a fixture test. Exits with the runner's own exit
 * code once at least one file exists in either place.
 */
import { readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = resolve(dirname(dirname(fileURLToPath(import.meta.url)))); // packages/integrity
const ROOT = resolve(PKG_DIR, "../.."); // repository root
const PLACES = [join(PKG_DIR, "test"), join(ROOT, "tests/integrity/116")];

/** Every `*.test.*` file of a directory tree, sorted. */
function testFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && /\.test\.[cm]?[jt]s$/.test(entry.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

const files = PLACES.flatMap(testFiles);
if (files.length === 0) {
  process.stdout.write(
    `integrity: no test file in ${PLACES.map((p) => "." + p.slice(ROOT.length)).join(" or ")} yet\n`,
  );
  process.exit(0);
}
const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: ROOT,
  stdio: "inherit",
});
if (result.error) {
  process.stderr.write(`run-tests: cannot start node --test: ${result.error.message}\n`);
  process.exit(2);
}
process.exit(result.status ?? 1);
