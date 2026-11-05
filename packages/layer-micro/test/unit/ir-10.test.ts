/**
 * CT-115-110 (T030, IR-10, F115-FR-015) — the runtime runs each check
 * itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { betweenPasses } from "../../src/callpoints/between-passes.ts";

const SRC = join(fileURLToPath(import.meta.url), "..", "..", "..", "src");

test("CT-115-110: every command of the check goes through the check runner", async () => {
  const byRunner: string[] = [];
  const outcome = await betweenPasses({
    services: {
      verifyManifest: () => ({ ok: true }) as const,
      endPassProcesses: async () => ({ guaranteed: true }),
      runCheckCommand: async (command) => {
        byRunner.push(command.id);
        return { id: command.id, exit: 0 };
      },
      innerSet: [
        { id: "a", argv: ["a"] },
        { id: "b", argv: ["b"] },
      ],
      stopRequested: () => false,
      budgetAvailable: () => true,
      enterQuotaPause: async () => {},
    },
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.deepEqual(byRunner, ["a", "b"]);
  assert.deepEqual(
    outcome.results.map((r) => r.id),
    byRunner,
  );
});

test("CT-115-110: the layer starts no process and spawns nothing", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts")) {
        const text = readFileSync(path, "utf8");
        if (/child_process|spawnSync|spawn\(|execSync|exec\(/.test(text)) {
          offenders.push(path);
        }
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, []);
});
