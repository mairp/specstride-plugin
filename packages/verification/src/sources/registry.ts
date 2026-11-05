/**
 * T091 — the plan-source registry and the BLOCKER RULES (F105-FR-015).
 *
 * Verification commands come from plan sources behind the one interface of
 * EP-07 and from nowhere else. Wave 1 ships four: the verification-commands
 * document, commands declared literally in the plan or the task list,
 * discovery of the entry points of a toolchain, and the inventory of the
 * launch contract, which its owner delivers through the same interface.
 *
 * Three rules this module is:
 *
 *  - **A blocker is never a guess.** A command that cannot be written as a
 *    fixed argument list, and two declarations that disagree, are blockers.
 *    A blocker is recorded among the `ambiguities` of the plan WITH ITS
 *    PROVENANCE, and the command it concerns does NOT enter the plan — so the
 *    mode `required` refuses the launch (F105-FR-019) and the mode `plan`
 *    lists it in the plan for people (F105-FR-022).
 *  - **A source that fails contributes nothing** and is reported as a finding;
 *    it takes the plainer path of annex A §A.4 and produces no verdict, no
 *    exit code and no stop reason of its own (F105-FR-053, F100-FR-019). In
 *    the mode `required` a phase that a failed source leaves without commands
 *    refuses the LAUNCH — the launch check of the mode, not an exit of the
 *    source.
 *  - **A source reads and never writes** (§C.9, `A_SOURCE_WRITES === false`).
 */
import { A_SOURCE_WRITES } from "@specstride/contracts/ep/verification-source";
import type { PlanCommand } from "../plan/record.ts";
import {
  ambiguityOf,
  declarationsDisagree,
  failedSourceFinding,
  notAFixedArgumentList,
  type Blocker,
  type Provenance,
  type SourceFinding,
} from "./finding.ts";

/** The four sources of Wave 1, in the order the plan takes them. */
export const WAVE_1_SOURCES = [
  "verification-commands-document",
  "literal",
  "toolchain-discovery",
  "launch-contract-inventory",
] as const;
export type Wave1Source = (typeof WAVE_1_SOURCES)[number];

/** The owner of the inventory of the launch contract: feature 107. */
export const OWNER_OF_THE_INVENTORY = "107" as const;

/** A source reads and never writes (§C.9). */
export const A_PLAN_SOURCE_WRITES = A_SOURCE_WRITES;

/** The repository root is the working directory of a literal command (F105-FR-015). */
export const DEFAULT_TIME_LIMIT_SEC = 1_800 as const;

/** What one registered source contributes to the plan. */
export type SourceContribution = {
  readonly sourceId: string;
  readonly commands: readonly PlanCommand[];
  readonly blockers: readonly Blocker[];
  readonly findings: readonly SourceFinding[];
  readonly assumptions: readonly string[];
  readonly ambiguities: readonly string[];
};

/** A registered plan source: one call that reads and never writes. */
export type RegisteredSource = {
  readonly id: string;
  /** Whether the source is one of Wave 1, for the report of the registry. */
  readonly wave1?: Wave1Source;
  read(): SourceContribution;
};

/** An empty contribution, which is what a failed source gives (§C.9). */
export function nothing(sourceId: string): SourceContribution {
  return Object.freeze({
    sourceId,
    commands: Object.freeze([]),
    blockers: Object.freeze([]),
    findings: Object.freeze([]),
    assumptions: Object.freeze([]),
    ambiguities: Object.freeze([]),
  });
}

/** What the registry gives the planner (F105-FR-015). */
export type RegistryResult = {
  /** The commands that ENTER the plan, in the order of the sources. */
  readonly commands: readonly PlanCommand[];
  /** Every blocker, each one also among `ambiguities` below. */
  readonly blockers: readonly Blocker[];
  /** Every finding, a failed source included. */
  readonly findings: readonly SourceFinding[];
  readonly assumptions: readonly string[];
  /** The ambiguities of the plan: the blockers, then the sources' own. */
  readonly ambiguities: readonly string[];
  /** The ids of the commands a blocker kept OUT of the plan. */
  readonly withheld: readonly string[];
};

/**
 * The provenance of a command, for a blocker that names it. A command the
 * sources built always has one; `line: 0` says only that the source reported
 * no line.
 */
export function provenanceOf(command: PlanCommand): Provenance {
  return command.provenance ?? Object.freeze({ file: "", line: 0 });
}

/** True where a command is a fixed argument list (F105-FR-015). */
export function isAFixedArgumentList(command: PlanCommand): boolean {
  return (
    typeof command.executable === "string" &&
    command.executable !== "" &&
    Array.isArray(command.args) &&
    command.args.every((one) => typeof one === "string")
  );
}

/** The identity two declarations must agree on: the argument list and the place. */
export function declarationIdentity(command: PlanCommand): string {
  return JSON.stringify([command.executable, [...command.args], command.cwd, command.timeoutSec]);
}

/**
 * The blockers of the registry's `conflicts` (§C.9, F105-FR-015): a command
 * that is not a fixed argument list, and two declarations of the same declared
 * id that disagree.
 */
export function blockersOf(contributions: readonly SourceContribution[]): readonly Blocker[] {
  const blockers: Blocker[] = [];
  const seen = new Map<string, PlanCommand>();
  for (const contribution of contributions) {
    for (const command of contribution.commands) {
      if (!isAFixedArgumentList(command)) {
        blockers.push(
          notAFixedArgumentList({
            message:
              `the command \`${command.declaredId ?? command.id}\` cannot be written as a ` +
              "fixed argument list and is never guessed",
            provenance: Object.freeze([provenanceOf(command)]),
          }),
        );
        continue;
      }
      const key = command.declaredId ?? command.id;
      const earlier = seen.get(key);
      if (earlier !== undefined && declarationIdentity(earlier) !== declarationIdentity(command)) {
        blockers.push(
          declarationsDisagree({
            message: `two declarations of \`${key}\` disagree`,
            provenance: Object.freeze([provenanceOf(earlier), provenanceOf(command)]),
          }),
        );
        continue;
      }
      seen.set(key, command);
    }
  }
  return Object.freeze(blockers);
}

/** The declared ids a blocker concerns, which never enter the plan. */
export function withheldOf(blockers: readonly Blocker[]): readonly string[] {
  const ids: string[] = [];
  for (const blocker of blockers) {
    const match = /`([^`]+)`/.exec(blocker.message);
    const id = match?.[1];
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return Object.freeze(ids);
}

/**
 * Read every registered source (F105-FR-015). A source that THROWS is a
 * source that failed: it contributes nothing and is reported as a finding, and
 * the registry never rethrows — a plan source produces no verdict, no exit
 * code and no stop reason of its own (F105-FR-053).
 */
export function readEverySource(sources: readonly RegisteredSource[]): RegistryResult {
  const contributions: SourceContribution[] = [];
  const findings: SourceFinding[] = [];
  for (const source of sources) {
    try {
      contributions.push(source.read());
    } catch (error) {
      contributions.push(nothing(source.id));
      findings.push(
        failedSourceFinding({
          sourceId: source.id,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  const blockers = blockersOf(contributions);
  const withheld = withheldOf(blockers);
  const commands: PlanCommand[] = [];
  for (const contribution of contributions) {
    for (const command of contribution.commands) {
      // A blocker keeps its command OUT of the plan (F105-FR-015).
      if (withheld.includes(command.declaredId ?? command.id)) continue;
      commands.push(command);
    }
  }
  for (const contribution of contributions) findings.push(...contribution.findings);
  return Object.freeze({
    commands: Object.freeze(commands),
    blockers,
    findings: Object.freeze(findings),
    assumptions: Object.freeze(contributions.flatMap((one) => [...one.assumptions])),
    ambiguities: Object.freeze([
      ...blockers.map(ambiguityOf),
      ...contributions.flatMap((one) => [...one.ambiguities]),
    ]),
    withheld,
  });
}

/**
 * The launch check of the mode `required` for a phase a failed source left
 * without commands (F105-FR-015, F105-FR-053): it is the check of the MODE and
 * never an exit of the source, so it returns the message and the caller of the
 * derivation refuses the launch.
 */
export function phasesWithoutACommand(input: {
  readonly phases: readonly number[];
  readonly commands: readonly PlanCommand[];
  readonly suiteCommandsOf?: ((phase: number) => readonly string[]) | undefined;
}): readonly number[] {
  return Object.freeze(
    input.phases.filter((phase) => {
      if (input.suiteCommandsOf !== undefined) return input.suiteCommandsOf(phase).length === 0;
      return !input.commands.some((command) => command.phase === phase);
    }),
  );
}
