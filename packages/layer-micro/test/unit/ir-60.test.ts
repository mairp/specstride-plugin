/**
 * CT-115-160 (T038, IR-60, F115-FR-017) — no commit, no revert.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(fileURLToPath(import.meta.url), "..", "..", "..", "src");

test("CT-115-160: no file of the layer commits, reverts, resets, cleans or checks out", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts")) {
        // Comments state the rule; the test holds the code to it.
        const text = readFileSync(path, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .replace(/^\s*\/\/.*$/gm, " ");
        if (
          /\bgit\b|rev-parse|for-each-ref|--hard|reset\(|revert|checkout|rmSync|writeFileSync|appendFileSync/.test(
            text,
          )
        ) {
          offenders.push(path);
        }
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, []);
});

test("CT-115-160: a kept unit is a directive and a record, nothing else", async () => {
  const { decideOutcome } = await import("../../src/unit/outcome.ts");
  const decision = decideOutcome([{ id: "a", exit: 0 }], {
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  // The decision carries no path, no command and no write of any kind.
  assert.deepEqual(decision, { outcome: "kept", directive: "keep" });
  assert.deepEqual(Object.keys(decision).sort(), ["directive", "outcome"]);
});
