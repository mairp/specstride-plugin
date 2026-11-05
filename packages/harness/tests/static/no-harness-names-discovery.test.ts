/**
 * T009 — static test of the discovery core (F146-FR-002; constitution
 * Principle VII, one open harness registry): no file under
 * `packages/harness/src/discovery/` tests a harness name in control flow or
 * holds a list of harnesses. The core names no harness: which harnesses a
 * machine holds is data of the seven sources and of the registry, and never
 * a literal of the code.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DISCOVERY_DIR = fileURLToPath(new URL("../../src/discovery/", import.meta.url));

/**
 * The names of the harnesses the product knows of. The list lives HERE, in
 * the checker, and nowhere in `src/discovery/`: the test is the one place
 * that is allowed to spell them, because it is the test that refuses them.
 * A new harness enters this list with its own adapter work, never with a
 * change of the discovery core.
 */
const HARNESS_NAMES: readonly string[] = Object.freeze([
  "claude",
  "claude-code",
  "codex",
  "gemini",
  "gemini-cli",
  "cursor",
  "cursor-agent",
  "copilot",
  "github-copilot",
  "aider",
  "goose",
  "opencode",
  "crush",
  "cline",
  "roo-code",
  "amp",
  "windsurf",
  "aichat",
  "llm-cli",
  "lmstudio",
]);

/** Every file of the discovery core, as `.ts`, in any depth. */
function discoveryFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...discoveryFiles(path));
    else if (entry.endsWith(".ts")) files.push(path);
  }
  return files;
}

/** The line with its comments and string literals taken out. */
function codeOf(line: string): string {
  return line
    .replace(/\/\/.*$/, " ")
    .replace(/\/\*.*?\*\//g, " ")
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
}

test("T009: no file of the discovery core names a harness", () => {
  const files = discoveryFiles(DISCOVERY_DIR);
  assert.ok(files.length >= 3, `the discovery core has files: ${files.length}`);
  const offenders: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const code = codeOf(line);
      for (const name of HARNESS_NAMES) {
        // A harness name spelled in code, in any form: a control-flow test
        // of it (`if (name === "claude")`), a switch case, a lookup or a
        // list. All of them are the registry's knowledge, not the core's.
        if (new RegExp(`\\b${name.replace(/-/g, "\\-")}\\b`).test(code)) {
          offenders.push(`${file}:${index + 1}: ${name}`);
        }
      }
    });
  }
  assert.deepEqual(offenders, []);
});

test("T009: no file of the discovery core holds a list of harnesses", () => {
  for (const file of discoveryFiles(DISCOVERY_DIR)) {
    const text = readFileSync(file, "utf8");
    // A list of harnesses: two or more distinct harness names anywhere in
    // one file, even spread over lines or inside comments.
    const found = [...new Set(HARNESS_NAMES.filter((n) => text.includes(n)))];
    assert.ok(found.length < 2, `${file} holds a list of harnesses: ${found.join(", ")}`);
  }
});
