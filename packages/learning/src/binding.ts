/**
 * T048/T049 — the binding of the decision log into the launch contract
 * (F106-FR-027, F106-FR-028, F106-FR-029) and the rules validation applies
 * (annex G §G.8; the learning class, annex X §X.6 row 274).
 *
 * Derivation (`deriveLearningBlock`): the block `configuration.learning`
 * holds exactly `mode`, `decisions_through`, `decisions_sha256`, `effective`
 * and `source_path`. `decisions_through` is the run id of the last log line
 * that has a text `run_id`, whatever its action. `decisions_sha256` is the
 * content hash (SHA-256, 64 hexadecimal digits in lower case, annex X §X.5)
 * of the bytes of the log up to and including the first line whose `run_id`
 * equals `decisions_through`, its line end included. `effective` maps each
 * knob to a map from the phase number, as text, to the value of the last
 * bound decision per (knob, phase, shape) that is not a `revert`, not
 * clamped. `source_path` is the logical name of the log,
 * `feature:<slug>:learning:decisions`, never an absolute path. The block is
 * omitted when the log is absent or no line has a run id. The derivation
 * takes the mode by option (`--learning-mode`, default `off`) and the path of
 * the log by option (`--applied-file`).
 *
 * Validation (`validateLearningBinding`): one exported function that returns
 * the structural findings of F106-FR-028 and F106-FR-029 — the class
 * `learning`, exit 20 — and, only when no structural error exists, the two
 * refusals of a changed or lost prefix, exit 23, reason
 * `LearningDecisionsChanged`. Validation of the launch contract (feature 107)
 * calls this function; it owns no rule of the binding itself.
 *
 * Purity: the environment is never read here; the stage declarations are read
 * from the contract handed in.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import {
  isModeLiteral,
  LEARNING_MODE_KEY,
  LEARNING_PINNABLE_KEYS,
  LEARNING_THROUGH_KEY,
  type LearningMode,
} from "./mode.ts";
import { entryShape, isDecision, toInt } from "./decision-log.ts";

/** The keys the block `configuration.learning` holds, exactly (F106-FR-027). */
export const LEARNING_BLOCK_KEYS = [
  "mode",
  "decisions_through",
  "decisions_sha256",
  "effective",
  "source_path",
] as const;

/** The class of a structural finding of the binding (annex X §X.6 row 274). */
export const LEARNING_ERROR_CLASS = "learning" as const;

/** The exit code of a structural error of the binding (annex G §G.4). */
export const LEARNING_STRUCTURE_EXIT = 20 as const;

/** The exit code of the two refusals of the binding (annex G §G.4). */
export const LEARNING_PREFIX_REFUSAL_EXIT = 23 as const;

/** The reason the binding refuses a changed or lost prefix (F106-FR-028). */
export const LEARNING_PREFIX_REFUSAL_REASON = "LearningDecisionsChanged" as const;

/** The logical name of the decision log, with the slug filled in (F106-FR-027). */
export function learningDecisionsLogicalName(slug: string): string {
  return `feature:${slug}:learning:decisions`;
}

/** The as-is message texts of the structural findings (the golden of FX-33). */
export const LEARNING_FINDING_MESSAGES = Object.freeze({
  keys:
    "configuration.learning must have exactly decisions_sha256, decisions_through, effective, " +
    "mode, source_path",
  mode: "configuration.learning.mode must be one of off, suggest, apply",
  through: "configuration.learning.decisions_through must be a run id",
  sha256: "configuration.learning.decisions_sha256 must be lowercase SHA-256",
  sourcePath: "configuration.learning.source_path must be the logical name of the decision log",
  effective: "configuration.learning.effective must map knob -> {phase: value}",
  effectiveShape: "configuration.learning.effective must map knob -> {phase: value}",
} as const);

/** A structural finding of the binding: class `learning`, exit 20 (F106-FR-028). */
export interface LearningStructuralFinding {
  readonly rule: string;
  readonly message: string;
  readonly class: typeof LEARNING_ERROR_CLASS;
  readonly exit: typeof LEARNING_STRUCTURE_EXIT;
}

/** A refusal of the binding: a changed or lost prefix, exit 23 (F106-FR-028). */
export interface LearningRefusal {
  readonly reason: typeof LEARNING_PREFIX_REFUSAL_REASON;
  readonly message: string;
  readonly exit: typeof LEARNING_PREFIX_REFUSAL_EXIT;
}

/** What `validateLearningBinding` returns. */
export interface LearningBindingValidation {
  /** The structural findings, in the order the rules are stated (F106-FR-028). */
  readonly structural: readonly LearningStructuralFinding[];
  /** The two refusals; empty unless no structural error exists. */
  readonly refusals: readonly LearningRefusal[];
  /** True when neither list holds anything. */
  readonly ok: boolean;
  /** The exit of validation for the binding: 0, 20 or 23. */
  readonly exit: 0 | 20 | 23;
}

/** The block `configuration.learning`, exactly as the launch contract carries it. */
export interface LearningBinding {
  readonly mode: LearningMode;
  readonly decisions_through: string;
  readonly decisions_sha256: string;
  readonly effective: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly source_path: string;
}

/** One line of the log read leniently: a JSON object, or nothing. */
function lenientLines(bytes: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of bytes.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        out.push(value as Record<string, unknown>);
      }
    } catch {
      // A line that is not JSON is skipped (F106-FR-007).
    }
  }
  return out;
}

/** The run id of a line, when it is a text (whatever the action of the line). */
function runIdOf(entry: Record<string, unknown>): string | null {
  const id = entry["run_id"];
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * The bound prefix: the bytes of the log up to and including the first line
 * whose `run_id` equals `through`, its line end included (F106-FR-027).
 * `null` when no line carries that id.
 */
export function boundPrefixBytes(raw: string, through: string): string | null {
  const lines = raw.split("\n");
  let consumed = 0;
  for (const line of lines) {
    consumed += Buffer.byteLength(line, "utf8") + 1; // the line end is included
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      if (runIdOf(entry as Record<string, unknown>) === through) {
        return raw.slice(0, consumed);
      }
    }
  }
  return null;
}

/** The content hash of the hasher over the prefix bytes (annex X §X.5). */
export function prefixHashHex(prefix: string): string {
  return createHash("sha256").update(prefix, "utf8").digest("hex");
}

/**
 * The `effective` map of the block (F106-FR-027): per (knob, phase, shape) the
 * last decision of the bound prefix, kept only where it is not a `revert`;
 * the recorded value, not clamped.
 */
export function effectiveMapOf(
  entries: readonly Record<string, unknown>[],
): Record<string, Record<string, number>> {
  const last = new Map<string, { order: number; value: number }>();
  entries.forEach((entry, order) => {
    if (!isDecision(entry) || entry["action"] === "revert") return;
    const knob = entry["knob"];
    const phase = toInt(entry["phase"]);
    const value = entry["value"];
    if (typeof knob !== "string" || knob === "" || phase === null || typeof value !== "number")
      return;
    const key = `${knob}\u0000${phase}\u0000${String(entryShape(entry))}`;
    const previous = last.get(key);
    if (previous === undefined || previous.order < order) last.set(key, { order, value });
  });
  const out: Record<string, Record<string, number>> = {};
  const latest = new Map<string, { order: number; knob: string; phase: string; value: number }>();
  for (const [key, entry] of last) {
    const [knob, phase] = key.split("\u0000");
    const flat = `${knob}\u0000${phase}`;
    const previous = latest.get(flat);
    // The map collapses the shapes: the latest kept decision of the key wins.
    if (previous === undefined || previous.order < entry.order) {
      latest.set(flat, { order: entry.order, knob, phase, value: entry.value });
    }
  }
  for (const { knob, phase, value } of latest.values()) {
    (out[knob] ??= {})[phase] = value;
  }
  return out;
}

/** The input of `deriveLearningBlock`. */
export interface DeriveLearningBlockInput {
  /** The mode the derivation takes by option `--learning-mode` (default `off`). */
  readonly mode?: LearningMode | undefined;
  /** The path of the log, from option `--applied-file`. */
  readonly decisionsFile: string;
  /** The slug the logical name carries. */
  readonly slug: string;
}

/**
 * Derive the block (F106-FR-027), or `null` when the log is absent or no line
 * of it has a text `run_id`: then the launch contract carries no block.
 */
export function deriveLearningBlock(input: DeriveLearningBlockInput): LearningBinding | null {
  let raw: string;
  try {
    raw = readFileSync(input.decisionsFile, "utf8");
  } catch {
    return null;
  }
  const entries = lenientLines(raw);
  let through: string | null = null;
  for (const entry of entries) {
    const id = runIdOf(entry);
    if (id !== null) through = id; // the last line with a run id, whatever its action
  }
  if (through === null) return null;
  const prefix = boundPrefixBytes(raw, through);
  if (prefix === null) return null;
  return Object.freeze({
    mode: input.mode ?? "off",
    decisions_through: through,
    decisions_sha256: prefixHashHex(prefix),
    effective: Object.freeze(
      effectiveMapOf(entries.slice(0, firstIndexWithRunId(entries, through) + 1)),
    ),
    source_path: learningDecisionsLogicalName(input.slug),
  });
}

/** The index of the first entry whose run id equals `through`. */
function firstIndexWithRunId(entries: readonly Record<string, unknown>[], through: string): number {
  return entries.findIndex((entry) => runIdOf(entry) === through);
}

/* ------------------------------------------------------------------ *
 * T049 — the rules of validation (F106-FR-028, F106-FR-029).
 * ------------------------------------------------------------------ */

/** The stage actions a declaration may stand in: the action and its resume twin. */
const STAGE_ACTION_KEYS = ["action", "action_on_resume", "on_resume"] as const;

/** The environment entry of a declaration: a literal, or a value taken from a named variable. */
function declaredLiteral(value: unknown): { literal: string } | { fromEnvironment: true } | null {
  if (typeof value === "string") return { literal: value };
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if ("variable" in record) return { fromEnvironment: true };
  }
  return null;
}

/** The stage declarations of one key, as `stage.<id>.action.env.<NAME>`. */
function stageDeclarations(
  stages: readonly unknown[],
  environmentName: string,
): { where: string; value: unknown }[] {
  const out: { where: string; value: unknown }[] = [];
  for (const stage of stages) {
    if (typeof stage !== "object" || stage === null) continue;
    const record = stage as Record<string, unknown>;
    const kind = record["kind"];
    if (kind !== "specstride" && kind !== "wiggum") continue;
    const id = typeof record["id"] === "string" ? record["id"] : "<unnamed>";
    for (const actionKey of STAGE_ACTION_KEYS) {
      const action = record[actionKey];
      if (typeof action !== "object" || action === null) continue;
      const env = (action as Record<string, unknown>)["env"];
      if (typeof env !== "object" || env === null || Array.isArray(env)) continue;
      const value = (env as Record<string, unknown>)[environmentName];
      if (value === undefined) continue;
      out.push({ where: `stage ${id}.${actionKey}.env.${environmentName}`, value });
    }
  }
  return out;
}

function finding(rule: string, message: string): LearningStructuralFinding {
  return Object.freeze({
    rule,
    message,
    class: LEARNING_ERROR_CLASS,
    exit: LEARNING_STRUCTURE_EXIT,
  });
}

/** The input of `validateLearningBinding`. */
export interface ValidateLearningBindingInput {
  /** The launch contract, as it is read from disk (validation reads it defensively). */
  readonly contract: unknown;
  /** The path of the decision log, resolved through the state layout. */
  readonly decisionsFile: string;
  /** The slug, to compare `source_path` with the logical name. */
  readonly slug: string;
}

/**
 * The rules of F106-FR-028 and F106-FR-029 as one function (T049): the
 * structural findings with the class `learning` (exit 20), and — only when no
 * structural error exists — the two refusals of a changed or lost prefix
 * (exit 23, `LearningDecisionsChanged`). Validation of the launch contract
 * calls this; the refusals are checked where validation compares the sources
 * with their hashes.
 */
export function validateLearningBinding(
  input: ValidateLearningBindingInput,
): LearningBindingValidation {
  const structural: LearningStructuralFinding[] = [];
  const contract =
    typeof input.contract === "object" && input.contract !== null
      ? (input.contract as Record<string, unknown>)
      : {};
  const configuration =
    typeof contract["configuration"] === "object" && contract["configuration"] !== null
      ? (contract["configuration"] as Record<string, unknown>)
      : {};
  const block = configuration["learning"];
  const stages = Array.isArray(contract["stages"]) ? (contract["stages"] as unknown[]) : [];

  if (block === undefined || block === null) {
    // Without the block no stage declares a bound or the mode `apply` (F106-FR-028).
    for (const { where, value } of [
      ...stageDeclarations(stages, "SPECSTRIDE_LEARNING"),
      ...stageDeclarations(stages, "SPECSTRIDE_LEARNING_THROUGH"),
    ]) {
      const declared = declaredLiteral(value);
      const modeApply = declared !== null && "literal" in declared && declared.literal === "apply";
      const bound = where.includes("SPECSTRIDE_LEARNING_THROUGH");
      if (bound || modeApply) {
        structural.push(
          finding(
            "no-block-no-declaration",
            `${where} declares a learning value but the launch contract carries no configuration.learning block`,
          ),
        );
      }
    }
    return finish(structural, []);
  }

  if (typeof block !== "object" || Array.isArray(block)) {
    structural.push(finding("block-keys", LEARNING_FINDING_MESSAGES.keys));
    return finish(structural, []);
  }
  const record = block as Record<string, unknown>;

  // Exactly the five keys (F106-FR-027).
  const keys = Object.keys(record).sort();
  const wanted = [...LEARNING_BLOCK_KEYS].sort();
  if (keys.length !== wanted.length || keys.some((key, i) => key !== wanted[i])) {
    structural.push(finding("block-keys", LEARNING_FINDING_MESSAGES.keys));
  }

  // `mode`: a literal member of the closed set (F106-FR-028).
  if (!isModeLiteral(record["mode"])) {
    structural.push(finding("mode", LEARNING_FINDING_MESSAGES.mode));
  }

  // `decisions_through`: a non-empty text (F106-FR-028).
  const through = record["decisions_through"];
  if (typeof through !== "string" || through === "") {
    structural.push(finding("decisions_through", LEARNING_FINDING_MESSAGES.through));
  }

  // `decisions_sha256`: 64 hexadecimal digits, lower case (F106-FR-028).
  if (
    typeof record["decisions_sha256"] !== "string" ||
    !/^[0-9a-f]{64}$/.test(record["decisions_sha256"])
  ) {
    structural.push(finding("decisions_sha256", LEARNING_FINDING_MESSAGES.sha256));
  }

  // `effective`: a map from the knob to a map from the phase, as text, to a number (F106-FR-027).
  const effective = record["effective"];
  if (typeof effective !== "object" || effective === null || Array.isArray(effective)) {
    structural.push(finding("effective", LEARNING_FINDING_MESSAGES.effective));
  } else {
    for (const [knob, phases] of Object.entries(effective as Record<string, unknown>)) {
      if (typeof phases !== "object" || phases === null || Array.isArray(phases)) {
        structural.push(finding("effective", LEARNING_FINDING_MESSAGES.effectiveShape));
        break;
      }
      const wellFormed = Object.entries(phases as Record<string, unknown>).every(
        ([phase, value]) => phase !== "" && typeof value === "number" && Number.isFinite(value),
      );
      if (!wellFormed || knob === "") {
        structural.push(finding("effective", LEARNING_FINDING_MESSAGES.effectiveShape));
        break;
      }
    }
  }

  // `source_path`: the logical name, never an absolute path (F106-FR-027).
  const sourcePath = record["source_path"];
  if (
    typeof sourcePath !== "string" ||
    sourcePath === "" ||
    isAbsolute(sourcePath) ||
    sourcePath !== learningDecisionsLogicalName(input.slug)
  ) {
    structural.push(finding("source_path", LEARNING_FINDING_MESSAGES.sourcePath));
  }

  // Every stage of kind `specstride` declares the same mode and the same bound,
  // in its action and in its action on resume; the mode is a literal of the
  // closed set, the bound a literal non-empty run id (F106-FR-028, F106-FR-029).
  for (const environmentName of ["SPECSTRIDE_LEARNING", "SPECSTRIDE_LEARNING_THROUGH"] as const) {
    const isMode = environmentName === "SPECSTRIDE_LEARNING";
    const bound = isMode
      ? typeof record["mode"] === "string"
        ? (record["mode"] as string)
        : null
      : through;
    for (const { where, value } of stageDeclarations(stages, environmentName)) {
      const declared = declaredLiteral(value);
      if (declared === null) {
        structural.push(finding("stage-declaration", `${where} must be a literal value`));
        continue;
      }
      if ("fromEnvironment" in declared) {
        // A declared mode is never taken from the environment of the shell (F106-FR-029).
        structural.push(
          finding(
            "stage-declaration-literal",
            `${where} must be a literal, never taken from the environment`,
          ),
        );
        continue;
      }
      if (isMode && !isModeLiteral(declared.literal)) {
        structural.push(
          finding("stage-declaration-mode", `${where} must be one of off, suggest, apply`),
        );
        continue;
      }
      if (!isMode && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(declared.literal)) {
        structural.push(finding("stage-declaration-through", `${where} must be a run id`));
        continue;
      }
      if (bound !== null && declared.literal !== bound) {
        structural.push(
          finding(
            "stage-declaration-consistency",
            `${where} must be '${bound}', as configuration.learning records`,
          ),
        );
      }
    }
  }

  if (structural.length > 0 || typeof through !== "string") {
    return finish(structural, []);
  }

  // The two refusals (exit 23), only when no structural error exists
  // (F106-FR-028): a changed or lost prefix, an unreadable log.
  let raw: string | null = null;
  try {
    raw = readFileSync(input.decisionsFile, "utf8");
  } catch {
    raw = null;
  }
  if (raw === null) {
    return finish(structural, [
      Object.freeze({
        reason: LEARNING_PREFIX_REFUSAL_REASON,
        message: `the decision log cannot be read: ${learningDecisionsLogicalName(input.slug)}`,
        exit: LEARNING_PREFIX_REFUSAL_EXIT,
      }),
    ]);
  }
  const prefix = boundPrefixBytes(raw, through);
  if (prefix === null) {
    return finish(structural, [
      Object.freeze({
        reason: LEARNING_PREFIX_REFUSAL_REASON,
        message: `the decision log holds no line with the bound run id '${through}'`,
        exit: LEARNING_PREFIX_REFUSAL_EXIT,
      }),
    ]);
  }
  const hash = prefixHashHex(prefix);
  if (hash !== record["decisions_sha256"]) {
    return finish(structural, [
      Object.freeze({
        reason: LEARNING_PREFIX_REFUSAL_REASON,
        message: `the bound prefix of the decision log changed since the binding (LearningDecisionsChanged)`,
        exit: LEARNING_PREFIX_REFUSAL_EXIT,
      }),
    ]);
  }
  return finish(structural, []);
}

function finish(
  structural: readonly LearningStructuralFinding[],
  refusals: readonly LearningRefusal[],
): LearningBindingValidation {
  const exit = structural.length > 0 ? 20 : refusals.length > 0 ? 23 : 0;
  return Object.freeze({
    structural: Object.freeze(structural),
    refusals: Object.freeze(refusals),
    ok: exit === 0,
    exit,
  });
}

/* ------------------------------------------------------------------ *
 * T051 — the handover to the configuration-precedence check of the
 * doctor (F106-FR-031; annex G §G.7). This feature registers no check
 * of its own: the keys are handed to the check of feature 112 as the
 * keys whose shadowing by the launch contract is reported, and the
 * source of the value in force is named `contract`. The check reads
 * the merged provenance of the configuration and maps the records of
 * these two keys through `learningShadowReports` below.
 * ------------------------------------------------------------------ */

/** The source the doctor shows for a value the launch contract pins (F106-FR-031). */
export const LEARNING_CONTRACT_SOURCE = "contract" as const;

/** One shadowed learning key, as the doctor's precedence check reports it. */
export interface LearningShadowReport {
  /** The configuration key: `learning.mode` or `learning.through`. */
  readonly key: typeof LEARNING_MODE_KEY | typeof LEARNING_THROUGH_KEY;
  /** The source of the value in force: always `contract` (F106-FR-031). */
  readonly source: typeof LEARNING_CONTRACT_SOURCE;
  /** The variable of the shell whose value is shadowed. */
  readonly variable: string | undefined;
}

/** The minimal shape of a merged provenance record the check reads. */
export interface LearningProvenanceInput {
  readonly key: string;
  readonly source: string;
  readonly shadowed: readonly { readonly source: string; readonly place?: string | undefined }[];
}

/**
 * The two keys this feature hands to the precedence check of the doctor
 * (F106-FR-031), and the mapping of a merged provenance table to the reports
 * the check renders. A key of another feature, or a value not shadowed from
 * the environment, produces no report. A report names no value — the report
 * holds no secret value (F106-FR-031).
 */
export function learningShadowReports(
  records: readonly LearningProvenanceInput[],
): readonly LearningShadowReport[] {
  const keys: ReadonlySet<string> = new Set<string>(LEARNING_PINNABLE_KEYS);
  const out: LearningShadowReport[] = [];
  for (const record of records) {
    if (!keys.has(record.key)) continue;
    for (const shadow of record.shadowed) {
      if (shadow.source !== "environment") continue;
      out.push(
        Object.freeze({
          key: record.key as LearningShadowReport["key"],
          source: LEARNING_CONTRACT_SOURCE,
          variable: shadow.place,
        }),
      );
    }
  }
  return Object.freeze(out);
}
