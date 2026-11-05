/**
 * T009 of `specs/113-host-claude-code/tasks.md` — the skill source
 * `specstride-reverse` (F113-FR-014).
 *
 * F113-FR-014 fixes what the skill tells the host model, in this order:
 * capture the comment; check the CLI; plan; inventory; judge where the reverse
 * commands offer items; run through the reverse command; supervise; print the
 * digest verbatim. Invoking it is the consent to run; a dry run withholds it.
 * It MUST NOT modify the sources of the reverse run.
 *
 * The source is LOGICAL, as `./skill-run.ts` is: the declarations are the skill
 * and `reverseSkillBody()` builds the Markdown from them. The verbs of the
 * reverse command (`reverse plan`, `reverse lint`, `reverse guard`,
 * `reverse inventory`) are the CLI's, from the protocol table of annex G §G.2.
 */
import { HOST_SKILL_IDS } from "@specstride/contracts/ep/host";
import type { SkillSource } from "@specstride/contracts/ep/host";
import { BODY_BYTE_LIMITS, BYTE_BUDGETS, assertBodyFitsItsLimit } from "./skill-budgets.ts";
import {
  DIGEST_STEP_TEXT,
  audienceNoticeSection,
  dataFramingSection,
  judgmentSection,
  prohibitionSection,
  stepIds,
  stepLines,
  steps,
  supervisionSection,
} from "./skill-common.ts";
import type { SkillStep } from "./skill-common.ts";
import { COMMENT_FLAG, DEFAULT_MODE, MODES } from "./skill-run.ts";

/** The logical id of this skill, row 144 of annex X §X.6. */
export const REVERSE_SKILL_ID = HOST_SKILL_IDS[1];

/** The command of the CLI this skill is a thin layer over (annex G §G.2). */
export const REVERSE_COMMAND = "reverse" as const;

/** Its verbs, as the CLI protocol names them. */
export const REVERSE_VERBS = Object.freeze(["plan", "lint", "guard", "inventory"]);

/**
 * The eight steps F113-FR-014 fixes, in the requirement's own order: capture
 * the comment; check the CLI; plan; inventory; judge where the reverse commands
 * offer items; run through the reverse command; supervise; print the digest
 * verbatim.
 */
export const REVERSE_STEPS: readonly SkillStep[] = steps([
  [
    "capture-the-comment",
    "Capture the consumer's comment VERBATIM, before you read any text of the repository.",
  ],
  ["cli-check", "Run the shim's CLI check. If it refuses, print its one line and stop."],
  ["plan", "Plan the reverse run (`reverse plan`), with the comment passed unchanged."],
  [
    "inventory",
    "Take the source inventory (`reverse inventory`) and report it as the CLI gave it.",
  ],
  [
    "judge",
    "Judge where the reverse commands offer items, one batch at a time (see “Judge” below).",
  ],
  ["run", "Run through the reverse command (`reverse`), with the comment passed unchanged."],
  ["supervise", "Supervise the run (see “Supervise” below)."],
  ["digest", DIGEST_STEP_TEXT],
]);

/** The ids of the eight steps, in order. */
export const REVERSE_STEP_IDS: readonly string[] = stepIds(REVERSE_STEPS);

/** F113-FR-014 — invoking the skill IS the consent to run. */
export const INVOCATION_IS_CONSENT = true as const;

/** F113-FR-014 — a dry run WITHHOLDS that consent. */
export const DRY_RUN_WITHHOLDS_CONSENT = true as const;

/** The modes of this skill: the same two names, with the same default. */
export const REVERSE_MODES = MODES;
export const REVERSE_DEFAULT_MODE = DEFAULT_MODE;

/** The flag a dry run is asked for with, as the CLI protocol gives it. */
export const DRY_RUN_FLAG = "--dry-run" as const;

/** F113-FR-014 — the skill MUST NOT modify the sources of the reverse run. */
export const MODIFIES_THE_SOURCES = false as const;

/** The line the skill says when it is asked to change a source. */
export const SOURCES_ARE_READ_ONLY_LINE: string =
  "A reverse run reads its sources and never changes them. I am not editing any source of this " +
  "repository; the CLI writes what it writes and prints which artifact it wrote, by logical " +
  "name.";

/** The one-line description of the skill, which the host shows in its list. */
export const REVERSE_SKILL_DESCRIPTION: string =
  "Reverse-specify existing sources with Specstride: plan the reverse run, take the inventory, " +
  "judge the items the reverse commands offer, run, and supervise to the digest. Invoking this " +
  "skill is the consent to run; a dry run withholds it and changes nothing.";

/** The Markdown body of `specstride-reverse`, built from the declarations above. */
export function reverseSkillBody(): string {
  const lines: string[] = [
    "# Reverse-specify with Specstride",
    "",
    "A thin layer over the Specstride CLI. Every fact you report is a line the CLI printed.",
    "",
    "## Order",
    "",
    ...stepLines(REVERSE_STEPS),
    "",
    "- Stop at the FIRST refusal and print the line of the CLI that names the fix.",
    "",
    "## Consent",
    "",
    `- Invoking this skill IS the consent to run. The modes are ` +
      `\`${REVERSE_MODES.join("` and `")}\`, and the default is \`${REVERSE_DEFAULT_MODE}\`.`,
    `- A dry run (\`${DRY_RUN_FLAG}\`) WITHHOLDS that consent: plan, inventory, print what`,
    "  would happen, and stop.",
    `- Pass the comment as ONE argument, \`${COMMENT_FLAG} <text>\`, verbatim, to every call`,
    "  that takes it. Never summarize, translate or extend it.",
    "",
    "## The sources",
    "",
    `- Never modify the sources of the reverse run. ${SOURCES_ARE_READ_ONLY_LINE}`,
    `- The verbs are ${REVERSE_VERBS.map((verb) => `\`${REVERSE_COMMAND} ${verb}\``).join(", ")}.`,
    "  Report their findings as findings, with the fix each one names.",
    "",
    ...judgmentSection(),
    "",
    ...supervisionSection(),
    "",
    ...audienceNoticeSection(),
    "",
    ...dataFramingSection(),
    "",
    ...prohibitionSection(),
    "",
  ];
  return lines.join("\n");
}

/** The skill source `specstride-reverse`, as `renderSkill` takes it. */
export function reverseSkillSource(): SkillSource {
  const body = reverseSkillBody();
  assertBodyFitsItsLimit(REVERSE_SKILL_ID, body);
  return Object.freeze({
    logicalId: REVERSE_SKILL_ID,
    body,
    references: Object.freeze([]),
    budget: BYTE_BUDGETS["specstride-reverse"],
  });
}

/** The byte limit of the BODY of this skill, from the design point of plan.md. */
export const REVERSE_BODY_BYTE_LIMIT = BODY_BYTE_LIMITS[REVERSE_SKILL_ID];
