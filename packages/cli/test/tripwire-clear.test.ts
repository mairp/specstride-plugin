/**
 * T115 (F115-FR-041) — the exit codes and the usage rule of the command
 * `tripwire clear`, from the command's own package.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTripwireClear, isUsageValid, EXIT_CODES } from "../src/commands/tripwire-clear.ts";
import { createTripwireStore, recordBreach } from "@specstride/integrity";

test("T115: the exit codes are 0 (cleared), 1 (no record) and 3 (wrong usage)", () => {
  assert.deepEqual(EXIT_CODES, { cleared: 0, absent: 1, usage: 3 });
});

test("T115: any argument beyond the command name is wrong usage", () => {
  assert.equal(isUsageValid([]), true);
  for (const argv of [["--force"], ["extra"], ["clear", "now"]]) {
    assert.equal(isUsageValid(argv), false);
  }
});

test("T115: clear removes the record and exits 0; without a record it exits 1", async () => {
  const home = mkdtempSync(join(tmpdir(), "tripwire-cli-"));
  try {
    assert.equal((await runTripwireClear([], { home })).exitCode, 1);
    const store = createTripwireStore({ home });
    await recordBreach(store, "outer-counter-changed", "IR-28", "d");
    assert.equal((await runTripwireClear([], { home })).exitCode, 0);
    assert.equal((await runTripwireClear([], { home })).exitCode, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
