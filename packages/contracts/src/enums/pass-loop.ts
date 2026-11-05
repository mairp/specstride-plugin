/**
 * T002 of feature 103 — the closed sets the specification of the pass loop
 * introduces, each with its unknown-value rule
 * (`specs/103-proposer-pass/spec.md`, "Closed sets"; annex X §X.6, rows 57,
 * 58, 121, 126, 132 and 133; F100-FR-021, F100-FR-208, F100-FR-209).
 *
 * | Row | Set | Unknown value, as the cell of §X.6 writes it |
 * |---|---|---|
 * | 57 | Directives of a loop layer | The layer is refused at registration |
 * | 58 | Returns of `afterPass` | `none`; the layer is off for the phase attempt |
 * | 132 | Kinds of record of the ledger namespace `core` | The record stays in the check of the chain; its content is ignored |
 * | 133 | Reasons for a fresh session | Read as `new-attempt` |
 * | 121 | Block sets of a prompt (proposer and critic) | Configuration error |
 * | 126 | Session directives | Read as `fresh` |
 *
 * The six rows live in `data/closed-sets.json` and register through T250 to
 * T256 in the batch files of their owners — rows 57, 58, 121, 132 and 133 in
 * `src/enums/sets-100-104.ts`, row 126 in `src/enums/sets-105-109.ts`. This
 * module reads them there, as `src/enums/gate.ts` reads its three rows. It
 * registers nothing itself, so the assembly of T257 keeps holding exactly the
 * rows of the table.
 *
 * What this module adds to the batch files is the part a reader of the pass
 * loop needs and the table alone does not give: the member type of each set, a
 * type guard, the unknown-value rule as a function with the kind the cell asks
 * for, the members of the two rows that the table states by reference (row 57
 * points at annex D §D.1, which `src/ep/loop-layer.ts` holds), and the one
 * member this feature's specification states that the row of the annex does
 * not hold yet.
 *
 * ## The thirteenth reason for a fresh session
 *
 * Row 133 of annex X §X.6 holds twelve reasons. Clarification U5 of
 * `specs/103-proposer-pass/spec.md` adds a thirteenth, `layer-requested`: a
 * `fresh` that a layer names in `requestPass` — the second repair of a unit of
 * work, an escalation — is recorded with that reason (F103-FR-042,
 * F103-FR-043). The annex stands for the ROW, so the registered set of row 133
 * keeps its twelve members and this module exports the thirteen of the
 * specification separately, as `FRESH_SESSION_REASONS`, with
 * `FRESH_SESSION_REASONS_OF_ROW_133` for the row and
 * `FRESH_SESSION_REASONS_ADDED_BY_103` for the addition. The data file
 * `data/closed-sets-103.json`, delivered from
 * `specs/103-proposer-pass/contracts/closed-sets.json`, carries the same
 * thirteen with the clarification that added them, and is the record of the
 * correction that annex X §X.6 is asked for.
 */
import loopLayerTables from "../../data/loop-layer-tables.json" with { type: "json" };
import closedSets103 from "../../data/closed-sets-103.json" with { type: "json" };
import {
  blockSetsOfAPromptProposerAndCritic,
  directivesOfALoopLayer,
  kindsOfRecordOfTheLedgerNamespaceCore,
  reasonsForAFreshSession,
  returnsOfAfterpass,
} from "./sets-100-104.ts";
import { sessionDirectives } from "./sets-105-109.ts";
import type { ClosedSet, UnknownValueOutcome, UnknownValueRule } from "./index.ts";

/** The section of annex X that owns the six rows. */
export const ANNEX_SECTION = "annex X, §X.6" as const;

/** The rows of §X.6 this module is about, in the order of the table. */
export const CLOSED_SET_ROWS = [57, 58, 121, 126, 132, 133] as const;
export type ClosedSetRowNumber = (typeof CLOSED_SET_ROWS)[number];

/** The feature that owns the sets of rows 57, 58, 132 and 133. */
export const OWNER = "103" as const;

/* ------------------------------------------------------------------ *
 * Row 57 — Directives of a loop layer.
 * ------------------------------------------------------------------ */

/**
 * Row 57 states its members by reference to annex D §D.1. The eleven are read
 * from the key `directives` of `data/loop-layer-tables.json`, the same table
 * `src/ep/loop-layer.ts` reads, so that the set and the annex cannot drift.
 */
const BACKTICKED = /`([^`]+)`/;

/** The eleven directives of row 57, in the order of the annex. */
export const DIRECTIVES_OF_A_LOOP_LAYER = Object.freeze(
  (loopLayerTables as { directives: { Directive: string }[] }).directives.map(
    (row) => (BACKTICKED.exec(row.Directive)?.[1] ?? row.Directive) as LoopLayerDirective,
  ),
) as readonly LoopLayerDirective[];

/** A directive of row 57. */
export type LoopLayerDirective =
  | "keep"
  | "repair"
  | "unresolved"
  | "layerOffForAttempt"
  | "layerOffForRun"
  | "giveIterationBack"
  | "exemptShortPass"
  | "exemptRepeatCounter"
  | "requestPass"
  | "requestPassGroup"
  | "integrateGroup";

/**
 * Row 57, as the closed set of §X.6 holds it, with its unknown-value rule and
 * the eleven members of annex D §D.1 filled in. The registered set of the
 * batch file states its members by reference and carries none.
 */
export const loopLayerDirectives: ClosedSet<LoopLayerDirective> = Object.freeze({
  name: directivesOfALoopLayer.name,
  number: directivesOfALoopLayer.number,
  owner: directivesOfALoopLayer.owner,
  members: DIRECTIVES_OF_A_LOOP_LAYER,
  has(value: string): value is LoopLayerDirective {
    return (DIRECTIVES_OF_A_LOOP_LAYER as readonly string[]).includes(value);
  },
  onUnknown(value: string): UnknownValueOutcome {
    return directivesOfALoopLayer.onUnknown(value);
  },
});

/** True when the value is a directive of row 57. */
export function isLoopLayerDirective(value: string): value is LoopLayerDirective {
  return loopLayerDirectives.has(value);
}

/**
 * The unknown-value rule of row 57: a directive outside the set REFUSES the
 * layer at registration, with a message that names the layer and the directive
 * (F103-FR-025). The kind is `refuse`.
 */
export const directiveOnUnknown: UnknownValueRule = (value) => loopLayerDirectives.onUnknown(value);

/* ------------------------------------------------------------------ *
 * Row 58 — Returns of `afterPass`.
 * ------------------------------------------------------------------ */

/** Row 58, as the closed set of §X.6 holds it, with its unknown-value rule. */
export const afterPassReturns: ClosedSet<"accept" | "refuse" | "none"> = returnsOfAfterpass;

/** The three returns of row 58, in the order of the table. */
export const AFTER_PASS_RETURNS = afterPassReturns.members;

/** A return of `afterPass` (row 58). */
export type AfterPassReturn = (typeof AFTER_PASS_RETURNS)[number];

/** True when the value is a return of row 58. */
export function isAfterPassReturn(value: string): value is AfterPassReturn {
  return afterPassReturns.has(value);
}

/**
 * The unknown-value rule of row 58: a return outside the set is READ AS
 * `none`, and the layer is off for the phase attempt (F103-FR-022,
 * F103-FR-027). The kind is `default`, so a reader branches on `treatedAs` and
 * never stops a run for it.
 */
export const AFTER_PASS_RETURN_WHEN_UNKNOWN = "none" as const;

/** Row 58's rule as a function (`kind: "default"`, `treatedAs: none`). */
export const afterPassReturnOnUnknown: UnknownValueRule = (value) =>
  afterPassReturns.onUnknown(value);

/* ------------------------------------------------------------------ *
 * Row 132 — Kinds of record of the ledger namespace `core`.
 * ------------------------------------------------------------------ */

/** Row 132, as the closed set of §X.6 holds it, with its unknown-value rule. */
export const coreLedgerKinds: ClosedSet<
  "attempt-open" | "attempt-closed" | "pass-closed" | "counts-reset"
> = kindsOfRecordOfTheLedgerNamespaceCore;

/** The four kinds of row 132, in the order of the table. */
export const CORE_LEDGER_KINDS = coreLedgerKinds.members;

/** A record kind of the ledger namespace `core` (row 132). */
export type CoreLedgerKind = (typeof CORE_LEDGER_KINDS)[number];

/** True when the value is a kind of row 132. */
export function isCoreLedgerKind(value: string): value is CoreLedgerKind {
  return coreLedgerKinds.has(value);
}

/**
 * The unknown-value rule of row 132: a reader KEEPS the record in the check of
 * the chain and IGNORES its content (F103-FR-039). The kind is `ignore`: an
 * unknown kind never breaks the chain and never stops a run.
 */
export const coreLedgerKindOnUnknown: UnknownValueRule = (value) =>
  coreLedgerKinds.onUnknown(value);

/** An unknown kind stays in the check of the chain; only its content is ignored. */
export const UNKNOWN_CORE_KIND_STAYS_IN_THE_CHAIN_CHECK = true as const;

/* ------------------------------------------------------------------ *
 * Row 133 — Reasons for a fresh session.
 * ------------------------------------------------------------------ */

type Raw103Set = {
  row: string;
  set: string;
  members: string;
  addedMembers?: string;
  closedBy: string;
  unknownValue: string;
};

const SETS_103 = (closedSets103 as { sets: Raw103Set[] }).sets;

function set103(row: ClosedSetRowNumber): Raw103Set {
  const found = SETS_103.find((s) => s.row === String(row));
  if (found === undefined) {
    throw new Error(
      `data/closed-sets-103.json holds no row ${row}; the data of feature 103 and ` +
        `annex X §X.6 state the same sets (F100-FR-208)`,
    );
  }
  return found;
}

/** The twelve reasons the ROW of annex X §X.6 holds. */
export const FRESH_SESSION_REASONS_OF_ROW_133 = reasonsForAFreshSession.members;

/**
 * The member clarification U5 of `specs/103-proposer-pass/spec.md` adds to the
 * set: a `fresh` a layer names in `requestPass` (F103-FR-042, F103-FR-043).
 * Annex X §X.6 is asked for the same correction; until it carries it, the row
 * holds twelve and the specification of this feature holds thirteen.
 */
export const FRESH_SESSION_REASONS_ADDED_BY_103 = Object.freeze(["layer-requested"]) as readonly [
  "layer-requested",
];

/** A reason for a fresh session, as feature 103's specification states the set. */
export type FreshSessionReason =
  (typeof FRESH_SESSION_REASONS_OF_ROW_133)[number] | "layer-requested";

/**
 * The thirteen reasons of the section "Closed sets" of
 * `specs/103-proposer-pass/spec.md`, in the order it lists them: the eleven
 * drop rules, then `no-continuation` for a harness that cannot continue, then
 * `layer-requested`.
 */
export const FRESH_SESSION_REASONS: readonly FreshSessionReason[] = Object.freeze([
  ...FRESH_SESSION_REASONS_OF_ROW_133,
  ...FRESH_SESSION_REASONS_ADDED_BY_103,
]);

/** The eleven drop rules of F103-FR-042: the set less the two always-fresh reasons. */
export const FRESH_SESSION_DROP_RULES: readonly FreshSessionReason[] = Object.freeze(
  FRESH_SESSION_REASONS.filter((r) => r !== "no-continuation" && r !== "layer-requested"),
);

/** The reasons of a session that is always fresh, whatever the drop rules say. */
export const ALWAYS_FRESH_REASONS = Object.freeze([
  "no-continuation",
  "layer-requested",
]) as readonly ["no-continuation", "layer-requested"];

/**
 * Row 133 as feature 103's specification states it: the thirteen members, with
 * the unknown-value rule of the row. The registered set of the batch file keeps
 * the twelve of the annex.
 */
export const freshSessionReasons: ClosedSet<FreshSessionReason> = Object.freeze({
  name: reasonsForAFreshSession.name,
  number: reasonsForAFreshSession.number,
  owner: reasonsForAFreshSession.owner,
  members: FRESH_SESSION_REASONS,
  has(value: string): value is FreshSessionReason {
    return (FRESH_SESSION_REASONS as readonly string[]).includes(value);
  },
  onUnknown(value: string): UnknownValueOutcome {
    return reasonsForAFreshSession.onUnknown(value);
  },
});

/** True when the value is a reason of the set as feature 103 states it. */
export function isFreshSessionReason(value: string): value is FreshSessionReason {
  return freshSessionReasons.has(value);
}

/**
 * The unknown-value rule of row 133: a reason outside the set is READ AS
 * `new-attempt` (F103-FR-042) — the safe side, a fresh session. The kind is
 * `default`.
 */
export const FRESH_SESSION_REASON_WHEN_UNKNOWN = "new-attempt" as const;

/** Row 133's rule as a function (`kind: "default"`, `treatedAs: new-attempt`). */
export const freshSessionReasonOnUnknown: UnknownValueRule = (value) =>
  freshSessionReasons.onUnknown(value);

/* ------------------------------------------------------------------ *
 * Row 121 — Block sets of a prompt (proposer and critic).
 * ------------------------------------------------------------------ */

/**
 * Row 121, as the closed set of §X.6 holds it, with its unknown-value rule.
 * The set is owned with feature 117, which uses it for the critic's prompt;
 * feature 103 uses it for the proposer's (F103-FR-031).
 */
export const promptBlockSets: ClosedSet<"current" | "as-is"> = blockSetsOfAPromptProposerAndCritic;

/** The two block sets of row 121, in the order of the table. */
export const PROMPT_BLOCK_SETS = promptBlockSets.members;

/** A block set of the proposer's prompt (row 121). */
export type PromptBlockSet = (typeof PROMPT_BLOCK_SETS)[number];

/** True when the value is a block set of row 121. */
export function isPromptBlockSet(value: string): value is PromptBlockSet {
  return promptBlockSets.has(value);
}

/**
 * The unknown-value rule of row 121: a block set outside the two is a
 * CONFIGURATION ERROR. The kind is `refuse`: no pass starts under it.
 */
export const promptBlockSetOnUnknown: UnknownValueRule = (value) =>
  promptBlockSets.onUnknown(value);

/** The block ids are an OPEN set, opened by the registry of providers. */
export const BLOCK_IDS_ARE_OPEN = true as const;

/* ------------------------------------------------------------------ *
 * Row 126 — Session directives.
 * ------------------------------------------------------------------ */

/**
 * Row 126, as the closed set of §X.6 holds it, with its unknown-value rule.
 * The row is owned by feature 109, which carries the value to the harness
 * port; feature 103 is the writer of the value, one per pass (F103-FR-042).
 */
export const sessionDirectiveValues: ClosedSet<"fresh" | "continue"> = sessionDirectives;

/** The two values of the session directive (row 126). */
export const SESSION_DIRECTIVES = sessionDirectiveValues.members;

/** A value of the session directive (row 126). */
export type SessionDirective = (typeof SESSION_DIRECTIVES)[number];

/** True when the value is a session directive of row 126. */
export function isSessionDirective(value: string): value is SessionDirective {
  return sessionDirectiveValues.has(value);
}

/**
 * The unknown-value rule of row 126: a value outside the two is READ AS
 * `fresh` — the safe side. The kind is `default`.
 */
export const SESSION_DIRECTIVE_WHEN_UNKNOWN = "fresh" as const;

/** Row 126's rule as a function (`kind: "default"`, `treatedAs: fresh`). */
export const sessionDirectiveOnUnknown: UnknownValueRule = (value) =>
  sessionDirectiveValues.onUnknown(value);

/* ------------------------------------------------------------------ *
 * The six sets together.
 * ------------------------------------------------------------------ */

/** The six sets of this module, keyed by the number of their row of §X.6. */
export const closedSetsOfThePassLoop: ReadonlyMap<ClosedSetRowNumber, ClosedSet> = Object.freeze(
  new Map<ClosedSetRowNumber, ClosedSet>([
    [57, loopLayerDirectives as ClosedSet],
    [58, afterPassReturns as ClosedSet],
    [121, promptBlockSets as ClosedSet],
    [126, sessionDirectiveValues as ClosedSet],
    [132, coreLedgerKinds as ClosedSet],
    [133, freshSessionReasons as ClosedSet],
  ]),
);

/** The members of a row, as `data/closed-sets-103.json` writes them. */
export function membersOfRow103(row: ClosedSetRowNumber): readonly string[] {
  return Object.freeze(
    set103(row)
      .members.split(",")
      .map((m) => m.trim())
      .filter((m) => m.length > 0),
  );
}

/** The unknown-value cell of a row, as `data/closed-sets-103.json` writes it. */
export function unknownValueOfRow103(row: ClosedSetRowNumber): string {
  return set103(row).unknownValue;
}
