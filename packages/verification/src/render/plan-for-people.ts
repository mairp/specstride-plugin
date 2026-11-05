/**
 * T098 — the verification plan FOR PEOPLE (F105-FR-022).
 *
 * It starts with `<!-- specstride-verification-plan content-hash: <hash> -->`
 * and holds the sections Provenance, Coverage obligations, Phase gates,
 * Effect-witness policy, Automated commands, and Ambiguities and blockers.
 * Provenance names the hash of the plan AND the hash of the source. It is
 * written under `feature:<slug>:verification:test-plan`.
 *
 * `./lisa-render.ts` beside this file is Lisa's renderer, extracted and
 * pinned; its marker is `lisa-verification-plan` and its headings are Lisa's.
 * This module is the one the derivation writes, and it is the SPECSTRIDE
 * baseline's (`lib/verification_plan.py`:1263) — which is the change
 * `EXTRACTED.md` listed under "What a later phase changes on purpose".
 */
import { holdsLogicalName } from "@specstride/contracts/ids/logical-names";
import { pythonJson } from "../plan/hash.ts";
import type { PlanCommand, VerificationPlan } from "../plan/record.ts";

/** The marker the first line carries (F105-FR-022, the as-is literal). */
export const GENERATED_MARKER = "<!-- specstride-verification-plan content-hash:" as const;

/** The first line of the plan for people (F105-FR-022). */
export function markerLine(contentHash: string): string {
  return `${GENERATED_MARKER} ${contentHash} -->`;
}

/** The logical name the plan for people is written under (F105-FR-022). */
export const PLAN_FOR_PEOPLE_NAME = "feature:<slug>:verification:test-plan" as const;

/** The place of the plan for people of one feature (F105-FR-022). */
export function planForPeopleNameOf(slug: string): string {
  return PLAN_FOR_PEOPLE_NAME.replace("<slug>", slug);
}

/** True where the logical name of the plan for people is one feature 100 knows. */
export function theNameIsKnown(): boolean {
  return holdsLogicalName(PLAN_FOR_PEOPLE_NAME);
}

/** The six sections F105-FR-022 names, in the order the plan holds them. */
export const SECTIONS = [
  "Provenance",
  "Coverage obligations",
  "Phase gates",
  "Effect-witness policy",
  "Automated commands",
  "Ambiguities and blockers",
] as const;

/** The heading of the title of the document (`:1264`). */
export const TITLE = "# Verification and Test Automation Plan" as const;

/**
 * The baseline writes EXACTLY the six sections above and no further one. Lisa's
 * renderer (`./lisa-render.ts`) writes three more — Release gate, Assumptions,
 * Evidence requirements — and that is one of the differences `EXTRACTED.md`
 * records as a change a later phase makes on purpose.
 */
export const FURTHER_SECTIONS: readonly string[] = Object.freeze([]);

/** The policy of the section Effect-witness policy (`:1313`). */
export const EFFECT_WITNESS_POLICY =
  "A mutation response is never sufficient evidence. Observe resulting state through an independent read path." as const;

/** The line a plan with no command at all carries (`:1322`). */
export const NO_COMMAND_LINE =
  "No safe automated command was discovered; operator clarification is required." as const;

/** The line the section Ambiguities and blockers carries when there is none. */
export const NONE_LINE = "- None." as const;

/** A cell of the table of obligations, with its two escapes (`:1283`). */
export function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/**
 * The command as a reader of the plan sees it (`lib/verification_plan.py`
 * `_command_line`, :1246). The environment overlay is PART of the command as
 * far as a reader is concerned: a proposer handed a command that only passes
 * under one variable cannot reproduce the gate it is judged by. A part that
 * holds a space is quoted as JSON quotes it.
 */
export function commandLine(command: PlanCommand): string {
  const quote = (value: string): string => (/\s/.test(value) ? pythonJson(value) : value);
  const prefix = Object.entries(command.env ?? {})
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${quote(value)}`);
  return [...prefix, ...[command.executable, ...command.args].map(quote)].join(" ");
}

/** The plan for people (F105-FR-022, `lib/verification_plan.py`:1263). */
export function renderPlanForPeople(plan: VerificationPlan): string {
  const lines: string[] = [
    markerLine(plan.contentHash),
    TITLE,
    "",
    "## Provenance",
    "",
    `- Plan ID: \`${plan.id}\``,
    `- Plan content hash: \`${plan.contentHash}\``,
    `- Source bundle ID: \`${plan.source.bundleId}\``,
    `- Source semantic hash: \`${plan.source.contentHash}\``,
    `- Source specification: \`${plan.source.specPath}\``,
    `- Absolute workdir: \`${plan.project.workdir}\``,
    `- Project fingerprint: \`${plan.project.fingerprint}\``,
    "",
    "## Coverage obligations",
    "",
    "| ID | Outcome | Level | Kind | Automation | Phase |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const obligation of plan.obligations) {
    lines.push(
      `| ${obligation.id} | ${cell(obligation.title)} | ${obligation.level} | ` +
        `${obligation.kind} | ${obligation.automationStatus} | ${obligation.phase ?? "release"} |`,
    );
  }
  lines.push("", "## Phase gates", "");
  for (const gate of plan.gates) {
    if (gate.scope !== "phase") continue;
    lines.push(
      `### Phase ${gate.phase}`,
      "",
      `- Gate ID: \`${gate.id}\``,
      `- Required: ${gate.required ? "yes" : "no"}`,
      `- Cumulative: ${gate.cumulative ? "yes" : "no"}`,
      `- Obligations: ${gate.obligationRefs.map((one) => `\`${one}\``).join(", ")}`,
      "",
    );
  }
  lines.push(
    "## Effect-witness policy",
    "",
    EFFECT_WITNESS_POLICY,
    "",
    "## Automated commands",
    "",
  );
  if (plan.commands.length === 0) lines.push(NO_COMMAND_LINE, "");
  for (const command of plan.commands) {
    lines.push(
      `### ${command.label}`,
      "",
      `- Command ID: \`${command.id}\``,
      `- Absolute working directory: \`${command.cwd}\``,
      "",
      "```bash",
      commandLine(command),
      "```",
      "",
    );
  }
  lines.push("## Ambiguities and blockers", "");
  if (plan.ambiguities.length > 0) {
    for (const ambiguity of plan.ambiguities) lines.push(`- ${ambiguity}`);
  } else {
    lines.push(NONE_LINE);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * The canonical record of the plan as the baseline writes it to disk
 * (`lib/verification_plan.py`:1391): `json.dumps(plan, indent=2,
 * sort_keys=True)` and one line end.
 */
export function canonicalPlanFile(plan: VerificationPlan): string {
  return `${pythonJson(plan, { indent: 2, sortKeys: true })}\n`;
}

/** The headings of the sections of a rendered plan, in the order they stand. */
export function sectionsOf(text: string): readonly string[] {
  return Object.freeze(
    text
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3)),
  );
}
