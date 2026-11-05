/**
 * T071 — own test CT-101-13: the approval key.
 *
 * proves: F101-FR-030 — "The key that signs approval records MUST be a key of
 * the feature, kept in the control plane. It MUST NOT be the key that signs
 * the ledger. It MUST never be in the environment of a harness call or of a
 * check, and never on a path that the containment level of a pass or of a
 * check lets them read, where that level allows it. The runtime MUST create
 * the key when the first approval record of a feature is written. An approval
 * record MUST name the key that signed it."
 *
 * fixtures: `FX-01`, port side only, plus the TRANSCRIPT OF THE STUBS for the
 * names of environment variables: the composition root of the harness is the
 * one place an environment of a harness call or of a check is built at all
 * (a core package passes none, F100-FR-012), and it records every one it
 * built, with its names and its values, on `RunObservation.environments`.
 *
 * Three claims, each measured and each with a negative case:
 *
 * | Claim | Measured on | Negative case |
 * |---|---|---|
 * | it is not the ledger key | the two logical names of `layout.json` and the two materials of a run | a test that the two are told apart at all, not assumed |
 * | it is in no environment | every environment of every call of `FX-01` | the same detector run over an environment with the key planted in it |
 * | the record names it | the field `keyId` of every approval record of the run | the material is searched for in the record and must be absent |
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rowOf } from "@specstride/contracts/ids/logical-names";
import { STATE_COMMANDS } from "@specstride/contracts";
import {
  KEY_BYTES,
  LEDGER_KEY_LOGICAL_NAME,
  LOGICAL_NAME,
  PLACES_THE_KEY_IS_NEVER_IN,
  SIGNATURE_ALGORITHM,
  THE_APPROVAL_KEY_IS_THE_LEDGER_KEY,
  approvalKeyOf,
  approvalKeyPath,
  keyIdOf,
  newApprovalKey,
  type ApprovalKeyRecord,
  type ApprovalKeyStore,
} from "../../src/approval/key.ts";
import { APPROVAL_LOGICAL_NAME } from "../../src/approval/record.ts";
import {
  FX_01_THREE_PHASES,
  fx01WithAPlantedEnvironment,
  runFixture,
  type RunObservation,
} from "./run-harness.ts";

/* ------------------------------------------------------------------ *
 * 1 — the approval key is NOT the ledger key.
 * ------------------------------------------------------------------ */

test("CT-101-13: the approval key and the ledger key are two different logical names", () => {
  assert.equal(THE_APPROVAL_KEY_IS_THE_LEDGER_KEY, false);
  assert.equal(LOGICAL_NAME, "feature:<slug>:approval-key");
  assert.equal(LEDGER_KEY_LOGICAL_NAME, "run:<runId>:ledger-key");
  assert.notEqual(LOGICAL_NAME, LEDGER_KEY_LOGICAL_NAME);
  // `layout.json` of feature 100 is the authority for both rows, and the row
  // of the ledger key says so itself.
  const approval = rowOf(LOGICAL_NAME);
  const ledger = rowOf(LEDGER_KEY_LOGICAL_NAME);
  assert.equal(approval.root, "control");
  assert.equal(ledger.root, "control");
  assert.match(ledger.content, /never the approval key/);
  assert.notEqual(approval.path, ledger.path);
  // The approval key is a key OF THE FEATURE; the ledger key is per run.
  assert.match(approval.path, /features\/<slug>\/keys\/approval\.key$/);
  assert.match(ledger.path, /runs\/<runId>\/keys\/ledger\.key$/);
  assert.equal(
    approvalKeyPath("101-gate-and-verdict"),
    "features/101-gate-and-verdict/keys/approval.key",
  );
});

test("CT-101-13 (FX-01): the key that signed the approvals is not the ledger key of the run", async () => {
  const run = await runFixture(FX_01_THREE_PHASES);
  const key = run.approvalKeys.get("101-gate-and-verdict");
  assert.ok(key !== undefined, "the run must have made an approval key");
  assert.notEqual(key.key, run.ledgerKey);
  assert.notEqual(key.keyId, run.ledgerKey);
  // And neither is a prefix of the other, so no test below passes by accident.
  assert.equal(key.key.includes(run.ledgerKey), false);
  assert.equal(run.ledgerKey.includes(key.key), false);
});

test("CT-101-13: the key is 32 bytes of the secure random source, and two keys differ", () => {
  assert.equal(KEY_BYTES, 32);
  assert.equal(SIGNATURE_ALGORITHM, "HMAC-SHA-256");
  const a = newApprovalKey("101-gate-and-verdict", "2026-10-03T00:00:00.000Z");
  const b = newApprovalKey("101-gate-and-verdict", "2026-10-03T00:00:00.000Z");
  assert.equal(a.key.length, KEY_BYTES * 2);
  assert.notEqual(a.key, b.key);
  assert.notEqual(a.keyId, b.keyId);
});

test("CT-101-13: the runtime makes the key when the FIRST approval record is written", () => {
  const held = new Map<string, ApprovalKeyRecord>();
  const store: ApprovalKeyStore = {
    read: (feature) => held.get(feature),
    write: (record) => void held.set(record.feature, record),
  };
  assert.equal(held.size, 0);
  const first = approvalKeyOf(store, "101-gate-and-verdict", "2026-10-03T00:00:00.000Z");
  assert.equal(first.created, true);
  const second = approvalKeyOf(store, "101-gate-and-verdict", "2026-10-03T00:00:01.000Z");
  assert.equal(second.created, false);
  assert.equal(second.key.key, first.key.key);
  // A key per FEATURE: another feature gets its own.
  const other = approvalKeyOf(store, "104-spec-input", "2026-10-03T00:00:02.000Z");
  assert.equal(other.created, true);
  assert.notEqual(other.key.key, first.key.key);
});

/* ------------------------------------------------------------------ *
 * 2 — it is in no environment of a harness call or of a check.
 * ------------------------------------------------------------------ */

/**
 * The detector: the names and the values of every environment of a run,
 * searched for the key material, for the id of the key and for the path of
 * the key. It is a function so that the negative case below can run the SAME
 * detector over an environment that does hold the key.
 */
function whereTheKeyAppears(
  run: RunObservation,
  needles: readonly string[],
): readonly { readonly kind: string; readonly what: string; readonly at: string }[] {
  const found: { kind: string; what: string; at: string }[] = [];
  for (const entry of run.environments) {
    for (const [name, value] of Object.entries(entry.env)) {
      for (const needle of needles) {
        if (needle === "") continue;
        if (name.includes(needle)) found.push({ kind: entry.kind, what: entry.what, at: name });
        if (value.includes(needle)) {
          found.push({ kind: entry.kind, what: entry.what, at: `${name}=…` });
        }
      }
    }
  }
  return Object.freeze(found);
}

test("CT-101-13 (FX-01): the run really built environments of both kinds", async () => {
  // Without this the claim below would be vacuous.
  const run = await runFixture(FX_01_THREE_PHASES);
  const kinds = new Set(run.environments.map((e) => e.kind));
  assert.equal(kinds.has("harness-call"), true);
  assert.equal(kinds.has("check"), true);
  assert.ok(run.environments.length >= 6, "one environment per critic call and per check");
});

test("CT-101-13 (FX-01): the approval key is in NO environment of a harness call or of a check", async () => {
  const run = await runFixture(FX_01_THREE_PHASES);
  const key = run.approvalKeys.get("101-gate-and-verdict");
  assert.ok(key !== undefined);
  const appears = whereTheKeyAppears(run, [
    key.key,
    key.keyId,
    approvalKeyPath("101-gate-and-verdict"),
    "approval.key",
    "APPROVAL_KEY",
  ]);
  assert.deepEqual([...appears], [], `the key reached ${JSON.stringify(appears)}`);
  // F101-FR-030 — the four places the key is never in, as the module names them.
  assert.deepEqual(
    [...PLACES_THE_KEY_IS_NEVER_IN],
    [
      "the environment of a harness call",
      "the environment of a check",
      "a path the containment level of a pass may read",
      "a path the containment level of a check may read",
    ],
  );
});

test("CT-101-13: the detector FINDS a key planted in the environment (the negative case)", async () => {
  // The same detector, over a run whose environments hold the key. If this
  // found nothing, the claim above would prove nothing.
  const material = "d".repeat(64);
  const run = await runFixture(fx01WithAPlantedEnvironment({ SPECSTRIDE_APPROVAL_KEY: material }));
  const byValue = whereTheKeyAppears(run, [material]);
  assert.ok(byValue.length > 0, "the detector missed a planted key value");
  const byName = whereTheKeyAppears(run, ["APPROVAL_KEY"]);
  assert.ok(byName.length > 0, "the detector missed a planted key NAME");
  // And it is found in BOTH kinds of environment.
  assert.equal(new Set(byValue.map((f) => f.kind)).size, 2);
});

test("CT-101-13: no name of an environment of a run names the key at all", async () => {
  const run = await runFixture(FX_01_THREE_PHASES);
  const names = new Set(run.environments.flatMap((e) => Object.keys(e.env)));
  for (const name of names) {
    assert.equal(/approval/i.test(name), false, `\`${name}\` names the approval key`);
    assert.equal(/\bkey\b/i.test(name), false, `\`${name}\` names a key`);
  }
  // The names that ARE there, for the record of the test.
  assert.ok(names.has("PATH"));
  assert.ok(names.has("SPECSTRIDE_RUN_ID"));
});

/* ------------------------------------------------------------------ *
 * 3 — the record NAMES the key that signed it.
 * ------------------------------------------------------------------ */

test("CT-101-13 (FX-01): every approval record names the key that signed it, and holds no material", async () => {
  const run = await runFixture(FX_01_THREE_PHASES);
  const key = run.approvalKeys.get("101-gate-and-verdict");
  assert.ok(key !== undefined);
  const records = [...run.files.entries()].filter(([path]) =>
    /approvals\/phase-\d+\.json$/.test(path),
  );
  assert.equal(records.length, 3);
  for (const [path, text] of records) {
    const record = JSON.parse(text) as { keyId: string; sig: string };
    // It NAMES the key: the id of the key, which is the hash of its material.
    assert.equal(record.keyId, key.keyId, path);
    assert.equal(record.keyId, keyIdOf(key.key));
    // And it holds no material: neither the key nor any part of it.
    assert.equal(text.includes(key.key), false, `${path} holds the key material`);
    assert.notEqual(record.sig, key.key);
  }
  assert.equal(APPROVAL_LOGICAL_NAME, "gate:<N>:approved");
});

test("CT-101-13: the id of a key is the hash of its material and never the material", () => {
  const key = newApprovalKey("101-gate-and-verdict", "2026-10-03T00:00:00.000Z");
  assert.equal(key.keyId, keyIdOf(key.key));
  assert.notEqual(key.keyId, key.key);
  assert.equal(key.keyId.length, 64);
});

/* ------------------------------------------------------------------ *
 * A static claim: no module of this feature puts the key in an environment.
 * ------------------------------------------------------------------ */

test("CT-101-13: no module of packages/core/src/ reads or writes a process environment", async () => {
  // A core package has no I/O (F100-FR-012, F100-FR-234), so there is no place
  // in it for the key to enter an environment from. Measured over the sources.
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const src = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "src");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts")) files.push(path);
    }
  };
  walk(src);
  assert.ok(files.length > 20, "the walk must have found the sources");
  const offenders = files.filter((path) => {
    const text = readFileSync(path, "utf8");
    return text.includes("process.env") || text.includes("node:process");
  });
  assert.deepEqual(offenders, []);
  // The three state commands of F101-FR-032 are named by feature 100, not by
  // this test: it reads them from the contracts package.
  assert.deepEqual([...STATE_COMMANDS], ["state export", "state import", "state adopt"]);
});
