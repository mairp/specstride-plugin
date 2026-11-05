/**
 * T102 — the interface types of EP-03, the spec-format adapter, from
 * `contracts/extension-points/EP-03.spec-format.json` and annex C, §C.7
 * (F100-FR-095, F100-FR-096).
 *
 * `specstride.spec-format/1`. One grammar owner serves the engine, the
 * critic, derivation of the launch contract, the CLI, the doctor and the UI;
 * a second parser does not exist.
 */
import type { CanonicalSpecModel } from "../records/canonical-spec-model.ts";

export const POINT_ID = "specstride.spec-format/1" as const;
export const EP = "EP-03" as const;
export const ANNEX_SECTION = "annex C, §C.7" as const;

/** F100-FR-095 — the five operations of the port. */
export const OPERATIONS = ["detect", "parse", "validate", "tick", "inputs"] as const;
export type SpecFormatOperation = (typeof OPERATIONS)[number];

/** The errors of §C.7, with the exit code each leads to. */
export const ERRORS = ["invalid-spec", "ambiguous-candidates", "unknown-format"] as const;
export type SpecFormatError = (typeof ERRORS)[number];

export const ERROR_EXIT_CODES: Readonly<Record<SpecFormatError, number>> = Object.freeze({
  "invalid-spec": 3,
  "ambiguous-candidates": 3,
  "unknown-format": 3,
});

/** F100-FR-096 — the format names of the Specstride baseline. */
export const FORMAT_NAMES = ["native", "speckit-tasks", "openspec-change"] as const;
export type FormatName = (typeof FORMAT_NAMES)[number];

/** F100-FR-096 — `openspec` is accepted as an alias of `openspec-change`. */
export const FORMAT_ALIASES: Readonly<Record<string, FormatName>> = Object.freeze({
  openspec: "openspec-change",
});

/** Resolve a format name through the aliases; `undefined` is `unknown-format`. */
export function resolveFormatName(name: string): FormatName | undefined {
  if ((FORMAT_NAMES as readonly string[]).includes(name)) return name as FormatName;
  return FORMAT_ALIASES[name];
}

/** F100-FR-096 — the detection order, which is the as-is order. */
export const DETECTION_ORDER = ["explicit override", "file name", "content"] as const;

/** Built-in formats win; a new format is detected only where they decline. */
export const BUILT_IN_FORMATS_WIN = true as const;

/** The input of `detect`: a path and the head of its content. */
export type DetectInput = { readonly path: string; readonly head: string };

/** The output of `detect`: whether the adapter claims the path, and its priority. */
export type DetectResult = { readonly claims: boolean; readonly priority: number };

/** The kinds of source a canonical model names (§C.7, the field table). */
export const SOURCE_KINDS = ["spec", "plan", "tasks"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number] | string;

/** One source with its hashes, as `inputs` reports it. */
export type SourceInput = {
  readonly kind: SourceKind;
  readonly path: string;
  /** The content hash from the canonical hasher of annex X §X.5. */
  readonly contentHash: string;
  /** For a task list, the hash that ignores checkboxes. */
  readonly hashIgnoringCheckboxes?: string;
};

/** One finding of `validate`. */
export type SpecFinding = {
  readonly severity: "warn" | "fail";
  readonly message: string;
  readonly path?: string;
  readonly line?: number;
};

/** What `tick` is asked to tick: task ids, or a phase number. */
export type TickRequest = { readonly taskIds: readonly string[] } | { readonly phase: number };

/** The checkboxes `tick` edited, in place. */
export type TickResult = {
  readonly ticked: readonly { readonly taskId: string; readonly line: number }[];
  /** `tick` changes checkboxes only and keeps every other byte. */
  readonly otherBytesChanged: false;
};

/** F100-FR-095 — the spec-format port. */
export type SpecFormatPort = {
  detect(input: DetectInput): DetectResult;
  parse(files: readonly string[]): CanonicalSpecModel;
  validate(model: CanonicalSpecModel): readonly SpecFinding[];
  tick(request: TickRequest): TickResult;
  inputs(): readonly SourceInput[];
};

/** "Failure of an implementation" of §C.7, as data. */
export const FAILURE_PATHS: Readonly<Record<SpecFormatOperation, string>> = Object.freeze({
  detect: "the spec-format adapter is passed over",
  parse: "`invalid-spec`",
  validate: "`invalid-spec`",
  tick: "the file is left unchanged and it is reported; it never undoes an approval",
  inputs: "`invalid-spec`",
});

/** "Unknown-value rule" of §C.7: an unknown task marker is kept as text. */
export const UNKNOWN_TASK_MARKER_IS_KEPT_AS_TEXT = true as const;

/** The position at which a run resumes is derived by the engine, never here. */
export const DERIVES_THE_RESUME_POSITION = false as const;
