/**
 * T028 / CT-131-11 — the containment ceiling (F131-FR-011).
 *
 * The ceiling is C2 with the provenance `adapter`. At C2 a proposer pass
 * runs in the sandbox mode `workspace-write`. Where the sandbox cannot
 * start, the pass ends with the typed failure `capability_absent`, the
 * doctor says why, and the adapter NEVER falls back to the allow-all flag
 * by itself. Until capture 3 the read-denial fact is null and the doctor
 * says the ceiling holds for writes.
 *
 * Effect witnesses: the typed failure object is durable (its class, its
 * typed-failure name and its capability survive into the record a caller
 * writes), and the read-denial fact is read back independently from the
 * capture-3 fixture file on disk.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TYPED_FAILURES } from "@specstride/harness";
import { CONTAINMENT_CEILING } from "../src/index.ts";
import {
  CAPABILITY_ABSENT,
  CapabilityAbsentError,
  CODEX_ALLOW_ALL_FLAG,
  buildProposerPlan,
  readDenialFact,
} from "../src/arguments.ts";

function captureFixture(number: number): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../fixtures/capture-${number}/capture.json`, import.meta.url)),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

test("CT-131-11: the ceiling is C2, declared by the adapter, and the default mode is workspace-write", () => {
  assert.equal(CONTAINMENT_CEILING, "C2");
  const plan = buildProposerPlan({ profile: "default", prompt: "p", workdir: "/w" });
  assert.equal(plan.record.sandboxMode, "workspace-write");
});

test("CT-131-11: a sandbox that cannot start ends the pass with the typed failure capability_absent", () => {
  let thrown: unknown = null;
  try {
    buildProposerPlan({
      profile: "default",
      prompt: "p",
      workdir: "/w",
      sandboxCanStart: false,
    });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof CapabilityAbsentError, "the typed refusal is thrown");
  const failure = thrown as CapabilityAbsentError;
  // The failure is durable and independently readable: the class name, the
  // typed-failure member of the port's closed set, and the capability.
  assert.equal(failure.name, "CapabilityAbsentError");
  assert.equal(failure.typedFailure, CAPABILITY_ABSENT);
  assert.equal(failure.capability, "sandbox");
  assert.ok(TYPED_FAILURES.includes(CAPABILITY_ABSENT), "capability_absent is a port failure");
  assert.match(failure.message, /capability_absent/);
  // A record a caller writes from the caught failure carries the facts.
  const record = {
    typedFailure: (thrown as CapabilityAbsentError).typedFailure,
    capability: (thrown as CapabilityAbsentError).capability,
    sandboxModeAsked: "workspace-write",
  };
  assert.equal(record.typedFailure, "capability_absent");
});

test("CT-131-11: NO fallback to the allow-all flag on a sandbox that cannot start", () => {
  assert.throws(
    () =>
      buildProposerPlan({
        profile: "default",
        prompt: "p",
        workdir: "/w",
        sandboxCanStart: false,
      }),
    CapabilityAbsentError,
  );
  // With the user-configuration C0 opt-in the flag is the consumer's own
  // opt-in, not a fallback; without it nothing catches the refusal.
  try {
    buildProposerPlan({
      profile: "default",
      prompt: "p",
      workdir: "/w",
      sandboxCanStart: false,
      c0OptInValues: [{ value: "C0", source: "environment" }],
    });
    assert.fail("a non-user C0 source is no fallback either");
  } catch (error) {
    assert.ok(error instanceof CapabilityAbsentError);
    assert.equal((error as CapabilityAbsentError).typedFailure, "capability_absent");
  }
  // And the plan that IS built under an opt-in in user configuration never
  // carries a sandbox that cannot start as the reason.
  const plan = buildProposerPlan({
    profile: "default",
    prompt: "p",
    workdir: "/w",
    sandboxCanStart: true,
  });
  assert.equal(plan.args.includes(CODEX_ALLOW_ALL_FLAG), false);
});

test("CT-131-11: the read-denial fact is null until capture 3 is made — read back from the fixture", () => {
  const capture3 = captureFixture(3);
  assert.equal(capture3["status"], "unverified", "capture 3 has not been made");
  const fact = readDenialFact(capture3 as { status?: string; denialFixture?: string | null });
  assert.equal(fact, null, "until capture 3 the adapter reports the fact as null");
  // The two closed forms the fact can take once the capture lands.
  assert.equal(
    readDenialFact({ status: "verified", denialFixture: "denial.json" }),
    true,
    "a confirmed denial reads true",
  );
  assert.equal(
    readDenialFact({ status: "verified", denialFixture: null }),
    false,
    "a capture that shows no denial reads false",
  );
  assert.equal(readDenialFact(null), null);
});

test("CT-131-11: while the read-denial fact is null the doctor says the ceiling holds for writes", () => {
  const capture3 = captureFixture(3) as { status?: string; denialFixture?: string | null };
  const fact = readDenialFact(capture3);
  const doctorLine =
    fact === null
      ? "the ceiling C2 holds for writes; whether the sandbox also refuses reads is unverified until capture 3"
      : fact === true
        ? "the ceiling C2 holds for writes and for reads"
        : "the ceiling C2 holds for writes only";
  assert.match(doctorLine, /holds for writes/);
  assert.doesNotMatch(doctorLine, /and for reads/);
});
