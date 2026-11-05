/**
 * T087 — the state of `packages/core/src/critic-input/` is named ONLY by the
 * logical names of annex B §B.5 — `attempt:<N>:<k>:<n>:withheld-paths`,
 * `attempt:<N>:<k>:<n>:hidden-files`, `gate:<N>:proofs`,
 * `attempt:<N>:<k>:<n>:critic-prompt`, `phase:<N>:verdict-pins` — and the
 * group holds no physical path (F117-FR-005, F117-FR-040, F117-FR-042).
 *
 * The four builders of the group are asserted against the annex shapes; a scan
 * of every source file of the group finds no other logical state name and no
 * absolute (physical) path constant.
 *
 * covers: F117-FR-005; F117-FR-040; F117-FR-042
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { hiddenFilesStateKey } from "../../src/critic-input/hide/hide.ts";
import { withheldPathsStateKey } from "../../src/critic-input/hide/withheld.ts";
import { criticPromptStateKey } from "../../src/critic-input/prompt/debug.ts";
import { verdictPinsStateKey } from "../../src/critic-input/pins/store.ts";

const GROUP = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "critic-input");

/** The five logical names of annex B §B.5 this feature names state by. */
const ATTEMPT_NAME = /^attempt:(\d+):(\d+):(\d+):(withheld-paths|hidden-files|critic-prompt)$/;
const VERDICT_PINS_NAME = /^phase:(\d+):verdict-pins$/;
const GATE_PROOFS_NAME = /^gate:(\d+):proofs$/;

function listAll(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...listAll(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

test("the four builders of the group produce the annex B §B.5 logical names", () => {
  assert.equal(withheldPathsStateKey(8, 2, 1), "attempt:8:2:1:withheld-paths");
  assert.equal(hiddenFilesStateKey(8, 2, 1), "attempt:8:2:1:hidden-files");
  assert.equal(criticPromptStateKey(8, 2, 1), "attempt:8:2:1:critic-prompt");
  assert.equal(verdictPinsStateKey(8), "phase:8:verdict-pins");
  for (const n of [
    withheldPathsStateKey(1, 1, 1),
    hiddenFilesStateKey(12, 3, 4),
    criticPromptStateKey(0, 0, 0),
  ]) {
    assert.match(n, ATTEMPT_NAME);
  }
  assert.match(verdictPinsStateKey(41), VERDICT_PINS_NAME);
});

test("the gate proofs name of the annex is the logical name of the proofs directory", () => {
  // The proofs of a phase are read as claims; the group holds the logical
  // name `gate:<N>:proofs` and no absolute directory of any host.
  assert.match("gate:8:proofs", GATE_PROOFS_NAME);
  const text = readFileSync(join(GROUP, "grounding", "path-list.ts"), "utf8");
  assert.ok(text.includes("gate:<N>:proofs"), "the logical name is the one the source names");
});

test("every state name written in the source of the group is one of the five logical names", () => {
  const offenders: string[] = [];
  for (const file of listAll(GROUP)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(
      /["'`](attempt:[^"'`\s]*|phase:\d+:verdict-pins|gate:\d*:proofs)["'`]/g,
    )) {
      const name = m[1]!;
      // The annex spelling `attempt:<N>:<k>:<n>:<record>` and the template
      // that builds it are the logical name; anything else is an offender.
      if (
        /^attempt:(<N>|(\$\{[^}"`]+\})):(<k>|(\$\{[^}"`]+\})):(<n>|(\$\{[^}"`]+\})):(withheld-paths|hidden-files|critic-prompt)$/.test(
          name,
        ) ||
        VERDICT_PINS_NAME.test(name) ||
        name === "gate:<N>:proofs"
      )
        continue;
      offenders.push(`${relative(GROUP, file)}: ${name}`);
    }
  }
  assert.deepEqual(offenders, [], "a state name outside the five logical names of annex B §B.5");
});

test("the group holds no physical path: no absolute path constant, no host directory", () => {
  const offenders: string[] = [];
  const physical =
    /["'`](?:\/(?:root|home|tmp|var|usr|etc|Users|private)\/[^\s"'`]*|node_modules\/[^\s"'`]*)["'`]/;
  for (const file of listAll(GROUP)) {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
      if (physical.test(line)) offenders.push(`${relative(GROUP, file)}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], "a physical path in the group");
});

test("the state of the group is written only under the logical names through the ports", () => {
  // The record writers take the state key from the builders above and the
  // physical place from the ports' input, never from a constant of this group.
  const store = readFileSync(join(GROUP, "pins", "store.ts"), "utf8");
  const hide = readFileSync(join(GROUP, "hide", "hide.ts"), "utf8");
  const withheld = readFileSync(join(GROUP, "hide", "withheld.ts"), "utf8");
  assert.ok(store.includes("verdictPinsStateKey"));
  assert.ok(hide.includes("hiddenFilesStateKey"));
  assert.ok(withheld.includes("withheldPathsStateKey"));
});
