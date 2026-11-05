/**
 * T034 — the validation order and the verdicts (F107-FR-013, F107-FR-018,
 * F107-FR-022; C-218).
 *
 * The order of validation, and the calls of the staleness verdict and of the
 * learning binding:
 *
 *  1. the composed schema (T005) — the record schema of feature 100 joined by
 *     reference with the item schemas of T003, and the one post-schema rule of
 *     research.md row 14;
 *  2. the post-schema rules of T033 (`rules.ts`) and the supervision ceilings
 *     of T036 (`supervision.ts`) — exit 20;
 *  3. the structural rules of the learning binding, through its port
 *     (`ports.ts` port 2) — exit 20 with the class `learning`;
 *  4. the staleness verdict — the ONE classification of the canonical hasher
 *     of feature 104 (`classifySources` and `verdictOf`), never a comparison
 *     written here — exit 23 with the list of changed and unreadable sources;
 *  5. the refusals of the learning binding — exit 23.
 *
 * `--no-source-check` skips ONLY step 4. `--allow-draft` skips the nine
 * readiness rules of F107-FR-022 and nothing structural.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { classifySources, verdictOf } from "@specstride/kernel";
import { contentHash, taskListHashIgnoringCheckboxesOfBytes } from "@specstride/kernel";
import type { ClassifiedSource } from "@specstride/kernel";

import { validateLaunchContract, type ComposedError } from "./compose.ts";
import {
  postSchemaRules,
  isSkippedByAllowDraft,
  resolveContractPath,
  type ValidationProblem,
  type RulesContext,
} from "./rules.ts";
import { supervisionProblems, type SupervisionCeilings, resolvedCeilings } from "./supervision.ts";
import { stampMatches } from "../promote/promote.ts";
import type { LearningBindingRulesPort } from "../ports.ts";
import { declarationProblems } from "./declarations.ts";

/** The stages of the validation order, in order (F107-FR-013). */
export const VALIDATION_ORDER: readonly string[] = Object.freeze([
  "composed-schema",
  "post-schema-rules",
  "supervision-ceilings",
  "learning-binding-structural",
  "staleness-verdict",
  "learning-binding-refusals",
]);

/** The options of one validation, as the command computes them from flags. */
export type ValidationOptions = {
  readonly root: string;
  readonly stageKinds: RulesContext["stageKinds"];
  readonly checks: RulesContext["checks"];
  readonly allowDraft: boolean;
  readonly noSourceCheck: boolean;
  /** True when `--promote` runs: the status readiness is what promotion writes. */
  readonly promoting?: boolean | undefined;
  readonly learning?: LearningBindingRulesPort | undefined;
  readonly ceilings?: SupervisionCeilings | undefined;
};

/** What one validation found. */
export type ValidationOutcome = {
  readonly problems: readonly ValidationProblem[];
  readonly composedErrors: readonly ComposedError[];
  /** The sources that are `changed` or `unreadable`, when the verdict is stale. */
  readonly changed: readonly ClassifiedSource[];
  readonly verdict: "fresh" | "stale" | "not-checked";
  /** The exit the outcome carries: 0, 20 or 23. */
  readonly exit: 0 | 20 | 23;
};

/** The problems the readiness of execution, skipped by `--allow-draft`. */
function filtered(
  problems: readonly ValidationProblem[],
  allowDraft: boolean,
): ValidationProblem[] {
  return allowDraft ? problems.filter((one) => !isSkippedByAllowDraft(one)) : [...problems];
}

/** The staleness readings of the sources of one launch contract. */
export function stalenessReadings(
  record: {
    readonly sources: readonly {
      readonly path: string;
      readonly kind: string;
      readonly sha256: string;
      readonly semantic_sha256?: string;
    }[];
  },
  root: string,
): readonly { reading: Parameters<typeof classifySources>[0][number]; path: string }[] {
  return record.sources.map((source) => {
    const resolved = resolveContractPath(root, source.path);
    const path = resolved.ok ? resolved.physical : join(root, source.path);
    let now: string | undefined;
    let nowIgnoringCheckboxes: string | undefined;
    try {
      const bytes = readFileSync(path);
      now = contentHash(bytes);
      if (source.kind === "tasks") {
        nowIgnoringCheckboxes = taskListHashIgnoringCheckboxesOfBytes(bytes);
      }
    } catch {
      now = undefined;
    }
    return {
      reading: {
        logicalName: source.kind,
        repositoryPath: source.path,
        recordedHash: source.sha256,
        recordedHashIgnoringCheckboxes: source.semantic_sha256,
        hashNow: now,
        hashNowIgnoringCheckboxes: nowIgnoringCheckboxes,
      },
      path,
    };
  });
}

/**
 * F107-FR-013, in order — one validation of one launch contract record.
 * `record` must be the record AS WRITTEN ON DISK, before any normalization.
 */
export function validateInOrder(record: unknown, options: ValidationOptions): ValidationOutcome {
  const ceilings = options.ceilings ?? resolvedCeilings();
  const ctx: RulesContext = {
    root: options.root,
    stageKinds: options.stageKinds,
    checks: options.checks,
    allowDraft: options.allowDraft,
  };

  // A `validated` record whose promotion stamp no longer matches the record
  // as written on disk is treated as `draft`: the promotion is lost the
  // moment the file changed after it was written (F107-FR-019).
  let judged: Record<string, unknown> | undefined;
  if (
    (record as { status?: unknown }).status === "validated" &&
    !stampMatches(record as Record<string, unknown>)
  ) {
    judged = { ...(record as Record<string, unknown>) };
    judged.status = "draft";
    delete judged.promotion;
  }
  const subject = judged ?? record;

  // 1. The composed schema.
  const composed = validateLaunchContract(subject);
  if (!composed.ok) {
    return {
      problems: [],
      composedErrors: composed.errors,
      changed: [],
      verdict: "not-checked",
      exit: 20,
    };
  }
  const typed = composed.record as unknown as Parameters<typeof postSchemaRules>[0];

  // 2. The post-schema rules and the supervision ceilings (exit 20), and the
  //    content rules of the declarations of F107-FR-037 (T054).
  const raw = [
    ...postSchemaRules(typed, ctx),
    ...(declarationProblems(typed) as ValidationProblem[]),
    ...(supervisionProblems(
      typed as unknown as Parameters<typeof supervisionProblems>[0],
      ceilings,
    ) as ValidationProblem[]),
  ];
  // `--promote` runs the rules STRICTLY, except the one readiness promotion
  // itself is what settles: the status `validated` (F107-FR-021).
  const problems = filtered(
    options.promoting === true
      ? raw.filter((one) => !(one.rule === "identity" && one.path === "/status"))
      : raw,
    options.allowDraft,
  );

  // 3. The structural rules of the learning binding, through its port.
  if (options.learning !== undefined) {
    const verdict = options.learning.validate({
      configuration: (typed as { configuration?: Record<string, unknown> }).configuration as never,
    });
    for (const finding of verdict.structural) {
      problems.push({
        rule: finding.rule,
        path: "/configuration/learning",
        message: finding.message,
        class: "structure",
        exit: 20,
      });
    }
    if (problems.length > 0) {
      return { problems, composedErrors: [], changed: [], verdict: "not-checked", exit: 20 };
    }

    // 5. The refusals of the binding — but only past the staleness verdict,
    //    which stands between them and everything structural.
    const staleness = stalenessOutcome(typed, options);
    if (staleness.exit === 23) return staleness;
    const refusalProblems: ValidationProblem[] = verdict.refusals.map((one) => ({
      rule: "learning-binding",
      path: "/configuration/learning",
      message: one.message,
      class: "structure",
      exit: 23 as const,
    }));
    if (refusalProblems.length > 0) {
      return {
        problems: refusalProblems,
        composedErrors: [],
        changed: staleness.changed,
        verdict: staleness.verdict,
        exit: 23,
      };
    }
    return { problems: [], composedErrors: [], changed: [], verdict: staleness.verdict, exit: 0 };
  }

  if (problems.length > 0) {
    return { problems, composedErrors: [], changed: [], verdict: "not-checked", exit: 20 };
  }

  // 4. The staleness verdict through the canonical hasher (exit 23).
  return stalenessOutcome(typed, options);
}

/** The staleness verdict over the sources of the contract (F107-FR-018). */
function stalenessOutcome(typed: unknown, options: ValidationOptions): ValidationOutcome {
  if (options.noSourceCheck) {
    return { problems: [], composedErrors: [], changed: [], verdict: "not-checked", exit: 0 };
  }
  const record = typed as {
    sources: readonly { path: string; kind: string; sha256: string; semantic_sha256?: string }[];
  };
  const readings = stalenessReadings(record, options.root).map((one) => one.reading);
  const classified = classifySources(readings);
  const verdict = verdictOf(classified);
  if (verdict === "fresh") {
    return { problems: [], composedErrors: [], changed: [], verdict: "fresh", exit: 0 };
  }
  const changed = classified.filter((one) => one.state === "changed" || one.state === "unreadable");
  return {
    problems: changed.map((one) => ({
      rule: "staleness",
      path: `/sources/${one.index}`,
      message: `sources[${one.index}] hash changed: ${one.path}`,
      class: "structure" as const,
      exit: 23 as const,
    })),
    composedErrors: [],
    changed,
    verdict: "stale",
    exit: 23,
  };
}
