/**
 * T109 — own test CT-101-30: a MISSING CREDENTIAL of the critic.
 *
 * proves: F101-FR-010. criterion: F101-SC-003.
 * fixtures: FX-07/missing-key, FX-07/codex-missing-key and
 * FX-07/phase-not-found, port side only.
 *
 * The three halves of the requirement, each a case below:
 *
 *  1. under the `parity` profile the switch is OFF, so the missing credential
 *     fails INSIDE the call: every phase attempt is scored MALFORMED with the
 *     detail `call-failed` and the run ends with exit 1 and
 *     `critic_unavailable` at the MALFORMED limit (CQ-187, DV-117);
 *  2. OUTSIDE the profile the switch is on, so the engine finds it BEFORE the
 *     call through `preflight` of the harness port — which makes no paid call
 *     — and halts with exit 3 and `critic_config`; no count changes, and the
 *     message names the credential BY THE NAME OF ITS VARIABLE and holds no
 *     value;
 *  3. every row of `contracts/gate-halts.json` that names a scenario of FX-07
 *     ends as the row says.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  A_MISSING_CREDENTIAL_CHANGES_A_COUNT,
  CONFIG_ERROR_EXIT_CODE,
  CONFIG_ERROR_STOP_REASON,
  CREDENTIAL_SWITCH_DEFAULT,
  DETAIL_OF_A_FAILED_CALL,
  FAILURES_FOUND_BEFORE_THE_CALL,
  MISSING_CREDENTIAL,
  MISSING_CREDENTIAL_SWITCH_ROW,
  PREFLIGHT_AT_LAUNCH_BELONGS_TO,
  PREFLIGHT_MAKES_A_PAID_CALL,
  PREFLIGHT_OPERATION,
  PROFILE_THAT_SWITCHES_IT_OFF,
  THE_ENGINE_READS_A_CREDENTIAL,
  checkTheCredentialOfTheCritic,
  missingCredentialMessage,
  missingCredentialOutcome,
  theCredentialSwitchIsOn,
} from "../../src/gate/critic-call.ts";
import { GATE_HALTS, haltOf } from "../../src/gate/halts.ts";
import { OPERATIONS as HARNESS_OPERATIONS } from "@specstride/contracts/ep/harness";
import {
  runFixture,
  runSetOfTheFixtureOfARow,
  FX_07_MISSING_KEY,
  FX_07_CODEX_MISSING_KEY,
  FX_07_MISSING_KEY_OUTSIDE_PARITY,
  FX_07_PHASE_NOT_FOUND,
} from "./run-harness.ts";

/** The value planted as the credential; it must reach nothing the run writes. */
const SECRET_VALUE = "sk-live-do-not-write-me-anywhere";

test("CT-101-30: the switch, its default and the profile that switches it off", () => {
  assert.equal(CREDENTIAL_SWITCH_DEFAULT, true, "on by default");
  assert.equal(PROFILE_THAT_SWITCHES_IT_OFF, "parity");
  assert.equal(theCredentialSwitchIsOn(undefined), true);
  assert.equal(theCredentialSwitchIsOn("default"), true);
  assert.equal(theCredentialSwitchIsOn("parity"), false);
  assert.equal(MISSING_CREDENTIAL_SWITCH_ROW, "a missing credential of the critic");
  // The check goes through `preflight` of the harness port, which is an
  // operation of that port and makes no paid call.
  assert.equal(PREFLIGHT_OPERATION, "preflight");
  assert.equal((HARNESS_OPERATIONS as readonly string[]).includes("preflight"), true);
  assert.equal(PREFLIGHT_MAKES_A_PAID_CALL, false);
  assert.equal(THE_ENGINE_READS_A_CREDENTIAL, false);
  // The preflight of every role AT LAUNCH is feature 124's, not this one's.
  assert.equal(PREFLIGHT_AT_LAUNCH_BELONGS_TO, "124");
  // A missing credential is found before the call, like a configuration error.
  assert.equal(FAILURES_FOUND_BEFORE_THE_CALL.includes(MISSING_CREDENTIAL), true);
  assert.equal(A_MISSING_CREDENTIAL_CHANGES_A_COUNT, false);
  // The two ends of the switch, as data.
  assert.deepEqual(
    { ...missingCredentialOutcome(true) },
    {
      halts: true,
      exitCode: 3,
      stopReason: "critic_config",
    },
  );
  assert.deepEqual(
    { ...missingCredentialOutcome(false) },
    {
      halts: false,
      scoredAs: "MALFORMED",
      detail: "call-failed",
    },
  );
});

test("CT-101-30: the message names the VARIABLE and never a value", () => {
  const message = missingCredentialMessage("CRITIC_API_KEY");
  assert.equal(message, "the credential of the critic is not set: CRITIC_API_KEY");
  assert.equal(message.includes(SECRET_VALUE), false);
  // Even handed the value itself, the function writes what it is handed and
  // the engine never hands it a value: the ENGINE READS NO CREDENTIAL.
  assert.equal(THE_ENGINE_READS_A_CREDENTIAL, false);
});

test("CT-101-30: with the switch on, `preflight` is asked and a missing credential halts", async () => {
  const asked: string[] = [];
  const absent = await checkTheCredentialOfTheCritic(
    { switchIsOn: true, variableOrKey: "CRITIC_API_KEY" },
    {
      harness: {
        preflight: (role) => {
          asked.push(role);
          return Promise.resolve({ credentialPresent: false, refused: true });
        },
      },
    },
  );
  assert.deepEqual(asked, ["critic"], "`preflight` is asked about the role `critic`");
  assert.equal(absent.checked, true);
  assert.equal(absent.checked && absent.present, false);
  if (absent.checked && !absent.present) {
    assert.equal(absent.exitCode, CONFIG_ERROR_EXIT_CODE);
    assert.equal(absent.stopReason, CONFIG_ERROR_STOP_REASON);
    assert.equal(absent.failure, MISSING_CREDENTIAL);
    assert.equal(absent.message, "the credential of the critic is not set: CRITIC_API_KEY");
    assert.equal(absent.result.exit_code, 3);
  }

  // A credential that IS present lets the call be made.
  const present = await checkTheCredentialOfTheCritic(
    { switchIsOn: true, variableOrKey: "CRITIC_API_KEY" },
    { harness: { preflight: () => Promise.resolve({ credentialPresent: true, refused: false }) } },
  );
  assert.equal(present.checked && present.present, true);

  // A `preflight` that THROWS is the credential treated as absent: the safe
  // failure of a check that cannot answer is to stop before a paid call.
  const threw = await checkTheCredentialOfTheCritic(
    { switchIsOn: true, variableOrKey: "CRITIC_API_KEY" },
    {
      harness: {
        preflight: () => {
          throw new Error("the harness is gone");
        },
      },
    },
  );
  assert.equal(threw.checked && !threw.present, true);
});

test("CT-101-30: with the switch OFF nothing is asked before the call", async () => {
  const asked: string[] = [];
  const outcome = await checkTheCredentialOfTheCritic(
    { switchIsOn: false, variableOrKey: "CRITIC_API_KEY" },
    {
      harness: {
        preflight: (role) => {
          asked.push(role);
          return Promise.resolve({ credentialPresent: false, refused: true });
        },
      },
    },
  );
  assert.deepEqual(asked, [], "no paid call and no check at all");
  assert.equal(outcome.checked, false);
});

test("CT-101-30 (FX-07/missing-key and FX-07/codex-missing-key, under `parity`): MALFORMED `call-failed`, then exit 1", async () => {
  for (const set of [FX_07_MISSING_KEY, FX_07_CODEX_MISSING_KEY]) {
    const run = await runFixture(set);
    // Nothing was asked before the call: the switch is off under `parity`.
    assert.deepEqual([...run.preflightCalls], [], `${set.scenario}: no preflight`);
    // Every phase attempt was scored MALFORMED with the detail `call-failed`.
    assert.deepEqual(
      run.decisions.map((decision) => decision.kind),
      ["malformed", "malformed", "malformed"],
      set.scenario,
    );
    const verdicts = [...run.files.entries()].filter(([k]) => k.endsWith("/critic/verdict.json"));
    assert.equal(verdicts.length, 3, set.scenario);
    for (const [, text] of verdicts) {
      assert.match(text, /"verdict":"MALFORMED"/, set.scenario);
      assert.match(text, /"detail":"call-failed"/, set.scenario);
    }
    assert.equal(DETAIL_OF_A_FAILED_CALL, "call-failed");
    // The run ends at the MALFORMED limit.
    assert.equal(run.exitCode, 1, set.scenario);
    assert.equal(run.stopReason, "critic_unavailable", set.scenario);
    assert.equal(run.haltCause, "malformed-limit", set.scenario);
    assert.deepEqual(run.stopFields, { phase: 1, attempts: 3, streak: 3 });
    // And nothing the run wrote holds a credential value.
    for (const [path, text] of run.files) {
      assert.equal(text.includes(SECRET_VALUE), false, path);
    }
  }
});

test("CT-101-30 (FX-07/missing-key, OUTSIDE the profile): exit 3 before the first call, no count changes", async () => {
  const run = await runFixture(FX_07_MISSING_KEY_OUTSIDE_PARITY);
  // `preflight` was asked, exactly once, about the role `critic`.
  assert.deepEqual([...run.preflightCalls], ["critic"]);
  // BEFORE the first call: no call was made at all.
  assert.deepEqual([...run.calls], []);
  assert.equal(run.exitCode, 3);
  assert.equal(run.stopReason, "critic_config");
  assert.equal(run.haltCause, "critic-config");
  assert.deepEqual(run.stopFields, { phase: 1 });
  // No count changes.
  assert.deepEqual([...run.ledgerWrites], []);
  assert.deepEqual([...run.decisions], []);
  assert.deepEqual([...run.archived], []);
  // The message names the credential and holds no value.
  const fatal = run.warnings.find((line) => line.includes("the credential of the critic"));
  assert.notEqual(fatal, undefined, run.warnings.join("\n"));
  assert.match(fatal ?? "", /CRITIC_API_KEY/);
  assert.equal((fatal ?? "").includes(SECRET_VALUE), false);
  // No verdict record and no feedback: nothing was scored.
  assert.deepEqual(
    [...run.files.keys()].filter((k) => k.endsWith("/critic/verdict.json")),
    [],
  );
});

test("CT-101-30: every row of the table that names a scenario of FX-07 ends as the row says", async () => {
  const named = GATE_HALTS.flatMap((row) =>
    row.fixtures.filter((f) => f.startsWith("FX-07")).map((f) => ({ row, fixture: f })),
  );
  // The contract names seven of them: one in `critic-config`, six in
  // `malformed-limit` (`contracts/README.md`).
  assert.equal(named.length, 7, named.map((n) => n.fixture).join(", "));
  assert.equal(named.filter((n) => n.row.cause === "critic-config").length, 1);
  assert.equal(named.filter((n) => n.row.cause === "malformed-limit").length, 6);
  for (const { row, fixture } of named) {
    const set = runSetOfTheFixtureOfARow(fixture, row.cause);
    assert.notEqual(set, undefined, fixture);
    const run = await runFixture(set as NonNullable<typeof set>);
    assert.equal(run.exitCode, row.exitCode, `${fixture}: the exit code of \`${row.cause}\``);
    assert.equal(
      run.stopReason ?? null,
      row.stopReason,
      `${fixture}: the stop reason of \`${row.cause}\``,
    );
    assert.equal(row.retryable, false, fixture);
  }
  // And `FX-07/phase-not-found` is the one that ends in `critic-config`.
  const configError = await runFixture(FX_07_PHASE_NOT_FOUND);
  assert.equal(configError.exitCode, haltOf("critic-config").exitCode);
  assert.equal(configError.stopReason, haltOf("critic-config").stopReason);
});
