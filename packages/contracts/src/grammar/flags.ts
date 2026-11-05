/**
 * T281 — the flags of §G.1 as data: the name of the flag
 * `--accept-source-change` of `resume` with what it does, and the rule that no
 * command has a flag that switches off a launch check, the terms gate or a
 * budget cap (annex G, §G.1; F100-FR-173, F100-FR-174).
 *
 * A slice of T188: the protocol of `protocol.ts` names the commands; this
 * module names the flags, in the form the static test of the flags of every
 * command reads.
 */
import { commandRows, type CommandRow } from "./protocol.ts";

/** The section of annex G that owns the flags. */
export const ANNEX_SECTION = "annex G, §G.1" as const;

/* ------------------------------------------------------------------ *
 * F100-FR-173 — `--accept-source-change` of `resume`.
 * ------------------------------------------------------------------ */

/** The spelling of the flag of F100-FR-173. */
export const ACCEPT_SOURCE_CHANGE = "--accept-source-change" as const;

/** The command the flag belongs to (§G.1). */
export const ACCEPT_SOURCE_CHANGE_COMMAND = "resume" as const;

/** The three sources an intended change may touch (F100-FR-173). */
export const SOURCES = ["spec", "plan", "tasks"] as const;
export type Source = (typeof SOURCES)[number];

/** What `resume` does WITH the flag (F100-FR-173), in the order of the requirement. */
export const WITH_THE_FLAG = Object.freeze({
  /** The verification plan is derived again. */
  derivesTheVerificationPlanAgain: true as const,
  /** The check manifest is derived again. */
  derivesTheCheckManifestAgain: true as const,
  /** The new hashes are recorded in the run snapshot. */
  recordsTheNewHashesIn: "run:<runId>:snapshot" as const,
  /** The counts of phases already delivered are kept. */
  keepsTheCounts: true as const,
  /** The phase evidence of phases already delivered is kept. */
  keepsThePhaseEvidenceOfDeliveredPhases: true as const,
  /** An event is emitted that every critic of the run receives as a fact. */
  emitsAnEvent: true as const,
  eventReachesEveryCriticOfTheRunAsAFact: true as const,
});

/** What `resume` does WITHOUT the flag (F100-FR-173). */
export const WITHOUT_THE_FLAG = Object.freeze({
  refuses: true as const,
  exitCode: 3 as const,
  namesTheChangedFile: true as const,
});

/** The outcome of `resume` on a changed source. */
export type SourceChangeOutcome =
  | {
      readonly accepted: true;
      readonly derivedAgain: readonly ["verification-plan", "check-manifest"];
      readonly hashesRecordedIn: string;
      readonly countsKept: true;
      readonly evidenceOfDeliveredPhasesKept: true;
      readonly event: {
        readonly reachesEveryCriticAsAFact: true;
        readonly files: readonly string[];
      };
    }
  | {
      readonly accepted: false;
      readonly exitCode: 3;
      readonly message: string;
      readonly files: readonly string[];
    };

/**
 * F100-FR-173 — what `resume` does with an intended change of spec, plan or
 * task list, with the flag and without it. `changed` names the files by their
 * source, as the run snapshot records them.
 */
export function onASourceChange(input: {
  readonly changed: readonly { readonly source: Source; readonly path: string }[];
  readonly flagGiven: boolean;
}): SourceChangeOutcome {
  const files = Object.freeze(input.changed.map((c) => c.path));
  if (!input.flagGiven) {
    return Object.freeze({
      accepted: false as const,
      exitCode: WITHOUT_THE_FLAG.exitCode,
      message:
        `refused: ${files.join(", ")} changed since launch; give ` +
        `\`${ACCEPT_SOURCE_CHANGE}\` to accept the change (F100-FR-173)`,
      files,
    });
  }
  return Object.freeze({
    accepted: true as const,
    derivedAgain: Object.freeze(["verification-plan", "check-manifest"] as const),
    hashesRecordedIn: WITH_THE_FLAG.recordsTheNewHashesIn,
    countsKept: true as const,
    evidenceOfDeliveredPhasesKept: true as const,
    event: Object.freeze({ reachesEveryCriticAsAFact: true as const, files }),
  });
}

/** The row of §X.7 under which the flag is not used. */
export const PARITY_ROW = 15 as const;
export const UNDER_PARITY = "not used" as const;

/* ------------------------------------------------------------------ *
 * F100-FR-174 — no flag switches off an enforcement.
 * ------------------------------------------------------------------ */

/** The three enforcements no flag of any command may switch off (F100-FR-174). */
export const ENFORCEMENTS_NO_FLAG_SWITCHES_OFF = [
  "a launch check",
  "the terms gate",
  "a budget cap",
] as const;
export type Enforcement = (typeof ENFORCEMENTS_NO_FLAG_SWITCHES_OFF)[number];

/**
 * The spellings a flag would use to switch one of the three off. The static
 * test of the flags of every command reads this list and fails on a flag that
 * matches one of them (F100-FR-174).
 */
export const FORBIDDEN_FLAG_PATTERNS: readonly {
  readonly enforcement: Enforcement;
  readonly pattern: RegExp;
}[] = Object.freeze([
  Object.freeze({
    enforcement: "a launch check" as const,
    pattern: /^--(no-|skip-|disable-|without-)?(launch-)?(check|checks|preflight|doctor)s?(-off)?$/,
  }),
  Object.freeze({
    enforcement: "the terms gate" as const,
    pattern: /^--(no-|skip-|disable-|accept-|without-)?terms(-gate)?(-off)?$/,
  }),
  Object.freeze({
    enforcement: "a budget cap" as const,
    pattern: /^--(no-|skip-|disable-|unlimited-|without-)?(budget|cap|spend|cost)s?(-off|-cap)?$/,
  }),
]);

/** One flag of a command, as the data of a command declares it. */
export type FlagDeclaration = {
  /** The command the flag belongs to. */
  readonly command: string;
  /** The flag, with its two hyphens. */
  readonly flag: string;
  /** What the flag does, in one sentence. */
  readonly what: string;
};

/** What a flag that F100-FR-174 forbids is reported as. */
export type ForbiddenFlag = {
  readonly command: string;
  readonly flag: string;
  readonly enforcement: Enforcement;
  readonly message: string;
};

/**
 * F100-FR-174 — the check the static test of the flags of every command runs:
 * a flag whose spelling would switch off a launch check, the terms gate or a
 * budget cap is reported, with the command, the flag and the enforcement.
 */
export function forbiddenFlags(declarations: readonly FlagDeclaration[]): readonly ForbiddenFlag[] {
  const out: ForbiddenFlag[] = [];
  for (const declaration of declarations) {
    for (const rule of FORBIDDEN_FLAG_PATTERNS) {
      if (!rule.pattern.test(declaration.flag)) continue;
      out.push(
        Object.freeze({
          command: declaration.command,
          flag: declaration.flag,
          enforcement: rule.enforcement,
          message:
            `the flag \`${declaration.flag}\` of \`${declaration.command}\` would switch ` +
            `off ${rule.enforcement}; no command has such a flag (F100-FR-174)`,
        }),
      );
      break;
    }
  }
  return Object.freeze(out);
}

/** True where the flag is one no command may have (F100-FR-174). */
export function flagIsForbidden(flag: string): boolean {
  return FORBIDDEN_FLAG_PATTERNS.some((rule) => rule.pattern.test(flag));
}

/**
 * F100-FR-174 — the consumer's comment only selects among options that
 * validation of the launch contract accepts.
 */
export const THE_COMMENT_ONLY_SELECTS_AMONG_ACCEPTED_OPTIONS = true as const;

/**
 * F100-FR-174 — anything that widens scope or spend needs a flag or a
 * configuration key set by the consumer, and is never inferred from text.
 */
export const WIDENING_NEEDS = ["a flag", "a configuration key set by the consumer"] as const;
export const WIDENING_IS_INFERRED_FROM_TEXT = false as const;

/* ------------------------------------------------------------------ *
 * The flags of the commands that §G.1 names, as data.
 * ------------------------------------------------------------------ */

/**
 * The flags the table of commands of §G.1 names, read from the `What it does`
 * cell of each row. The static test of the flags of every command takes this
 * list as its subject; the owner of a command adds the flags of its own
 * specification to it.
 */
export function declaredFlags(
  rows: readonly CommandRow[] = commandRows,
): readonly FlagDeclaration[] {
  const out: FlagDeclaration[] = [];
  for (const row of rows) {
    const command = row.verbs[0] ?? row.cell;
    for (const match of row.whatItDoes.matchAll(/`(--[a-z0-9-]+)`/g)) {
      out.push(Object.freeze({ command, flag: match[1], what: row.whatItDoes }));
    }
  }
  return Object.freeze(out);
}

/** The flags of §G.1, as the table names them. */
export const FLAGS_OF_THE_ANNEX: readonly FlagDeclaration[] = declaredFlags();

/** True where `--accept-source-change` is a flag of `resume` in the table. */
export const ACCEPT_SOURCE_CHANGE_IS_DECLARED: boolean = FLAGS_OF_THE_ANNEX.some(
  (f) => f.flag === ACCEPT_SOURCE_CHANGE && f.command === ACCEPT_SOURCE_CHANGE_COMMAND,
);
