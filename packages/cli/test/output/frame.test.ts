/**
 * T005 — the data-frame writer: fresh 64-bit token, redactor call
 * (F119-FR-032).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  FRAME_TEXT_BYTE_CAP,
  freshFrameToken,
  textReference,
  frameText,
  referenceLine,
} from "../../src/output/frame.ts";

const SECRET = "sk-live-abcdef0123456789abcdef0123456789";

test("T005: the token is fresh and 64 bits long", () => {
  const a = freshFrameToken();
  const b = freshFrameToken();
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.match(b, /^[0-9a-f]{16}$/);
  assert.notEqual(a, b);
  const frame = frameText("critic-feedback", "phase 3 text");
  assert.equal(frame.token, frame.token);
  assert.equal(frame.end, `[SPECSTRIDE-DATA] part=end token=${frame.token}`);
  assert.notEqual(frame.token, freshFrameToken());
});

test("T005: the frame opens, carries the redacted text and closes", () => {
  const text = `the token is ${SECRET} in the transcript`;
  const frame = frameText("verdict-transcript", text);
  assert.match(
    frame.begin,
    /^\[SPECSTRIDE-DATA\] part=begin name="verdict-transcript" bytes=\d+ token=[0-9a-f]{16}$/,
  );
  assert.equal(frame.begin.endsWith(`token=${frame.token}`), true);
  assert.match(frame.end, /^\[SPECSTRIDE-DATA\] part=end token=[0-9a-f]{16}$/);
  assert.ok(!frame.body.includes(SECRET), "the secret is redacted before printing");
  assert.equal(frame.dropped, false);
});

test("T005: bytes on the begin line is the size BEFORE the cap", () => {
  const text = "y".repeat(FRAME_TEXT_BYTE_CAP + 1_000);
  const frame = frameText("agent-text", text);
  assert.equal(frame.begin.includes(`bytes=${FRAME_TEXT_BYTE_CAP + 1_000}`), true);
  assert.ok(Buffer.byteLength(frame.body) <= FRAME_TEXT_BYTE_CAP);
});

test("T005: the frame cap is 16,384 bytes per framed text (F119-FR-032)", () => {
  assert.equal(FRAME_TEXT_BYTE_CAP, 16384);
});

test("T005: default output refers to outside text by name, bytes and hash", () => {
  const text = "outside text from the critic";
  const ref = textReference("critic-feedback-3", text);
  assert.equal(ref.name, "critic-feedback-3");
  assert.equal(ref.bytes, Buffer.byteLength(text));
  assert.equal(ref.hash, createHash("sha256").update(text).digest("hex").slice(0, 8));
  assert.equal(
    referenceLine("[SPECSTRIDE-FEEDBACK]", "critic-feedback-3", text),
    '[SPECSTRIDE-FEEDBACK] name="critic-feedback-3" bytes=28 hash=' + ref.hash,
  );
  assert.ok(!referenceLine("[SPECSTRIDE-FEEDBACK]", "critic-feedback-3", text).includes(text));
});
