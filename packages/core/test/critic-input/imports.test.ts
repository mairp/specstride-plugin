/**
 * The import rule of the critic-input group (quickstart scenario 8, first
 * half; F100-FR-012).
 *
 * No file under `packages/core/src/critic-input/` imports `node:fs`, a
 * process module or a network module: every file-system answer goes through
 * the ports of `src/critic-input/ports.ts` (types only, itself importing
 * nothing), every move through the `FileMovingPort`, and the one ignore
 * probe through the `ProcessPort`. The shipped adapters live in the edge
 * packages.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GROUP = join(HERE, "..", "..", "src", "critic-input");

/** The modules a file of the group must never import. */
const FORBIDDEN = [
  "node:fs",
  "node:fs/promises",
  "node:child_process",
  "node:http",
  "node:https",
  "node:net",
  "node:tls",
  "node:dns",
  "node:worker_threads",
];

function listAll(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...listAll(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

test("critic-input imports: no file of the group imports fs, process or network", () => {
  const files = listAll(GROUP);
  assert.ok(files.length > 0, "the group holds no source file");
  const offenders: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      const match = /(?:^|\bfrom\s+|import\s+|import\()\s*["']([^"']+)["']/.exec(line);
      if (match !== null && FORBIDDEN.includes(match[1]!)) {
        offenders.push(`${relative(GROUP, file)}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("critic-input imports: the ports file imports nothing at all", () => {
  const text = readFileSync(join(GROUP, "ports.ts"), "utf8");
  assert.ok(!/^\s*import\s/m.test(text), "ports.ts carries an import");
  assert.ok(!/require\(/.test(text), "ports.ts carries a require");
});
