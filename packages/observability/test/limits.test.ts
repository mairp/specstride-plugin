/**
 * T038 — PT-111-C-167-limits: the parity test of C-167 / B-2212 to B-2216 on the
 * fixture family FX-26 (stream formats through the seam), surface `events`.
 *
 * F111-FR-027: *Limits and truncation MUST be as at the baseline. The metadata
 * fields of a sanitised value MUST be `redacted`, `truncated`, `original_bytes`
 * and `retained_bytes`. The default limits in bytes MUST be: text 4096, tool
 * arguments 2048, tool result 4096, diagnostic 1024, target 512; and 8 target
 * paths. A limit that is not a positive integer MUST be refused with the message
 * `observability limits must be positive integers`. Truncation MUST be by UTF-8
 * bytes, MUST drop a partial trailing character and MUST add no marker.
 * Redaction MUST run before truncation.*
 *
 * The order of the three steps is the point of research D-7 / B-2216, and it is
 * tested as an order and not as a pair of flags: the input below holds a secret
 * that straddles the cap, so a port that cut first would leave half of it in the
 * output, and the assertion that the secret's tail is absent is the one that
 * fails for such a port.
 *
 * The REFERENCE side is the oracle of feature 141, which is not built: that half
 * reports a SKIP with its reason and never a pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BAD_LIMIT_MESSAGE,
  DEFAULT_LIMITS,
  LIMIT_NAMES,
  SANITIZED_METADATA_FIELDS,
  baselineJson,
  byteLength,
  resolveLimits,
  sanitizeText,
  sanitizeValue,
  truncateUtf8,
} from "../src/ingress/limits.ts";

const ROOT = resolve(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));

function referenceHalf(): { skip: string | false } {
  const present =
    existsSync(join(ROOT, "tests", "parity", "reference")) &&
    existsSync(join(ROOT, "packages", "oracle", "src"));
  if (present) return { skip: false };
  return {
    skip:
      `prerequisite missing: the parity oracle of feature 141 (\`packages/oracle\` and ` +
      `\`tests/parity/reference\`) is not built, so the fixture family FX-26 cannot be run ` +
      `against the reference. This is a SKIP with its reason and never a pass (the ` +
      `constitution, principle XVII).`,
  };
}

test("PT-111-C-167: the limits of the reference on FX-26 equal the port's", referenceHalf(), () => {
  assert.fail("the oracle is present: compare the reference trees here");
});

/* ------------------------------------------------------------------ *
 * The defaults (B-2213).
 * ------------------------------------------------------------------ */

test("the default limits are the five byte caps and the eight target paths", () => {
  assert.deepEqual(
    { ...DEFAULT_LIMITS },
    {
      textMaxBytes: 4096,
      toolArgsMaxBytes: 2048,
      toolResultMaxBytes: 4096,
      diagnosticMaxBytes: 1024,
      targetMaxBytes: 512,
      maxTargetPaths: 8,
    },
  );
});

test("the six limits are the six the baseline validates, and no other", () => {
  assert.deepEqual(
    [...LIMIT_NAMES],
    [
      "textMaxBytes",
      "toolArgsMaxBytes",
      "toolResultMaxBytes",
      "diagnosticMaxBytes",
      "targetMaxBytes",
      "maxTargetPaths",
    ],
  );
  assert.deepEqual(Object.keys(DEFAULT_LIMITS).sort(), [...LIMIT_NAMES].sort());
});

test("`resolveLimits` with nothing given is the defaults", () => {
  assert.deepEqual({ ...resolveLimits() }, { ...DEFAULT_LIMITS });
});

/* ------------------------------------------------------------------ *
 * The refusal of a bad limit (B-2212).
 * ------------------------------------------------------------------ */

test("the refusal message is the baseline's, word for word", () => {
  assert.equal(BAD_LIMIT_MESSAGE, "observability limits must be positive integers");
});

test("every one of the six limits is refused when it is not a positive integer", () => {
  const bad: readonly unknown[] = [0, -1, 1.5, Number.NaN, "4096", null, true, Infinity];
  for (const name of LIMIT_NAMES) {
    for (const value of bad) {
      assert.throws(
        () => resolveLimits({ [name]: value } as Record<string, never>),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, BAD_LIMIT_MESSAGE);
          return true;
        },
        `${name} = ${String(value)}`,
      );
    }
  }
});

test("a positive integer is accepted, and the others keep their defaults", () => {
  const limits = resolveLimits({ textMaxBytes: 1 });
  assert.equal(limits.textMaxBytes, 1);
  assert.equal(limits.toolArgsMaxBytes, DEFAULT_LIMITS.toolArgsMaxBytes);
});

/* ------------------------------------------------------------------ *
 * Truncation by UTF-8 bytes, no marker, no partial character (B-2214).
 * ------------------------------------------------------------------ */

test("truncation is by BYTES and not by characters", () => {
  // Four characters, twelve bytes: each `€` is three bytes in UTF-8.
  const text = "€€€€";
  assert.equal(byteLength(text), 12);
  const cut = truncateUtf8(text, 6);
  assert.equal(cut.value, "€€");
  assert.equal(cut.truncated, true);
  assert.equal(byteLength(cut.value), 6);
});

test("a partial trailing character is DROPPED and no marker is added", () => {
  const cut = truncateUtf8("€€€€", 7);
  // Seven bytes fall inside the third `€`: it is dropped whole.
  assert.equal(cut.value, "€€");
  assert.equal(byteLength(cut.value), 6);
  assert.equal(cut.truncated, true);
  // No marker: not an ellipsis, not a replacement character, nothing.
  assert.ok(!cut.value.includes("…"), cut.value);
  assert.ok(!cut.value.includes("�"), cut.value);
  assert.ok(!cut.value.endsWith("..."), cut.value);
  assert.equal(cut.value, "€€");
});

test("text that fits comes back byte for byte and is not marked truncated", () => {
  const cut = truncateUtf8("€€€€", 12);
  assert.equal(cut.value, "€€€€");
  assert.equal(cut.truncated, false);
});

test("a four-byte character is dropped whole, however the cap falls inside it", () => {
  const emoji = "a🙂b"; // 1 + 4 + 1 bytes
  assert.equal(byteLength(emoji), 6);
  for (const cap of [1, 2, 3, 4]) {
    const cut = truncateUtf8(emoji, cap);
    assert.equal(cut.value, "a", `cap ${cap}`);
    assert.equal(cut.truncated, true, `cap ${cap}`);
  }
  assert.equal(truncateUtf8(emoji, 5).value, "a🙂");
});

/* ------------------------------------------------------------------ *
 * The metadata fields (B-2215).
 * ------------------------------------------------------------------ */

test("the metadata fields of a sanitised value are the four of the requirement", () => {
  assert.deepEqual(
    [...SANITIZED_METADATA_FIELDS],
    ["redacted", "truncated", "original_bytes", "retained_bytes"],
  );
});

test("a sanitised value carries exactly those four fields in its metadata", () => {
  const sanitized = sanitizeText("bearer abcdefgh12345678", resolveLimits());
  assert.deepEqual(Object.keys(sanitized.metadata()), [...SANITIZED_METADATA_FIELDS]);
  assert.equal(sanitized.metadata().redacted, true);
  assert.equal(sanitized.metadata().truncated, false);
  assert.equal(typeof sanitized.metadata().original_bytes, "number");
  assert.equal(typeof sanitized.metadata().retained_bytes, "number");
});

test("`original_bytes` is measured BEFORE redaction, `retained_bytes` after the cut", () => {
  const limits = resolveLimits();
  const text = "bearer abcdefgh12345678";
  const sanitized = sanitizeText(text, limits);
  assert.equal(sanitized.original_bytes, byteLength(text));
  assert.equal(sanitized.retained_bytes, byteLength(sanitized.value));
  // The placeholder is shorter than what it replaced here, so the two differ.
  assert.ok(sanitized.retained_bytes < sanitized.original_bytes);
});

test("a value that is not text carries the same four fields", () => {
  const sanitized = sanitizeValue({ api_key: "sekritvalue" }, resolveLimits());
  assert.deepEqual(Object.keys(sanitized.metadata()), [...SANITIZED_METADATA_FIELDS]);
  assert.equal(sanitized.redacted, true);
  assert.deepEqual(sanitized.value, { api_key: "[REDACTED]" });
});

/* ------------------------------------------------------------------ *
 * Redaction runs BEFORE truncation (B-2216, research D-7).
 * ------------------------------------------------------------------ */

test("redaction runs before the cut: a secret that straddles the cap is gone whole", () => {
  //           0123456789012345678901
  //           prefix ---------------- bearer abcdefghIJKLMNOP
  // The cap falls inside the secret. Cut-then-redact would leave its head.
  const text = "prefix bearer abcdefghIJKLMNOP tail";
  const cap = 24;
  const limits = resolveLimits({ textMaxBytes: cap });
  const sanitized = sanitizeText(text, limits);
  assert.equal(sanitized.redacted, true);
  assert.ok(!sanitized.value.includes("abcdefgh"), sanitized.value);
  assert.ok(!sanitized.value.includes("bearer abc"), sanitized.value);
  assert.ok(sanitized.value.includes("[REDACTED]"), sanitized.value);
  // What a port that cut first would have produced, for contrast.
  const cutFirst = truncateUtf8(text, cap).value;
  assert.equal(cutFirst, "prefix bearer abcdefghIJ");
  assert.ok(cutFirst.includes("abcdefgh"), "the contrast case does leak");
  assert.notEqual(sanitized.value, cutFirst);
});

test("the cut still applies after redaction, and `truncated` says so", () => {
  const limits = resolveLimits({ textMaxBytes: 12 });
  const sanitized = sanitizeText("bearer abcdefgh12345678 and a long tail here", limits);
  assert.equal(sanitized.truncated, true);
  assert.equal(byteLength(sanitized.value), 12);
  assert.equal(sanitized.value, "[REDACTED] a");
});

test("`baselineJson` renders as the baseline's `json.dumps` does: sorted keys, spaces", () => {
  assert.equal(baselineJson({ b: 1, a: "x" }), '{"a": "x", "b": 1}');
  assert.equal(baselineJson(["a", 1, null, true]), '["a", 1, null, true]');
  assert.equal(baselineJson("plain"), '"plain"');
});

test("a sanitised value of the baseline's own shape equals the baseline's answer", () => {
  // Read off `lib/observability_policy.py` at `9cab15d`:
  //   sanitize({'thinking': 'x', 'token': 'y', 'text': 'bearer abcdefgh12345678'})
  //   -> value {'text': '[REDACTED]', 'token': '[REDACTED]'}, redacted True,
  //      original_bytes 66, retained_bytes 45
  const sanitized = sanitizeValue(
    { thinking: "x", token: "y", text: "bearer abcdefgh12345678" },
    resolveLimits(),
  );
  assert.deepEqual(sanitized.value, { text: "[REDACTED]", token: "[REDACTED]" });
  assert.equal(sanitized.redacted, true);
  assert.equal(sanitized.original_bytes, 66);
  assert.equal(sanitized.retained_bytes, 45);
});
