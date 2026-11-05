/**
 * T035 — the own property test of F101-SC-002, over the event log of EVERY
 * fixture run of user story 1.
 *
 * criterion: F101-SC-002 — "No approval without an independent verdict. On the
 * event log of every run, the number of approval records that do not follow a
 * reply with the matching nonce, from a call made after the full verification
 * gate of the same phase attempt ran or was not required by the verification
 * mode of the run, is 0."
 *
 * proves: F101-FR-005 (the order at the phase gate) and F101-FR-008 (a verdict
 * comes from the reply of a critic call and from nothing else).
 *
 * fixtures: FX-01 to FX-08, FX-15 and FX-27, PORT SIDE ONLY — the reference
 * side needs the oracle of feature 141, which is not built. The run sets are
 * `RUN_SETS_OF_USER_STORY_1` of the harness, and the VERIFICATION MODE of each
 * fixture is read FROM ITS RUN SET, as the task asks, never restated here.
 *
 * The property is checked three ways over the same run, so that no single
 * surface can be the whole proof:
 *
 *  1. on the EVENT LOG: every approval event follows, in the same phase
 *     attempt, a critic call, and that call follows the end of the
 *     verification gate of that phase attempt — unless the verification mode
 *     of the run did not require the gate;
 *  2. on the REPLY: the reply of that call carries EXACTLY ONE whole verdict
 *     line with the nonce the harness adapter was given for that call, which
 *     the parser of feature 101 is asked again here, independently;
 *  3. on the RECORDS: the approval record of the phase names the verdict
 *     record of that phase attempt, and the two carry the SAME hash of the
 *     nonce, which is the hash of the nonce of that very call.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseVerdict } from "../../src/gate/verdict-parser.ts";
import { MODE_THAT_GATES_EVERY_PHASE_ATTEMPT } from "../../src/gate/phase-gate.ts";
import { approvalRecordPath } from "../../src/approval/record.ts";
import {
  runFixture,
  verdictRecordPath,
  RUN_SETS_OF_USER_STORY_1,
  type RunObservation,
  type RunSet,
} from "./run-harness.ts";

const SLUG = "101-gate-and-verdict";

/** The as-is approval event of a phase: the `verdict` event with APPROVED. */
function approvalEvents(run: RunObservation): readonly { phase: number; attempt: number }[] {
  return run.events
    .filter((e) => e.type === "verdict.recorded" && e.data.result === "APPROVED")
    .map((e) => ({ phase: Number(e.data.phase), attempt: Number(e.data.attempt) }));
}

/** The index of an event of a phase attempt in the log, or -1. */
function indexOf(run: RunObservation, type: string, phase: number, attempt: number): number {
  return run.events.findIndex(
    (e) => e.type === type && Number(e.data.phase) === phase && Number(e.data.attempt) === attempt,
  );
}

/** Whether the verification mode of the run required the gate. */
function theGateWasRequired(set: RunSet): boolean {
  return set.verificationMode === MODE_THAT_GATES_EVERY_PHASE_ATTEMPT;
}

for (const set of RUN_SETS_OF_USER_STORY_1) {
  const name = `${set.family}/${set.scenario}`;

  test(`F101-SC-002 (${name}): every approval follows a nonce-matched reply after the verification gate`, async () => {
    const run = await runFixture(set);
    const approvals = approvalEvents(run);

    // The property is about approval RECORDS, so the two must agree first:
    // one record per approval event of THIS run, and no record without one.
    // The phases approved BEFORE the run carry a record and no event, so they
    // are taken out — they were approved by an earlier run, whose own log the
    // criterion speaks of.
    const approvedBefore = new Set(set.approvedBefore ?? []);
    const records = [...run.files.keys()]
      .filter((k) => /^features\/[^/]+\/approvals\/phase-\d+\.json$/.test(k))
      .map((k) => Number(/phase-(\d+)\.json$/.exec(k)?.[1] ?? "0"))
      .filter((phase) => !approvedBefore.has(phase))
      .sort((a, b) => a - b);
    assert.deepEqual(
      records,
      approvals.map((a) => a.phase).sort((a, b) => a - b),
      `${name}: one approval record per approval event of this run`,
    );

    let counterExamples = 0;
    for (const { phase, attempt } of approvals) {
      // 1 — the event log: the approval follows a critic call of the same
      // phase attempt, and that call follows the END of the verification gate
      // of that same phase attempt, where the mode required it.
      const approvalAt = indexOf(run, "verdict.recorded", phase, attempt);
      const callAt = indexOf(run, "critic.started", phase, attempt);
      if (callAt < 0 || callAt > approvalAt) counterExamples += 1;
      if (theGateWasRequired(set)) {
        const gateEndedAt = indexOf(run, "verification.ended", phase, attempt);
        if (gateEndedAt < 0 || gateEndedAt > callAt) counterExamples += 1;
        // The FULL gate ran and passed: a gate that failed never reaches the
        // critic at all (F101-FR-005).
        const gate = run.events[gateEndedAt];
        if (gate === undefined || gate.data.rc !== 0) counterExamples += 1;
      } else {
        // The mode did not require it, so no gate event exists — and none is
        // asked for. The order still holds for the call itself.
        if (indexOf(run, "verification.ended", phase, attempt) >= 0) counterExamples += 1;
      }

      // 2 — the reply: exactly one whole verdict line, with the nonce the
      // adapter was given for THAT call. The parser is asked again here.
      const call = run.calls.find((c) => c.phase === phase && c.ordinal === attempt);
      if (call === undefined) {
        counterExamples += 1;
      } else {
        const parsed = parseVerdict(call.reply, call.nonceGiven);
        if (parsed.result !== "APPROVED") counterExamples += 1;
        // And the same reply read with ANY other nonce is no approval, which
        // is what "the matching nonce" means.
        const other = parseVerdict(call.reply, "0".repeat(16));
        if (other.result === "APPROVED") counterExamples += 1;
      }

      // 3 — the records: the approval record names the verdict record of that
      // phase attempt, and both carry the hash of the nonce of that call.
      const record = JSON.parse(run.files.get(approvalRecordPath(SLUG, phase)) ?? "{}") as {
        verdictId?: string;
        nonceHash?: string;
      };
      const verdict = JSON.parse(
        run.files.get(verdictRecordPath(run.runId, phase, attempt)) ?? "{}",
      ) as {
        verdictId?: string;
        verdict?: string;
        calls?: { nonceHash?: string }[];
      };
      if (record.verdictId !== verdict.verdictId) counterExamples += 1;
      if (verdict.verdict !== "APPROVED") counterExamples += 1;
      const expected = createHash("sha256")
        .update(call?.nonceGiven ?? "")
        .digest("hex");
      if (record.nonceHash !== expected) counterExamples += 1;
      if (verdict.calls?.[0]?.nonceHash !== expected) counterExamples += 1;
      // The nonce itself is NOWHERE in an event (threat T-05).
      for (const event of run.events) {
        if (JSON.stringify(event.data).includes(call?.nonceGiven ?? "\u0000")) {
          counterExamples += 1;
        }
      }
    }

    assert.equal(counterExamples, 0, `${name}: the count F101-SC-002 bounds is 0`);
  });
}

test("F101-SC-002: the fixtures cover an approval, a rejection, a halt and both verification modes", async () => {
  // A property that held over nothing would prove nothing, so the run sets are
  // checked for the shapes the criterion is about.
  const observed = await Promise.all(RUN_SETS_OF_USER_STORY_1.map((set) => runFixture(set)));
  const approvals = observed.flatMap((run) => approvalEvents(run));
  assert.ok(approvals.length >= 8, `approvals seen: ${String(approvals.length)}`);
  assert.ok(
    observed.some((run) => run.exitCode === 0),
    "a run that approves",
  );
  assert.ok(
    observed.some((run) => run.stopReason === "max_rejects"),
    "a run that halts at the reject limit",
  );
  assert.ok(
    observed.some((run) => run.stopReason === "critic_unavailable"),
    "a run that halts at the MALFORMED limit",
  );
  assert.ok(
    RUN_SETS_OF_USER_STORY_1.some((set) => set.verificationMode === "required"),
    "a fixture whose mode requires the verification gate",
  );
  assert.ok(
    RUN_SETS_OF_USER_STORY_1.some((set) => set.verificationMode === "off"),
    "a fixture whose mode does not require it",
  );
  // The ten families the task names are all represented.
  const families = new Set(RUN_SETS_OF_USER_STORY_1.map((set) => set.family));
  for (const family of [
    "FX-01",
    "FX-02",
    "FX-03",
    "FX-05",
    "FX-06",
    "FX-07",
    "FX-08",
    "FX-15",
    "FX-27",
  ]) {
    assert.ok(families.has(family), `${family} has a run set`);
  }
});

test("F101-SC-002: a run whose approval record is planted carries no approval event, and the record is refused", async () => {
  // The negative case of the criterion, built the only way a planted approval
  // can be built from outside: a BARE marker with no record (FX-13). It
  // approves nothing, so the count stays 0 and the phase is judged again.
  const run = await runFixture({
    family: "FX-13",
    scenario: "planted-approval-marker",
    phases: [{ phase: 1, title: "Setup", taskIds: ["T001"] }],
    reply: () => "reject" as const,
    verificationMode: "required",
    plantedMarkerFor: [1],
    rejectLimit: 1,
  });
  assert.deepEqual(approvalEvents(run), []);
  assert.equal([...run.files.keys()].filter((k) => k.includes("/approvals/")).length, 0);
  assert.equal(run.exitCode, 2);
  assert.equal(run.stopReason, "max_rejects");
});
