/**
 * T052, T053 — a batch runs to its end, in the order of the manifest
 * (F148-FR-015), and a command that failed in a batch of more than one is
 * executed once more ALONE (F148-FR-016).
 *
 * F148-FR-015 is four claims:
 *
 *  1. **Every command of a batch runs to its end.** `runABatch` starts every
 *     member and waits for all of them. Nothing in this module calls
 *     `cancel` on a neighbour: `NO_MEMBER_IS_CANCELLED_BECAUSE_ANOTHER_FAILED`
 *     states the rule and CT-148-204 observes it on a batch whose first
 *     command fails at once.
 *  2. **The steps of the step runner are never concurrent**, and a command
 *     that has steps shares no batch while the step runner is on — the
 *     admission rule B6, with the reason `steps` (`admission.ts`).
 *  3. **Results are ordered by the position in the manifest**, never by
 *     completion: `orderByManifestPosition` sorts on the position the
 *     formation recorded, and `completionOrder` is kept beside the results so
 *     that a test can see the two differ and the results still do not.
 *  4. **The failure signature and the contribution to the fact block are
 *     ordered the same way**: `failureSignature` and `factContributionOf`
 *     walk the ordered results, so two runs whose commands finished in
 *     opposite orders give the same signature byte for byte.
 *
 * F148-FR-016: a command that fails in a batch of MORE THAN ONE is executed
 * once more alone, with a pair of fingerprint readings OF ITS OWN, and both
 * results are stated — the second in the field `rerun` of the first. Where
 * the two differ the result carries `flaky` (`statedTogether`).
 */
import { createHash } from "node:crypto";
import { bracketACommand, type ProtectedSetPort } from "../bracket/fingerprint.ts";
import { contributeToTheFactBlock, type FactContribution } from "../bracket/protected-fact.ts";
import { runCommand } from "../command/kind-command.ts";
import { statedAsPass, withCondition, type RunnerResult } from "../result/result.ts";
import {
  formBatches,
  type Batch,
  type BatchEntry,
  type BatchMember,
  type BatchPlan,
  type FormationOptions,
} from "./admission.ts";
import {
  CHECK_ADMISSION,
  admissionEventData,
  type AdmissionEvent,
  type AdmissionRecord,
} from "./admission.ts";
import { commandRunOf, startTheMembers, type IsolationContext } from "./isolation.ts";
import {
  RunParallelism,
  bracketABatch,
  parallelismLoweredEvent,
  type ParallelismLoweredEvent,
  type ParallelismLowering,
} from "./parallelism.ts";
import { withBatchFields } from "../events/batch-fields.ts";

/* ------------------------------------------------------------------ *
 * Run to the end (F148-FR-015).
 * ------------------------------------------------------------------ */

/**
 * F148-FR-015 — the rule this module keeps: no member of a batch is ever
 * cancelled because another member failed. A failure of one is a result of
 * one.
 */
export const NO_MEMBER_IS_CANCELLED_BECAUSE_ANOTHER_FAILED = true as const;

/** F148-FR-015 — what the results of a batch are ordered by, and what never. */
export const RESULTS_ARE_ORDERED_BY = "the position in the manifest" as const;
export const RESULTS_ARE_NEVER_ORDERED_BY = "completion" as const;

/** Anything that knows where it stood in the manifest. */
export type HasAPosition = { readonly position: number };

/** F148-FR-015 — order by the position in the manifest, never by completion. */
export function orderByManifestPosition<T extends HasAPosition>(items: readonly T[]): readonly T[] {
  return Object.freeze([...items].sort((a, b) => a.position - b.position));
}

/** One result of a batch, with the position of its command in the manifest. */
export type PlacedResult = {
  readonly position: number;
  readonly checkId: string;
  readonly result: RunnerResult;
};

/** What one batch, run to its end, gives back. */
export type BatchOutcome = {
  readonly batch: number;
  /** The results, ordered by the position in the manifest. */
  readonly placed: readonly PlacedResult[];
  /** The ids in the order the members actually FINISHED, for a test. */
  readonly completionOrder: readonly string[];
};

/**
 * F148-FR-013, F148-FR-015 — run every member of a batch to its end. The
 * members are started together and all of them are awaited; the results are
 * then ordered by the position in the manifest, whatever order they finished
 * in.
 */
export async function runABatch(batch: Batch, context: IsolationContext): Promise<BatchOutcome> {
  const running = startTheMembers(batch, context);
  const completionOrder: string[] = [];
  const settled = await Promise.all(
    running.map(async (one, index) => {
      const member = batch.members[index] as BatchMember;
      const result = await one.settled;
      completionOrder.push(member.entry.id);
      return { member, result };
    }),
  );
  const placed = settled.map(({ member, result }) => ({
    position: member.position,
    checkId: member.entry.id,
    // F148-FR-017 — the batch, the slot and whether it ran beside another.
    result: withBatchFields(result, {
      batch: member.batch,
      slot: member.slot,
      concurrent: batch.concurrent,
    }),
  }));
  return Object.freeze({
    batch: batch.batch,
    placed: orderByManifestPosition(placed),
    completionOrder: Object.freeze([...completionOrder]),
  });
}

/* ------------------------------------------------------------------ *
 * The failure signature and the fact contribution (F148-FR-015).
 * ------------------------------------------------------------------ */

/** One line of a failure signature: the command and how it failed. */
export function failureLineOf(placed: PlacedResult): string {
  const result = placed.result;
  const exit = result.exitCode === null ? "null" : String(result.exitCode);
  const signal = result.signal ?? "none";
  const conditions = [
    result.tainted ? "tainted" : "",
    result.unchecked ? "unchecked" : "",
    result.interrupted ? "interrupted" : "",
    result.flaky ? "flaky" : "",
  ]
    .filter((one) => one !== "")
    .join("+");
  return `${placed.checkId}\u0000${exit}\u0000${signal}\u0000${conditions}`;
}

/**
 * F148-FR-015 — the failure signature of a set of results, ORDERED BY THE
 * POSITION IN THE MANIFEST. Two runs of the same commands whose completion
 * orders are opposite give the same signature, byte for byte.
 */
export function failureSignature(placed: readonly PlacedResult[]): string {
  const lines = orderByManifestPosition(placed)
    .filter((one) => !statedAsPass(one.result))
    .map(failureLineOf);
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

/** The lines the signature was taken over, for a reader that must see them. */
export function failureLines(placed: readonly PlacedResult[]): readonly string[] {
  return Object.freeze(
    orderByManifestPosition(placed)
      .filter((one) => !statedAsPass(one.result))
      .map(failureLineOf),
  );
}

/**
 * F148-FR-006, F148-FR-015 — the contribution of a run of batches to the fact
 * block, built by walking the results IN THE ORDER OF THE MANIFEST. It holds
 * paths and kinds, never an exit result, a time or a count of tests.
 */
export function factContributionOf(input: {
  readonly placed: readonly PlacedResult[];
  readonly changed?: readonly string[];
  readonly authorised?: readonly string[];
  readonly integrity?: readonly string[];
}): FactContribution {
  const ordered = orderByManifestPosition(input.placed);
  const paths = new Set<string>(input.changed ?? []);
  for (const one of ordered) {
    const changed = (one.result as RunnerResult & { changedDuringCheck?: readonly string[] })
      .changedDuringCheck;
    for (const path of changed ?? []) paths.add(path);
  }
  return contributeToTheFactBlock({
    protectedSet: {
      changedSincePhaseEntry: Object.freeze([...paths].sort()),
      ...(input.authorised === undefined ? {} : { authorised: input.authorised }),
    },
    ...(input.integrity === undefined ? {} : { integrity: input.integrity }),
  });
}

/* ------------------------------------------------------------------ *
 * The second execution, alone (F148-FR-016).
 * ------------------------------------------------------------------ */

/** F148-FR-016 — when a command is executed once more alone. */
export const RERUN_ALONE_WHEN = "a command that fails in a batch of more than one" as const;

/** The fields two executions of one command are compared on (F148-FR-016). */
export const FIELDS_COMPARED_ACROSS_THE_TWO_EXECUTIONS: readonly string[] = Object.freeze([
  "exitCode",
  "signal",
  "passed",
]);

/** F148-FR-016 — true where the two observed results of a command differ. */
export function resultsDiffer(first: RunnerResult, second: RunnerResult): boolean {
  return (
    first.exitCode !== second.exitCode ||
    first.signal !== second.signal ||
    first.passed !== second.passed
  );
}

/**
 * F148-FR-016 — BOTH results are stated: the second stands in the field
 * `rerun` of the first, and where the two differ the result carries `flaky`
 * with both observed results. The exit result of the first execution is left
 * exactly as the runtime observed it.
 */
export function statedTogether(first: RunnerResult, second: RunnerResult): RunnerResult {
  const differ = resultsDiffer(first, second);
  const observed = Object.freeze([
    Object.freeze({
      at: "in the batch",
      exitCode: first.exitCode,
      signal: first.signal,
      passed: first.passed,
    }),
    Object.freeze({
      at: "alone",
      exitCode: second.exitCode,
      signal: second.signal,
      passed: second.passed,
    }),
  ]);
  if (!differ) {
    return Object.freeze({ ...first, rerun: second }) as RunnerResult;
  }
  return withCondition(first, "flaky", first.reason, {
    rerun: second,
    observedResults: observed,
  });
}

/** What a second execution of one command is given. */
export type RerunContext = IsolationContext & {
  /** The reading of one end, taken through EP-16: the rerun has its OWN pair. */
  readonly reading?: ProtectedSetPort;
  readonly gateFingerprint?: boolean;
};

/**
 * F148-FR-016 — execute a command once more ALONE, with a pair of fingerprint
 * readings of its own. "Alone" is literal: the member is run on its own, in
 * a batch of one, and the result carries no batch and no slot of a batch of
 * more than one.
 */
export async function rerunAlone(
  member: BatchMember,
  context: RerunContext,
): Promise<RunnerResult> {
  const alone: BatchMember = Object.freeze({ ...member, slot: 0 });
  const run = async (): Promise<RunnerResult> => await runCommand(commandRunOf(alone, context));
  if (context.reading === undefined) {
    const result = await run();
    return withBatchFields(result, { batch: member.batch, slot: 0, concurrent: false });
  }
  const bracketed = await bracketACommand({
    reading: context.reading,
    declaredWrites: member.declaration.writes,
    ...(context.profile === undefined ? {} : { profile: context.profile }),
    ...(context.gateFingerprint === undefined ? {} : { gateFingerprint: context.gateFingerprint }),
    run,
  });
  return withBatchFields(bracketed.result, { batch: member.batch, slot: 0, concurrent: false });
}

/* ------------------------------------------------------------------ *
 * The whole manifest: form, run, bracket, lower, re-execute.
 * ------------------------------------------------------------------ */

/** One event this run produced, in the order it was produced. */
export type BatchRunEvent = AdmissionEvent | ParallelismLoweredEvent;

/** What a run of a whole check manifest gives back. */
export type BatchRun = {
  readonly plan: BatchPlan;
  /** The results, ordered by the position in the manifest. */
  readonly placed: readonly PlacedResult[];
  /** The ids in the order they finished, across the whole run. */
  readonly completionOrder: readonly string[];
  readonly events: readonly BatchRunEvent[];
  readonly lowerings: readonly ParallelismLowering[];
  /** The parallelism in force at the end of the run. */
  readonly parallelism: number;
  readonly failureSignature: string;
  readonly factContribution: FactContribution;
  /** The commands that were executed a second time, alone (F148-FR-016). */
  readonly rerun: readonly string[];
};

/** What a run of a whole check manifest is given. */
export type BatchRunInput = IsolationContext &
  FormationOptions & {
    readonly entries: readonly BatchEntry[];
    /** The reading of one end, taken through EP-16 (feature 116). */
    readonly reading?: ProtectedSetPort;
    readonly gateFingerprint?: boolean;
    readonly phase?: number;
    readonly attempt?: number;
  };

const NO_READING: ProtectedSetPort = () => ({});

/**
 * F148-FR-011 to F148-FR-017 — run a whole check manifest: form the batches,
 * run each to its end with one fingerprint pair around it, taint and lower
 * the parallelism where the readings differ, execute a failed member of a
 * batch of more than one once more alone, and order everything by the
 * position in the manifest.
 *
 * The parallelism is re-read before EVERY batch, so a lowering caused by one
 * batch holds for the rest of the run (F148-FR-014).
 */
export async function runTheCheckManifest(input: BatchRunInput): Promise<BatchRun> {
  const first = formBatches(input.entries, input);
  const parallelism = new RunParallelism(first.parallelism, input.lowered === true);
  const events: BatchRunEvent[] = [];
  const admissions: AdmissionRecord[] = [];
  const batches: Batch[] = [];
  const placed: PlacedResult[] = [];
  const completionOrder: string[] = [];
  const rerun: string[] = [];
  const changed = new Set<string>();

  let done = 0;
  let batchNumber = 0;
  while (done < input.entries.length) {
    // Re-form from the entries that are still to run, at the parallelism in
    // force NOW: a taint of an earlier batch lowers it for the rest of the
    // run (F148-FR-014).
    const remaining = input.entries.slice(done);
    const formed = formBatches(remaining, {
      ...input,
      parallelism: parallelism.configured(),
      lowered: parallelism.lowered(),
    });
    const head = formed.batches[0];
    if (head === undefined) break;
    const members = head.members.map((member) =>
      Object.freeze({ ...member, position: member.position + done, batch: batchNumber }),
    );
    const here: Batch = Object.freeze({
      ...head,
      batch: batchNumber,
      members: Object.freeze(members),
    });
    batches.push(here);

    // F148-FR-012 — every admission to this batch and every refusal from it,
    // each in an event of the type `check.admission`.
    for (const record of formed.admissions) {
      if (record.batch !== head.batch) continue;
      const here = Object.freeze({ ...record, batch: batchNumber });
      admissions.push(here);
      events.push({ type: CHECK_ADMISSION, data: admissionEventData(here) });
    }

    const outcome = await bracketABatch({
      batch: here,
      reading: input.reading ?? NO_READING,
      ...(input.profile === undefined ? {} : { profile: input.profile }),
      gateFingerprint: input.gateFingerprint ?? input.reading !== undefined,
      ...(input.phase === undefined ? {} : { phase: input.phase }),
      ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
      parallelism,
      run: async () => {
        const ran = await runABatch(here, input);
        completionOrder.push(...ran.completionOrder);
        return ran.placed.map((one) => one.result);
      },
    });
    if (outcome.lowering !== null) events.push(parallelismLoweredEvent(outcome.lowering));
    for (const path of outcome.changed) changed.add(path);

    const ordered = orderByManifestPosition(members);
    for (let i = 0; i < ordered.length; i++) {
      const member = ordered[i] as BatchMember;
      let result = outcome.results[i] as RunnerResult;
      // F148-FR-016 — a command that failed in a batch of MORE THAN ONE is
      // executed once more alone, with a fingerprint pair of its own.
      if (here.concurrent && !result.passed) {
        const second = await rerunAlone(member, {
          ...input,
          ...(input.reading === undefined ? {} : { reading: input.reading }),
        });
        result = statedTogether(result, second);
        rerun.push(member.entry.id);
      }
      placed.push({ position: member.position, checkId: member.entry.id, result });
    }
    done += members.length;
    batchNumber += 1;
  }

  const orderedResults = orderByManifestPosition(placed);
  return Object.freeze({
    plan: Object.freeze({
      parallelism: first.parallelism,
      batches: Object.freeze(batches),
      admissions: Object.freeze(admissions),
    }),
    placed: orderedResults,
    completionOrder: Object.freeze([...completionOrder]),
    events: Object.freeze([...events]),
    lowerings: parallelism.lowerings(),
    parallelism: parallelism.value(),
    failureSignature: failureSignature(orderedResults),
    factContribution: factContributionOf({
      placed: orderedResults,
      changed: Object.freeze([...changed].sort()),
    }),
    rerun: Object.freeze([...rerun]),
  });
}

/* ------------------------------------------------------------------ *
 * F148-SC-001: equal results with the values 1 and 3.
 * ------------------------------------------------------------------ */

/**
 * F148-SC-001 — the fields of a result that must NOT depend on the
 * parallelism, and the three that may, each with the reason why.
 */
export const WHY_A_FIELD_MAY_DIFFER: Readonly<Record<string, string>> = Object.freeze({
  durationMs: "a measured time; a command that ran beside another took longer",
  batch: "the number of the batch the command was admitted to",
  slot: "the slot inside that batch",
  concurrent: "whether the command ran beside another, which is the point of the flag",
  rerun:
    "the second execution alone, which exists only for a failed member of a batch of more " +
    "than one (F148-FR-016); it ADDS a reading and changes none",
});

/** The comparable part of one result: everything the parallelism must not change. */
export function comparableResult(result: RunnerResult): Readonly<Record<string, unknown>> {
  return Object.freeze({
    commandId: result.commandId,
    exitCode: result.exitCode,
    signal: result.signal,
    passed: result.passed,
    stdout: result.stdout,
    stderr: result.stderr,
    tainted: result.tainted,
    cached: result.cached,
    flaky: result.flaky,
    interrupted: result.interrupted,
    unchecked: result.unchecked,
    reason: result.reason,
    error: result.error,
    statedAsPass: statedAsPass(result),
  });
}

/** The comparable part of a whole run: results, signature and fact contribution. */
export function comparableRun(run: BatchRun): Readonly<Record<string, unknown>> {
  return Object.freeze({
    results: run.placed.map((one) => comparableResult(one.result)),
    failureSignature: run.failureSignature,
    factContribution: run.factContribution,
  });
}
