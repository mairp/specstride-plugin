// CT-116-22 (F116-FR-022) — one event `integrity.noted` with `kind` and
// `detail` per integrity event of the four kinds; no content and no output in
// `detail`; no event with no loop layer on and the switch of the comparison
// at phase entry off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTED_EVENT_TYPE, NOTED_KINDS, noteIntegrityEvent } from "../../src/events/noted.ts";

test("CT-116-22 one integrity.noted event per integrity event of the four kinds", () => {
  for (const kind of NOTED_KINDS) {
    const noted = noteIntegrityEvent(
      { kind, paths: ["src/a.ts"] },
      { loopLayerOn: true, phaseEntrySwitch: "on" },
    );
    assert.ok(noted, `no event for kind ${kind}`);
    assert.equal(noted.type, NOTED_EVENT_TYPE);
    assert.equal(noted.type, "integrity.noted");
    assert.equal(noted.kind, kind);
    assert.ok(noted.detail);
    assert.deepEqual(noted.detail.paths, [{ value: "src/a.ts", origin: "workspace" }]);
  }
  assert.deepEqual([...NOTED_KINDS].sort(), [
    "changed-during-check",
    "phase-entry-mismatch",
    "pin-mismatch",
    "toolchain-config-changed",
  ]);
});

test("CT-116-22 detail holds marked workspace paths and no content and no output", () => {
  const noted = noteIntegrityEvent(
    { kind: "changed-during-check", paths: ["test/x.test.ts", "pkg/y.ts"] },
    { loopLayerOn: true, phaseEntrySwitch: "on" },
  );
  assert.ok(noted);
  const text = JSON.stringify(noted);
  assert.ok(!text.includes("content"));
  assert.ok(!text.includes("output"));
  assert.ok(!text.includes("stdout"));
  for (const path of noted.detail.paths) {
    assert.equal(path.origin, "workspace");
    assert.equal(typeof path.value, "string");
  }
});

test("CT-116-22 no event with no loop layer on and the phase-entry switch off", () => {
  const event = { kind: "phase-entry-mismatch", paths: ["src/a.ts"] };
  assert.equal(noteIntegrityEvent(event, { loopLayerOn: false, phaseEntrySwitch: "off" }), null);
  // Either condition alone still notes the event.
  assert.ok(noteIntegrityEvent(event, { loopLayerOn: false, phaseEntrySwitch: "on" }));
  assert.ok(noteIntegrityEvent(event, { loopLayerOn: true, phaseEntrySwitch: "off" }));
});

test("CT-116-22 no event of any other kind and no other event type", () => {
  const foreign = noteIntegrityEvent(
    { kind: "ledger-invalid", paths: [] },
    { loopLayerOn: true, phaseEntrySwitch: "on" },
  );
  assert.equal(foreign, null);
});
