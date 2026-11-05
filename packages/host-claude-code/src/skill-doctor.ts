/**
 * T010 of `specs/113-host-claude-code/tasks.md` — the doctor skill source
 * (F113-FR-015).
 *
 * F113-FR-015: the skill MUST run the doctor command, print the findings terse
 * with the fix of each, and print the command to run when a CLI is missing or
 * mismatched. It MUST NOT install or update anything. It MUST report the exit
 * codes 0, 1, 2, 3 as annex G §G.4 gives them.
 *
 * The four codes and their meanings are READ from the per-command table of
 * annex G §G.4 (`@specstride/contracts/codes/commands`), never written here, so
 * a change of the annex cannot leave this skill behind. The install command and
 * the protocol refusal come from `./shim/index.ts`, the one place that knows
 * them.
 */
import { SEVERITIES } from "@specstride/contracts/ep/doctor";
import type { SkillSource } from "@specstride/contracts/ep/host";
import { commandCodeRow } from "@specstride/contracts/codes/commands";
import { BODY_BYTE_LIMITS, BYTE_BUDGETS, assertBodyFitsItsLimit } from "./skill-budgets.ts";
import {
  INSTALL_COMMAND,
  PROTOCOL_MISMATCH_EXIT_CODE,
  PROTOCOL_MISMATCH_LINE,
  PUBLISHED_PACKAGE,
  supportedRange,
} from "./shim/index.ts";
import { dataFramingSection } from "./skill-common.ts";

/** The logical id of this skill, row 144 of annex X §X.6: `doctor`. */
export const DOCTOR_SKILL_LOGICAL_ID = "doctor" as const;

/** The command of the CLI the skill is a thin layer over. */
export const DOCTOR_COMMAND = "doctor" as const;

/** The severities of a finding, from EP-14 (annex G §G.7). */
export const FINDING_SEVERITIES = SEVERITIES;

/** One exit code of `doctor` with the meaning annex G §G.4 gives it. */
export type DoctorExit = { readonly code: number; readonly meaning: string };

/**
 * The exit codes of `doctor` with their meanings, read out of the cell of the
 * per-command table of annex G §G.4: "0 no `fail` finding; 1 the doctor could
 * not run; 2 at least one `fail` finding; 3 usage error."
 */
export const DOCTOR_EXITS: readonly DoctorExit[] = Object.freeze(
  (() => {
    const row = commandCodeRow(DOCTOR_COMMAND);
    if (row === undefined) {
      throw new Error(`annex G §G.4 holds no row for the command \`${DOCTOR_COMMAND}\``);
    }
    const exits: DoctorExit[] = [];
    for (const part of row.codes.split(";")) {
      const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(part.replace(/\.\s*`--strict`.*$/s, ""));
      if (match === null) continue;
      exits.push(Object.freeze({ code: Number(match[1]), meaning: match[2] ?? "" }));
    }
    if (exits.length === 0) {
      throw new Error(`annex G §G.4 names no exit code of \`${DOCTOR_COMMAND}\``);
    }
    return exits;
  })(),
);

/** The four codes F113-FR-015 names, in the order of the annex. */
export const DOCTOR_EXIT_CODES: readonly number[] = Object.freeze(DOCTOR_EXITS.map((e) => e.code));

/** The meaning of an exit code, as annex G §G.4 gives it. */
export function meaningOfExit(code: number): string | undefined {
  return DOCTOR_EXITS.find((e) => e.code === code)?.meaning;
}

/** F113-FR-015 — the skill installs and updates nothing. */
export const INSTALLS_OR_UPDATES = false as const;

/** The command the skill PRINTS, and never runs, when the CLI is missing. */
export const MISSING_CLI_COMMAND = INSTALL_COMMAND;

/** The package that command names, with no range (F113-FR-042). */
export const MISSING_CLI_PACKAGE = PUBLISHED_PACKAGE;

/** The refusal line of a protocol mismatch, and its exit code. */
export const MISMATCH_LINE = PROTOCOL_MISMATCH_LINE;
export const MISMATCH_EXIT_CODE = PROTOCOL_MISMATCH_EXIT_CODE;

/** The range of protocols the plugin supports, for the mismatch line. */
export const SUPPORTED_PROTOCOL_RANGE = supportedRange();

/** The one-line description of the skill, which the host shows in its list. */
export const DOCTOR_SKILL_DESCRIPTION: string =
  "Check this machine for Specstride: run the doctor, list each finding with its fix, and print " +
  "the command to run when the CLI is missing or its protocol does not match. It installs and " +
  "updates nothing.";

/** The Markdown body of the doctor skill, built from the declarations above. */
export function doctorSkillBody(): string {
  const lines: string[] = [
    "# Check Specstride on this machine",
    "",
    "A thin layer over the Specstride CLI.",
    "",
    "## Order",
    "",
    `1. Run \`${DOCTOR_COMMAND}\` through the shim.`,
    `2. Print every finding TERSE: one line each, \`<severity> <check> — <fix>\`. The`,
    `   severities are \`${FINDING_SEVERITIES.join("`, `")}\`; a finding without a fix is`,
    "   printed with the fix the CLI gave, and never with one of your own.",
    "3. Report the exit code with its meaning, as the table of the CLI gives it:",
    ...DOCTOR_EXITS.map((exit) => `   - \`${exit.code}\`: ${exit.meaning}.`),
    "",
    "## A missing or mismatched CLI",
    "",
    `- No CLI: print the command to run, \`${MISSING_CLI_COMMAND}\`, and stop. Never run it.`,
    `- Protocol mismatch: print the shim's one line, which starts \`${MISMATCH_LINE}\`, names ` +
      `this skill and carries both integers, and exit ${MISMATCH_EXIT_CODE}. The protocol this ` +
      `plugin supports is ${SUPPORTED_PROTOCOL_RANGE}.`,
    "- A plugin version and a CLI version that differ while the protocol matches are a " +
      "difference to SHOW, not a reason to refuse.",
    "",
    "## Never",
    "",
    "- Never install, update, fetch or remove anything, and never edit a file of the",
    "  consumer's repository. You print commands; the consumer runs them.",
    "",
    ...dataFramingSection(),
    "",
  ];
  return lines.join("\n");
}

/** The doctor skill source, as `renderSkill` takes it. */
export function doctorSkillSource(): SkillSource {
  const body = doctorSkillBody();
  assertBodyFitsItsLimit(DOCTOR_SKILL_LOGICAL_ID, body);
  return Object.freeze({
    logicalId: DOCTOR_SKILL_LOGICAL_ID,
    body,
    references: Object.freeze([]),
    budget: BYTE_BUDGETS.doctor,
  });
}

/** The byte limit of the BODY of this skill, from the design point of plan.md. */
export const DOCTOR_BODY_BYTE_LIMIT = BODY_BYTE_LIMITS[DOCTOR_SKILL_LOGICAL_ID];
