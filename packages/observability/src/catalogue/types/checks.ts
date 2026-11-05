/**
 * T025 — the `data` schemas of the types of F111-FR-008: verification and long
 * work.
 *
 * *`check.started` and `check.ended` MUST be written for every check whoever
 * runs it (`runner`: `runtime` or `proposer`), with the command by reference,
 * the duration and the result; `check.started` MUST also carry the
 * verification batch and the slot of the command (`batch`, `slot`), and
 * `check.ended` those two and `concurrent`, which says whether the command ran
 * beside another because the parallelism was lowered. The checks of the
 * micro-loop layer MUST use the same events. `job.step`, `job.first_failure`
 * and `job.ended` with `msAfterFirstFailure` MUST be written for a long job.
 * `resource.wait` MUST be written when a check or a job waits on a declared
 * exclusive resource. `microloop.unit` MUST carry the unit, the result
 * (`kept`, `repair`, `unresolved`, row 136) and, where the layer went off, in
 * `layerOff` the cause that the ledger record `disengaged` of feature 115
 * carries ... and in `fallbackReason` the fallback reason of annex X §X.6 row
 * 59 where one applies (`no-check`, `single-unit`), else null. While the layer
 * stays on, both fields MUST be null.*
 *
 * The seven causes of `layerOff` are the reading N-111-1 of `spec.md`: no
 * closed set of the product holds them yet, and feature 100 is to append a row
 * of annex X §X.6 for them. They are written here as a list with that
 * assumption recorded, and the FALLBACK reasons they may go with are read from
 * row 59, which does exist.
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import {
  refine,
  CONTENT_REFERENCE_FIELD,
  COUNT,
  COUNT_OR_NULL,
  FLAG,
  TEXT,
  TEXT_OR_NULL,
  type TypeRefinement,
} from "./refinement.ts";

/** The two runners of a check (F111-FR-008). */
export const CHECK_RUNNERS = ["runtime", "proposer"] as const;

/** The outcomes of a unit of work: annex X §X.6 row 136. */
export const MICROLOOP_RESULTS: readonly string[] = Object.freeze([
  ...(closedSet(136)?.members ?? []),
]);

/**
 * The seven causes the ledger record `disengaged` of feature 115 carries
 * (`assumption: N-111-1`; owner 115; a row of annex X §X.6 to be appended).
 */
export const LAYER_OFF_CAUSES = [
  "caps",
  "integrity",
  "check-error",
  "no-check",
  "single-unit",
  "layer-error",
  "breach",
] as const;

/** The fallback reasons of the layer `micro`: annex X §X.6 row 59. */
export const FALLBACK_REASONS: readonly string[] = Object.freeze([
  ...(closedSet(59)?.members ?? []),
]);

/** The two causes that go with a fallback reason of the same name. */
export const FALLBACK_CAUSES = ["no-check", "single-unit"] as const;

/**
 * The findings of one `microloop.unit` against F111-FR-008. While the layer
 * stays ON, both fields are null; a fallback reason without a cause is a
 * fallback nobody can account for.
 */
export function microloopFindings(data: Readonly<Record<string, unknown>>): readonly string[] {
  const findings: string[] = [];
  const off = data.layerOff ?? null;
  const fallback = data.fallbackReason ?? null;
  if (off === null && fallback !== null) {
    findings.push(
      "while the layer stays on, `layerOff` and `fallbackReason` are both null; " +
        `this unit carries a fallbackReason of ${JSON.stringify(fallback)} and no layerOff`,
    );
  }
  if (
    fallback !== null &&
    typeof off === "string" &&
    !(FALLBACK_CAUSES as readonly string[]).includes(off)
  ) {
    findings.push(
      `a fallback reason applies to the causes ${FALLBACK_CAUSES.join(" and ")}; ` +
        `the layer went off for ${off}`,
    );
  }
  return Object.freeze(findings);
}

/** The refinements of F111-FR-008. */
export const REFINEMENTS: readonly TypeRefinement[] = Object.freeze([
  refine({
    requirement: "F111-FR-008",
    type: "check.started",
    required: ["checkId", "commandRef", "runner", "batch", "slot"],
    fields: {
      checkId: TEXT,
      commandRef: CONTENT_REFERENCE_FIELD,
      runner: { enum: CHECK_RUNNERS },
      batch: COUNT,
      slot: COUNT,
    },
    note: "the checks of the micro-loop layer use the same events",
  }),
  refine({
    requirement: "F111-FR-008",
    type: "check.ended",
    required: ["checkId", "result", "durationMs", "batch", "slot", "concurrent"],
    fields: {
      checkId: TEXT,
      result: TEXT,
      durationMs: COUNT,
      batch: COUNT,
      slot: COUNT,
      concurrent: FLAG,
    },
  }),
  refine({
    requirement: "F111-FR-008",
    type: "job.step",
    required: ["jobId", "cycle", "stepTs"],
    fields: { jobId: TEXT, cycle: COUNT, stepTs: TEXT },
  }),
  refine({
    requirement: "F111-FR-008",
    type: "job.first_failure",
    required: ["jobId", "failedAt"],
    fields: { jobId: TEXT, failedAt: TEXT },
  }),
  refine({
    requirement: "F111-FR-008",
    type: "job.ended",
    required: ["msAfterFirstFailure"],
    fields: { msAfterFirstFailure: COUNT_OR_NULL, logRef: CONTENT_REFERENCE_FIELD },
  }),
  refine({
    requirement: "F111-FR-008",
    type: "resource.wait",
    required: ["resource", "holder", "ms"],
    fields: { ms: COUNT },
  }),
  refine({
    requirement: "F111-FR-008",
    type: "microloop.unit",
    required: ["unitId", "result", "layerOff", "fallbackReason"],
    fields: {
      unitId: TEXT,
      check: TEXT_OR_NULL,
      result: { enum: MICROLOOP_RESULTS },
      layerOff: {
        type: ["string", "null"],
        enum: [...LAYER_OFF_CAUSES],
        note: "assumption N-111-1: the seven causes of the ledger record `disengaged`",
      },
      fallbackReason: {
        type: ["string", "null"],
        enum: FALLBACK_REASONS,
        note: "annex X §X.6 row 59, where one applies; else null",
      },
    },
    rules: [
      {
        name: "the-layer-is-on-or-a-cause-is-named",
        check: (data) => microloopFindings(data)[0] ?? null,
      },
    ],
  }),
]);
