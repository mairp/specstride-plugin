/**
 * T006 of `specs/113-host-claude-code/tasks.md` — `renderSkill`,
 * `renderEntry`, `renderStatusHooks` and the budget check of EP-01 for this
 * host (F113-FR-029, F113-FR-036).
 *
 * `contracts/host-package.md` gives the host's rendering:
 *
 * | `renderSkill`        | A skill directory with body and references; fails with `budget-exceeded` over the byte limit |
 * | `renderEntry`        | The host's spelling of a command, for example `doctor` |
 * | `renderStatusHooks`  | Shell shims that print the precomputed status line |
 *
 * F113-FR-029 holds for both halves of the unknown-value rule of annex H
 * §H.1: an unknown capability in `describe` is ignored (`../describe/`), and
 * an unknown logical id of a skill or a command FAILS THE BUILD — here, with
 * `UnknownLogicalIdError` and the message of the annex.
 *
 * F113-FR-036 is the budget check: the five token budgets, measured in BYTES
 * at 2.8 bytes per token, and the cap of 500 lines on the body of a skill. The
 * printed byte numbers of the requirement (22,400; 19,600; 4,200; 420; 8,400)
 * are held against the product of the token budget and the rate at load, so
 * the two cannot drift. The check is the first of the seven checks of the
 * context-cost build, "static size" (row 145 of annex X §X.6).
 *
 * This module runs in the BUILD, not on the consumer's machine, so it may
 * import `@specstride/contracts`; `../shim/` may not. It renders the shim's
 * own script from `../shim/index.ts`, which inlines every constant.
 */
import {
  DOCTOR_SKILL_ID,
  HOST_SKILL_IDS,
  unknownLogicalIdMessage,
} from "@specstride/contracts/ep/host";
import type { HostArtifact, SkillSource } from "@specstride/contracts/ep/host";
import {
  CONTEXT_COST_CHECKS,
  HOST_SKILL_AND_ENTRY_IDS,
} from "@specstride/contracts/ep/context-cost";
import { DESCRIPTION_CAP, SKILL_NAMING_RULE } from "../describe/index.ts";
import { STATUS_EVENT_IDS, STATUS_LINE_LOGICAL_NAME, hookShimArtifact } from "../hooks.ts";
import { SHIM_FILE_NAME, shimScript } from "../shim/index.ts";

/* -------------------------------------------------------------------------
 * The precomputed status line, by its logical name
 * ---------------------------------------------------------------------- */

/**
 * The logical name of the precomputed status line, which is the one input of
 * `renderStatusHooks` (annex H §H.1, Inputs; F113-FR-021). It comes from the
 * table of annex B §B.5 and is never spelled out here. T016 owns the shims
 * themselves, so the name, the place of the line under the control root, the
 * state-unknown line and `HOOKS_DIRECTORY` all live in `../hooks.ts`, and this
 * operation reads them from there.
 */

/* -------------------------------------------------------------------------
 * F113-FR-036 — the budgets, in tokens and in bytes
 * ---------------------------------------------------------------------- */

/** The rate the build measures at: "2.8 bytes per token" (F113-FR-036). */
export const BYTES_PER_TOKEN = 2.8 as const;

/** The five budgeted things of F113-FR-036, in the order the requirement names them. */
export const BUDGETED = [
  "specstride-run",
  "specstride-reverse",
  "doctor",
  "supervision-cycle",
  "run-supervision",
] as const;
export type Budgeted = (typeof BUDGETED)[number];

/** The token budgets of F113-FR-036: 8,000; 7,000; 1,500; 150; 3,000. */
export const TOKEN_BUDGETS: Readonly<Record<Budgeted, number>> = Object.freeze({
  "specstride-run": 8_000,
  "specstride-reverse": 7_000,
  doctor: 1_500,
  "supervision-cycle": 150,
  "run-supervision": 3_000,
});

/**
 * The byte numbers F113-FR-036 PRINTS: "(22,400; 19,600; 4,200; 420; 8,400)".
 * They are the requirement's own arithmetic, and `assertNoBudgetDrift()` holds
 * them against the product of the token budget and the rate at load.
 */
export const PRINTED_BYTE_BUDGETS: Readonly<Record<Budgeted, number>> = Object.freeze({
  "specstride-run": 22_400,
  "specstride-reverse": 19_600,
  doctor: 4_200,
  "supervision-cycle": 420,
  "run-supervision": 8_400,
});

/** The bytes a token budget allows, at 2.8 bytes per token (F113-FR-036). */
export function bytesForTokens(tokens: number): number {
  // 2.8 has no exact binary form: 8000 * 2.8 is 22400.000000000004. The
  // requirement's own numbers are whole bytes, so the product is rounded.
  return Math.round(tokens * BYTES_PER_TOKEN);
}

/** The byte budgets, computed from the token budgets at 2.8 bytes per token. */
export const BYTE_BUDGETS: Readonly<Record<Budgeted, number>> = Object.freeze(
  Object.fromEntries(BUDGETED.map((id) => [id, bytesForTokens(TOKEN_BUDGETS[id])])) as Record<
    Budgeted,
    number
  >,
);

/** F113-FR-036 — "The body of a skill MUST NOT exceed 500 lines." */
export const MAX_BODY_LINES = 500 as const;

/** The check of the context-cost build this module performs: "static size". */
export const STATIC_SIZE_CHECK = CONTEXT_COST_CHECKS[0];

function assertNoBudgetDrift(): void {
  for (const id of BUDGETED) {
    if (BYTE_BUDGETS[id] !== PRINTED_BYTE_BUDGETS[id]) {
      throw new Error(
        `F113-FR-036 prints ${PRINTED_BYTE_BUDGETS[id]} bytes for \`${id}\`, and ` +
          `${TOKEN_BUDGETS[id]} tokens at ${BYTES_PER_TOKEN} bytes per token is ` +
          `${BYTE_BUDGETS[id]}`,
      );
    }
  }
  if (STATIC_SIZE_CHECK !== "static size") {
    throw new Error(
      `the first of the seven checks of the context-cost build is "static size"; row 145 of ` +
        `annex X §X.6 gives "${STATIC_SIZE_CHECK}"`,
    );
  }
}

assertNoBudgetDrift();

/* -------------------------------------------------------------------------
 * The two errors of the build
 * ---------------------------------------------------------------------- */

/**
 * `budget-exceeded` of annex H §H.1: it FAILS THE BUILD. The error carries the
 * check, the measured bytes and the limit, so that a line of the report file
 * can be written from it (data-model.md, "Check result").
 */
export class BudgetExceededError extends Error {
  /** The error of annex H §H.1, by its name in the closed set of errors. */
  readonly code = "budget-exceeded" as const;
  readonly check: string;
  readonly measured: number;
  readonly limit: number;
  readonly unit: "bytes" | "lines" | "characters";
  constructor(args: {
    readonly check: string;
    readonly measured: number;
    readonly limit: number;
    readonly unit: "bytes" | "lines" | "characters";
    readonly subject: string;
  }) {
    super(
      `budget-exceeded: ${args.subject} measures ${args.measured} ${args.unit} and the limit ` +
        `is ${args.limit} (check "${args.check}", F113-FR-036)`,
    );
    this.name = "BudgetExceededError";
    this.check = args.check;
    this.measured = args.measured;
    this.limit = args.limit;
    this.unit = args.unit;
  }
}

/**
 * The unknown-value rule of annex H §H.1 and of row 144 of annex X §X.6: an
 * unknown logical id of a skill or a command FAILS THE BUILD (F113-FR-029).
 * It is not one of the three errors of §H.1: it is the build refusing.
 */
export class UnknownLogicalIdError extends Error {
  readonly code = "unknown-logical-id" as const;
  readonly logicalId: string;
  constructor(logicalId: string) {
    super(unknownLogicalIdMessage(logicalId));
    this.name = "UnknownLogicalIdError";
    this.logicalId = logicalId;
  }
}

/* -------------------------------------------------------------------------
 * The check result (data-model.md, "Check result")
 * ---------------------------------------------------------------------- */

/** One line of the report file: check, measured bytes, limit, verdict. */
export type CheckResult = {
  readonly check: string;
  readonly subject: string;
  readonly measured: number;
  readonly limit: number;
  readonly unit: "bytes" | "lines" | "characters";
  readonly verdict: "pass" | "fail";
};

function result(
  subject: string,
  measured: number,
  limit: number,
  unit: "bytes" | "lines" | "characters",
): CheckResult {
  return Object.freeze({
    check: STATIC_SIZE_CHECK,
    subject,
    measured,
    limit,
    unit,
    verdict: measured <= limit ? ("pass" as const) : ("fail" as const),
  });
}

/* -------------------------------------------------------------------------
 * `renderEntry` — the host's spelling of a command
 * ---------------------------------------------------------------------- */

/**
 * The logical ids of skills and commands, row 144 of annex X §X.6, owner 113:
 * `specstride-run`, `specstride-reverse`, `doctor`. Unknown value: the build
 * fails.
 */
export const LOGICAL_IDS = HOST_SKILL_AND_ENTRY_IDS;

/**
 * The host's spelling of each logical id. The two host skills of F100-FR-194
 * already carry the product's prefix, which this host's naming rule asks for;
 * the logical id `doctor` is spelled `specstride-doctor`, the id the product's
 * own contract uses for the doctor skill (`DOCTOR_SKILL_ID`), so that the
 * three skills of the plugin directory cannot collide with a skill of another
 * plugin (`SKILL_NAMING_RULE` of `../describe/`).
 */
export const HOST_SPELLINGS: Readonly<Record<string, string>> = Object.freeze({
  [HOST_SKILL_IDS[0]]: HOST_SKILL_IDS[0],
  [HOST_SKILL_IDS[1]]: HOST_SKILL_IDS[1],
  doctor: DOCTOR_SKILL_ID,
});

/** True for one of the three logical ids of row 144. */
export function isLogicalId(logicalId: string): boolean {
  return (LOGICAL_IDS as readonly string[]).includes(logicalId);
}

/**
 * `renderEntry` of EP-01: the host's spelling of a command, for example
 * `doctor` → `specstride-doctor` (`contracts/host-package.md`). An unknown
 * logical id FAILS THE BUILD (F113-FR-029).
 */
export function renderEntry(logicalId: string): string {
  const spelling = HOST_SPELLINGS[logicalId];
  if (spelling === undefined) throw new UnknownLogicalIdError(logicalId);
  return spelling;
}

/** The byte budget F113-FR-036 fixes for a logical id, or `undefined`. */
export function byteBudgetOf(logicalId: string): number | undefined {
  if (logicalId === HOST_SKILL_IDS[0]) return BYTE_BUDGETS["specstride-run"];
  if (logicalId === HOST_SKILL_IDS[1]) return BYTE_BUDGETS["specstride-reverse"];
  if (logicalId === "doctor" || logicalId === DOCTOR_SKILL_ID) return BYTE_BUDGETS.doctor;
  return undefined;
}

/* -------------------------------------------------------------------------
 * `renderSkill` — a skill directory with body and references
 * ---------------------------------------------------------------------- */

/** The file of a skill of this host, inside the skill's own directory. */
export const SKILL_FILE = "SKILL.md" as const;

/** The directory of the plugin the skills of this host lie in. */
export const SKILLS_DIRECTORY = "skills" as const;

/** The path of a skill's own file inside the plugin directory. */
export function skillPath(logicalId: string): string {
  return `${SKILLS_DIRECTORY}/${renderEntry(logicalId)}/${SKILL_FILE}`;
}

/**
 * The description of a rendered skill: the caller's, else the first non-empty
 * line of the body with the markers of a heading removed. It is capped at
 * `DESCRIPTION_CAP` characters, and a longer one FAILS THE BUILD rather than
 * being cut, so that no skill ships a description the host would truncate.
 */
export function descriptionFor(source: SkillSource, given?: string): string {
  const first = source.body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  const description = (given ?? first ?? "").replace(/^#+\s*/, "").trim();
  if (description.length > DESCRIPTION_CAP) {
    throw new BudgetExceededError({
      check: STATIC_SIZE_CHECK,
      measured: description.length,
      limit: DESCRIPTION_CAP,
      unit: "characters",
      subject: `the description of the skill \`${source.logicalId}\``,
    });
  }
  return description;
}

/** The lines of the "References" section of a rendered skill, or none. */
function referenceLines(source: SkillSource): readonly string[] {
  if (source.references.length === 0) return Object.freeze([]);
  const lines = ["", "## References", ""];
  for (const reference of source.references) {
    lines.push(`- \`${reference.path}\` — read when ${reference.readWhen}`);
  }
  return Object.freeze(lines);
}

/** The text of a rendered skill: the host's front matter, the body, the references. */
export function skillText(
  source: SkillSource,
  options?: { readonly description?: string },
): string {
  const name = renderEntry(source.logicalId);
  const description = descriptionFor(source, options?.description);
  return [
    "---",
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    source.body.replace(/\n+$/, ""),
    ...referenceLines(source),
    "",
  ].join("\n");
}

/**
 * The budget check of F113-FR-036 for one rendered skill: the bytes of the
 * artifact against the limit, and the lines of the BODY against the cap of
 * 500. The limit is the smaller of the source's own budget and the byte budget
 * the requirement fixes for that skill: a source may ask for less, never for
 * more than F113-FR-036 allows.
 */
export function checkSkillBudget(
  source: SkillSource,
  bytes: number,
): readonly [CheckResult, CheckResult] {
  const fixed = byteBudgetOf(source.logicalId);
  const limit = fixed === undefined ? source.budget : Math.min(source.budget, fixed);
  const bodyLines = source.body.split("\n").length;
  return Object.freeze([
    result(`the skill \`${source.logicalId}\``, bytes, limit, "bytes"),
    result(`the body of the skill \`${source.logicalId}\``, bodyLines, MAX_BODY_LINES, "lines"),
  ]);
}

/**
 * `renderSkill` of EP-01: the artifact of one skill for this host — the file
 * `skills/<the host's spelling>/SKILL.md`, with the body and the references.
 * It fails with `budget-exceeded` over the byte limit and over the cap of 500
 * lines on the body (`contracts/host-package.md`, F113-FR-036), and with
 * `UnknownLogicalIdError` for a logical id outside row 144 (F113-FR-029).
 */
export function renderSkill(
  source: SkillSource,
  options?: { readonly description?: string },
): HostArtifact {
  const content = skillText(source, options);
  const bytes = Buffer.byteLength(content, "utf8");
  for (const checked of checkSkillBudget(source, bytes)) {
    if (checked.verdict === "fail") {
      throw new BudgetExceededError({
        check: checked.check,
        measured: checked.measured,
        limit: checked.limit,
        unit: checked.unit,
        subject: checked.subject,
      });
    }
  }
  return Object.freeze({ path: skillPath(source.logicalId), bytes, content });
}

/**
 * The whole skill DIRECTORY: the skill's own file, and one artifact per
 * reference that the source carries text for. A reference the source names
 * without text is listed in the skill's file and rendered by the task that
 * writes it; the directory is then the one file.
 */
export function renderSkillDirectory(
  source: SkillSource,
  options?: { readonly description?: string },
): readonly HostArtifact[] {
  return Object.freeze([renderSkill(source, options)]);
}

/* -------------------------------------------------------------------------
 * `renderStatusHooks` — shims that print the precomputed status line
 * ---------------------------------------------------------------------- */

/**
 * `renderStatusHooks` of EP-01: shell shims that print the precomputed status
 * line without starting the product (annex H §H.1,
 * `contracts/host-package.md`). One shim per event that shows the line — the
 * session start of F113-FR-021 and the prompt submission of F113-FR-022.
 *
 * The shims themselves are T016's (`../hooks.ts`): this operation of EP-01
 * selects the two status events out of the four the plugin registers, so that
 * the file the build writes and the file this operation returns are the SAME
 * bytes. An unknown logical name fails the build (F113-FR-029).
 */
export function renderStatusHooks(statusLineLogicalName: string): readonly HostArtifact[] {
  if (statusLineLogicalName !== STATUS_LINE_LOGICAL_NAME) {
    throw new UnknownLogicalIdError(statusLineLogicalName);
  }
  return Object.freeze(STATUS_EVENT_IDS.map((eventId) => hookShimArtifact(eventId)));
}

/* -------------------------------------------------------------------------
 * The shim of the plugin, rendered from `../shim/`
 * ---------------------------------------------------------------------- */

/** The path of the shim inside the plugin directory (T007, plan.md's layout). */
export const SHIM_PATH = `bin/${SHIM_FILE_NAME}` as const;

/**
 * The executable shim of the plugin as an artifact (T007). Its text comes from
 * `../shim/index.ts`, which imports nothing and inlines every constant, so the
 * file that ships and the module the tests exercise cannot drift; a test holds
 * `plugin/bin/specstride` on disk against this artifact byte for byte.
 */
export function renderShim(): HostArtifact {
  const content = shimScript();
  return Object.freeze({
    path: SHIM_PATH,
    bytes: Buffer.byteLength(content, "utf8"),
    content,
  });
}

/**
 * The naming rule `renderEntry` and `skillPath` apply, for a reader of the
 * rendered tree. It is declared by `describe` (`../describe/index.ts`).
 */
export const NAMING_RULE_APPLIED = SKILL_NAMING_RULE;
