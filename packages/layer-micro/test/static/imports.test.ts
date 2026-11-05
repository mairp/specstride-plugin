/**
 * T132 (IR-01; F115-FR-002) — static: the package graph of
 * `packages/layer-micro/` imports no writer of the phase gate, starts no
 * process, opens no connection and imports neither `node:fs` nor
 * `node:fs/promises`.
 *
 * The walk is over every TypeScript file under `src/` (the package graph of
 * the layer itself); the test reads files, the layer never does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..", "..", "src");

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (entry.name.endsWith(".ts")) yield path;
  }
}

const files = [...sources(SRC)];
const MODULE_SPECIFIER = /(?:^|\n)\s*(?:import|export)[^"'`]*?from\s*["']([^"']+)["']/g;
const BARE_IMPORT = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;

function specifiers(text: string): string[] {
  const found: string[] = [];
  for (const regex of [MODULE_SPECIFIER, BARE_IMPORT]) {
    for (const match of text.matchAll(regex)) found.push(match[1]);
  }
  return found;
}

test("T132: the layer holds sources to scan", () => {
  assert.ok(files.length >= 20, `only ${files.length} sources under src/`);
});

test("T132: no `node:fs`, `node:fs/promises` or any other node: module", () => {
  const violations = files.flatMap((file) =>
    specifiers(readFileSync(file, "utf8"))
      .filter((specifier) => specifier.startsWith("node:"))
      .map((specifier) => `${file}: ${specifier}`),
  );
  assert.deepEqual(violations, []);
});

test("T132: imports are contracts, kernel or relative — never a writer of the phase gate", () => {
  const violations = files.flatMap((file) =>
    specifiers(readFileSync(file, "utf8"))
      .filter((specifier) => !specifier.startsWith("."))
      // The data of the layer (`.../data/*-115.json`) is `@specstride/contracts`.
      .filter(
        (specifier) =>
          specifier !== "@specstride/kernel" &&
          specifier !== "@specstride/contracts" &&
          !specifier.startsWith("@specstride/contracts/"),
      )
      .map((specifier) => `${file}: ${specifier}`),
  );
  assert.deepEqual(violations, []);
});

test("T132: no relative import escapes the package (no writer of the phase gate by path)", () => {
  const violations = files.flatMap((file) =>
    specifiers(readFileSync(file, "utf8"))
      .filter((specifier) => specifier.startsWith("..") && specifier.includes("../.."))
      .map((specifier) => `${file}: ${specifier}`),
  );
  assert.deepEqual(violations, []);
});

test("T132: no process is started and no connection is opened", () => {
  const PROCESS = /\b(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/;
  const CONNECTION =
    /\b(net|dgram|http|https|tls)\s*\.\s*(connect|request|createConnection|createServer)\b|\bfetch\s*\(|\bnew\s+WebSocket\b/;
  const violations: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (PROCESS.test(text)) violations.push(`${file}: starts a process`);
    if (CONNECTION.test(text)) violations.push(`${file}: opens a connection`);
    if (/\bchild_process\b/.test(text)) violations.push(`${file}: child_process`);
  }
  assert.deepEqual(violations, []);
});
