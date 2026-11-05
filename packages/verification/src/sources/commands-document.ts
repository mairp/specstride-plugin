/**
 * T092 and T148 — the verification-commands document as a plan source
 * (F105-FR-016), and the refusal of `reads`, `writes` and `sideEffects` from
 * repository text (CQ-190, `research.md` D-18).
 *
 * The document is a record with a list `commands` that is not empty. Every
 * field this requirement does not name is IGNORED WITH A FINDING (the
 * unknown-value rule of feature 100, annex C §C.9) — never refused, never
 * silently dropped. Three names are ignored with a finding of their own and
 * make the command UNDECLARED, which means it runs alone: `reads`, `writes`
 * and `sideEffects`. The document is a file of the project, and a file of the
 * project may not widen what runs side by side (rulings P11 and 35).
 *
 * The stage `pre` is a spelling of `prestage` and is STORED as `prestage`, so
 * that every rule written for `prestage` holds for it; the fold is
 * `normalizeStage` of `../mode/closed-sets.ts`, the closed set of row 228.
 */
import { accessSync, constants, readFileSync, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import {
  commandStages,
  discoveryValues,
  normalizeStage,
  reusePolicies,
  type StoredCommandStage,
} from "../mode/closed-sets.ts";
import { canonicalJson, commandSeed, pythonJson, sha256Bytes, stableId } from "../plan/hash.ts";
import {
  DEFAULT_DECLARED_KIND,
  DEFAULT_REUSE_POLICY,
  DEFAULT_STAGE,
  DEFAULT_STAGING,
  VerificationError,
  type PlanCommand,
  type ReusePolicy,
} from "../plan/record.ts";
import type { SourceFinding } from "./finding.ts";

/** The fields of the document itself that F105-FR-016 names. */
export const DOCUMENT_FIELDS = [
  "commands",
  "schema_version",
  "discovery",
  "phaseTimeouts",
] as const;

/** The fields of a command that F105-FR-016 names as required. */
export const REQUIRED_COMMAND_FIELDS = ["id", "phase", "executable", "cwd", "timeoutSec"] as const;

/** The fields of a command that F105-FR-016 names as optional. */
export const OPTIONAL_COMMAND_FIELDS = [
  "args",
  "env",
  "stage",
  "reportPath",
  "reusePolicy",
  "detached",
  "cumulative",
  "kind",
  "label",
  "steps",
  "resource",
] as const;

/** Every field of a command the requirement names (F105-FR-016). */
export const NAMED_COMMAND_FIELDS: readonly string[] = Object.freeze([
  ...REQUIRED_COMMAND_FIELDS,
  ...OPTIONAL_COMMAND_FIELDS,
]);

/**
 * The three names the document MUST NOT declare (F105-FR-016, CQ-190). They
 * are ignored with a finding that names the command and the line, and the
 * command counts as undeclared, which means that it runs alone.
 */
export const FIELDS_REPOSITORY_TEXT_MUST_NOT_DECLARE = ["reads", "writes", "sideEffects"] as const;

/** The finding a field of that list gives (F105-FR-016). */
export function repositoryTextFieldFinding(input: {
  readonly field: string;
  readonly commandId: string;
  readonly file: string;
  readonly line: number;
}): SourceFinding {
  return Object.freeze({
    message:
      `the field \`${input.field}\` of the command \`${input.commandId}\` is ignored: ` +
      "the verification-commands document is repository text and declares no reads, " +
      "writes or side effects of a command (F105-FR-016, CQ-190); the command counts " +
      "as undeclared and runs alone",
    provenance: Object.freeze({ file: input.file, line: input.line }),
    field: input.field,
    commandId: input.commandId,
    undeclares: true,
  });
}

/** The finding any other unnamed field gives (annex C §C.9). */
export function unknownFieldFinding(input: {
  readonly field: string;
  readonly commandId: string;
  readonly file: string;
  readonly line: number;
}): SourceFinding {
  return Object.freeze({
    message:
      `the field \`${input.field}\` of the command \`${input.commandId}\` is not a field ` +
      "F105-FR-016 names and is ignored (annex C §C.9, unknown-value rule)",
    provenance: Object.freeze({ file: input.file, line: input.line }),
    field: input.field,
    commandId: input.commandId,
    undeclares: false,
  });
}

/** The line a key of a command sits on, for the provenance of a finding. */
export function lineOfKey(text: string, commandId: string, key: string): number {
  const lines = text.split("\n");
  let inside = false;
  let depth = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!inside && new RegExp(`"id"\\s*:\\s*${JSON.stringify(commandId)}`).test(line)) {
      inside = true;
      depth = 0;
    }
    if (inside) {
      if (new RegExp(`"${key}"\\s*:`).test(line)) return index + 1;
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      if (depth < 0) inside = false;
    }
  }
  return 0;
}

/** The line the `id` of a command sits on, for its provenance (F105-FR-015). */
export function lineOfCommand(text: string, commandId: string): number {
  return lineOfKey(text, commandId, "id");
}

/** The refusal of one declared entry, with its id and its index (`:235`). */
function bad(entry: unknown, index: number, message: string): VerificationError {
  const id = (entry as { id?: unknown } | null)?.id;
  return new VerificationError(
    `declared command ${pythonJson(id ?? "?")} (index ${index}): ${message}`,
  );
}

/** Resolve a bare name of an executable on the search path (F105-FR-016). */
export function resolveOnSearchPath(name: string, searchPath: string): string | undefined {
  for (const directory of searchPath.split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Continue with the next entry of the search path.
    }
  }
  return undefined;
}

/** The baseline's `_command` (`lib/verification_plan.py`:183). */
export function commandRecord(input: {
  readonly kind: string;
  readonly label: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutSec: number;
}): PlanCommand {
  const executable = realpathSync(input.executable);
  const seed = commandSeed({
    kind: input.kind,
    executable,
    args: input.args,
    workdir: input.cwd,
  });
  return Object.freeze({
    id: stableId("CMD", seed),
    kind: input.kind,
    label: input.label,
    executable,
    args: Object.freeze([...input.args]),
    cwd: input.cwd,
    timeoutSec: input.timeoutSec,
  });
}

/** What one entry of the document became, with the findings it gave. */
export type DeclaredEntry = {
  readonly command: PlanCommand;
  readonly findings: readonly SourceFinding[];
  /** True where a field of repository text made the command undeclared. */
  readonly undeclared: boolean;
};

/** One declared entry of the document as a plan command (F105-FR-016). */
export function declaredEntryCommand(input: {
  readonly entry: unknown;
  readonly index: number;
  readonly searchPath: string;
  readonly file: string;
  readonly documentText: string;
}): DeclaredEntry {
  const { entry, index } = input;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw bad(entry, index, "entry must be an object");
  }
  const record = entry as Record<string, unknown>;
  const declaredId = record["id"];
  if (typeof declaredId !== "string" || declaredId.trim() === "") {
    throw bad(entry, index, "id must be a non-empty string");
  }
  const phase = record["phase"];
  if (typeof phase !== "number" || !Number.isInteger(phase) || phase < 1) {
    throw bad(entry, index, "phase must be a positive integer");
  }
  const executable = record["executable"];
  if (typeof executable !== "string" || executable === "") {
    throw bad(entry, index, "executable must be a non-empty string");
  }
  const rawArgs = record["args"] ?? [];
  if (!Array.isArray(rawArgs) || !rawArgs.every((one) => typeof one === "string")) {
    throw bad(entry, index, "args must be a list of strings");
  }
  const args = rawArgs as string[];
  const cwd = record["cwd"];
  if (typeof cwd !== "string" || !isAbsolute(cwd)) {
    throw bad(entry, index, "cwd must be an absolute path");
  }
  let cwdIsADirectory = false;
  try {
    cwdIsADirectory = statSync(cwd).isDirectory();
  } catch {
    cwdIsADirectory = false;
  }
  if (!cwdIsADirectory) throw bad(entry, index, `cwd is not a directory: ${cwd}`);
  const timeoutSec = record["timeoutSec"];
  if (typeof timeoutSec !== "number" || !Number.isInteger(timeoutSec) || timeoutSec <= 0) {
    throw bad(entry, index, "timeoutSec must be a positive integer");
  }
  const rawEnv = record["env"] ?? {};
  if (
    rawEnv === null ||
    typeof rawEnv !== "object" ||
    Array.isArray(rawEnv) ||
    !Object.entries(rawEnv).every(([k, v]) => typeof k === "string" && typeof v === "string")
  ) {
    throw bad(entry, index, "env must be an object of string to string");
  }
  const env = rawEnv as Record<string, string>;

  const rawStage = record["stage"] ?? DEFAULT_STAGE;
  const stage: StoredCommandStage | undefined =
    typeof rawStage === "string" ? normalizeStage(rawStage) : undefined;
  if (stage === undefined) {
    throw bad(
      entry,
      index,
      `stage must be one of ${[...sortedStages()].map((v) => pythonJson(v)).join(", ")}`,
    );
  }
  const reportPathRaw = record["reportPath"];
  let reportPath: string | null = null;
  if (reportPathRaw !== undefined && reportPathRaw !== null) {
    if (typeof reportPathRaw !== "string" || reportPathRaw.trim() === "") {
      throw bad(entry, index, "reportPath must be a non-empty string");
    }
    if (isAbsolute(reportPathRaw)) {
      throw bad(entry, index, "reportPath must be workdir-relative, not absolute");
    }
    reportPath = reportPathRaw;
  }
  const reusePolicyRaw = record["reusePolicy"] ?? DEFAULT_REUSE_POLICY;
  if (typeof reusePolicyRaw !== "string" || !reusePolicies.has(reusePolicyRaw)) {
    throw bad(
      entry,
      index,
      `reusePolicy must be one of ${reusePolicies.members.map((v) => pythonJson(v)).join(", ")}`,
    );
  }
  const reusePolicy = reusePolicyRaw as ReusePolicy;
  const detached = record["detached"] ?? false;
  if (typeof detached !== "boolean") throw bad(entry, index, "detached must be a boolean");
  const cumulative = record["cumulative"] ?? true;
  if (typeof cumulative !== "boolean") throw bad(entry, index, "cumulative must be a boolean");
  if (detached && stage === "gate") {
    throw bad(entry, index, 'detached requires stage "prestage" or "both"');
  }

  let resolved: string;
  if (isAbsolute(executable)) {
    resolved = executable;
  } else {
    const found = resolveOnSearchPath(executable, input.searchPath);
    if (found === undefined)
      throw bad(entry, index, `executable '${executable}' not found on PATH`);
    resolved = found;
  }
  let runnable = false;
  try {
    accessSync(resolved, constants.X_OK);
    runnable = statSync(resolved).isFile();
  } catch {
    runnable = false;
  }
  if (!runnable) throw bad(entry, index, `executable is not an executable file: ${resolved}`);

  // T148 — the three names of repository text, and every other unnamed field.
  const findings: SourceFinding[] = [];
  let undeclared = false;
  for (const key of Object.keys(record)) {
    if (NAMED_COMMAND_FIELDS.includes(key)) continue;
    const line =
      lineOfKey(input.documentText, declaredId, key) ||
      lineOfCommand(input.documentText, declaredId);
    if ((FIELDS_REPOSITORY_TEXT_MUST_NOT_DECLARE as readonly string[]).includes(key)) {
      findings.push(
        repositoryTextFieldFinding({
          field: key,
          commandId: declaredId,
          file: input.file,
          line,
        }),
      );
      undeclared = true;
      continue;
    }
    findings.push(
      unknownFieldFinding({ field: key, commandId: declaredId, file: input.file, line }),
    );
  }

  const base = commandRecord({
    kind:
      typeof record["kind"] === "string" && record["kind"] !== ""
        ? (record["kind"] as string)
        : DEFAULT_DECLARED_KIND,
    label:
      typeof record["label"] === "string" && record["label"] !== ""
        ? (record["label"] as string)
        : `${declaredId} (declared)`,
    executable: resolved,
    args,
    cwd,
    timeoutSec,
  });
  const staging = {
    stage,
    reportPath,
    reusePolicy,
    detached,
    cumulative,
  };
  // The declared identity and the staging fields join the seed, so two entries
  // that differ only in id, phase, environment or staging keep two ids. The
  // segment is appended ONLY when something is non-default, so a document that
  // uses none of the staging fields keeps the ids it has at the baseline.
  let seed = `declared:${declaredId}:${phase}:${resolved}:${pythonJson(args)}:${cwd}:${canonicalJson(env)}`;
  if (canonicalJson(staging) !== canonicalJson(DEFAULT_STAGING)) {
    seed += `:${canonicalJson(staging)}`;
  }
  const command: PlanCommand = Object.freeze({
    ...base,
    source: "declared",
    declaredId,
    phase,
    ...(Object.keys(env).length > 0 ? { env: Object.freeze({ ...env }) } : {}),
    ...(stage !== DEFAULT_STAGE ? { stage } : {}),
    ...(reportPath !== null && reportPath !== "" ? { reportPath } : {}),
    ...(reusePolicy !== DEFAULT_REUSE_POLICY ? { reusePolicy } : {}),
    ...(detached ? { detached: true } : {}),
    ...(cumulative ? {} : { cumulative: false }),
    ...(Array.isArray(record["steps"]) ? { steps: record["steps"] as PlanCommand["steps"] } : {}),
    ...(typeof record["resource"] === "string" ? { resource: record["resource"] } : {}),
    provenance: Object.freeze({
      file: input.file,
      line: lineOfCommand(input.documentText, declaredId),
    }),
    id: stableId("CMD", seed),
  });
  return Object.freeze({ command, findings: Object.freeze(findings), undeclared });
}

/**
 * The stages the refusal of an unknown stage names, SORTED, as the baseline's
 * `sorted(STAGE_ALIASES)` gives them (`lib/verification_plan.py`:275). The
 * members come from the closed set of row 228 and are never retyped here.
 */
export function sortedStages(): readonly string[] {
  return Object.freeze([...commandStages.members].sort());
}

/** The ceilings of a pass per phase the document may supply (F105-FR-016). */
export type PhaseTimeouts = Readonly<Record<string, number>>;

/** The document, as the planner reads it (F105-FR-016, F105-FR-012). */
export type LoadedDocument = {
  readonly path: string;
  readonly contentHash: string;
  readonly schemaVersion: unknown;
  readonly commands: readonly PlanCommand[];
  readonly discovery?: string;
  readonly phaseTimeouts: PhaseTimeouts;
  readonly findings: readonly SourceFinding[];
  /** The declared ids of the commands a field of repository text undeclared. */
  readonly undeclared: readonly string[];
};

/** The value `discovery` may hold, which removes every discovered command. */
export const DISCOVERY_NONE = "none" as const;

/**
 * Read a verification-commands document into plan commands (F105-FR-016,
 * `lib/verification_plan.py`:364). Its place must be absolute when it is
 * loaded, and the function refuses anything it cannot run exactly as written.
 */
export function loadDeclaredCommands(input: {
  readonly path: string;
  readonly searchPath: string;
}): LoadedDocument {
  const { path } = input;
  if (!isAbsolute(path)) {
    throw new VerificationError(`verification commands path must be absolute: ${path}`);
  }
  let isAFile = false;
  try {
    isAFile = statSync(path).isFile();
  } catch {
    isAFile = false;
  }
  if (!isAFile) throw new VerificationError(`verification commands not found: ${path}`);
  const bytes = readFileSync(path);
  const text = bytes.toString("utf8");
  let document: unknown;
  try {
    document = JSON.parse(text) as unknown;
  } catch (error) {
    throw new VerificationError(`cannot read JSON ${path}: ${String(error)}`);
  }
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    throw new VerificationError(`JSON document must be an object: ${path}`);
  }
  const record = document as Record<string, unknown>;
  const entries = record["commands"];
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new VerificationError("verification commands document has no non-empty 'commands' array");
  }
  const real = realpathSync(path);
  const commands: PlanCommand[] = [];
  const findings: SourceFinding[] = [];
  const undeclared: string[] = [];
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const one = declaredEntryCommand({
      entry,
      index,
      searchPath: input.searchPath,
      file: real,
      documentText: text,
    });
    const declaredId = one.command.declaredId ?? "";
    if (seen.has(declaredId)) {
      throw new VerificationError(`duplicate declared command id: ${declaredId}`);
    }
    seen.add(declaredId);
    commands.push(one.command);
    findings.push(...one.findings);
    if (one.undeclared) undeclared.push(declaredId);
  });
  const discoveryMode = record["discovery"];
  if (discoveryMode !== undefined && discoveryMode !== null) {
    if (typeof discoveryMode !== "string" || !discoveryValues.has(discoveryMode)) {
      throw new VerificationError(
        `verification commands 'discovery' must be "none" when present (got ${pythonJson(discoveryMode)})`,
      );
    }
  }
  // Every field of the DOCUMENT that this requirement does not name is ignored
  // with a finding, as an unnamed field of a command is.
  for (const key of Object.keys(record)) {
    if ((DOCUMENT_FIELDS as readonly string[]).includes(key)) continue;
    findings.push(
      Object.freeze({
        message:
          `the field \`${key}\` of the verification-commands document is not a field ` +
          "F105-FR-016 names and is ignored (annex C §C.9, unknown-value rule)",
        provenance: Object.freeze({ file: real, line: lineOfKey(text, "", key) }),
        field: key,
        undeclares: false,
      }),
    );
  }
  return Object.freeze({
    path: real,
    contentHash: sha256Bytes(bytes),
    schemaVersion: record["schema_version"] ?? null,
    commands: Object.freeze(commands),
    ...(discoveryMode !== undefined && discoveryMode !== null
      ? { discovery: discoveryMode as string }
      : {}),
    phaseTimeouts: phaseTimeoutsOf(record["phaseTimeouts"]),
    findings: Object.freeze(findings),
    undeclared: Object.freeze(undeclared),
  });
}

/**
 * `phaseTimeouts` (F105-FR-016, B-0269): declared ceilings of a pass per
 * phase. A document that cannot be read for them is treated as holding none,
 * so a value that is not a record, or an entry that is not a positive whole
 * number of seconds, contributes nothing and never refuses the document.
 */
export function phaseTimeoutsOf(value: unknown): PhaseTimeouts {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({});
  }
  const out: Record<string, number> = {};
  for (const [key, one] of Object.entries(value as Record<string, unknown>)) {
    if (typeof one === "number" && Number.isInteger(one) && one > 0) out[key] = one;
  }
  return Object.freeze(out);
}

/** The ceiling of a pass of one phase, or `undefined` where none is declared. */
export function phaseTimeoutOf(timeouts: PhaseTimeouts, phase: number): number | undefined {
  return timeouts[String(phase)];
}

/** The document that cannot be read for its ceilings holds NONE (B-0269). */
export function phaseTimeoutsOfAnUnreadableDocument(): PhaseTimeouts {
  return Object.freeze({});
}

/**
 * The ENTRIES of `phaseTimeouts` as the launch reads them (B-0269, the engine
 * script of the baseline at `9cab15d`, lines 856 to 874): one
 * `"<phase>=<seconds>"` per entry, in the
 * order of the document, and NONE where the document cannot be read at all —
 * the baseline's reader exits 0 with no output for an unreadable document, so
 * such a document is treated as holding none and never refuses the launch.
 */
export function phaseTimeoutEntries(documentText: string | undefined): readonly string[] {
  if (documentText === undefined || documentText.trim() === "") return Object.freeze([]);
  let document: unknown;
  try {
    document = JSON.parse(documentText) as unknown;
  } catch {
    return Object.freeze([]);
  }
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    return Object.freeze([]);
  }
  const timeouts = (document as Record<string, unknown>)["phaseTimeouts"];
  if (timeouts === null || typeof timeouts !== "object" || Array.isArray(timeouts)) {
    return Object.freeze([]);
  }
  return Object.freeze(
    Object.entries(timeouts as Record<string, unknown>).map(
      ([phase, seconds]) => `${phase}=${textOfAValue(seconds)}`,
    ),
  );
}

/** A value as the baseline's `print("%s=%s")` writes it. */
function textOfAValue(value: unknown): string {
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "object") return canonicalJson(value);
  return String(value);
}

/** The refusal of an entry that is no phase mapped to positive seconds. */
export function badPhaseTimeoutMessage(input: {
  readonly documentPath: string;
  readonly phase: string;
  readonly seconds: string;
}): string {
  return (
    `phaseTimeouts in ${input.documentPath} must map phase numbers to positive ` +
    `integer seconds (got '${input.phase}' => '${input.seconds}')`
  );
}

/** A phase number of an entry: whole digits only, as the baseline's test. */
export const A_WHOLE_NUMBER = /^[0-9]+$/;

/**
 * The declared ceilings of a pass per phase, as the LAUNCH reads them
 * (B-0269). An entry whose phase is no whole number, or whose seconds are no
 * positive whole number, refuses the launch with the baseline's message; a
 * document that cannot be read holds none and refuses nothing.
 */
export function readPhaseTimeouts(input: {
  readonly documentPath: string;
  readonly documentText: string | undefined;
}): PhaseTimeouts {
  const out: Record<string, number> = {};
  for (const entry of phaseTimeoutEntries(input.documentText)) {
    const at = entry.indexOf("=");
    const phase = entry.slice(0, at);
    const seconds = entry.slice(at + 1);
    if (phase === "") continue;
    if (!A_WHOLE_NUMBER.test(phase) || !A_WHOLE_NUMBER.test(seconds) || Number(seconds) <= 0) {
      throw new VerificationError(
        badPhaseTimeoutMessage({ documentPath: input.documentPath, phase, seconds }),
      );
    }
    out[phase] = Number(seconds);
  }
  return Object.freeze(out);
}
