/**
 * T101 — the PHASE CONTEXT that prompts receive (F105-FR-025).
 *
 * It starts with `## Verification obligations`,
 * `Canonical verification plan: <id>`, `Verification plan hash: <hash>` and
 * `Source semantic hash: <hash>`. The obligations OF THE CURRENT PHASE are
 * rendered in full; those of EARLIER phases are one line each under the as-is
 * heading — the verification gate of phase N carries a cumulative obligation
 * set, and rendering sixty-five of them in full prose overflowed the agent's
 * context at the baseline, which is why the two halves read differently.
 *
 * It lists EVERY command of the cumulative verification gate under
 * `### Commands this phase's gate will execute`, with the environment, the
 * working directory and the time limit, WITHOUT REGARD to excluded commands:
 * the list is what the phase is judged against, and a reader must see the
 * whole of it.
 *
 * Where a record of commands staged before exists for the phase, the context
 * ends with THE BLOCK OF THOSE COMMANDS after an empty line; without such a
 * record nothing is added. The block arrives as an OPTIONAL LAST PART, which
 * T128 of phase 6 supplies (`prestage-report`, F105-FR-039) — this module
 * never reads a record of staged commands itself.
 *
 * A phase without a verification gate in the plan gives an EMPTY phase context
 * (F105-FR-018).
 */
import { gateOfThePlan, PHASE_CONTEXT_OF_A_PHASE_WITHOUT_A_GATE } from "../plan/suites.ts";
import type { PlanObligation, VerificationPlan } from "../plan/record.ts";
import { commandLine } from "./plan-for-people.ts";

/** The first heading of the phase context (F105-FR-025, an as-is literal). */
export const HEADING = "## Verification obligations" as const;

/** The heading of the list of commands (F105-FR-025, an as-is literal). */
export const COMMANDS_HEADING = "### Commands this phase's gate will execute" as const;

/** The heading the inherited obligations stand under (F105-FR-025). */
export const INHERITED_HEADING =
  "### Inherited obligations from earlier approved phases (regression context — " +
  "already gated, not new work; the cumulative gate still re-checks them):";

/** The sentence under the heading of the commands (`lib/verification_plan.py`:1407). */
export const COMMANDS_SENTENCE =
  "These run with shell=False before the critic sees anything. They are the only thing " +
  "that can clear the gate — restating the evidence cannot.";

/** The sentence that says a scaffold is never passing evidence (F105-FR-024). */
export const SCAFFOLD_SENTENCE =
  "Create or update automated tests for these obligations. Generated TODO/skip scaffolds " +
  "are starting points only and are never passing evidence.";

/** The last sentence of the context (`:1425`). */
export const EVIDENCE_SENTENCE =
  "The phase evidence must map every obligation above to independently observable evidence." as const;

/** The three lines of provenance after the heading (F105-FR-025). */
export function provenanceLines(plan: VerificationPlan): readonly string[] {
  return Object.freeze([
    `Canonical verification plan: ${plan.id}`,
    `Verification plan hash: ${plan.contentHash}`,
    `Source semantic hash: ${plan.source.contentHash}`,
  ]);
}

/** One obligation of the CURRENT phase, in full (`:1372`). */
export function obligationInFull(obligation: PlanObligation): readonly string[] {
  return Object.freeze([
    `### ${obligation.id} — ${obligation.title}`,
    `- Level: ${obligation.level}`,
    `- Kind: ${obligation.kind}`,
    `- Action: ${obligation.action}`,
    ...obligation.oracle.map((one) => `- Oracle: ${one}`),
    ...obligation.witnesses.map((one) => `- Witness: ${one}`),
    ...obligation.negativeCases.map((one) => `- Negative case: ${one}`),
    "",
  ]);
}

/** One obligation of an EARLIER phase, as one line (`:1392`). */
export function obligationInOneLine(obligation: PlanObligation): string {
  return `- ${obligation.id} — ${obligation.title}`;
}

/** One command of the gate, as the context lists it (`:1418`). */
export function commandLineOfTheContext(command: {
  readonly executable: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly cwd: string;
  readonly timeoutSec: number;
}): string {
  return `- \`${commandLine(command as never)}\` (cwd ${command.cwd}, timeout ${command.timeoutSec}s)`;
}

/**
 * The commands the phase context lists (F105-FR-025): every command of every
 * suite the gate names, in order, each once, WITHOUT REGARD to excluded
 * commands — so this reading is NOT `commandIdsOfGate` of `../plan/suites.ts`,
 * which applies the exclusion because the gate EXECUTES that selection.
 */
export function commandIdsOfTheContext(input: {
  readonly plan: VerificationPlan;
  readonly phase: number;
}): readonly string[] {
  const gate = gateOfThePlan(input.plan.gates, input.phase);
  if (gate === undefined) return Object.freeze([]);
  const bySuite = new Map(input.plan.suites.map((suite) => [suite.id, suite]));
  const ids: string[] = [];
  for (const suiteId of gate.suiteRefs) {
    for (const commandId of bySuite.get(suiteId)?.commandRefs ?? []) {
      if (!ids.includes(commandId)) ids.push(commandId);
    }
  }
  return Object.freeze(ids);
}

/** The phase context (F105-FR-025, `lib/verification_plan.py`:1146). */
export function renderPhaseContext(input: {
  readonly plan: VerificationPlan;
  readonly phase: number;
  /**
   * The block of the commands staged before, which T128 of phase 6 supplies
   * (`prestage-report`, F105-FR-039). Without one NOTHING is added.
   */
  readonly prestageBlock?: string | undefined;
}): string {
  const gate = gateOfThePlan(input.plan.gates, input.phase);
  // A phase without a verification gate gives an EMPTY context (F105-FR-018).
  if (gate === undefined) return PHASE_CONTEXT_OF_A_PHASE_WITHOUT_A_GATE;
  const byId = new Map(input.plan.obligations.map((one) => [one.id, one]));
  const current: PlanObligation[] = [];
  const inherited: PlanObligation[] = [];
  for (const ref of gate.obligationRefs) {
    const obligation = byId.get(ref);
    if (obligation === undefined) continue;
    if (obligation.phase === input.phase) current.push(obligation);
    else inherited.push(obligation);
  }
  const lines: string[] = [HEADING, ...provenanceLines(input.plan), ""];
  for (const obligation of current) lines.push(...obligationInFull(obligation));
  if (inherited.length > 0) {
    lines.push(INHERITED_HEADING);
    for (const obligation of inherited) lines.push(obligationInOneLine(obligation));
    lines.push("");
  }
  const byCommandId = new Map(input.plan.commands.map((one) => [one.id, one]));
  const commandIds = commandIdsOfTheContext({ plan: input.plan, phase: input.phase });
  if (commandIds.length > 0) {
    lines.push(COMMANDS_HEADING, COMMANDS_SENTENCE);
    for (const id of commandIds) {
      const command = byCommandId.get(id);
      if (command === undefined) continue;
      lines.push(commandLineOfTheContext(command));
    }
    lines.push("");
  }
  lines.push(SCAFFOLD_SENTENCE, EVIDENCE_SENTENCE);
  // The block of the commands staged before, after an EMPTY LINE; without a
  // record nothing is added (F105-FR-025).
  if (input.prestageBlock !== undefined && input.prestageBlock !== "") {
    lines.push("", input.prestageBlock.replace(/\s+$/, ""));
  }
  return lines.join("\n");
}

/**
 * The directory the records of staged commands default to for the public
 * command: THE DIRECTORY OF THE PLAN, as at the baseline (F105-FR-025,
 * `lib/verification_plan.py` `_prestage_dir`, :2213).
 */
export function defaultPrestageDirectoryOf(planPath: string): string {
  const at = planPath.lastIndexOf("/");
  return at <= 0 ? "/" : planPath.slice(0, at);
}
