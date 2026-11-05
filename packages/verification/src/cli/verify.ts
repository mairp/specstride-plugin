/**
 * T135 — THE PUBLIC COMMAND `verify` (F105-FR-039).
 *
 * Seven sub-commands and four exit codes. The command is a DISPATCHER: every
 * sub-command is the one call of a module that already exists and is already
 * gated —
 *
 * | Sub-command | What it calls |
 * |---|---|
 * | `create` | `derivePlan` (`../plan/create.ts`), `persistPlan` and `writeScaffolds` (`../render/`) |
 * | `validate` | `loadPlan` (`../plan/validate.ts`), then `VALID_LINE` |
 * | `slice` | `renderPhaseContext` (`../render/phase-context.ts`) with the block of `prestage-report` |
 * | `scaffold` | `writeScaffolds` and `scaffoldArtifactsJson` (`../render/scaffolds.ts`) |
 * | `run` | `runGate` (`../gate/gate.ts`) with the reuse rules of `../prestage/reuse.ts` |
 * | `prestage` | `runPrestage` (`../prestage/step.ts`) |
 * | `prestage-report` | `renderPrestageReport` (`../prestage/report.ts`) |
 *
 * so this module adds no verification behaviour of its own. What it owns is
 * the ORDER (parse, load, call, write, print) and the CODE each ending gives.
 *
 * IT WRITES NOTHING TO A STREAM ITSELF. `runVerify` gives back the exit code
 * and the exact bytes of standard output and standard error, so a composition
 * root writes them and a test compares them with the baseline's byte for byte.
 * `print(x)` of the baseline ends the line; `print(x, end="")` does not, and
 * `prestage-report` is the one sub-command of the second kind (F105-FR-039,
 * "without adding a line end").
 *
 * Everything outside this package arrives as a PORT, because the `mayImport`
 * of `@specstride/verification` is `@specstride/contracts` and
 * `@specstride/kernel` and nothing else: the canonical spec model (EP-03, the
 * grammar owner), the check runner (EP-05), the one ingress (F100-FR-009) and
 * the process primitive for a detached command (F100-FR-234). The file system
 * has defaults, because the modules this one calls already read and write
 * files.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWrite } from "@specstride/kernel";
import { pythonJson } from "../plan/hash.ts";
import { VerificationError } from "../plan/record.ts";
import type { SourceRevision } from "../plan/record.ts";
import { derivePlan } from "../plan/create.ts";
import type { ProjectionPhaseInput } from "../plan/projection.ts";
import { VALID_LINE, loadPlan } from "../plan/validate.ts";
import type { ExpectedSpec } from "../plan/validate.ts";
import type { VerificationPlan } from "../plan/record.ts";
import { discoverProject, requireAbsoluteDirectory } from "../sources/discovery.ts";
import { loadDeclaredCommands } from "../sources/commands-document.ts";
import {
  GENERATED_MARKER,
  canonicalPlanFile,
  markerLine,
  renderPlanForPeople,
} from "../render/plan-for-people.ts";
import { persistPlan } from "../render/safe-writes.ts";
import { generatedReport, scaffoldArtifactsJson, writeScaffolds } from "../render/scaffolds.ts";
import { defaultPrestageDirectoryOf, renderPhaseContext } from "../render/phase-context.ts";
import { GateCannotRunError, runGate } from "../gate/gate.ts";
import type { CommandRunner, GateOutcome, PlannedCommand } from "../gate/gate.ts";
import type { CommandOutputIngress } from "../gate/ingress.ts";
import {
  GATE_RECORD_NAME,
  WriteOnceRefusedError,
  gateResultRecord,
  writeOnce,
} from "../gate/records.ts";
import { VerificationWriteError } from "../render/lisa-store.ts";
import { VerificationClosedSetError } from "../mode/closed-sets.ts";
import { VerificationSwitchError } from "../mode/switches.ts";
import {
  PRESTAGE_KIND,
  PRESTAGE_PREFIX,
  attemptFromPath,
  prestagePath,
} from "../prestage/commands.ts";
import { renderPrestageReport } from "../prestage/report.ts";
import { prestageReuse } from "../prestage/reuse.ts";
import type { FoundDocument } from "../prestage/reuse.ts";
import { recordText, runPrestage } from "../prestage/step.ts";
import type { RunPrestageInput, StagedCommandRunner } from "../prestage/step.ts";
import type { BuildArtifactRecord } from "../prestage/artifacts.ts";
import { UNCAUGHT_ERROR_CODE } from "@specstride/contracts/codes/commands";
import {
  GATE_FAILED,
  STAGED_COMMAND_FAILED,
  SUCCESS,
  VERIFICATION_ERROR,
  errorLine,
} from "./exit-codes.ts";
import {
  VerifyUsageError,
  invalidSpecificationMessage,
  parseVerifyArguments,
  phaseOfRun,
  requireCommandsDocument,
  requireSpecificationFile,
  flagSwitchOf,
  flagValueOf,
  flagWholeNumberOf,
} from "./arguments.ts";
import type { ParsedArguments } from "./arguments.ts";

/* ------------------------------------------------------------------ *
 * The ports.
 * ------------------------------------------------------------------ */

/** What the grammar owner (EP-03) gives for one specification. */
export type SpecReading = {
  readonly format: string;
  readonly phases: readonly ProjectionPhaseInput[];
  /** The errors of validation, where the document does not validate. */
  readonly errors?: readonly string[] | undefined;
};

/**
 * THE ONE PORT OF THE GRAMMAR (EP-03). This package holds no reader of a
 * phase heading or a task line — F104-SC-001 gives that grammar to one
 * package — so the format, the validation and the phases of a specification
 * all arrive from the owner.
 */
export type SpecModelPort = (input: {
  readonly specPath: string;
  readonly text: string;
  readonly format?: string | undefined;
}) => SpecReading;

/** How the command reads and writes files; every member has a default. */
export type VerifyFilePort = {
  readonly read: (path: string) => string;
  readonly readIfPresent: (path: string) => string | undefined;
  readonly isFile: (path: string) => boolean;
  readonly realPath: (path: string) => string;
  readonly write: (path: string, text: string) => void;
  /** The records of staged commands under a directory, with their places. */
  readonly recordsIn: (directory: string) => readonly FoundDocument[];
};

/** The file port of a real run: `node:fs` and the atomic write of the kernel. */
export function defaultFilePort(): VerifyFilePort {
  return Object.freeze({
    read: (path: string) => readFileSync(path, "utf8"),
    readIfPresent: (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
    isFile: (path: string) => existsSync(path) && statSync(path).isFile(),
    realPath: (path: string) => {
      try {
        return realpathSync(path);
      } catch {
        return path;
      }
    },
    write: (path: string, text: string) => {
      mkdirSync(dirname(path), { recursive: true });
      atomicWrite(path, text, { createDirectory: true });
    },
    recordsIn: (directory: string) => readRecordsIn(directory),
  });
}

/**
 * The records of staged commands under a directory, as the baseline's
 * `_prestage_documents` finds them (`lib/verification_plan.py`:1882): the
 * files whose name starts with `prestage-phase-` and ends in `.json`, sorted
 * by name, and only those of the kind `specstride-prestage-evidence`. A file
 * that cannot be read as JSON is SKIPPED, as the baseline skips it.
 */
export function readRecordsIn(directory: string): readonly FoundDocument[] {
  if (!existsSync(directory)) return Object.freeze([]);
  const found: FoundDocument[] = [];
  for (const name of readdirSync(directory).sort()) {
    if (!name.startsWith(PRESTAGE_PREFIX) || !name.endsWith(".json")) continue;
    const path = join(directory, name);
    let document: unknown;
    try {
      document = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      continue;
    }
    if (document === null || typeof document !== "object") continue;
    if ((document as Record<string, unknown>)["kind"] !== PRESTAGE_KIND) continue;
    found.push(Object.freeze({ path, document: document as never }));
  }
  return Object.freeze(found);
}

/** What the command is given beside its argument list. */
export type VerifyPorts = {
  /** EP-03, the canonical spec model. `create` is the only caller. */
  readonly specModel?: SpecModelPort | undefined;
  /** EP-05, one command of the verification gate. `run` is the only caller. */
  readonly run?: CommandRunner | undefined;
  /** One command staged before. `prestage` is the only caller. */
  readonly stagedRun?: StagedCommandRunner | undefined;
  /** The one ingress of F100-FR-009; `run` and `prestage` need it. */
  readonly ingress?: CommandOutputIngress | undefined;
  /** The search path discovery and the commands document resolve names on. */
  readonly searchPath?: string | undefined;
  /** Whole seconds since the epoch, from the clock of the kernel. */
  readonly nowEpoch?: (() => number) | undefined;
  /** The revision of the source the records record. */
  readonly sourceRevision?: SourceRevision | undefined;
  /** THE ENGINE'S FACT (F105-FR-033): a loop layer is engaged. */
  readonly loopLayerEngaged?: boolean | undefined;
  /** The build artifacts of one passed build command (F105-FR-036). */
  readonly artifactsOf?:
    ((command: PlannedCommand, result: unknown) => readonly BuildArtifactRecord[]) | undefined;
  /** The process primitive and the files, for a DETACHED staged command. */
  readonly detached?: RunPrestageInput["detached"] | undefined;
  /** Whether a declared report path exists. */
  readonly reportExists?: RunPrestageInput["reportExists"] | undefined;
  /** How files are read and written; `defaultFilePort()` where absent. */
  readonly files?: VerifyFilePort | undefined;
};

/** What one call of `verify` ended with. */
export type VerifyResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** The sub-command that ran, or `undefined` where the parse refused. */
  readonly subCommand?: string | undefined;
};

/** The message of a port a sub-command needs and was not given. */
export function missingPortMessage(subCommand: string, port: string): string {
  return `${subCommand} needs the port \`${port}\`, which the caller did not hand in`;
}

/* ------------------------------------------------------------------ *
 * Loading a plan, which five of the seven sub-commands do.
 * ------------------------------------------------------------------ */

/**
 * The specification a plan is checked against, where `--specs` was given.
 * Without it the plan is loaded without the check, as the baseline loads it
 * (`load_plan(path, expected_specs=None)`).
 */
function expectedSpecOf(input: {
  readonly specs: string | undefined;
  readonly files: VerifyFilePort;
  readonly specModel: SpecModelPort | undefined;
}): ExpectedSpec | undefined {
  if (input.specs === undefined) return undefined;
  const path = requireSpecificationFile({
    path: input.specs,
    isFile: input.files.isFile,
    realPath: input.files.realPath,
  });
  const text = input.files.read(path);
  if (input.specModel === undefined) {
    // Without the grammar owner only the TEXT of the task list can be
    // compared, which is what a plan written before the projection rule is
    // checked by (`hashOfTheSourceAsThePlanWasHashed`).
    return Object.freeze({ text, realPath: path, format: "", phases: Object.freeze([]) });
  }
  const reading = input.specModel({ specPath: path, text });
  if (reading.errors !== undefined && reading.errors.length > 0) {
    throw new VerificationError(invalidSpecificationMessage(reading.errors));
  }
  return Object.freeze({
    text,
    realPath: path,
    format: reading.format,
    phases: Object.freeze([...reading.phases]),
  });
}

/** Load the plan a sub-command names, with its optional specification. */
function planOf(input: {
  readonly parsed: ParsedArguments;
  readonly ports: VerifyPorts;
  readonly files: VerifyFilePort;
}): { readonly plan: VerificationPlan; readonly path: string } {
  const path = flagValueOf(input.parsed, "--plan") as string;
  const expected = expectedSpecOf({
    specs: flagValueOf(input.parsed, "--specs"),
    files: input.files,
    specModel: input.ports.specModel,
  });
  const plan = loadPlan({
    path,
    read: input.files.read,
    ...(expected !== undefined ? { expected } : {}),
  });
  return Object.freeze({ plan, path });
}

/**
 * Where the records of staged commands live: the directory `--prestage-dir`
 * names, which MUST be absolute, and otherwise the directory of the plan, as
 * at the baseline (`_prestage_dir`, `lib/verification_plan.py`:2212).
 */
export function prestageDirectoryOf(input: {
  readonly explicit: string | undefined;
  readonly planPath: string;
}): string {
  if (input.explicit !== undefined && input.explicit !== "") {
    if (!input.explicit.startsWith("/")) {
      throw new VerificationError(`--prestage-dir must be absolute: ${input.explicit}`);
    }
    return input.explicit;
  }
  return defaultPrestageDirectoryOf(input.planPath);
}

/**
 * The revision a record records: the one the reading carries where it is
 * available, and nothing where it is not (`SourceRevision` is a union and the
 * unavailable branch has no revision at all).
 */
export function revisionOf(reading: SourceRevision | undefined): string | undefined {
  return reading !== undefined && reading.available ? reading.revision : undefined;
}

/** The as-is refusal of a result record whose place is not absolute. */
export function evidenceNotAbsoluteMessage(path: string): string {
  return `evidence output must be absolute: ${path}`;
}

/** The place of a result record, checked (`_write_evidence`, :2200). */
function requireAbsoluteEvidence(path: string): string {
  if (!path.startsWith("/")) throw new VerificationError(evidenceNotAbsoluteMessage(path));
  return path;
}

/* ------------------------------------------------------------------ *
 * The seven sub-commands.
 * ------------------------------------------------------------------ */

/** `create` — derive the plan, write it, optionally scaffold, print one record. */
async function create(input: {
  readonly parsed: ParsedArguments;
  readonly ports: VerifyPorts;
  readonly files: VerifyFilePort;
}): Promise<VerifyResult> {
  const { parsed, ports, files } = input;
  const specModel = ports.specModel;
  if (specModel === undefined) {
    throw new VerificationError(missingPortMessage("create", "specModel"));
  }
  // B-1046 — the working directory: absolute and a directory that is there.
  const workdir = requireAbsoluteDirectory(flagValueOf(parsed, "--workdir") as string, "workdir");
  // B-1047 — the specification: absolute, a file that is there, and valid in
  // its format, which only the grammar owner can say.
  const specPath = requireSpecificationFile({
    path: flagValueOf(parsed, "--specs") as string,
    isFile: files.isFile,
    realPath: files.realPath,
  });
  const text = files.read(specPath);
  // B-1048 — `--format` forces the format.
  const forced = flagValueOf(parsed, "--format");
  const reading = specModel({
    specPath,
    text,
    ...(forced !== undefined ? { format: forced } : {}),
  });
  if (reading.errors !== undefined && reading.errors.length > 0) {
    throw new VerificationError(invalidSpecificationMessage(reading.errors));
  }
  // B-1053 — the verification-commands document: absolute and a file.
  const documentPath = flagValueOf(parsed, "--verification-commands");
  const searchPath = ports.searchPath ?? "";
  const document =
    documentPath === undefined
      ? undefined
      : loadDeclaredCommands({
          path: requireCommandsDocument({ path: documentPath, isFile: files.isFile }),
          searchPath,
        });
  const derived = derivePlan({
    specPath,
    model: { format: reading.format, phases: reading.phases },
    discovery: discoverProject({ workdir, searchPath }),
    ...(document !== undefined
      ? {
          declared: {
            path: document.path,
            contentHash: document.contentHash,
            schemaVersion: document.schemaVersion,
            commands: document.commands,
            ...(document.discovery !== undefined ? { discovery: document.discovery } : {}),
          },
        }
      : {}),
    required: flagSwitchOf(parsed, "--required"),
  });
  const plan = derived.plan;
  // B-1049, B-1050 — both places absolute and inside the working directory;
  // `persistPlan` authorizes each one (F105-FR-023).
  const persisted = persistPlan({
    plan,
    markdownPath: flagValueOf(parsed, "--output") as string,
    jsonPath: flagValueOf(parsed, "--json-output") as string,
    markdown: renderPlanForPeople(plan),
    marker: markerLine(plan.contentHash),
    json: canonicalPlanFile(plan),
  });
  const scaffoldDirectory = flagValueOf(parsed, "--generate-tests");
  const generated =
    scaffoldDirectory === undefined || scaffoldDirectory === ""
      ? Object.freeze([])
      : generatedReport(writeScaffolds({ plan, outputDirectory: scaffoldDirectory }));
  // B-1037 — ONE record with the six fields, keys sorted, as `json.dumps`
  // writes it.
  const record = {
    planId: plan.id,
    contentHash: plan.contentHash,
    markdownPath: persisted.markdownPath,
    canonicalPath: persisted.jsonPath,
    declaredCommands: plan.declaredCommands ?? null,
    generated: generated.map((one) => ({
      path: one.path,
      framework: one.framework,
      reused: one.reused,
    })),
  };
  return Object.freeze({
    exitCode: SUCCESS,
    stdout: `${pythonJson(record, { sortKeys: true })}\n`,
    stderr: "",
    subCommand: "create",
  });
}

/** `validate` — load the plan and print `valid` (B-1038, B-1075). */
function validate(input: {
  readonly parsed: ParsedArguments;
  readonly ports: VerifyPorts;
  readonly files: VerifyFilePort;
}): VerifyResult {
  planOf(input);
  return Object.freeze({
    exitCode: SUCCESS,
    stdout: `${VALID_LINE}\n`,
    stderr: "",
    subCommand: "validate",
  });
}

/** `slice` — print the phase context (F105-FR-025). */
function slice(input: {
  readonly parsed: ParsedArguments;
  readonly ports: VerifyPorts;
  readonly files: VerifyFilePort;
}): VerifyResult {
  const { plan, path } = planOf(input);
  const phase = flagWholeNumberOf(input.parsed, "--phase") as number;
  const directory = prestageDirectoryOf({
    explicit: flagValueOf(input.parsed, "--prestage-dir"),
    planPath: path,
  });
  const block = renderPrestageReport({
    plan,
    phase,
    found: input.files.recordsIn(directory),
  });
  return Object.freeze({
    exitCode: SUCCESS,
    stdout: `${renderPhaseContext({ plan, phase, prestageBlock: block })}\n`,
    stderr: "",
    subCommand: "slice",
  });
}

/** `scaffold` — write the scaffolds and print the list as a record (B-1040). */
function scaffold(input: {
  readonly parsed: ParsedArguments;
  readonly ports: VerifyPorts;
  readonly files: VerifyFilePort;
}): VerifyResult {
  const { plan } = planOf(input);
  const scaffolds = writeScaffolds({
    plan,
    outputDirectory: flagValueOf(input.parsed, "--output") as string,
  });
  return Object.freeze({
    exitCode: SUCCESS,
    stdout: `${scaffoldArtifactsJson(scaffolds)}\n`,
    stderr: "",
    subCommand: "scaffold",
  });
}

/**
 * `run` — the verification gate of a phase or of the release (B-1041, B-1054,
 * B-1057). The result record is written where `--evidence-output` names one,
 * and the code is 0 when the gate passed and 10 when it failed.
 */
async function run(input: {
  readonly parsed: ParsedArguments;
  readonly ports: VerifyPorts;
  readonly files: VerifyFilePort;
}): Promise<VerifyResult> {
  const { parsed, ports, files } = input;
  const runner = ports.run;
  const ingress = ports.ingress;
  if (runner === undefined) throw new VerificationError(missingPortMessage("run", "run"));
  if (ingress === undefined) throw new VerificationError(missingPortMessage("run", "ingress"));
  // B-1054 — the phase is a whole number or the literal `release`, and the
  // refusal of anything else is read BEFORE the plan is loaded, as the
  // baseline reads it (`:2404`).
  const { plan, path } = planOf(input);
  const phase = phaseOfRun(flagValueOf(parsed, "--phase") as string);
  const revision = revisionOf(ports.sourceRevision);
  const evidence = flagValueOf(parsed, "--evidence-output");
  const attempt = flagWholeNumberOf(parsed, "--attempt") ?? attemptFromPath(evidence);
  const directory = prestageDirectoryOf({
    explicit: flagValueOf(parsed, "--prestage-dir"),
    planPath: path,
  });
  const outcome: GateOutcome = await runGate({
    plan,
    phase,
    run: runner,
    ingress,
    ...(revision !== undefined ? { sourceRevision: revision } : {}),
    ...(ports.artifactsOf !== undefined ? { artifactsOf: ports.artifactsOf as never } : {}),
    reuse: prestageReuse({
      planHash: plan.contentHash,
      gatePhase: typeof phase === "number" ? phase : undefined,
      sourceRevision: ports.sourceRevision,
      attempt,
      found: files.recordsIn(directory),
      loopLayerEngaged: ports.loopLayerEngaged ?? false,
    }),
  });
  if (evidence !== undefined && evidence !== "") {
    writeOnce({
      logicalName: GATE_RECORD_NAME,
      path: requireAbsoluteEvidence(evidence),
      record: gateResultRecord({
        planId: plan.id,
        planHash: plan.contentHash,
        gateId: outcome.gateId ?? "",
        phase: typeof phase === "number" ? phase : null,
        sourceRevision: revision ?? "",
        outcome,
        buildArtifacts: outcome.buildArtifacts,
      }),
      readExisting: files.readIfPresent,
      write: files.write,
      raise: true,
    });
  }
  return Object.freeze({
    exitCode: outcome.passed ? SUCCESS : GATE_FAILED,
    stdout: `${outcome.summary}\n`,
    stderr: "",
    subCommand: "run",
  });
}

/**
 * `prestage` — run the commands staged before a phase attempt (F105-FR-034).
 * A phase with no staged command prints the no-commands line and ends with 0
 * BEFORE anything is written, as the baseline does (`:2365`). The code is 11
 * when a command failed, for information only.
 */
async function prestage(input: {
  readonly parsed: ParsedArguments;
  readonly ports: VerifyPorts;
  readonly files: VerifyFilePort;
}): Promise<VerifyResult> {
  const { parsed, ports, files } = input;
  const runner = ports.stagedRun;
  const ingress = ports.ingress;
  if (runner === undefined) {
    throw new VerificationError(missingPortMessage("prestage", "stagedRun"));
  }
  if (ingress === undefined) {
    throw new VerificationError(missingPortMessage("prestage", "ingress"));
  }
  const { plan, path } = planOf(input);
  const phase = flagWholeNumberOf(parsed, "--phase") as number;
  const attempt = flagWholeNumberOf(parsed, "--attempt") as number;
  const directory = prestageDirectoryOf({
    explicit: flagValueOf(parsed, "--prestage-dir"),
    planPath: path,
  });
  const outcome = await runPrestage({
    plan,
    phase,
    attempt,
    directory,
    run: runner,
    ingress,
    nowEpoch: ports.nowEpoch ?? (() => Math.floor(Date.now() / 1000)),
    ...(ports.sourceRevision !== undefined ? { sourceRevision: ports.sourceRevision } : {}),
    ...(ports.detached !== undefined ? { detached: ports.detached } : {}),
    ...(ports.reportExists !== undefined ? { reportExists: ports.reportExists } : {}),
  });
  if (outcome.document !== undefined) {
    // A record of the SAME phase attempt is legitimately rewritten — a
    // resumed run re-stages, and a detached job's record is refreshed in
    // place when it finishes — so this write REPLACES, as the baseline's
    // `_write_evidence(..., overwrite=True)` does (`:2372`).
    const evidence = flagValueOf(parsed, "--evidence-output");
    const place =
      evidence !== undefined && evidence !== ""
        ? requireAbsoluteEvidence(evidence)
        : prestagePath(directory, phase, attempt);
    files.write(place, recordText(outcome.document));
  }
  return Object.freeze({
    exitCode: outcome.rc === 0 ? SUCCESS : STAGED_COMMAND_FAILED,
    stdout: `${outcome.printed}\n`,
    stderr: "",
    subCommand: "prestage",
  });
}

/**
 * `prestage-report` — the block for a prompt, WITHOUT a line end added
 * (B-1043). Nothing is printed where no record exists for the phase or the
 * record holds no command.
 */
function prestageReport(input: {
  readonly parsed: ParsedArguments;
  readonly ports: VerifyPorts;
  readonly files: VerifyFilePort;
}): VerifyResult {
  const { plan, path } = planOf(input);
  const phase = flagWholeNumberOf(input.parsed, "--phase") as number;
  const attempt = flagWholeNumberOf(input.parsed, "--attempt");
  const directory = prestageDirectoryOf({
    explicit: flagValueOf(input.parsed, "--prestage-dir"),
    planPath: path,
  });
  const block = renderPrestageReport({
    plan,
    phase,
    found: input.files.recordsIn(directory),
    ...(attempt !== undefined ? { attempt } : {}),
  });
  return Object.freeze({
    exitCode: SUCCESS,
    stdout: block,
    stderr: "",
    subCommand: "prestage-report",
  });
}

/* ------------------------------------------------------------------ *
 * The one entry point.
 * ------------------------------------------------------------------ */

/**
 * RUN ONE CALL OF `verify` (F105-FR-039).
 *
 * Every refusal this command can give is a `VerificationError`, and EVERY ONE
 * OF THEM ENDS WITH THE CODE 3 and the message after the component name on
 * standard error (B-1058). A usage error of the argument list carries the
 * as-is code of the command, which feature 100's table maps to the same 3
 * (F100-FR-182), so the command has the four codes of its row and no fifth.
 */
export async function runVerify(input: {
  readonly argv: readonly string[];
  readonly ports?: VerifyPorts | undefined;
}): Promise<VerifyResult> {
  const ports = input.ports ?? {};
  const files = ports.files ?? defaultFilePort();
  let name: string | undefined;
  try {
    const parsed = parseVerifyArguments(input.argv);
    name = parsed.subCommand.name;
    const call = Object.freeze({ parsed, ports, files });
    switch (parsed.subCommand.name) {
      case "create":
        return await create(call);
      case "validate":
        return validate(call);
      case "slice":
        return slice(call);
      case "scaffold":
        return scaffold(call);
      case "run":
        return await run(call);
      case "prestage":
        return await prestage(call);
      default:
        return prestageReport(call);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Object.freeze({
      exitCode: codeOfAThrow(error),
      stdout: "",
      stderr: errorLine(message),
      ...(name !== undefined ? { subCommand: name } : {}),
    });
  }
}

/**
 * THE ERRORS OF THIS FEATURE, each a refusal of its own work and each the
 * code 3 (B-1058, the closed set of row 52 of annex X §X.6). They are listed
 * BY CLASS and not sniffed from a field, so a new error class of this package
 * that is a refusal has to be entered here on purpose.
 *
 * Anything else that reaches the entry point is an UNCAUGHT ERROR of the
 * general rules of §G.4 and exits 70 (F100-FR-182), with its message on
 * standard error. It is NOT reported as a verification error: a programming
 * fault is not a statement about the consumer's project, and the baseline
 * leaves such a fault as a stack trace with the code 1, which is not a code of
 * `verify`'s row at all. The code 70 is read from feature 100.
 */
export const VERIFICATION_ERROR_CLASSES = Object.freeze([
  VerificationError,
  GateCannotRunError,
  WriteOnceRefusedError,
  VerificationWriteError,
  VerificationClosedSetError,
  VerificationSwitchError,
]);

/** True where an error is a refusal of this feature's own work. */
export function isAVerificationError(error: unknown): boolean {
  return VERIFICATION_ERROR_CLASSES.some((one) => error instanceof one);
}

/** The code one ending gives: 3 for a refusal of this feature, else 70. */
export function codeOfAThrow(error: unknown): number {
  if (error instanceof VerifyUsageError) return error.usageCode;
  return isAVerificationError(error) ? VERIFICATION_ERROR : UNCAUGHT_ERROR_CODE;
}

/** The marker of the plan for people, re-exported for a caller of `create`. */
export const PLAN_MARKER: typeof GENERATED_MARKER = GENERATED_MARKER;
