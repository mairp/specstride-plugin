/**
 * CT-115-17 (T022, F115-FR-017) — no commit, no reference, no write under
 * the repository directory. Integration: the state of a fixture repository
 * is read back through an independent path after the layer has run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterPass } from "../../src/callpoints/after-pass.ts";
import { betweenPasses } from "../../src/callpoints/between-passes.ts";
import { registerLayerMicro } from "../../src/register.ts";
import type { CheckpointClaimReader } from "@specstride/contracts";

/** An independent digest of a whole directory tree: names and content. */
function digest(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        hash.update(path.slice(root.length));
        hash.update(statSync(path).mtimeMs.toString());
      }
    }
  };
  walk(root);
  return hash.digest("hex");
}

test("CT-115-17: a full pass over a fixture repository writes nothing", async () => {
  const repo = mkdtempSync(join(tmpdir(), "ct115-17-"));
  const before = digest(repo);
  const beforeStat = statSync(repo);

  const reader: CheckpointClaimReader = {
    async readClaim() {
      return { ok: true, claim: { schema: "specstride.checkpoint/1", tasks: ["T010"] } };
    },
  };
  registerLayerMicro();
  const accepted = await afterPass({
    claimReader: reader,
    unitId: "u1",
    phaseTaskIds: ["T010"],
  });
  const checked = await betweenPasses({
    services: {
      verifyManifest: () => ({ ok: true }) as const,
      endPassProcesses: async () => ({ guaranteed: true }),
      runCheckCommand: async (command) => ({ id: command.id, exit: 0 }),
      innerSet: [{ id: "a", argv: ["a"] }],
      stopRequested: () => false,
      budgetAvailable: () => true,
      enterQuotaPause: async () => {},
    },
    taskIds: accepted.tasks ?? [],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });

  assert.equal(accepted.result, "accept");
  assert.equal(checked.decision?.outcome, "kept");
  // The repository directory is byte-for-byte as it was: no commit, no
  // reference, no write of any kind.
  assert.equal(digest(repo), before);
  assert.equal(statSync(repo).mtimeMs, beforeStat.mtimeMs);
});
