/**
 * T017 — the caller errors of F104-FR-018.
 *
 * A caller that reads the canonical model gets ONE error kind for each
 * failure, and maps it to its OWN result code 3. The four failures the
 * requirement names, with their as-is texts:
 *
 *  | failure                 | text                             | record |
 *  |-------------------------|----------------------------------|--------|
 *  | the spec file is missing| `specs not found: <path>`        | B-0795, B-0861 |
 *  | the phase is not found  | `phase <N> not found in <specs>` | B-0796, B-0863 |
 *  | the format is invalid   | F104-FR-006                      | B-0802, B-0862 |
 *  | the file cannot be read | `spec: <operating-system error>`  | B-2000 |
 *
 * Two texts that look alike are DISTINCT and the requirement says so: the
 * critic's `specs not found: <path>` (its flag is `--specs`, B-0795) and the
 * spec module's `spec not found: <path>` of F104-FR-015 (B-2000's neighbour).
 * `SPEC_MODULE_NOT_FOUND` and `CALLER_SPECS_NOT_FOUND` hold the two forms so
 * that a test can measure that they differ rather than trust a reading.
 *
 * These codes are FIELDS of result records and not processes of their own
 * (layering rule LR-6): nothing here exits, writes or logs. A caller catches
 * the error, reads `kind` and `resultCode`, and fills its own record.
 */
import { featureSlug, type FeatureSlug } from "./slug.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F104-FR-018"] as const;

/** The records of the baseline the texts are taken from. */
export const BEHAVIOUR_ROWS = Object.freeze([
  "B-0795",
  "B-0796",
  "B-0802",
  "B-0861",
  "B-0862",
  "B-0863",
  "B-2000",
]);

/** The result code every caller error maps to (F104-FR-018, F104-FR-020). */
export const RESULT_CODE_OF_A_CALLER_ERROR = 3 as const;

/** LR-6: a caller error is a field of a result record, never a process. */
export const IS_A_FIELD_OF_A_RESULT_RECORD = true as const;

/** The four failures of F104-FR-018, as the names this module uses for them. */
export const CALLER_FAILURES = [
  "missing-spec-file",
  "phase-not-found",
  "invalid-format",
  "unreadable-file",
] as const;
export type CallerFailure = (typeof CALLER_FAILURES)[number];

/**
 * The error kind of row 99 of annex X §X.6 each failure carries. An invalid
 * format is `unknown-format`; the other three are `invalid-spec`. The kind is
 * what EP-03 names; the failure above is what this feature calls the case.
 */
export const KIND_OF_A_FAILURE: Readonly<Record<CallerFailure, string>> = Object.freeze({
  "missing-spec-file": "invalid-spec",
  "phase-not-found": "invalid-spec",
  "invalid-format": "unknown-format",
  "unreadable-file": "invalid-spec",
});

/** The critic's text for a spec file that is not a file (B-0795). */
export function callerSpecsNotFound(path: string): string {
  return `specs not found: ${path}`;
}

/** The spec module's text of F104-FR-015, which is NOT the critic's (B-2000). */
export function specModuleNotFound(path: string): string {
  return `spec not found: ${path}`;
}

/** The two forms, kept apart so that a test can measure that they differ. */
export const CALLER_SPECS_NOT_FOUND = "specs not found: " as const;
export const SPEC_MODULE_NOT_FOUND = "spec not found: " as const;

/** The base of every caller error: a kind, a failure and the result code 3. */
export abstract class SpecCallerError extends Error {
  /** The error kind of row 99 of annex X §X.6. */
  abstract readonly kind: string;
  /** Which of the four failures of F104-FR-018 this is. */
  abstract readonly failure: CallerFailure;
  /** The code 3 of the caller's own result record (LR-6). */
  readonly resultCode = RESULT_CODE_OF_A_CALLER_ERROR;
}

/**
 * A spec file that is missing, as the CALLER sees it: `specs not found: <path>`
 * (B-0795, B-0861). The critic's flag is `--specs`, which is where the plural
 * comes from.
 */
export class SpecsNotFoundError extends SpecCallerError {
  readonly kind = "invalid-spec" as const;
  readonly failure = "missing-spec-file" as const;
  readonly path: string;
  constructor(path: string) {
    super(callerSpecsNotFound(path));
    this.name = "SpecsNotFoundError";
    this.path = path;
  }
}

/** A phase the model cannot find: `phase <N> not found in <specs>` (B-0796, B-0863). */
export class PhaseNotFoundError extends SpecCallerError {
  readonly kind = "invalid-spec" as const;
  readonly failure = "phase-not-found" as const;
  readonly phase: number;
  readonly specs: string;
  constructor(phase: number, specs: string) {
    super(`phase ${phase} not found in ${specs}`);
    this.name = "PhaseNotFoundError";
    this.phase = phase;
    this.specs = specs;
  }
}

/**
 * A file that cannot be read: `spec: <operating-system error>` (B-2000). The
 * message of the operating system is carried through as it came, because the
 * requirement names it as the text.
 */
export class UnreadableSpecError extends SpecCallerError {
  readonly kind = "invalid-spec" as const;
  readonly failure = "unreadable-file" as const;
  readonly path: string;
  readonly operatingSystemError: string;
  constructor(path: string, cause: unknown) {
    const text = operatingSystemMessage(cause);
    super(`spec: ${text}`);
    this.name = "UnreadableSpecError";
    this.path = path;
    this.operatingSystemError = text;
    if (cause !== undefined) this.cause = cause;
  }
}

/** The message of the operating system, as `node:fs` reports it. */
export function operatingSystemMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * An explicit format that is no registered format and no alias (F104-FR-006).
 * It lives here because it is one of the four failures of F104-FR-018;
 * `registry.ts` re-exports it, so that the module that raises it and the module
 * that lists the caller errors are the same class.
 */
export class UnknownFormatError extends SpecCallerError {
  readonly kind = "unknown-format" as const;
  readonly failure = "invalid-format" as const;
  /** The names of the registry, in registration order; the alias is not among them. */
  readonly registered: readonly string[];
  /** The value as the caller wrote it; it is never guessed at (F104-FR-006). */
  readonly value: string;
  constructor(value: string, registered: readonly string[]) {
    // The as-is text of F104-FR-006.
    super(`spec: unknown spec format: ${value} (${registered.join(", ")})`);
    this.name = "UnknownFormatError";
    this.value = value;
    this.registered = Object.freeze([...registered]);
  }
}

/** The result code of any caller error; anything else is not one of the four. */
export function resultCodeOf(error: unknown): number | undefined {
  return error instanceof SpecCallerError ? error.resultCode : undefined;
}

/** True when the error is one of the four failures of F104-FR-018. */
export function isACallerError(error: unknown): error is SpecCallerError {
  return error instanceof SpecCallerError;
}

/**
 * The critic's feature slug (F104-FR-018): `--feature`, else the key
 * `spec.feature`, else the location of the spec — by the rule of F104-FR-003,
 * which `slug.ts` owns. The critic derives no slug of its own (B-0806).
 */
export function criticFeatureSlug(
  request: {
    readonly featureFlag?: string | undefined;
    readonly featureKey?: string | undefined;
    readonly specPath?: string | undefined;
  },
  options: { readonly exists?: (path: string) => boolean } = {},
): FeatureSlug {
  const explicit =
    request.featureFlag !== undefined && request.featureFlag !== ""
      ? request.featureFlag
      : request.featureKey;
  return featureSlug({ explicit, specPath: request.specPath }, options);
}

/** The order the critic reads the feature from (F104-FR-018). */
export const CRITIC_FEATURE_ORDER = ["--feature", "spec.feature", "the spec location"] as const;
