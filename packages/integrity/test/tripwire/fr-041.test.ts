/**
 * CT-115-41 (T108, F115-FR-041) — the tripwire record, the classic fallback
 * of later launches, `tripwire clear` with the exit codes 0, 1 and 3, and
 * the events `tripwire.raised` and `tripwire.cleared` (the second in the
 * next engine start).
 *
 * Effect witnesses: the record is read back through an independent read path
 * (a direct read of the file, not the store), and the clear marker is
 * consumed by the engine-start function, which is not the command.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTripwireStore,
  readTripwire,
  recordBreach,
  launchFallbackFor,
  tripwireRecordPath,
  tripwireClearMarkerPath,
  consumeClearMarkersAtEngineStart,
  TRIPWIRE_FALLBACK_REASON,
} from "@specstride/integrity";
import { runTripwireClear } from "@specstride/cli/commands/tripwire-clear";
import { reportEvents } from "@specstride/layer-micro";
const { tripwireRaised, tripwireCleared } = reportEvents;

function freshHome(): string {
  return mkdtempSync(join(tmpdir(), "tripwire-115-"));
}

test("CT-115-41: a breach writes the record, with the kind of the breach and the id of the rule", async () => {
  const home = freshHome();
  try {
    const store = createTripwireStore({ home, now: () => "2026-10-06T05:00:00.000Z" });
    await recordBreach(store, "outer-counter-changed", "IR-28", "reject 4 → 5");
    // Independent read path: the file on disk, not the store.
    const raw = JSON.parse(readFileSync(tripwireRecordPath(home), "utf8")) as {
      breached: boolean;
      breaches: { kind: string; ruleId: string; detail: string; observedAt: string }[];
    };
    assert.equal(raw.breached, true);
    assert.equal(raw.breaches.length, 1);
    assert.equal(raw.breaches[0]!.kind, "outer-counter-changed");
    assert.equal(raw.breaches[0]!.ruleId, "IR-28");
    assert.ok(raw.breaches[0]!.observedAt.length > 0);
    // The written file is the atomically written record: JSON, final newline.
    const text = readFileSync(tripwireRecordPath(home), "utf8");
    assert.match(text, /\n$/);
    // The atomic write leaves no temporary file behind.
    assert.deepEqual(readdirSync(home).sort(), ["tripwire.json"]);
    // The port reads the same state.
    const state = await store.read();
    assert.equal(state.breached, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("CT-115-41: while the record exists every later launch is classic, reason tripwire", async () => {
  const home = freshHome();
  try {
    assert.equal(launchFallbackFor(readTripwire(home)), undefined);
    const store = createTripwireStore({ home });
    await recordBreach(store, "false-pass", "IR-28", "ghost pass");
    assert.equal(launchFallbackFor(readTripwire(home)), TRIPWIRE_FALLBACK_REASON);
    assert.equal(launchFallbackFor(readTripwire(home)), "tripwire");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("CT-115-41: tripwire clear — exit 0 with a record, exit 1 without, exit 3 on wrong usage", async () => {
  const home = freshHome();
  try {
    // No record: exit 1.
    const absent = await runTripwireClear([], { home });
    assert.equal(absent.exitCode, 1);
    assert.match(absent.message, /no record/);
    // Wrong usage: exit 3.
    const usage = await runTripwireClear(["--force"], { home });
    assert.equal(usage.exitCode, 3);
    assert.match(usage.message, /usage:/);
    // With a record: exit 0, the record is gone, and later launches are clear.
    const store = createTripwireStore({ home });
    await recordBreach(store, "approval-without-gate", "IR-28", "no nonce");
    const cleared = await runTripwireClear([], { home });
    assert.equal(cleared.exitCode, 0);
    assert.equal(existsSync(tripwireRecordPath(home)), false);
    assert.equal(launchFallbackFor(readTripwire(home)), undefined);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("CT-115-41: the events tripwire.raised and tripwire.cleared, the second in the next engine start", async () => {
  const home = freshHome();
  try {
    // raised — the writing of the record is recorded as this event.
    const raised = tripwireRaised({ kind: "outer-counter-changed", ruleId: "IR-28" });
    assert.equal(raised.type, "tripwire.raised");
    assert.equal(raised.fields["kind"], "outer-counter-changed");
    assert.equal(raised.fields["ruleId"], "IR-28");

    // clear leaves a marker; the NEXT engine start records tripwire.cleared.
    const store = createTripwireStore({ home });
    await recordBreach(store, "outer-counter-changed", "IR-28", "d");
    await store.clear();
    assert.equal(existsSync(tripwireClearMarkerPath(home)), true);
    const atStart = consumeClearMarkersAtEngineStart(home);
    assert.equal(atStart.length, 1);
    assert.ok(atStart[0]!.clearedAt.length > 0);
    const cleared = tripwireCleared({ clearedAt: atStart[0]!.clearedAt });
    assert.equal(cleared.type, "tripwire.cleared");
    assert.equal(cleared.fields["clearedAt"], atStart[0]!.clearedAt);
    // The marker is consumed: the start after that records nothing.
    assert.deepEqual(consumeClearMarkersAtEngineStart(home), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("CT-115-41: an absent record reads as not breached; a clear removes the record itself", async () => {
  const home = freshHome();
  try {
    assert.deepEqual(readTripwire(home), { breached: false, breaches: [] });
    const store = createTripwireStore({ home });
    await recordBreach(store, "false-pass", "IR-28", "d");
    await store.clear();
    assert.deepEqual(readTripwire(home), { breached: false, breaches: [] });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
