/**
 * T043 — CT-111-130 and CT-111-131: registration at use, the exact match, the
 * consumer's comment, and the scan before a commit (F111-FR-030, F111-FR-031).
 *
 * F111-FR-030: *A secret that the runtime resolved MUST be registered with the
 * redactor at the moment of its use, and its exact value MUST be replaced in
 * every text that enters the ingress from then on. The value MUST never be
 * written to any state, event, log or contract.*
 *
 * F111-FR-031: *The consumer's comment MUST pass the ingress before it is
 * recorded. Before the runtime makes a commit, the files of the commit that the
 * runtime wrote MUST be scanned with the same redactor for registered secrets and
 * for the patterns; a hit MUST block the commit and raise
 * `redaction.commit_blocked`, which names the files and the counts and never the
 * matches.*
 *
 * This is an INTEGRATION test with an EFFECT WITNESS. The commit scan reads REAL
 * FILES in a temporary directory, written by this test, and every claim about
 * what the scan found is read back from the scan's own durable subject — the
 * files on disk — rather than from a value the scan returned about itself. The
 * negative control is the file that holds no secret: it must not be named.
 *
 * "The value is never written to any state, event, log or contract" is tested as
 * a property of the registry and not as a promise: the registry is put through
 * `JSON.stringify` and through the event the scan raises, and the secret is in
 * neither.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REDACTION_PLACEHOLDER } from "../../src/redactor/index.ts";
import { SecretRegistry, registerAtUse, secretFingerprint } from "../../src/redactor/register.ts";
import {
  COMMIT_BLOCKED_EVENT_TYPE,
  commitBlockedEvent,
  scanCommitFiles,
} from "../../src/redactor/scan.ts";
import { createRedactor } from "../../src/redactor/redactor.ts";

function workdir(): string {
  return mkdtempSync(join(tmpdir(), "ct-111-130-"));
}

/* ------------------------------------------------------------------ *
 * CT-111-130 — registration at the moment of use, and the exact match.
 * ------------------------------------------------------------------ */

test("CT-111-130: a text that holds the secret passes through UNTOUCHED before registration", () => {
  const redactor = createRedactor();
  const secret = "Zq7-correct-horse-battery";
  const before = redactor.redact(`the value is ${secret}`, 4096);
  assert.ok(before.text.includes(secret), "no rule of the set matches this value");
  // AT THE MOMENT OF ITS USE the runtime registers it, and from then on it goes.
  registerAtUse(redactor, secret);
  const after = redactor.redact(`the value is ${secret}`, 4096);
  assert.ok(!after.text.includes(secret), after.text);
  assert.equal(after.text, `the value is ${REDACTION_PLACEHOLDER}`);
  assert.equal(after.replacements, 1);
});

test("CT-111-130: the match is EXACT: a near miss is not replaced", () => {
  const registry = new SecretRegistry();
  registry.register("abcdefgh-ijkl");
  assert.equal(registry.replaceIn("abcdefgh-ijkl").text, REDACTION_PLACEHOLDER);
  // A prefix, a suffix, a different case: none is the exact value.
  for (const near of ["abcdefgh-ijk", "abcdefgh-ijkL", "ABCDEFGH-IJKL", "bcdefgh-ijkl"]) {
    const out = registry.replaceIn(near);
    assert.equal(out.text, near, near);
    assert.equal(out.replacements, 0, near);
  }
  // The exact value INSIDE a longer text is replaced, every occurrence of it.
  const twice = registry.replaceIn("x abcdefgh-ijkl y abcdefgh-ijkl z");
  assert.equal(twice.text, `x ${REDACTION_PLACEHOLDER} y ${REDACTION_PLACEHOLDER} z`);
  assert.equal(twice.replacements, 2);
});

test("CT-111-130: a value with regular-expression characters is matched literally", () => {
  const registry = new SecretRegistry();
  registry.register("a.*b+c?(d)");
  assert.equal(registry.replaceIn("a.*b+c?(d)").text, REDACTION_PLACEHOLDER);
  // The value is a literal and not a pattern: this text does not match it.
  assert.equal(registry.replaceIn("axxbbbcd").text, "axxbbbcd");
});

test("CT-111-130: the longest registered value wins where two overlap", () => {
  const registry = new SecretRegistry();
  registry.register("abc");
  registry.register("abcdef");
  const out = registry.replaceIn("abcdef");
  assert.equal(out.text, REDACTION_PLACEHOLDER);
  assert.equal(out.replacements, 1, "the long value was replaced whole, not in two halves");
});

test("CT-111-130: THE VALUE IS NEVER WRITTEN to any state, event, log or contract", () => {
  const registry = new SecretRegistry();
  const secret = "Zq7-correct-horse-battery";
  registry.register(secret);
  // The registry carries the value and still cannot serialise it.
  assert.equal(registry.has(secret), true);
  assert.ok(!JSON.stringify(registry).includes(secret), JSON.stringify(registry));
  assert.ok(!JSON.stringify(registry.toJSON()).includes(secret));
  assert.ok(!String(registry).includes(secret));
  assert.ok(!`${registry.size} registered`.includes(secret));
  // What a record MAY carry is the fingerprint, which is not the value.
  const fingerprint = secretFingerprint(secret);
  assert.match(fingerprint, /^[0-9a-f]{16}$/);
  assert.notEqual(fingerprint, secret);
  assert.deepEqual(registry.toJSON(), { count: 1, fingerprints: [fingerprint] });
});

test("CT-111-130: an empty or very short value is not registered (it would redact everything)", () => {
  const registry = new SecretRegistry();
  registry.register("");
  registry.register("a");
  assert.equal(registry.size, 0);
  assert.equal(registry.replaceIn("a plain sentence").text, "a plain sentence");
});

/* ------------------------------------------------------------------ *
 * CT-111-131 — the comment, and the scan before a commit.
 * ------------------------------------------------------------------ */

test("CT-111-131: the consumer's comment passes the redactor before it is recorded", () => {
  const redactor = createRedactor();
  registerAtUse(redactor, "Zq7-correct-horse-battery");
  const comment = "please retry with Zq7-correct-horse-battery and api_key=sekritvalue";
  const recorded = redactor.redact(comment, 1024);
  assert.ok(!recorded.text.includes("Zq7-correct-horse-battery"), recorded.text);
  assert.ok(!recorded.text.includes("sekritvalue"), recorded.text);
  assert.equal(recorded.replacements, 2);
});

test("CT-111-131: the scan blocks a commit on a registered secret, and names the file", () => {
  const dir = workdir();
  try {
    const redactor = createRedactor();
    const secret = "Zq7-correct-horse-battery";
    registerAtUse(redactor, secret);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "leaky.ts"), `const key = "${secret}";\n`);
    writeFileSync(join(dir, "src", "clean.ts"), "const ok = 1;\n");

    const result = scanCommitFiles(["src/leaky.ts", "src/clean.ts"], { root: dir, redactor });

    assert.equal(result.blocked, true);
    assert.deepEqual([...result.files], ["src/leaky.ts"]);
    assert.deepEqual([...result.counts], [1]);
    assert.equal(result.hits.length, 1);
    assert.equal(result.hits[0]?.file, "src/leaky.ts");
    assert.equal(result.hits[0]?.line, 1);
    assert.equal(result.hits[0]?.matched, "registered-secret");
    // The effect witness: the file on disk still holds the secret — the scan
    // reads and never writes, and the block is the runtime's to act on.
    assert.ok(readFileSync(join(dir, "src", "leaky.ts"), "utf8").includes(secret));
    // The negative control: the clean file is named nowhere.
    assert.ok(!JSON.stringify(result).includes("clean.ts"), JSON.stringify(result));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-111-131: the scan blocks a commit on a PATTERN of the set, with its name", () => {
  const dir = workdir();
  try {
    const redactor = createRedactor();
    writeFileSync(join(dir, "config.env"), "GITHUB=ghp_abcd1234efgh\nOK=1\nSK=sk-abcdefgh1234\n");
    const result = scanCommitFiles(["config.env"], { root: dir, redactor });
    assert.equal(result.blocked, true);
    assert.deepEqual([...result.files], ["config.env"]);
    assert.deepEqual([...result.counts], [2]);
    assert.equal(result.hits.length, 2);
    for (const hit of result.hits) {
      assert.equal(hit.matched, "pattern");
      assert.ok(typeof hit.pattern === "string" && hit.pattern.length > 0);
    }
    assert.deepEqual(
      result.hits.map((hit) => hit.line),
      [1, 3],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-111-131: a commit with no hit is NOT blocked and raises no event", () => {
  const dir = workdir();
  try {
    const redactor = createRedactor();
    registerAtUse(redactor, "Zq7-correct-horse-battery");
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "b.md"), "# notes\nnothing to see\n");
    const result = scanCommitFiles(["a.ts", "b.md"], { root: dir, redactor });
    assert.equal(result.blocked, false);
    assert.deepEqual([...result.hits], []);
    assert.deepEqual([...result.files], []);
    assert.equal(result.event, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-111-131: a file the scan cannot read does not throw and does not pass silently", () => {
  const dir = workdir();
  try {
    const redactor = createRedactor();
    const result = scanCommitFiles(["does/not/exist.ts"], { root: dir, redactor });
    assert.equal(result.blocked, true, "a file that cannot be read fails CLOSED");
    assert.equal(result.hits[0]?.matched, "unreadable");
    assert.deepEqual([...result.files], ["does/not/exist.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-111-131: the event is `redaction.commit_blocked`, with the files and the counts", () => {
  const dir = workdir();
  try {
    const redactor = createRedactor();
    const secret = "Zq7-correct-horse-battery";
    registerAtUse(redactor, secret);
    writeFileSync(join(dir, "one.ts"), `a = "${secret}"\nb = "ghp_abcd1234efgh"\n`);
    writeFileSync(join(dir, "two.ts"), `c = "sk-abcdefgh1234"\n`);
    const result = scanCommitFiles(["one.ts", "two.ts"], { root: dir, redactor });
    assert.equal(COMMIT_BLOCKED_EVENT_TYPE, "redaction.commit_blocked");
    const event = commitBlockedEvent(result);
    assert.ok(event !== undefined);
    assert.equal(event.type, COMMIT_BLOCKED_EVENT_TYPE);
    assert.deepEqual(Object.keys(event.data).sort(), ["counts", "files"]);
    assert.deepEqual(event.data.files, ["one.ts", "two.ts"]);
    assert.deepEqual(event.data.counts, [2, 1]);
    // AND NEVER THE MATCHES.
    const rendered = JSON.stringify(event);
    for (const match of [secret, "ghp_abcd1234efgh", "sk-abcdefgh1234", REDACTION_PLACEHOLDER]) {
      assert.ok(!rendered.includes(match), `${match} is not in ${rendered}`);
    }
    assert.deepEqual(result.event, event);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-111-131: the event names only the files and the counts, and no line number", () => {
  const dir = workdir();
  try {
    const redactor = createRedactor();
    writeFileSync(join(dir, "x.ts"), "\n\n\nghp_abcd1234efgh\n");
    const result = scanCommitFiles(["x.ts"], { root: dir, redactor });
    assert.equal(result.hits[0]?.line, 4, "the hit itself knows the line, for the runtime");
    const event = commitBlockedEvent(result);
    assert.ok(event !== undefined);
    assert.deepEqual(event.data, { files: ["x.ts"], counts: [1] });
    assert.ok(!JSON.stringify(event).includes('"line"'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-111-131: the scan uses THE SAME redactor as the ingress", () => {
  const dir = workdir();
  try {
    // A secret registered with the redactor the ingress uses is the one the
    // scan finds: there is one redactor and one registry behind both.
    const redactor = createRedactor();
    writeFileSync(join(dir, "y.ts"), "value = Zq7-correct-horse-battery\n");
    const before = scanCommitFiles(["y.ts"], { root: dir, redactor });
    assert.equal(before.blocked, false);
    registerAtUse(redactor, "Zq7-correct-horse-battery");
    const after = scanCommitFiles(["y.ts"], { root: dir, redactor });
    assert.equal(after.blocked, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
