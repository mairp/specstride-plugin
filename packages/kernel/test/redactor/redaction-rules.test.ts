/**
 * T036 — PT-111-C-167-redaction-rules: the parity test of C-167 / B-2203 to
 * B-2209 on the fixture families FX-01 (the core loop) and FX-26 (stream
 * formats through the seam), surfaces `events` and `transcript`.
 *
 * F111-FR-025: *The redaction of the baseline MUST be kept. The placeholder
 * MUST be `[REDACTED]`. The keys `thinking`, `reasoning`, `chain_of_thought`
 * and `chainofthought`, in any case, MUST be dropped and counted as a
 * redaction. The value of a key equal, in any case, to `api_key`, `apikey`,
 * `authorization`, `cookie`, `credential`, `password`, `secret`, `token`,
 * `access_token`, `refresh_token` or `client_secret` MUST be replaced. In any
 * text, `bearer` with 8 or more token characters, `sk-` with 8 or more of
 * letters, digits, hyphen and underscore, `ghp_`, `gho_`, `ghu_`, `ghs_` and
 * `ghr_` with 8 or more alphanumerics, and `api_key`, `api-key`, `apikey`,
 * `token`, `secret` or `password` followed by `=` or `:` and a value (the whole,
 * key name included) MUST be replaced.*
 *
 * The REFERENCE side of a parity test is the oracle of feature 141, which is
 * not built: that half reports a SKIP with its reason and never a pass (the
 * constitution, principle XVII). The PORT side — the rules themselves, which
 * are the thing the requirement states — runs here in full, and every rule is
 * asserted with a NEGATIVE CONTROL beside it, so that a rule which replaced
 * everything would fail as loudly as one which replaced nothing.
 *
 * The baseline this ports is `lib/observability_policy.py` at `9cab15d`:
 * `REDACTED`, `THINKING_KEYS`, `DEFAULT_SECRET_KEYS`, `DEFAULT_SECRET_VALUES`
 * and `_redact_text` / `sanitize`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASELINE_SECRET_KEYS,
  BASELINE_SECRET_VALUE_PATTERNS,
  REDACTED,
  THINKING_KEYS,
  isBaselineSecretKey,
  isThinkingKey,
  redactText,
  redactValue,
} from "../../src/redactor/rules.ts";
import { REDACTION_PLACEHOLDER } from "../../src/redactor/index.ts";

/* ------------------------------------------------------------------ *
 * The reference half: skipped with its reason while the oracle is absent.
 * ------------------------------------------------------------------ */

/** The repository root: four levels up from `packages/kernel/test/redactor`. */
const ROOT = resolve(dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))));
const FIXTURES = ["FX-01", "FX-26"] as const;

function oracleIsAvailable(): boolean {
  return (
    existsSync(join(ROOT, "tests", "parity", "reference")) &&
    existsSync(join(ROOT, "packages", "oracle", "src"))
  );
}

function referenceHalf(): { skip: string | false } {
  if (oracleIsAvailable()) return { skip: false };
  return {
    skip:
      `prerequisite missing: the parity oracle of feature 141 ` +
      `(\`packages/oracle\` and \`tests/parity/reference\`) is not built, so the fixture ` +
      `families ${FIXTURES.join(", ")} cannot be run against the reference. This is a SKIP ` +
      `with its reason and never a pass (the constitution, principle XVII).`,
  };
}

test(
  "PT-111-C-167: the redaction of the reference on FX-01 and FX-26 equals the port's",
  referenceHalf(),
  () => {
    assert.fail("the oracle is present: compare the reference trees here");
  },
);

/* ------------------------------------------------------------------ *
 * The placeholder (B-2203).
 * ------------------------------------------------------------------ */

test("the placeholder is `[REDACTED]` and the folder names the same text", () => {
  assert.equal(REDACTED, "[REDACTED]");
  assert.equal(REDACTION_PLACEHOLDER, REDACTED);
});

test("the placeholder is what a replacement puts in place of the match", () => {
  const out = redactText("Authorization: Bearer abcdefgh12345678");
  assert.ok(out.text.includes(REDACTED), out.text);
  // Negative control: the secret itself is gone, not merely decorated.
  assert.ok(!out.text.includes("abcdefgh12345678"), out.text);
});

/* ------------------------------------------------------------------ *
 * The thinking keys (B-2204).
 * ------------------------------------------------------------------ */

test("the four thinking keys are the baseline's four and no other", () => {
  assert.deepEqual([...THINKING_KEYS].sort(), [
    "chain_of_thought",
    "chainofthought",
    "reasoning",
    "thinking",
  ]);
});

test("a thinking key is recognised in any case, and a near miss is not", () => {
  for (const key of ["thinking", "THINKING", "Reasoning", "Chain_Of_Thought", "CHAINOFTHOUGHT"]) {
    assert.equal(isThinkingKey(key), true, key);
  }
  // Negative control: these are not the keys the baseline drops.
  for (const key of ["think", "thinking_time", "chain", "reason", "thoughts"]) {
    assert.equal(isThinkingKey(key), false, key);
  }
});

test("a thinking key is DROPPED from the value and counted as a redaction", () => {
  const out = redactValue({ thinking: "the private chain", text: "hello", REASONING: "more" });
  const value = out.value as Record<string, unknown>;
  assert.equal(Object.hasOwn(value, "thinking"), false);
  assert.equal(Object.hasOwn(value, "REASONING"), false);
  assert.equal(value["text"], "hello");
  assert.equal(out.redacted, true, "dropping a thinking key counts as a redaction");
  // The dropped text is nowhere in the result, not even as a placeholder key.
  assert.ok(!JSON.stringify(out.value).includes("the private chain"));
});

test("a value with no thinking key and no secret is not counted as redacted", () => {
  const out = redactValue({ text: "hello", count: 3, ok: true, nested: ["a", "b"] });
  assert.equal(out.redacted, false);
  assert.deepEqual(out.value, { text: "hello", count: 3, ok: true, nested: ["a", "b"] });
});

/* ------------------------------------------------------------------ *
 * The eleven key names (B-2205).
 * ------------------------------------------------------------------ */

test("the key names are the baseline's eleven and no other", () => {
  assert.deepEqual(
    [...BASELINE_SECRET_KEYS],
    [
      "api_key",
      "apikey",
      "authorization",
      "cookie",
      "credential",
      "password",
      "secret",
      "token",
      "access_token",
      "refresh_token",
      "client_secret",
    ],
  );
  assert.equal(BASELINE_SECRET_KEYS.length, 11);
});

test("a key name matches in any case and ONLY as a whole (the baseline anchors it)", () => {
  for (const key of ["api_key", "API_KEY", "ApiKey", "AUTHORIZATION", "Client_Secret"]) {
    assert.equal(isBaselineSecretKey(key), true, key);
  }
  // Negative control: the baseline set matches the whole key, not a part of it.
  for (const key of ["my_api_key", "token_count", "secrets", "passwordHash", "x"]) {
    assert.equal(isBaselineSecretKey(key), false, key);
  }
});

test("the VALUE of a key of the set is replaced, and the key itself is kept", () => {
  const out = redactValue({
    api_key: "A-real-looking-value",
    Token: "another",
    harmless: "kept",
  });
  const value = out.value as Record<string, unknown>;
  assert.equal(value["api_key"], REDACTED);
  assert.equal(value["Token"], REDACTED);
  assert.equal(value["harmless"], "kept");
  assert.equal(out.redacted, true);
  assert.ok(!JSON.stringify(out.value).includes("A-real-looking-value"));
});

test("a key of the set is replaced however deep it sits, in a list as in a map", () => {
  const out = redactValue({
    outer: [{ inner: { cookie: "session=abc" } }, { ok: "kept" }],
  });
  const rendered = JSON.stringify(out.value);
  assert.ok(!rendered.includes("session=abc"), rendered);
  assert.ok(rendered.includes(REDACTED));
  assert.ok(rendered.includes("kept"));
});

/* ------------------------------------------------------------------ *
 * The four value patterns (B-2206 to B-2209).
 * ------------------------------------------------------------------ */

test("the value patterns are the baseline's four", () => {
  assert.equal(BASELINE_SECRET_VALUE_PATTERNS.length, 4);
  assert.deepEqual(
    BASELINE_SECRET_VALUE_PATTERNS.map((entry) => entry.name),
    ["bearer", "sk-prefix", "github-prefix", "key-name-then-value"],
  );
});

test("pattern 1 — `bearer` with 8 or more token characters, in any case", () => {
  for (const text of [
    "Bearer abcdefgh",
    "bearer ABCD1234._~+/=-xyz",
    "authorization: BEARER 01234567",
  ]) {
    const out = redactText(text);
    assert.equal(out.redacted, true, text);
    assert.ok(out.text.includes(REDACTED), text);
  }
  // Negative control: fewer than eight token characters, and the bare word.
  for (const text of ["bearer abc", "the bearer of the news", "bearer 1234567"]) {
    assert.equal(redactText(text).redacted, false, text);
  }
});

test("pattern 2 — `sk-` with 8 or more of letters, digits, hyphen and underscore", () => {
  for (const text of ["sk-abcdefgh", "key sk-ABCD_1234-xyz here", "sk-01234567"]) {
    const out = redactText(text);
    assert.equal(out.redacted, true, text);
    assert.ok(out.text.includes(REDACTED), text);
  }
  // Negative control: fewer than eight, and a word that merely contains `sk-`.
  for (const text of ["sk-abc", "sk-1234567", "risk-free"]) {
    assert.equal(redactText(text).redacted, false, text);
  }
});

test("pattern 3 — the five GitHub prefixes with 8 or more alphanumerics", () => {
  for (const prefix of ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"]) {
    const text = `token ${prefix}abcd1234efgh`;
    const out = redactText(text);
    assert.equal(out.redacted, true, text);
    assert.ok(!out.text.includes("abcd1234efgh"), out.text);
  }
  // Negative control: a prefix the baseline does not know, and a short tail.
  for (const text of ["ghx_abcd1234efgh", "ghp_abc", "ghp_1234567"]) {
    assert.equal(redactText(text).redacted, false, text);
  }
});

test("pattern 4 — a key name then `=` or `:` and a value: the WHOLE, key name included", () => {
  for (const text of [
    "api_key=sekritvalue",
    "api-key: sekritvalue",
    "APIKEY=sekritvalue",
    "token : sekritvalue",
    "secret=sekritvalue",
    "password=sekritvalue",
  ]) {
    const out = redactText(text);
    assert.equal(out.redacted, true, text);
    assert.ok(!out.text.includes("sekritvalue"), out.text);
    // The key name goes with the value: the whole is replaced.
    assert.equal(out.text.trim(), REDACTED, out.text);
  }
  // Negative control: a key name with no value, and a key name the pattern
  // does not hold (`authorization` is a KEY of the map rule, not of this one).
  for (const text of ["api_key=", "the token is held", "cookie=crumbs"]) {
    const out = redactText(text);
    if (text === "cookie=crumbs") {
      assert.equal(out.redacted, false, `${text}: \`cookie\` is not one of the six of pattern 4`);
    } else {
      assert.equal(out.redacted, false, text);
    }
  }
});

test("the count of replacements rises with every match, and is zero with none", () => {
  const two = redactText("bearer abcdefgh and sk-abcdefgh");
  assert.equal(two.replacements, 2, two.text);
  assert.equal(redactText("nothing to see").replacements, 0);
});

test("text that no pattern matches comes back byte for byte", () => {
  const text = "packages/observability/src/ingress/ingress.ts: 42 lines, ok";
  const out = redactText(text);
  assert.equal(out.text, text);
  assert.equal(out.redacted, false);
});

/* ------------------------------------------------------------------ *
 * The transcript surface: a stream record of FX-26's shape.
 * ------------------------------------------------------------------ */

test("a stream record of the shape FX-26 captures loses its secrets and keeps its shape", () => {
  const record = {
    type: "assistant",
    message: {
      role: "assistant",
      thinking: "I will use the key sk-abcdefgh12345678",
      content: [{ type: "text", text: "calling with Bearer abcdefgh12345678" }],
    },
    headers: { Authorization: "Bearer abcdefgh12345678", "x-request-id": "req-1" },
  };
  const out = redactValue(record);
  const rendered = JSON.stringify(out.value);
  assert.equal(out.redacted, true);
  assert.ok(!rendered.includes("abcdefgh12345678"), rendered);
  assert.ok(!rendered.includes("sk-abcdefgh"), rendered);
  assert.ok(!rendered.includes("thinking"), rendered);
  // The shape survives: the record is still a record of the same kind.
  const value = out.value as { type: string; headers: Record<string, unknown> };
  assert.equal(value.type, "assistant");
  assert.equal(value.headers["x-request-id"], "req-1");
});
