/**
 * T089 — the validation of a loaded plan (F105-FR-013), and the staleness
 * check of the source hash the same code path makes (F105-FR-012,
 * F105-FR-042).
 *
 * A plan is validated WHENEVER IT IS LOADED, and every refusal is a
 * verification error with the code 3. The checks, in the order the baseline
 * makes them (`lib/verification_plan.py`:1055):
 *
 *  1. the eleven fields the baseline requires are present;
 *  2. the kind is `verification-plan` and the version is 1;
 *  3. `project.workdir` and `source.specPath` are absolute;
 *  4. every command has an absolute executable and an absolute working
 *     directory;
 *  5. the recorded `contentHash` equals the computed one, else
 *     `verification plan hash mismatch`;
 *  6. where a specification is given: `source.specPath` is its real path,
 *     else `verification plan source mismatch`; and the hash of its
 *     projection equals `source.contentHash`, else the plan is STALE.
 *
 * The projection is part of the comparison: a plan that names NO projection is
 * checked by the older raw-text rule, and a plan whose projection name this
 * build cannot reproduce is refused with `unsupported source projection`
 * (F105-FR-012).
 */
import { isAbsolute } from "node:path";
import { planContentHash } from "./hash.ts";
import {
  SPEC_PROJECTION,
  specProjectionHash,
  specSourceTextHash,
  type CriterionNormalizer,
  type ProjectionPhaseInput,
} from "./projection.ts";
import { PLAN_KIND, PLAN_VERSION, VerificationError, type VerificationPlan } from "./record.ts";

/** The eleven fields the baseline requires of a plan (`:1056`). */
export const REQUIRED_PLAN_FIELDS = [
  "id",
  "kind",
  "version",
  "source",
  "project",
  "obligations",
  "commands",
  "suites",
  "gates",
  "contentHash",
] as const;

/** The refusal of a plan whose recorded hash differs (F105-FR-013). */
export const HASH_MISMATCH = "verification plan hash mismatch" as const;
/** The refusal of a plan whose `source.specPath` differs (F105-FR-013). */
export const SOURCE_MISMATCH = "verification plan source mismatch" as const;
/** The refusal of a plan whose source hash moved (F105-FR-042). */
export const STALE = "verification plan is stale" as const;
/** The refusal of a projection this build cannot reproduce (F105-FR-012). */
export const UNSUPPORTED_PROJECTION_PREFIX =
  "verification plan was hashed with an unsupported source projection" as const;

/** The spec a validation compares the plan against, as the model gives it. */
export type ExpectedSpec = {
  /** The real path of the specification (`os.path.realpath`). */
  readonly realPath: string;
  /** The format the adapter resolved; part of the projection. */
  readonly format: string;
  /** The phases of the canonical spec model (EP-03). */
  readonly phases: readonly ProjectionPhaseInput[];
  /** The raw text, for the OLDER rule of a plan with no projection. */
  readonly text: string;
  /**
   * The hash of the task list that ignores checkboxes, as the canonical spec
   * model carries it (`SpecSource.hashIgnoringCheckboxes`, annex C §C.7). It
   * is what the OLDER rule of F105-FR-012 compares; where the caller gives
   * none, the canonical hasher's own operation is used over `text` — the one
   * module F104-SC-001 permits to hold the mark rule.
   */
  readonly hashIgnoringCheckboxes?: string | undefined;
  /** How the text of a criterion is read; `TRIM_ONLY` by default. */
  readonly criterionText?: CriterionNormalizer | undefined;
};

/**
 * Validate a plan (F105-FR-013). `expected` is given where the caller hands
 * the specification together with the plan — which, under the `parity`
 * profile, is every step of the engine the baseline hands both to
 * (F105-FR-042).
 */
export function validatePlan(plan: unknown, expected?: ExpectedSpec | undefined): VerificationPlan {
  if (plan === null || typeof plan !== "object" || Array.isArray(plan)) {
    throw new VerificationError("JSON document must be an object");
  }
  const record = plan as Record<string, unknown>;
  const missing = REQUIRED_PLAN_FIELDS.filter((key) => !(key in record));
  if (missing.length > 0) {
    throw new VerificationError(`verification plan is missing fields: ${missing.join(", ")}`);
  }
  if (record["kind"] !== PLAN_KIND || record["version"] !== PLAN_VERSION) {
    throw new VerificationError("unsupported verification plan kind/version");
  }
  const project = (record["project"] ?? {}) as Record<string, unknown>;
  const workdir = typeof project["workdir"] === "string" ? project["workdir"] : "";
  if (!isAbsolute(workdir)) {
    throw new VerificationError("verification plan workdir must be absolute");
  }
  const source = (record["source"] ?? {}) as Record<string, unknown>;
  const specPath = typeof source["specPath"] === "string" ? source["specPath"] : "";
  if (!isAbsolute(specPath)) {
    throw new VerificationError("verification plan specPath must be absolute");
  }
  const commands = Array.isArray(record["commands"]) ? (record["commands"] as unknown[]) : [];
  for (const one of commands) {
    const command = (one ?? {}) as Record<string, unknown>;
    const id = typeof command["id"] === "string" ? command["id"] : "?";
    if (!isAbsolute(typeof command["executable"] === "string" ? command["executable"] : "")) {
      throw new VerificationError(`verification command executable must be absolute: ${id}`);
    }
    if (!isAbsolute(typeof command["cwd"] === "string" ? command["cwd"] : "")) {
      throw new VerificationError(`verification command cwd must be absolute: ${id}`);
    }
  }
  const recorded = record["contentHash"];
  const computed = planContentHash(record);
  if (recorded !== computed) {
    throw new VerificationError(
      `${HASH_MISMATCH}: recorded ${String(recorded)} computed ${computed}`,
    );
  }
  if (expected !== undefined) {
    if (specPath !== expected.realPath) {
      throw new VerificationError(
        `${SOURCE_MISMATCH}: expected ${expected.realPath} got ${specPath}`,
      );
    }
    const actual = hashOfTheSourceAsThePlanWasHashed({ plan: record, expected });
    if (actual !== source["contentHash"]) {
      throw new VerificationError(
        `${STALE}: expected source hash ${String(source["contentHash"])} got ${actual}`,
      );
    }
  }
  return record as unknown as VerificationPlan;
}

/**
 * The hash of the specification AS THE PLAN WAS HASHED (F105-FR-012): the
 * projection where the plan names `tasks-v2`, the older raw-text rule where it
 * names none, and a refusal where it names a projection this build cannot
 * reproduce.
 */
export function hashOfTheSourceAsThePlanWasHashed(input: {
  readonly plan: Readonly<Record<string, unknown>>;
  readonly expected: ExpectedSpec;
}): string {
  const source = (input.plan["source"] ?? {}) as Record<string, unknown>;
  const projection = source["projection"];
  if (projection === undefined || projection === null) {
    // A plan written before the projection rule: checked the way it was
    // hashed, over the task list with its ticks read as unticked. The hash is
    // the canonical spec model's where the caller has it, and otherwise the
    // canonical hasher's over the text.
    return input.expected.hashIgnoringCheckboxes ?? specSourceTextHash(input.expected.text);
  }
  if (projection !== SPEC_PROJECTION) {
    throw new VerificationError(
      `${UNSUPPORTED_PROJECTION_PREFIX}: ${String(projection)} ` +
        `(this build writes ${SPEC_PROJECTION})`,
    );
  }
  return specProjectionHash({
    format: input.expected.format,
    phases: input.expected.phases,
    ...(input.expected.criterionText !== undefined
      ? { criterionText: input.expected.criterionText }
      : {}),
  });
}

/**
 * Load a plan from an ABSOLUTE place and validate it (F105-FR-013). The place
 * of the plan itself must be absolute; `read` is the one file read, injected,
 * so a caller of this package decides how a file is read.
 */
export function loadPlan(input: {
  readonly path: string;
  readonly read: (path: string) => string;
  readonly expected?: ExpectedSpec | undefined;
}): VerificationPlan {
  if (!isAbsolute(input.path)) {
    throw new VerificationError(`verification plan path must be absolute: ${input.path}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(input.read(input.path)) as unknown;
  } catch (error) {
    throw new VerificationError(`cannot read JSON ${input.path}: ${String(error)}`);
  }
  return validatePlan(value, input.expected);
}

/** True where a plan passes validation; it never throws. */
export function planIsValid(plan: unknown, expected?: ExpectedSpec | undefined): boolean {
  try {
    validatePlan(plan, expected);
    return true;
  } catch {
    return false;
  }
}

/** The word the public command `validate` prints on success (F105-FR-039). */
export const VALID_LINE = "valid" as const;
