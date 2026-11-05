/**
 * The RENDERER of Lisa's verification package — the plan for people —
 * extracted as source (T006, `research.md` D-1; recorded in
 * `../../EXTRACTED.md`).
 *
 * Extracted from `packages/verification/src/render.ts` of Lisa at `363e6a3`
 * (141 lines, the whole file), read with
 * `git -C <lisa> show 363e6a3:packages/verification/src/render.ts`.
 *
 * The one change of the extraction: the type-only import comes from
 * `../plan/lisa-plan.ts` instead of `@lisa/core` — the same shapes, and a
 * type import emits nothing. `cell`, `commandLine` and `obligationRows` stay
 * module-private, as at the baseline.
 *
 * As extracted, and a LATER phase of this feature changes each on purpose:
 * the generated marker is `<!-- lisa-verification-plan content-hash: … -->`
 * (the Specstride baseline writes `specstride-verification-plan`,
 * F105-FR-022, item B-1060), and the headings are Lisa's. Every line of the
 * projection below is pinned as it was extracted by
 * `tests/characterization/105/CT-105-2.test.ts`.
 */
import type {
  VerificationCommand,
  VerificationObligation,
  VerificationPlanV1,
} from "../plan/lisa-plan.ts";

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function commandLine(command: VerificationCommand): string {
  return [command.executable, ...command.args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function obligationRows(obligations: VerificationObligation[]): string[] {
  return obligations.map((obligation) =>
    [
      `| ${cell(obligation.id)}`,
      cell(obligation.title),
      obligation.level,
      obligation.kind,
      obligation.automationStatus,
      `${obligation.phase ?? "release"} |`,
    ].join(" | "),
  );
}

export function renderVerificationPlan(plan: VerificationPlanV1): string {
  const lines: string[] = [
    `<!-- lisa-verification-plan content-hash: ${plan.contentHash} -->`,
    "# Verification and Test Automation Plan",
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
    `- Frameworks: ${plan.project.frameworks.length > 0 ? plan.project.frameworks.map((value) => `\`${value}\``).join(", ") : "none detected"}`,
    "",
    "This file is a deterministic projection of the canonical verification plan.",
    "The canonical source is hash-bound to the specification bundle and project fingerprint.",
    "",
    "## Coverage obligations",
    "",
    "| ID | Requirement or observable outcome | Level | Kind | Automation | Phase |",
    "| --- | --- | --- | --- | --- | --- |",
    ...obligationRows(plan.obligations),
    "",
    "## Phase gates",
    "",
  ];

  for (const gate of plan.gates.filter((value) => value.scope === "phase")) {
    lines.push(`### Phase ${gate.phase}`);
    lines.push("");
    lines.push(`- Gate ID: \`${gate.id}\``);
    lines.push(`- Required: ${gate.required ? "yes" : "no"}`);
    lines.push(`- Cumulative: ${gate.cumulative ? "yes" : "no"}`);
    lines.push(`- Obligations: ${gate.obligationRefs.map((value) => `\`${value}\``).join(", ")}`);
    lines.push(`- Suites: ${gate.suiteRefs.map((value) => `\`${value}\``).join(", ")}`);
    lines.push("");
  }

  lines.push("## Effect-witness policy");
  lines.push("");
  lines.push(
    "A mutation response is never sufficient evidence. Every effect-witness obligation must observe resulting state through an independent read path and preserve durable identity or content-hash evidence.",
  );
  lines.push("");
  for (const obligation of plan.obligations.filter((value) => value.kind === "effect-witness")) {
    lines.push(`### ${obligation.id} — ${obligation.title}`);
    lines.push("");
    for (const witness of obligation.witnesses) lines.push(`- ${witness}`);
    for (const negative of obligation.negativeCases) {
      lines.push(`- Negative: ${negative}`);
    }
    lines.push("");
  }

  lines.push("## Automated commands");
  lines.push("");
  if (plan.commands.length === 0) {
    lines.push("No safe automated command was discovered; operator clarification is required.");
    lines.push("");
  }
  for (const command of plan.commands) {
    lines.push(`### ${command.label}`);
    lines.push("");
    lines.push(`- Command ID: \`${command.id}\``);
    lines.push(`- Kind: \`${command.kind}\``);
    lines.push(`- Absolute working directory: \`${command.cwd}\``);
    lines.push(`- Timeout: ${command.timeoutSec} seconds`);
    lines.push("");
    lines.push("```bash");
    lines.push(commandLine(command));
    lines.push("```");
    lines.push("");
  }

  const release = plan.gates.find((value) => value.scope === "release");
  lines.push("## Release gate");
  lines.push("");
  if (release) {
    lines.push(`- Gate ID: \`${release.id}\``);
    lines.push(`- Required: ${release.required ? "yes" : "no"}`);
    lines.push(`- Obligations: ${release.obligationRefs.length}`);
    lines.push(`- Suites: ${release.suiteRefs.map((value) => `\`${value}\``).join(", ")}`);
  }
  lines.push("");

  lines.push("## Assumptions");
  lines.push("");
  if (plan.assumptions.length === 0) lines.push("- None.");
  else for (const assumption of plan.assumptions) lines.push(`- ${assumption}`);
  lines.push("");

  lines.push("## Ambiguities and blockers");
  lines.push("");
  if (plan.ambiguities.length === 0) lines.push("- None.");
  else for (const ambiguity of plan.ambiguities) lines.push(`- ${ambiguity}`);
  lines.push("");

  lines.push("## Evidence requirements");
  lines.push("");
  lines.push("- Record the exact absolute command and working directory.");
  lines.push("- Record exit code, duration, and bounded stdout/stderr.");
  lines.push("- Record bundle ID, semantic hash, plan hash, and phase.");
  lines.push("- Record skipped obligations with an explicit approved reason.");
  lines.push("- Refuse phase completion when a required gate has no independent witness.");
  lines.push("");

  return lines.join("\n");
}
