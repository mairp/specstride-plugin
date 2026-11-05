/**
 * T013 and T017 — the driver spec of a reverse run (F108-FR-016 to
 * F108-FR-021, F108-FR-023), and the wiring of an oversize inventory into it:
 * one unit phase per inventory unit (F108-FR-018).
 *
 * The driver is the state `reverse:<slug>:driver` of annex B §B.5. It is the
 * spec the gated loop of features 101 and 103 runs; this module only WRITES
 * it, and validates it with the native spec-format adapter of feature 104
 * before the plan writes it (F108-FR-021), because an invalid driver is a
 * defect of the product and not of the input.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  resolve as resolveLogicalName,
  type RootPaths,
} from "@specstride/contracts/ids/logical-names";
import { adapters, validate as specValidate } from "@specstride/spec-formats";

import {
  shownGuardCommand,
  shownLintCommand,
  type CommandLocations,
  type CommandsPhase,
} from "./commands.ts";
import { REFUSED_EXIT_CODE } from "./inventory-call.ts";
import { ReverseError } from "./output.ts";

/* ------------------------------------------------------------------------- *
 * The phases (F108-FR-018)
 * ------------------------------------------------------------------------- */

/** The kinds of phase a reverse run has (`data-model.md`). */
export const PHASE_KINDS = ["unit", "spec", "plan", "design", "tasks", "analysis"] as const;

/** One kind of `PHASE_KINDS`. */
export type PhaseKind = (typeof PHASE_KINDS)[number];

/** The tasks mode of a reverse run (F108-FR-011). */
export const TASKS_MODES = ["done", "open"] as const;

/** One mode of `TASKS_MODES`. */
export type TasksMode = (typeof TASKS_MODES)[number];

/** One phase of the driver. */
export type ReversePhase = {
  /** Contiguous from 1; the number is the number of the phase gate. */
  readonly n: number;
  readonly title: string;
  /** The lint level of the phase, 0 to 5. */
  readonly lintLevel: number;
  readonly kind: PhaseKind;
  /** The unit path, for a unit phase only. */
  readonly unit?: string | undefined;
  /** The unit key of a unit phase (F108-FR-019). */
  readonly unitKey?: string | undefined;
  /** The resolved location of `reverse:<slug>:claims:<unit-key>`. */
  readonly claims?: string | undefined;
};

/** The title of the specification phase, by whether a constitution is written. */
export const SPEC_TITLE_WITH_CONSTITUTION = "Constitution and specification" as const;
export const SPEC_TITLE_WITHOUT_CONSTITUTION = "Specification" as const;

/** The title of the specification phase of an OVERSIZE run (F108-FR-018). */
export const SYNTHESIS_TITLE_WITH_CONSTITUTION =
  "Synthesis — constitution and specification" as const;
export const SYNTHESIS_TITLE_WITHOUT_CONSTITUTION = "Synthesis — specification" as const;

/** The fixed titles of the four phases after the specification phase. */
export const PLAN_TITLE = "Plan and research" as const;
export const DESIGN_TITLE = "Design artifacts" as const;
export const ANALYSIS_TITLE = "Cross-artifact analysis and sign-off" as const;

/** The title of the tasks phase, which carries the mode (F108-FR-018). */
export function tasksTitle(mode: TasksMode): string {
  return `Tasks (${mode})`;
}

/** The letters a unit phase is labelled with, `a` to `z` (F108-FR-018). */
export const UNIT_LETTERS = "abcdefghijklmnopqrstuvwxyz" as const;

/**
 * F108-FR-018 — the label of the unit phase of the unit at `index`, 0-based:
 * the letters `a` to `z`, and from the 27th unit the suffix `-<index+1>`.
 */
export function unitLabel(index: number): string {
  if (index < 0) return `-${index + 1}`;
  return index < UNIT_LETTERS.length ? UNIT_LETTERS.charAt(index) : `-${index + 1}`;
}

/** F108-FR-018 — the title of a unit phase. */
export function unitPhaseTitle(unit: string, index: number): string {
  return `Investigate unit ${unit} (1${unitLabel(index)})`;
}

/** The unit key of the unit `.` (F108-FR-019). */
export const ROOT_UNIT_KEY = "root" as const;

/**
 * F108-FR-019 — the unit key: `root` for the unit `.`, else the unit path with
 * every run of characters outside `A-Za-z0-9._-` replaced by `-`.
 */
export function unitKeyOf(unit: string): string {
  if (unit === ".") return ROOT_UNIT_KEY;
  return unit.replace(/[^A-Za-z0-9._-]+/g, "-");
}

/** The logical name of the scratch claims file of a unit phase (annex B §B.5). */
export const CLAIMS_LOGICAL_NAME = "reverse:<slug>:claims:<unit-key>" as const;

/** The lint level of a unit phase (F108-FR-018). */
export const UNIT_LINT_LEVEL = 0 as const;

/** What the phase list is built from. */
export type PhaseListInput = {
  readonly slug: string;
  readonly tasksMode: TasksMode;
  /** True where the source has no constitution, so the run writes one. */
  readonly writesAConstitution: boolean;
  /** True where the inventory is oversize (F108-FR-018). */
  readonly oversize: boolean;
  /** The inventory units, in the inventory's order; used when oversize. */
  readonly units: readonly string[];
  /** The roots of the machine, for the location of a claims file. */
  readonly roots?: RootPaths | undefined;
};

/**
 * F108-FR-018 and T017 — the phases of a reverse run, numbered contiguously
 * from 1 in list order. A run that is not oversize has the five phases; an
 * oversize run puts one level-0 phase per inventory unit BEFORE the
 * specification phase and renames that phase to the synthesis title.
 */
export function phasesOfAReverseRun(input: PhaseListInput): readonly ReversePhase[] {
  const phases: Omit<ReversePhase, "n">[] = [];
  if (input.oversize) {
    input.units.forEach((unit, index) => {
      const unitKey = unitKeyOf(unit);
      phases.push({
        title: unitPhaseTitle(unit, index),
        lintLevel: UNIT_LINT_LEVEL,
        kind: "unit",
        unit,
        unitKey,
        claims:
          input.roots === undefined
            ? undefined
            : resolveLogicalName(
                CLAIMS_LOGICAL_NAME,
                { "<slug>": input.slug, "<unit-key>": unitKey },
                input.roots,
              ),
      });
    });
  }
  const specTitle = input.oversize
    ? input.writesAConstitution
      ? SYNTHESIS_TITLE_WITH_CONSTITUTION
      : SYNTHESIS_TITLE_WITHOUT_CONSTITUTION
    : input.writesAConstitution
      ? SPEC_TITLE_WITH_CONSTITUTION
      : SPEC_TITLE_WITHOUT_CONSTITUTION;
  phases.push({ title: specTitle, lintLevel: 1, kind: "spec" });
  phases.push({ title: PLAN_TITLE, lintLevel: 2, kind: "plan" });
  phases.push({ title: DESIGN_TITLE, lintLevel: 3, kind: "design" });
  phases.push({ title: tasksTitle(input.tasksMode), lintLevel: 4, kind: "tasks" });
  phases.push({ title: ANALYSIS_TITLE, lintLevel: 5, kind: "analysis" });
  return Object.freeze(phases.map((phase, index) => Object.freeze({ ...phase, n: index + 1 })));
}

/** The phase shape the verification commands are built from (F108-FR-022). */
export function commandsPhaseOf(phase: ReversePhase): CommandsPhase {
  return Object.freeze({ n: phase.n, lintLevel: phase.lintLevel, claims: phase.claims });
}

/* ------------------------------------------------------------------------- *
 * The template directory (F108-FR-023)
 * ------------------------------------------------------------------------- */

/** The templates of the source, when it has them (F108-FR-023). */
export const SOURCE_TEMPLATES = join(".specify", "templates");

/** The logical name of a template the product ships (annex B §B.5). */
export const SHIPPED_TEMPLATES_LOGICAL_NAME = "package:templates:<name>" as const;

/** The directory the shipped templates lie in, through the layout table. */
export function shippedTemplatesDirectory(packageRoot: string): string {
  return dirname(
    resolveLogicalName(
      SHIPPED_TEMPLATES_LOGICAL_NAME,
      { "<name>": "spec-template.md" },
      { "<package>": packageRoot },
    ),
  );
}

/**
 * F108-FR-023 — the template directory the driver names: `.specify/templates`
 * of the source when it EXISTS, else the templates the product ships.
 */
export function templateDirectory(src: string, packageRoot: string): string {
  const ofTheSource = join(src, SOURCE_TEMPLATES);
  return existsSync(ofTheSource) ? ofTheSource : shippedTemplatesDirectory(packageRoot);
}

/* ------------------------------------------------------------------------- *
 * The policy (F108-FR-017)
 * ------------------------------------------------------------------------- */

/** The mode the policy states; the only mode the wrapper accepts. */
export const MODE = "source-aware" as const;

/** The cap on `[NEEDS CLARIFICATION` markers in `spec.md` (F108-FR-017). */
export const MAX_CLARIFICATION_MARKERS = 3 as const;

/**
 * F108-FR-017 — the policy of the driver spec, one clause per line. The text
 * is repeated VERBATIM in the `### Policy` of every phase (F108-FR-016), which
 * is why it is one list and not a template filled per phase.
 */
export const POLICY_LINES: readonly string[] = Object.freeze([
  `- Mode: ${MODE}. The source, its configuration, its tests, its schemas, its documentation, its manifests and its git history are READ-ONLY evidence.`,
  "- No network access, no dependency install, no services, no containers and no daemons.",
  "- The product under study, its tests, its builds, its generators, its migrations, its linters and its formatters are NOT executed. Only read-only discovery (`ls`, `cat`, `grep`, `find`, `wc`) and `git log`, `git show`, `git blame` are allowed.",
  "- The only permitted writes are the output directory and the workspace part. The run never touches `.specify/`, never writes `.specify/feature.json`, and never creates a git branch or a git commit.",
  "- Describe only CURRENT behaviour. No To-Be design, no backlog.",
  "- Evidence precedence: executable source, schemas and configuration first; then tests; then templates and command definitions; then user documents; then comments and git history. A disagreement lowers confidence and is recorded in `contradicts=`.",
  "- Every claim the lint checks carries an evidence comment on the line after it.",
  "- Evidence paths are relative to the source, and their line ranges must exist.",
  `- At most ${MAX_CLARIFICATION_MARKERS} \`[NEEDS CLARIFICATION\` markers are allowed in \`spec.md\`. Every other unknown goes under Assumptions with \`validation=unverified\`.`,
]);

/* ------------------------------------------------------------------------- *
 * The evidence rules the driver asks for (F108-FR-016)
 * ------------------------------------------------------------------------- */

/** The grounding budget of the critic, which the driver names (F108-FR-016). */
export const CRITIC_GROUNDING_BUDGET_BYTES = 32 * 1024;

/** The sentence that names the grounding budget, as the driver writes it. */
export const EVIDENCE_STAYS_SHORT =
  "- Keep the phase evidence SHORT: the grounding budget of the critic is 32 KB." as const;

/** The two other evidence rules of F108-FR-016. */
export const EVIDENCE_PASTE_JSON =
  "- Paste the `--json` output of the lint into the phase evidence." as const;
export const EVIDENCE_CITE_RELATIVE =
  "- Cite every artifact by its working-tree-relative path." as const;

/** The sentence that makes the inventory summary the ground truth (F108-FR-016). */
export function groundTruthLine(summary: string): string {
  return (
    `- The inventory summary at \`${summary}\` is the GROUND TRUTH of what exists in the ` +
    `source. Read it; do not derive the inventory again.`
  );
}

/* ------------------------------------------------------------------------- *
 * The acceptance criteria (F108-FR-016, F108-FR-020)
 * ------------------------------------------------------------------------- */

/** F108-FR-016 — the two lines every phase's criteria list ENDS with. */
export function commonCriteria(lint: string, guard: string): readonly string[] {
  return Object.freeze([`${lint} exits 0.`, `${guard} exits 0.`]);
}

/** F108-FR-020 — the added criterion of the specification phase. */
export const SPEC_CRITERION = "No desired behavior is represented as current behavior." as const;

/** F108-FR-020 — the added criteria of the design phase. */
export const DESIGN_CRITERIA: readonly string[] = Object.freeze([
  "`data-model.md`, `quickstart.md` and at least one `contracts/*.md` exist.",
  "Every command of `quickstart.md` is labelled as not executed by the reverse run.",
]);

/** F108-FR-020 — the added criterion of the tasks phase. */
export const TASKS_CRITERION =
  "`tasks.md` passes the validation of the `spec` command in the format `speckit-tasks`." as const;

/** F108-FR-020 — the added criteria of the final phase. */
export function analysisCriteria(analysis: string): readonly string[] {
  return Object.freeze([
    `The analysis report exists at \`${analysis}\` and lists every finding with its resolution.`,
    "The lint reports zero errors at level 5.",
  ]);
}

/** The criteria a phase adds to the two common lines (F108-FR-020). */
export function addedCriteriaOf(phase: ReversePhase, analysis: string): readonly string[] {
  switch (phase.kind) {
    case "spec":
      return Object.freeze([SPEC_CRITERION]);
    case "design":
      return DESIGN_CRITERIA;
    case "tasks":
      return Object.freeze([TASKS_CRITERION]);
    case "analysis":
      return analysisCriteria(analysis);
    case "unit":
    case "plan":
    default:
      return Object.freeze([]);
  }
}

/* ------------------------------------------------------------------------- *
 * The work of each phase (F108-FR-019)
 * ------------------------------------------------------------------------- */

/** F108-FR-019 — the work of a unit phase. */
export function unitWork(phase: ReversePhase): readonly string[] {
  const claims = phase.claims ?? `reverse:<slug>:claims:${phase.unitKey ?? ""}`;
  return Object.freeze([
    `- Investigate ONLY the unit \`${phase.unit ?? "."}\`. Nothing outside it is in this phase.`,
    `- Append your claims to the scratch claims file of the unit, \`${claims}\` ` +
      `(logical name \`${CLAIMS_LOGICAL_NAME}\`, unit key \`${phase.unitKey ?? ""}\`), ` +
      "one claim per line as `- <claim>`, each followed by its evidence comment.",
    "- Write NOTHING under the output directory in this phase.",
  ]);
}

/** F108-FR-019 — the work of the specification phase. */
export function specWork(input: {
  readonly oversize: boolean;
  readonly writesAConstitution: boolean;
  readonly templates: string;
}): readonly string[] {
  const lines: string[] = [];
  if (input.oversize) {
    lines.push(
      "- Synthesise from the scratch claims files the unit phases wrote; they are the record of this run's reading of the source.",
    );
  }
  lines.push(
    input.writesAConstitution
      ? `- Write \`memory/constitution.md\` from the constitution template of \`${input.templates}\`, with principles RECOVERED from evidence: the source has no constitution.`
      : "- The source already HAS a constitution. Read it without copying it, and write no `memory/constitution.md`.",
  );
  lines.push(
    "- `spec.md` follows the grammar: `### User Story <n> - <title> (Priority: P<n>)` numbered from 1, each with **Why this priority**, **Independent Test** and a Given/When/Then scenario; requirements as `- **FR-###**:` lines and criteria as `- **SC-###**:` lines, each with its evidence comment.",
    "- `checklists/requirements.md` has every item as `[x]` or `[ ]`, each followed by an indented `Fails:` line with an evidence comment.",
    "- Leave NO template placeholder, no sample text and no template comment behind.",
  );
  return Object.freeze(lines);
}

/** F108-FR-019 — the work of the plan phase. */
export function planWork(templates: string): readonly string[] {
  return Object.freeze([
    `- Write \`plan.md\` from the plan template of \`${templates}\` with a REAL technical context, a real constitution check and a real structure. Delete every \`[REMOVE IF UNUSED]\` option, and keep Complexity Tracking as a heading with \`None\`.`,
    "- Write `research.md` as `- **Decision**: ...` entries, each followed by its evidence comment, then its rationale and its alternatives. Write `unknown` where the rationale cannot be recovered.",
  ]);
}

/** F108-FR-019 — the work of the design phase. */
export function designWork(): readonly string[] {
  return Object.freeze([
    "- Write `data-model.md` with one `### <Entity>` heading per entity, each followed by its evidence comment.",
    "- Write `contracts/*.md`, one file per external surface that EXISTS in the source.",
    "- Write `quickstart.md` with the commands of the manifests and the documents, each labelled as NOT executed by the reverse run.",
  ]);
}

/** F108-FR-019 — the work of the tasks phase. */
export function tasksWork(mode: TasksMode, templates: string): readonly string[] {
  const box = mode === "done" ? "[x]" : "[ ]";
  return Object.freeze([
    `- Write \`tasks.md\` from the tasks template of \`${templates}\`, keeping the template's front matter.`,
    `- Every box is \`${box}\`, because the tasks mode of this run is \`${mode}\`.`,
    "- The phases are Setup, Foundational, one phase per user story in priority order, and a final numbered Polish phase.",
    "- Every `FR-###` of `spec.md` is mentioned in at least one task description.",
    `- The line after the front matter holds the marker \`<!-- specstride-reverse: tasks=${mode} -->\` and nothing else.`,
  ]);
}

/** F108-FR-020 — the work of the final phase: the analysis report. */
export function analysisWork(analysis: string): readonly string[] {
  return Object.freeze([
    `- Write the analysis report to \`${analysis}\` (logical name \`reverse:<slug>:analysis\`), in the shape of the \`/speckit.analyze\` report.`,
    "- The analysis report does NOT go into the output directory.",
    "- List every finding with its resolution.",
  ]);
}

/* ------------------------------------------------------------------------- *
 * The rendering (F108-FR-016)
 * ------------------------------------------------------------------------- */

/** What the driver is rendered from. */
export type DriverInput = {
  readonly slug: string;
  /** The real path of the source. */
  readonly src: string;
  /** The base name of the source directory, which the title carries. */
  readonly sourceBaseName: string;
  /** The resolved location of `reverse:<slug>:output`. */
  readonly out: string;
  /** The workspace part. */
  readonly stateDir: string;
  /** The resolved location of `reverse:<slug>:inventory-summary`. */
  readonly inventorySummary: string;
  /** The resolved location of `reverse:<slug>:analysis`. */
  readonly analysis: string;
  /** The template directory of F108-FR-023. */
  readonly templates: string;
  readonly tasksMode: TasksMode;
  readonly oversize: boolean;
  readonly writesAConstitution: boolean;
  readonly phases: readonly ReversePhase[];
  /** The locations the verification commands carry. */
  readonly locations: CommandLocations;
};

/** F108-FR-016 — the first line of the driver. */
export function driverTitle(sourceBaseName: string): string {
  return `# Reverse-engineer \`${sourceBaseName}\` into Spec Kit (as-is)`;
}

/** The heading of the section of F108-FR-016. */
export const RUN_BOUNDARIES_HEADING = "## Run boundaries" as const;

/** The four subsection headings of a phase (F108-FR-016). */
export const PHASE_SUBSECTIONS = Object.freeze([
  "### Policy",
  "### Work",
  "### Gate",
  "### Acceptance criteria",
] as const);

/** F108-FR-016 — the `## Run boundaries` section. */
export function runBoundaries(input: DriverInput): readonly string[] {
  return Object.freeze([
    RUN_BOUNDARIES_HEADING,
    "",
    `- Target repository: \`${input.src}\``,
    `- Output directory: \`${input.out}\` (logical name \`reverse:${input.slug}:output\`)`,
    `- Workspace part: \`${input.stateDir}\``,
    `- Tasks mode: \`${input.tasksMode}\``,
    `- Template directory: \`${input.templates}\``,
    "",
    ...POLICY_LINES,
    "",
    EVIDENCE_STAYS_SHORT,
    EVIDENCE_PASTE_JSON,
    EVIDENCE_CITE_RELATIVE,
  ]);
}

/** The work lines of one phase (F108-FR-019, F108-FR-020). */
export function workOf(phase: ReversePhase, input: DriverInput): readonly string[] {
  switch (phase.kind) {
    case "unit":
      return unitWork(phase);
    case "spec":
      return specWork({
        oversize: input.oversize,
        writesAConstitution: input.writesAConstitution,
        templates: input.templates,
      });
    case "plan":
      return planWork(input.templates);
    case "design":
      return designWork();
    case "tasks":
      return tasksWork(input.tasksMode, input.templates);
    case "analysis":
      return analysisWork(input.analysis);
    default:
      return Object.freeze([]);
  }
}

/** F108-FR-016 — the `### Gate` of one phase: the two commands and the rule. */
export function gateOf(phase: ReversePhase, input: DriverInput): readonly string[] {
  const commandsPhase = commandsPhaseOf(phase);
  return Object.freeze([
    "Run these FIRST and fix every error before you write the phase evidence.",
    "",
    "```sh",
    shownLintCommand(commandsPhase, input.locations),
    shownGuardCommand(commandsPhase, input.locations),
    "```",
    "",
    EVIDENCE_STAYS_SHORT,
    EVIDENCE_PASTE_JSON,
    EVIDENCE_CITE_RELATIVE,
  ]);
}

/**
 * F108-FR-016, F108-FR-020 — the acceptance criteria of one phase: UNTICKED
 * checkbox lines, the phase's own criteria first and the two common lines last.
 */
export function criteriaOf(phase: ReversePhase, input: DriverInput): readonly string[] {
  const commandsPhase = commandsPhaseOf(phase);
  const lint = shownLintCommand(commandsPhase, input.locations);
  const guard = shownGuardCommand(commandsPhase, input.locations);
  return Object.freeze([...addedCriteriaOf(phase, input.analysis), ...commonCriteria(lint, guard)]);
}

/** One phase, rendered (F108-FR-016). */
export function renderPhase(phase: ReversePhase, input: DriverInput): readonly string[] {
  const lines: string[] = [`## Phase ${phase.n}: ${phase.title}`, ""];
  lines.push(PHASE_SUBSECTIONS[0], "");
  lines.push(...POLICY_LINES, "");
  lines.push(PHASE_SUBSECTIONS[1], "");
  lines.push(groundTruthLine(input.inventorySummary));
  lines.push(...workOf(phase, input), "");
  lines.push(PHASE_SUBSECTIONS[2], "");
  lines.push(...gateOf(phase, input), "");
  lines.push(PHASE_SUBSECTIONS[3], "");
  for (const criterion of criteriaOf(phase, input)) lines.push(`- [ ] ${criterion}`);
  lines.push("");
  return Object.freeze(lines);
}

/**
 * F108-FR-016 — the whole driver spec. It starts with the title line and ends
 * with EXACTLY ONE line end.
 */
export function renderDriver(input: DriverInput): string {
  const lines: string[] = [driverTitle(input.sourceBaseName), ""];
  lines.push(...runBoundaries(input), "");
  for (const phase of input.phases) lines.push(...renderPhase(phase, input));
  // One trailing line end: drop every blank line at the end, then join with
  // "\n" and add the one end.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n") + "\n";
}

/* ------------------------------------------------------------------------- *
 * The native validation (F108-FR-021)
 * ------------------------------------------------------------------------- */

/** The format the driver is written in, and validated as (F108-FR-007). */
export const DRIVER_FORMAT = "native" as const;

/** F108-FR-021 — the message of a driver the native adapter refuses. */
export function driverNotValidMessage(errors: readonly string[]): string {
  return `generated driver is not a valid native spec: ${errors.join("; ")}`;
}

/**
 * F108-FR-021 — validate the driver with the native spec-format adapter. A
 * failure fails the plan with exit 3 and `generated driver is not a valid
 * native spec: <errors>`; it is a defect of the PRODUCT, not of the input.
 */
export function validateDriver(text: string, file: string, feature: string): void {
  const grammar = adapters.native.grammar;
  const model = specValidate.parse({ file, text, format: DRIVER_FORMAT, feature }, grammar);
  const findings = specValidate.validate(model, text, grammar);
  if (findings.length === 0) return;
  throw new ReverseError(
    driverNotValidMessage(findings.map((finding) => finding.message)),
    "driver-not-valid",
    REFUSED_EXIT_CODE,
  );
}

/**
 * The driver of a reverse run: rendered and validated. The plan writes what
 * this returns, so an invalid driver is never on disk (F108-FR-021).
 */
export function buildDriver(input: DriverInput, driverPath: string, feature: string): string {
  const text = renderDriver(input);
  validateDriver(text, driverPath, feature);
  return text;
}
