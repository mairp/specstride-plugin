/**
 * T086 — contract tests CT-100-260 and CT-100-261 for the handshake
 * (annex F, §F.3; F100-FR-160, F100-FR-161).
 *
 * The tests bind T087 to the key `handshake` of `data/exit-codes.json` and to
 * the exported types of T038 (the launch record) and T040 (the lease).
 */
import test from "node:test";
import assert from "node:assert/strict";
import exitCodes from "../data/exit-codes.json" with { type: "json" };
import { closedSets } from "../src/enums/all-sets.ts";
import {
  ANNEX_SECTION,
  CLOSED_BY,
  EXPIRED_STATUS_LINE,
  HANDSHAKE_OUTCOMES,
  HANDSHAKE_STEPS,
  HOW_A_NEW_SESSION_LEARNS,
  LAUNCH_ABANDONED,
  PIPELINE_REFUSAL_CODES,
  READINESS_IS_CONFIRMED_BY,
  REATTACHMENT_IS_READING_ONLY,
  REFUSALS_THAT_EXIT_24,
  REFUSAL_CODE,
  ROLE_RESOLUTION_REFUSAL_CODE_IN_THE_FOREGROUND,
  VALID_UNTIL_NONE,
  deriveLaunchAbandoned,
  exitOfLaunch,
  handshakeOutcomeSet,
  handshakeRow,
  handshakeRows,
  leaseConfirmsLaunch,
  outcomeOf,
  statusLineIsValid,
} from "../src/state/handshake.ts";
import { DERIVED_CONDITION_ABANDONED, type LaunchRecord } from "../src/records/launch-record.ts";
import type { Lease } from "../src/records/lease.ts";
import { DERIVED_RUN_CONDITIONS } from "../src/state/run-state.ts";
import { sampleOf } from "./samples.ts";

const RAW = (exitCodes as { handshake: Record<string, string>[] }).handshake;

const launchRecord = (over: Partial<LaunchRecord> = {}): LaunchRecord =>
  ({
    ...sampleOf("specstride.launch/1"),
    launchNonce: "nonce-1",
    createdAt: "2026-09-30T00:00:00.000Z",
    ...over,
  }) as LaunchRecord;

const lease = (over: Partial<Lease> = {}): Lease =>
  ({ ...sampleOf("specstride.lease/1"), launchNonce: "nonce-1", ...over }) as Lease;

test("CT-100-260: a launch follows the four steps of §F.3", () => {
  assert.equal(ANNEX_SECTION, "annex F, §F.3");
  assert.equal(HANDSHAKE_STEPS.length, 4);
  assert.deepEqual(
    HANDSHAKE_STEPS.map((s) => s.step),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    HANDSHAKE_STEPS.map((s) => s.actor),
    ["CLI", "CLI", "Runtime root", "CLI"],
  );
  assert.match(String(HANDSHAKE_STEPS[0]?.act), /launch record with a fresh launch nonce/);
  assert.match(String(HANDSHAKE_STEPS[1]?.act), /detach strategy/);
  assert.match(String(HANDSHAKE_STEPS[2]?.act), /lease with the launch nonce/);
  assert.match(String(HANDSHAKE_STEPS[3]?.act), /bounded time and no longer/);
});

test("CT-100-260: a launch ends in exactly one of the three outcomes, with its code", () => {
  assert.equal(RAW.length, 3);
  assert.deepEqual([...HANDSHAKE_OUTCOMES], ["started", "attached", "refused"]);
  assert.equal(handshakeRows.length, 3);
  for (const raw of RAW) {
    const outcome = String(raw.Outcome).replace(/`/g, "").trim();
    const row = handshakeRow(outcome);
    assert.notEqual(row, undefined, outcome);
    assert.equal(row?.meaning, raw.Meaning);
    assert.equal(row?.cliPrints, raw["The CLI prints"]);
    assert.equal(row?.exitCell, raw["Exit of `launch`"]);
    assert.notEqual(row?.cliPrints.trim(), "", `${outcome} says what the CLI prints`);
  }
  assert.equal(handshakeRow("invented"), undefined);

  // Row 17 of §X.6 holds the same three.
  assert.equal(handshakeOutcomeSet.number, 17);
  assert.deepEqual([...handshakeOutcomeSet.members], [...HANDSHAKE_OUTCOMES]);
  assert.deepEqual([...(closedSets.get(17)?.members ?? [])], [...HANDSHAKE_OUTCOMES]);

  // The exit code of `launch` for each outcome.
  assert.equal(exitOfLaunch("started"), 0);
  assert.equal(exitOfLaunch("attached"), 4);
  assert.equal(exitOfLaunch("refused"), REFUSAL_CODE);
  assert.equal(REFUSAL_CODE, 4);
  // `lock-conflict` and `lock-unknown` give 24; every other refusal 4.
  assert.deepEqual([...REFUSALS_THAT_EXIT_24], ["lock-conflict", "lock-unknown"]);
  for (const refusal of REFUSALS_THAT_EXIT_24) {
    assert.equal(exitOfLaunch("refused", { refusal }), 24, refusal);
  }
  assert.equal(exitOfLaunch("refused", { refusal: "open-blocker" }), 4);
  // The pipeline's own refusals give 20, 21 or 23.
  assert.deepEqual(PIPELINE_REFUSAL_CODES, {
    "invalid-contract": 20,
    "preflight-blocked": 21,
    "stale-sources": 23,
  });
  for (const [refusal, code] of Object.entries(PIPELINE_REFUSAL_CODES)) {
    assert.equal(exitOfLaunch("refused", { refusal }), code, refusal);
  }
  // A refusal of role resolution in the foreground `run` gives 3.
  assert.equal(ROLE_RESOLUTION_REFUSAL_CODE_IN_THE_FOREGROUND, 3);
  assert.equal(exitOfLaunch("refused", { refusal: "resolve-no-harness", foregroundRun: true }), 3);
  assert.equal(exitOfLaunch("refused", { refusal: "resolve-no-harness" }), 4);
  // The codes of the three rows are the ones the annex names.
  assert.deepEqual([...(handshakeRow("refused")?.exitCodes ?? [])], [4, 24, 20, 21, 23, 3]);
  assert.throws(() => exitOfLaunch("invented" as never), /not an outcome of the handshake/);
});

test("CT-100-260: readiness is the lease that carries the launch nonce", () => {
  assert.equal(READINESS_IS_CONFIRMED_BY, "the lease that carries the launch nonce");
  const record = launchRecord();
  assert.ok(leaseConfirmsLaunch(record, lease()));
  assert.equal(leaseConfirmsLaunch(record, lease({ launchNonce: "another" })), false);
  assert.equal(leaseConfirmsLaunch(record, undefined), false);

  assert.equal(outcomeOf({ record, lease: lease() }), "started");
  assert.equal(outcomeOf({ record, lease: lease({ launchNonce: "another" }) }), "attached");
  assert.equal(outcomeOf({ record }), "refused");
  assert.equal(outcomeOf({ record, lease: lease(), refusal: "open-blocker" }), "refused");
});

test("CT-100-260: an unanswered launch is closed as `launch-abandoned` by the next launch", () => {
  assert.equal(LAUNCH_ABANDONED, "launch-abandoned");
  assert.equal(LAUNCH_ABANDONED, DERIVED_CONDITION_ABANDONED);
  assert.ok((DERIVED_RUN_CONDITIONS as readonly string[]).includes(LAUNCH_ABANDONED));
  assert.equal(CLOSED_BY, "the next launch");

  const record = launchRecord();
  const later = new Date("2026-09-30T00:10:00.000Z");
  const limit = 120;
  // No outcome, no lease with the nonce, older than the limit: abandoned.
  assert.equal(
    deriveLaunchAbandoned({ record, now: later, handshakeLimitSeconds: limit }),
    LAUNCH_ABANDONED,
  );
  // A lease with the nonce: not abandoned.
  assert.equal(
    deriveLaunchAbandoned({ record, lease: lease(), now: later, handshakeLimitSeconds: limit }),
    undefined,
  );
  // An outcome recorded: not abandoned.
  assert.equal(
    deriveLaunchAbandoned({
      record: launchRecord({ outcome: "started" }),
      now: later,
      handshakeLimitSeconds: limit,
    }),
    undefined,
  );
  // Younger than the limit: not abandoned yet.
  assert.equal(
    deriveLaunchAbandoned({
      record,
      now: new Date("2026-09-30T00:00:30.000Z"),
      handshakeLimitSeconds: limit,
    }),
    undefined,
  );
  // A lease of another launch does not answer this one.
  assert.equal(
    deriveLaunchAbandoned({
      record,
      lease: lease({ launchNonce: "another" }),
      now: later,
      handshakeLimitSeconds: limit,
    }),
    LAUNCH_ABANDONED,
  );
});

test("CT-100-261: re-attachment is reading only, and `validUntil` governs a status line", () => {
  assert.equal(REATTACHMENT_IS_READING_ONLY, true);
  assert.deepEqual(
    [...HOW_A_NEW_SESSION_LEARNS],
    ["`status`", "a host hook shim that prints a precomputed status line"],
  );
  assert.equal(VALID_UNTIL_NONE, "none");
  // A run that rests and has no lease carries `none`, without expiry.
  assert.equal(statusLineIsValid(VALID_UNTIL_NONE, new Date("2030-01-01T00:00:00.000Z")), true);
  // A time that has passed: the shim says the state is unknown and names
  // the command `status`.
  const now = new Date("2026-09-30T12:00:00.000Z");
  assert.equal(statusLineIsValid("2026-09-30T11:59:00.000Z", now), false);
  assert.equal(statusLineIsValid("2026-09-30T12:01:00.000Z", now), true);
  assert.equal(statusLineIsValid("not a time", now), false);
  assert.equal(EXPIRED_STATUS_LINE.says, "the state is unknown");
  assert.equal(EXPIRED_STATUS_LINE.namesTheCommand, "status");
});
