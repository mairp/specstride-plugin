/**
 * T007 — static test for the seam of the roles (F124-SC-008): no file under
 * `packages/harness/src/roles/` tests a harness name in control flow, and no
 * file there holds a list of harnesses. The names of harnesses are data of
 * the registry; the code of the roles is name-blind.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROLES_ROOT = join(import.meta.dirname, "..", "..", "src", "roles");

/** Every file under `src/roles/`, recursively. */
function filesUnder(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

/**
 * A harness name, as this repository spells one in tests and data: the ids of
 * the fixtures of `tests/roles/fixtures/harnesses/` and the ids of the
 * conformance fixture of the descriptor-only port. A control flow that names
 * one of these would resolve a harness in code instead of in the registry.
 */
const HARNESS_NAME_PATTERN =
  /\b(state-tested|state-locally-verified|state-declared|state-detected|fixture-fake-endpoint|stub-harness|claude|codex|gemini|cursor|opencode|droid|copilot)\b/;

/**
 * A list of harnesses in code: an array literal whose elements are harness
 * names, or an exported constant whose name says it lists harnesses.
 */
const HARNESS_LIST_PATTERN =
  /\b(const|let|var)\s+(harnesses|harnessIds|harnessList|harnessNames|HARNESS_IDS|HARNESS_LIST|HARNESS_NAMES)\b\s*[:=]/;

test("F124-SC-008 no file under src/roles/ names a harness in control flow", () => {
  const files = filesUnder(ROLES_ROOT).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length > 0, "the directory src/roles/ holds the modules of this feature");
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const hit = text.split("\n").findIndex((line) => HARNESS_NAME_PATTERN.test(line));
    assert.equal(
      hit,
      -1,
      `${file} names a harness at line ${hit + 1}; a harness name is data of ` +
        `the registry, never a branch of the code (F124-SC-008)`,
    );
  }
});

test("F124-SC-008 no file under src/roles/ holds a list of harnesses", () => {
  for (const file of filesUnder(ROLES_ROOT).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(file, "utf8");
    assert.equal(
      HARNESS_LIST_PATTERN.test(text),
      false,
      `${file} declares a list of harnesses; the candidates come from the ` +
        `field \`harnesses\` of the resolved registry (F124-SC-008)`,
    );
  }
});

test("F124-SC-008 the check itself bites: a file that names a harness is caught", () => {
  const sample = "if (id === 'stub-harness') { useDefault(); }";
  assert.equal(HARNESS_NAME_PATTERN.test(sample), true);
  const listSample = "const harnessList: string[] = ['stub-harness'];";
  assert.equal(HARNESS_LIST_PATTERN.test(listSample), true);
});
