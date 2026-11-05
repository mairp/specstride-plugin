/**
 * CT-115-9 (T014, F115-FR-009) — ids and bounded note read, other fields
 * ignored.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCheckpoint, boundedNote, NOTE_MAX_BYTES } from "../../src/unit/validate.ts";

const CONTEXT = { phaseTaskIds: ["T010", "T011", "T012"] };

test("CT-115-9: the ids and the note are read", () => {
  const result = validateCheckpoint(
    { schema: "specstride.checkpoint/1", tasks: ["T011"], note: "short note" },
    CONTEXT,
  );
  assert.deepEqual(result, { ok: true, tasks: ["T011"], note: "short note" });
});

test("CT-115-9: every other field is ignored", () => {
  const claim = {
    schema: "specstride.checkpoint/1",
    tasks: ["T010"],
    note: "n",
    // A field the runtime does not know: ignored, never kept, never shown.
    summary: "rewrote the parser and it all works",
    agent: "some-agent",
    confident: true,
  } as unknown as { schema: string; tasks: string[]; note?: string };
  const result = validateCheckpoint(claim, CONTEXT);
  assert.deepEqual(result, { ok: true, tasks: ["T010"], note: "n" });
  assert.equal("summary" in result, false);
  assert.equal("agent" in result, false);
});

test("CT-115-9: at most 512 bytes of the note are kept", () => {
  assert.equal(NOTE_MAX_BYTES, 512);
  const long = "x".repeat(600) + "ä".repeat(600);
  const cut = boundedNote(long);
  assert.ok(Buffer.byteLength(cut, "utf8") <= NOTE_MAX_BYTES);
  const result = validateCheckpoint(
    { schema: "specstride.checkpoint/1", tasks: ["T012"], note: long },
    CONTEXT,
  );
  assert.ok(result.ok);
  assert.ok(Buffer.byteLength(result.note ?? "", "utf8") <= NOTE_MAX_BYTES);
});

test("CT-115-9: an absent note stays absent", () => {
  const result = validateCheckpoint(
    { schema: "specstride.checkpoint/1", tasks: ["T010"] },
    CONTEXT,
  );
  assert.ok(result.ok);
  assert.equal("note" in result, false);
});
