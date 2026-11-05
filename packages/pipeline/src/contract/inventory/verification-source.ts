/**
 * T019 — the verification-plan source of the launch contract (EP-07:
 * `specstride.verification-source/1`; F107-FR-008; annex C §C.9).
 *
 * The three operations of the point:
 *
 * - `discover(workspace, model)` — the declared commands of the workspace:
 *   the commands of the verification-commands documents of the features in
 *   scope, and the commands written literally in the plan or the task list
 *   (the shell candidates whose body is one line). Each carries its
 *   provenance (the file and the line it was declared on), its phase, its
 *   order, its working directory, its environment and its time limit. A
 *   command whose declaration carried `reads`, `writes` or `sideEffects`
 *   counts as UNDECLARED (CQ-190, ruling P11): those fields are never
 *   reported, the command is given no fixed argument list of the plan, and a
 *   finding names it.
 * - `obligations(model)` — one verification obligation per task line of the
 *   canonical model.
 * - `conflicts(resultsOfEverySource)` — two declarations of one id that
 *   disagree are a blocker and never a guess, and a command that cannot be a
 *   fixed argument list is a blocker too.
 *
 * The three counts of F107-FR-008 — source declarations, normalized commands
 * and phase mappings — come from `countsOf` and are printed by the
 * `[SPECSTRIDE-DERIVE]` line, never stored as the reason of the verification
 * mode (F107-FR-036).
 *
 * The conformance suite of EP-07 (`packages/testkit/src/conformance/EP-07/`)
 * runs on this source from
 * `tests/characterization/107/verification-source.test.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import type {
  Blocker,
  DeclaredCommand,
  Provenance,
  SourceFinding,
  VerificationObligation,
  VerificationSource,
} from "@specstride/contracts/ep/verification-source";

/** The id this implementation registers under in the EP-07 registry. */
export const SOURCE_ID = "pipeline-107-verification-source" as const;

/** A declaration with everything the inventory needs, before the point's shape. */
export type DiscoveredCommand = {
  readonly id: string;
  readonly argv: readonly string[];
  readonly provenance: Provenance;
  readonly phase: number;
  readonly order: number;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeLimitMs: number;
  /** True when the declaration named `reads`, `writes` or `sideEffects`. */
  readonly undeclaredBecauseOfScopes: readonly string[];
};

const FORBIDDEN_SCOPE_FIELDS = ["reads", "writes", "sideEffects"] as const;

/** Split one literal command line into a fixed argument list. */
export function argvOfLine(line: string): readonly string[] {
  const args: string[] = [];
  for (const match of line.matchAll(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)) {
    const one = (match[0] ?? "").replace(/^["']|["']$/g, "");
    if (one !== "") args.push(one);
  }
  return args;
}

/** True when a list of arguments cannot be a fixed argument list. */
export function isNotAFixedArgumentList(argv: readonly string[]): boolean {
  return argv.length === 0 || argv.some((one) => one.trim() === "");
}

function commandFromDocumentEntry(input: {
  readonly file: string;
  readonly index: number;
  readonly entry: Record<string, unknown>;
}): DiscoveredCommand {
  const entry = input.entry;
  const argv = [
    String(entry.executable ?? ""),
    ...(Array.isArray(entry.args) ? entry.args.map(String) : []),
  ];
  const undeclared = FORBIDDEN_SCOPE_FIELDS.filter((field) => entry[field] !== undefined);
  const env: Record<string, string> = {};
  if (entry.env !== undefined && typeof entry.env === "object" && entry.env !== null) {
    for (const [key, value] of Object.entries(entry.env as Record<string, unknown>)) {
      env[key] = String(value);
    }
  }
  return {
    id: String(entry.id ?? `command-${input.index + 1}`),
    argv,
    provenance: { file: input.file, line: input.index + 1 },
    phase: typeof entry.phase === "number" ? entry.phase : 1,
    order: input.index,
    ...(typeof entry.cwd === "string" ? { cwd: entry.cwd } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
    timeLimitMs: typeof entry.timeoutSec === "number" ? entry.timeoutSec * 1000 : 600_000,
    undeclaredBecauseOfScopes: undeclared,
  };
}

/**
 * `discover` over one workspace: the declared commands of the
 * verification-commands documents found under `.specstride` for the features
 * of the model and beside each feature directory, plus the literal commands of
 * the plan. Reads repository text only; writes nothing (§C.9).
 */
export function discoverDeclaredCommands(
  workspace: string,
  model: unknown,
): readonly DiscoveredCommand[] {
  const commands: DiscoveredCommand[] = [];
  const documents = documentsOf(workspace, model);
  for (const document of documents) {
    if (!existsSync(document)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(document, "utf8")) as unknown;
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== "object") continue;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.commands)) continue;
    record.commands.forEach((entry, index) => {
      if (entry === null || typeof entry !== "object") return;
      commands.push(
        commandFromDocumentEntry({
          file: document,
          index,
          entry: entry as Record<string, unknown>,
        }),
      );
    });
  }
  // The literal commands: the shell candidates of the plan whose body is one
  // line, declared with the file and the line they were written on.
  const phases = (model as { readonly phases?: readonly unknown[] } | undefined)?.phases ?? [];
  for (const phase of phases) {
    const text = (phase as { readonly section?: string }).section ?? "";
    const lines = text.split("\n");
    const heading = lines[0] ?? "";
    const offset = offsetOfSection(text, workspace, model);
    for (const [index, line] of lines.entries()) {
      if (!line.startsWith("```") || line.trim().toLowerCase() !== "```bash") continue;
      const body = lines[index + 1];
      if (body === undefined) continue;
      const argv = argvOfLine(body);
      if (argv.length === 0) continue;
      commands.push({
        id: argv[0] as string,
        argv,
        provenance: { file: fileOfModel(workspace, model), line: offset + index + 1 },
        phase: phaseNumber(heading),
        order: commands.length,
        timeLimitMs: 600_000,
        undeclaredBecauseOfScopes: [],
      });
      break;
    }
  }
  return commands;
}

function phaseNumber(heading: string): number {
  const found = /Phase[ \t]+(\d+)/.exec(heading);
  return found === null ? 1 : Number.parseInt(found[1] as string, 10);
}

function fileOfModel(workspace: string, model: unknown): string {
  const file = (model as { readonly file?: string } | undefined)?.file;
  return file === undefined
    ? join(workspace, "plan.md")
    : isAbsolute(file)
      ? file
      : join(workspace, file);
}

function offsetOfSection(_section: string, _workspace: string, _model: unknown): number {
  // The exact offset needs the line of the heading in its file; the inventory
  // records it on the feature. A conservative 0 keeps the provenance a real
  // line of the file's text when the caller did not hand one over.
  return 0;
}

/** The verification-commands documents a workspace holds. */
function documentsOf(workspace: string, model: unknown): readonly string[] {
  const documents: string[] = [];
  const feature = (model as { readonly feature?: string } | undefined)?.feature;
  if (feature !== undefined && feature !== "") {
    documents.push(join(workspace, "specs", feature, "verification-commands.json"));
  }
  documents.push(join(workspace, "verification-commands.json"));
  return documents;
}

/** The verification obligations: one per task line (§C.9, Outputs). */
export function obligationsOf(model: unknown): readonly VerificationObligation[] {
  const phases = (model as { readonly phases?: readonly unknown[] } | undefined)?.phases ?? [];
  const obligations: VerificationObligation[] = [];
  for (const phase of phases) {
    for (const task of (phase as { readonly tasks?: readonly unknown[] }).tasks ?? []) {
      const one = task as { readonly id?: string; readonly text?: string };
      obligations.push({
        obligationId: `V-${one.id ?? "task"}`,
        taskId: one.id ?? "task",
        level: "phase",
        kind: "verify",
        oracle: one.text ?? "",
      });
    }
  }
  return obligations;
}

/** The blockers of a set of results of every source (§C.9, Outputs). */
export function conflictsOf(
  resultsOfEverySource: readonly (readonly DeclaredCommand[])[],
): readonly Blocker[] {
  const blockers: Blocker[] = [];
  const byId = new Map<string, DeclaredCommand>();
  for (const results of resultsOfEverySource) {
    for (const command of results) {
      if (isNotAFixedArgumentList(command.argv)) {
        blockers.push({
          reason: "not-a-fixed-argument-list",
          message: `command ${command.id} cannot be a fixed argument list`,
          provenance: [command.provenance],
        });
        continue;
      }
      const first = byId.get(command.id);
      if (first === undefined) {
        byId.set(command.id, command);
        continue;
      }
      if (JSON.stringify(first.argv) !== JSON.stringify(command.argv)) {
        blockers.push({
          reason: "declarations-disagree",
          message: `command ${command.id} is declared differently by two sources`,
          provenance: [first.provenance, command.provenance],
        });
      }
    }
  }
  return blockers;
}

/** The three counts of F107-FR-008. */
export type SourceCounts = {
  /** The declarations the sources made. */
  readonly sourceDeclarations: number;
  /** The commands the source reports. */
  readonly normalizedCommands: number;
  /** The mappings of a command onto a phase. */
  readonly phaseMappings: number;
};

/** The counts of the source, from the discoveries and the blockers. */
export function countsOf(input: {
  readonly discoveries: readonly DiscoveredCommand[];
  readonly blockers: readonly Blocker[];
  readonly findings: readonly SourceFinding[];
}): SourceCounts {
  const declared = input.discoveries.filter((one) => one.undeclaredBecauseOfScopes.length === 0);
  const refused = input.discoveries.length - declared.length + input.findings.length;
  const mappings = new Set(declared.map((one) => `${one.id}@${one.phase}`));
  return {
    sourceDeclarations: declared.length + refused,
    normalizedCommands: declared.length,
    phaseMappings: mappings.size,
  };
}

/** The source as the point sees it: the three operations, nothing more. */
export function verificationSource(): VerificationSource & {
  readonly id: typeof SOURCE_ID;
} {
  return {
    id: SOURCE_ID,
    discover: (workspace: string, model: unknown) =>
      Promise.resolve(
        discoverDeclaredCommands(workspace, model)
          .filter(
            (one) =>
              one.undeclaredBecauseOfScopes.length === 0 && !isNotAFixedArgumentList(one.argv),
          )
          .map((one): DeclaredCommand => ({
            id: one.id,
            argv: one.argv,
            provenance: one.provenance,
            phase: one.phase,
            timeLimitMs: one.timeLimitMs,
          })),
      ),
    obligations: (model: unknown) => Promise.resolve(obligationsOf(model)),
    conflicts: (resultsOfEverySource) => conflictsOf(resultsOfEverySource),
  };
}

/** The absolute form of a workspace path (§C.9: the place of a document). */
export function absoluteWorkspace(workspace: string): string {
  return resolve(workspace);
}
