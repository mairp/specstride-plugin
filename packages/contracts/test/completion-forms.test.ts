/**
 * T161 — contract tests CT-100-187 and CT-100-188 for the forms of the
 * `completion` level (annex C, §C.3; F100-FR-087, F100-FR-088). The subject is
 * the table of the two forms, the key `completionForms` of
 * `data/harness-tables.json`, and the proof each form needs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import harnessTables from "../data/harness-tables.json" with { type: "json" };
import closedSetsData from "../data/closed-sets.json" with { type: "json" };
import {
  ANNEX_SECTION,
  CLOSED_SET_ROW,
  COMPLETION_FORMS,
  COMPLETION_FORM_COUNT,
  COMPLETION_FORM_ROWS,
  CRITIC_NEVER_RECEIVES_AN_ALL_TOOLS_FLAG,
  CRITIC_PROMPT_HOLDS,
  EXCEPTION_IS_LIMITED_TO,
  FAILURE_WHEN_THE_PROOF_IS_MISSING,
  FILES_ARE_MOVED_BACK_AFTER_THE_CALL,
  FILES_MOVED_OUT_OF_THE_WORKING_TREE,
  FIRST_FORM,
  FIRST_FORM_FACTS,
  MOVE_HOLDS_FOR_EVERY_CRITIC_CLASS_CALL,
  PROOF_IS_MADE_UNDER_PARITY,
  PROOF_IS_RECORDED_FOR_EVERY_CALL,
  PROOF_KINDS,
  PROOF_OUTCOMES,
  PROOF_REQUIREMENTS,
  SECOND_FORM,
  SECOND_FORM_FACTS,
  SESSION_PROOF_CASES,
  STATED_EXCEPTION,
  VERDICT_IS_BOUND_TO_THE_NONCE,
  WEAKER_PROOF_FACTS,
  WEAKER_SESSION_PROOF_CASE,
  callIsRefused,
  isCompletionForm,
  movesTheProposersFiles,
  needsATestedHarnessAdapter,
  proofRequiredFor,
  rowOfForm,
  type CriticProofResult,
} from "../src/enums/completion-forms.ts";
import { closedSets } from "../src/enums/all-sets.ts";
import { formsOfTheCompletionLevel } from "../src/enums/sets-105-109.ts";
import { COMPLETION_FORMS as FORMS_OF_THE_PORT } from "../src/ep/harness.ts";

type RawRow = { Form: string; Id: string; Meaning: string; "Open to": string; Proof: string };
const RAW = (harnessTables as { completionForms: RawRow[] }).completionForms;

test("CT-100-187: the `completion` level has exactly the two forms of §C.3", () => {
  assert.equal(ANNEX_SECTION, "annex C, §C.3");
  assert.equal(COMPLETION_FORM_COUNT, 2);
  assert.deepEqual([...COMPLETION_FORMS], ["tool-less", "read-only-tools"]);
  assert.equal(COMPLETION_FORMS.length, COMPLETION_FORM_COUNT);
  assert.equal(FIRST_FORM, "tool-less");
  assert.equal(SECOND_FORM, "read-only-tools");

  // The table of the package is the table of the data file, row for row.
  assert.equal(COMPLETION_FORM_ROWS.length, RAW.length);
  COMPLETION_FORM_ROWS.forEach((row, i) => {
    const raw = RAW[i] as RawRow;
    assert.equal(row.form, raw.Form);
    assert.equal(`\`${row.id}\``, raw.Id);
    assert.equal(row.meaning, raw.Meaning);
    assert.equal(row.proof, raw.Proof);
  });
  assert.deepEqual([...COMPLETION_FORM_ROWS.map((r) => r.form)], ["First", "Second"]);

  // Who each form is open to: the second a tested harness adapter only.
  assert.equal(needsATestedHarnessAdapter(FIRST_FORM), false);
  assert.equal(needsATestedHarnessAdapter(SECOND_FORM), true);
  assert.equal(rowOfForm(SECOND_FORM).openTo, "tested-harness-adapter-only");
  assert.match(rowOfForm(SECOND_FORM).meaning, /read-only sandbox/);

  // The set is closed: row 28 of annex X §X.6, registered through T070.
  assert.equal(CLOSED_SET_ROW, 28);
  const row28 = (
    closedSetsData as { closedSets: { number: number; name: string; literals: string[] }[] }
  ).closedSets.find((r) => r.number === 28);
  assert.notEqual(row28, undefined);
  assert.equal(row28?.name, "Forms of the `completion` level");
  assert.deepEqual([...(row28?.literals ?? [])], [...COMPLETION_FORMS]);
  const registered = closedSets.get(28);
  assert.notEqual(registered, undefined);
  assert.deepEqual([...(registered?.members ?? [])], [...COMPLETION_FORMS]);
  assert.equal(registered, formsOfTheCompletionLevel);
  assert.ok(formsOfTheCompletionLevel.has("tool-less"));
  assert.equal(formsOfTheCompletionLevel.has("all-tools"), false);
  assert.ok(isCompletionForm("read-only-tools"));
  assert.equal(isCompletionForm("all-tools"), false);

  // The harness port of §C.1 names the same two forms.
  assert.deepEqual([...FORMS_OF_THE_PORT], [...COMPLETION_FORMS]);
});

test("CT-100-187: the proof each form needs, and what a failed proof does", () => {
  // The first form: the initial record shows an empty tool list and the
  // session identity of F100-FR-230; the weaker proof is the fallback.
  const first = proofRequiredFor(FIRST_FORM);
  assert.equal(first.kind, "initial-record");
  assert.deepEqual([...first.facts], ["emptyToolList", "sessionIdentity"]);
  assert.deepEqual([...FIRST_FORM_FACTS], ["emptyToolList", "sessionIdentity"]);
  assert.notEqual(first.fallback, undefined);
  assert.equal(first.fallback?.kind, "version-pin-and-flags");
  assert.deepEqual([...(first.fallback?.facts ?? [])], ["versionPin", "preflight", "flagSet"]);
  assert.deepEqual([...WEAKER_PROOF_FACTS], ["versionPin", "preflight", "flagSet"]);
  assert.equal(first.fallback?.testedHarnessAdapterOnly, true);
  assert.equal(first.fallback?.recordedAsTheWeakerProof, true);
  // The words of the table say the same.
  assert.match(rowOfForm(FIRST_FORM).proof, /empty tool list/);
  assert.match(rowOfForm(FIRST_FORM).proof, /weaker proof/);

  // The second form: the call record shows the sandbox mode, the network off,
  // and the confirmation about the withheld paths of §C.4.
  const second = proofRequiredFor(SECOND_FORM);
  assert.equal(second.kind, "call-record");
  assert.deepEqual(
    [...second.facts],
    ["readOnlySandboxMode", "networkOff", "withheldPathsConfirmed"],
  );
  assert.deepEqual([...SECOND_FORM_FACTS], [...second.facts]);
  assert.equal(second.fallback, undefined);
  assert.match(rowOfForm(SECOND_FORM).proof, /read-only sandbox mode/);
  assert.match(rowOfForm(SECOND_FORM).proof, /withheld paths/);
  assert.deepEqual(Object.keys(PROOF_REQUIREMENTS).sort(), [...COMPLETION_FORMS].sort());
  assert.deepEqual([...PROOF_KINDS], ["initial-record", "version-pin-and-flags", "call-record"]);

  // The three ways of F100-FR-230, and which one is the weaker proof.
  assert.equal(SESSION_PROOF_CASES.length, 3);
  assert.equal(WEAKER_SESSION_PROOF_CASE, "no-session-in-the-initial-record");
  assert.ok(SESSION_PROOF_CASES.includes(WEAKER_SESSION_PROOF_CASE));

  // A call whose proof is missing or fails is refused with
  // `critic_not_toolless`; the result is recorded for every call; a critic
  // path never receives a flag that allows all tools.
  assert.equal(FAILURE_WHEN_THE_PROOF_IS_MISSING, "critic_not_toolless");
  assert.equal(PROOF_IS_RECORDED_FOR_EVERY_CALL, true);
  assert.equal(CRITIC_NEVER_RECEIVES_AN_ALL_TOOLS_FLAG, true);
  assert.deepEqual([...PROOF_OUTCOMES], ["passed", "failed", "not-made"]);

  const passed: CriticProofResult = {
    form: FIRST_FORM,
    outcome: "passed",
    kind: "initial-record",
    sessionProofCase: "caller-minted-id",
    weakerProof: false,
    facts: { emptyToolList: true, sessionIdentity: true },
    underParity: false,
  };
  assert.equal(callIsRefused(passed), false);
  assert.equal(
    callIsRefused({ ...passed, outcome: "failed", failure: "critic_not_toolless" }),
    true,
  );
  assert.equal(callIsRefused({ ...passed, outcome: "not-made" }), true);
  // Under the `parity` profile no proof is made, as at the baseline, so the
  // call is not refused for want of one (rows 28 and 117 of annex X §X.7).
  assert.equal(PROOF_IS_MADE_UNDER_PARITY, false);
  assert.equal(callIsRefused({ ...passed, outcome: "not-made", underParity: true }), false);

  // The weaker proof rests on case 3 and on a tested harness adapter.
  const weaker: CriticProofResult = {
    ...passed,
    kind: "version-pin-and-flags",
    sessionProofCase: WEAKER_SESSION_PROOF_CASE,
    weakerProof: true,
    facts: { versionPin: true, preflight: true, flagSet: true },
  };
  assert.equal(callIsRefused(weaker), false);
  assert.equal(weaker.weakerProof, true);
});

test("CT-100-188: what a critic of either form receives, and the move of the files", () => {
  // F100-FR-088 — the grounding snapshot and, where one exists, the fact
  // block; the verdict is bound to the nonce of the call.
  assert.deepEqual([...CRITIC_PROMPT_HOLDS], ["grounding-snapshot", "fact-block-where-one-exists"]);
  assert.equal(VERDICT_IS_BOUND_TO_THE_NONCE, true);

  // The three files of the proposer are moved out of the working tree before
  // the call and back after it, for every critic-class call.
  assert.deepEqual([...FILES_MOVED_OUT_OF_THE_WORKING_TREE], ["notebook", "handoff", "outbox"]);
  assert.equal(FILES_ARE_MOVED_BACK_AFTER_THE_CALL, true);
  assert.equal(MOVE_HOLDS_FOR_EVERY_CRITIC_CLASS_CALL, true);
  for (const form of COMPLETION_FORMS) assert.equal(movesTheProposersFiles(form), true, form);

  // The second form is the stated exception, limited to reading project files.
  assert.equal(STATED_EXCEPTION, SECOND_FORM);
  assert.equal(EXCEPTION_IS_LIMITED_TO, "reading project files");
});
