/**
 * T084 to T086 — what the critic is told (feature 142, F142-FR-065 to
 * F142-FR-067; rules PU-60, PU-61, PU-83).
 *
 * T084 (F142-FR-065): an integrated group appears in the fact block as **one
 * unit of work**, whose id is the hash of its sorted task ids, with the results
 * of the merge check. The block holds no worker, no group, no count, no outcome
 * of a worker, no order, and no word that tells a group from a serial unit that
 * named the same tasks. Two runs that end in the same tree and the same kept
 * units of work, one serial and one through a group, give byte-identical critic
 * prompts.
 *
 * T085 (F142-FR-066): the integrity kinds this feature adds and that reach the
 * critic are neutral and carry no count — `tree-changed-outside-pass`, and
 * `protected-change-not-applied` for a refused change of the protected set.
 *
 * T086 (F142-FR-067): a delta refused for scope alone, an overlap, a path leak,
 * a killed worker and a failed merge check are scheduling and repair history.
 * They are withheld from every critic-class call and stay in the event file and
 * the ledger.
 *
 * The module is a pure function of what the engine read. The one way it can keep
 * its promise is by **building** the unit from a shape that has no room for a
 * worker, a group or an order: `unitOfWork` takes the tasks and the results of
 * the merge check and nothing else, and both the serial path and the group path
 * call it. Byte identity then follows from the call and is not a property
 * anybody has to remember.
 */
import { rowOf } from "@specstride/contracts/enums";
import {
  NEVER_IN_THE_BLOCK,
  UNIT_CONDITIONS,
  mayBeInTheBlock,
} from "@specstride/contracts/records/fact-block";

/* ================================================================== *
 * 1. One unit of work (T084, F142-FR-065, PU-60).
 * ================================================================== */

/** F142-FR-065 — an integrated group is one unit of work in the fact block. */
export const UNITS_PER_INTEGRATED_GROUP = 1 as const;

/** The fields of a unit of the fact block, in the order the block writes them. */
export const UNIT_FIELDS = Object.freeze(["unitId", "tasks", "commands"] as const);

/** The conditions of a result, each in a separate field (§D.7, `units`). */
export const CONDITIONS_OF_A_RESULT = UNIT_CONDITIONS;

/** One result of the merge check, as the fact block carries it per command. */
export type ResultForTheBlock = {
  readonly id: string;
  readonly exitCode: number;
  readonly tainted: boolean;
  readonly flaky: boolean;
  readonly superseded: boolean;
  readonly current: boolean;
  readonly cached: boolean;
};

/** The task ids of a unit, sorted: the text the unit id is the hash of. */
export function sortedTaskIds(tasks: readonly string[]): readonly string[] {
  return Object.freeze([...tasks].sort());
}

/**
 * The id of a unit of work: the hash of its sorted task ids (F142-FR-065). The
 * hashing scheme is the canonical one of annex X §X.5 and arrives as an
 * argument, so that this module holds no hashing of its own — and so that the
 * group path and the serial path cannot hash differently.
 */
export function unitIdOfTheTasks(tasks: readonly string[], hash: (text: string) => string): string {
  return hash(sortedTaskIds(tasks).join("\n"));
}

/** What a unit of work is built from, and nothing else (F142-FR-065). */
export type UnitInput = {
  /** The tasks the unit named, in the order the task list holds them. */
  readonly tasks: readonly string[];
  /** The results of the checks that ran on the tree the unit is bound to. */
  readonly results: readonly ResultForTheBlock[];
  readonly hash: (text: string) => string;
};

/** One unit of work of the fact block, as a record of the block (§D.7). */
export type UnitOfWork = {
  readonly unitId: string;
  readonly tasks: readonly string[];
  readonly commands: readonly ResultForTheBlock[];
};

/**
 * Build one unit of work for the fact block (T084, F142-FR-065).
 *
 * This is the **only** builder: the serial path and the group path both call it,
 * and its input holds no worker, no group, no order of integration and no count,
 * so none of those can reach the block. The tasks are written sorted, because a
 * group integrates its workers in the order of the tasks at launch while a
 * serial pass works them in the order of the task list, and a difference in that
 * order would be exactly the word that tells the two apart.
 */
export function unitOfWork(input: UnitInput): UnitOfWork {
  return Object.freeze({
    unitId: unitIdOfTheTasks(input.tasks, input.hash),
    tasks: sortedTaskIds(input.tasks),
    commands: Object.freeze(
      input.results.map((result) =>
        Object.freeze({
          id: result.id,
          exitCode: result.exitCode,
          tainted: result.tainted,
          flaky: result.flaky,
          superseded: result.superseded,
          current: result.current,
          cached: result.cached,
        }),
      ),
    ),
  });
}

/**
 * An integrated group, as the engine reports it to the layer at
 * `contributeCriticInput`. Everything in it beside `tasks` and `results` is
 * history: it is read to decide what is **withheld** and never written to the
 * block.
 */
export type IntegratedGroup = {
  /** The tasks the integrated workers named. */
  readonly tasks: readonly string[];
  /** The results of the merge check of this group, per command. */
  readonly results: readonly ResultForTheBlock[];
  /** True where the merge check passed without a condition (F142-FR-061). */
  readonly mergeCheckPassed: boolean;
  /** The refusal reasons the audits recorded, which the critic never sees. */
  readonly refusals?: readonly string[];
  /** The workers that were killed, which the critic never sees. */
  readonly killed?: readonly string[];
  /** The protected paths whose change was refused and so never applied. */
  readonly protectedChangesNotApplied?: readonly string[];
  /** True where the workspace changed during the group (F142-FR-064). */
  readonly treeChangedOutsidePass?: boolean;
};

/**
 * One unit per integrated group, in the order of the groups (T084). A group
 * whose merge check did not pass contributes **no** unit: nothing was kept, so
 * there is nothing the critic could be told about a tree.
 */
export function unitsOfTheIntegratedGroups(
  groups: readonly IntegratedGroup[],
  hash: (text: string) => string,
): readonly UnitOfWork[] {
  return Object.freeze(
    groups
      .filter((group) => group.mergeCheckPassed)
      .map((group) => unitOfWork({ tasks: group.tasks, results: group.results, hash })),
  );
}

/** The list "Never in the block" of §D.7, which this feature does not widen. */
export const NEVER_IN_THE_BLOCK_LIST = NEVER_IN_THE_BLOCK;

/**
 * The field names of a record that §D.7 does not allow in the block
 * (F142-FR-065). Empty on every unit `unitOfWork` built.
 */
export function fieldsThatMayNotBeInTheBlock(
  record: Readonly<Record<string, unknown>>,
): readonly string[] {
  return Object.freeze(Object.keys(record).filter((field) => !mayBeInTheBlock(field)));
}

/**
 * The fields of a unit that tell a group from a serial unit: none, by
 * construction. The function walks the record, not the type, so that a field
 * added by accident is found.
 */
export function fieldsThatTellAGroupFromASerialUnit(
  unit: Readonly<Record<string, unknown>>,
): readonly string[] {
  return Object.freeze(
    Object.keys(unit).filter((field) => !(UNIT_FIELDS as readonly string[]).includes(field)),
  );
}

/* ================================================================== *
 * 2. The two neutral integrity kinds (T085, F142-FR-066, PU-83).
 * ================================================================== */

/** The row of annex X §X.6 that holds the integrity kinds that reach the critic. */
export const INTEGRITY_KIND_ROW = 65 as const;

/** The owner of row 65; this feature contributes two members to it. */
export const INTEGRITY_KIND_ROW_OWNER = "116" as const;

/** The two kinds this feature adds and that reach the critic (F142-FR-066). */
export const NEUTRAL_INTEGRITY_KINDS = Object.freeze([
  "tree-changed-outside-pass",
  "protected-change-not-applied",
] as const);
export type NeutralIntegrityKind = (typeof NEUTRAL_INTEGRITY_KINDS)[number];

/** What each kind stands for, in the words of F142-FR-064 and F142-FR-066. */
export const WHAT_THE_KIND_STANDS_FOR: Readonly<Record<NeutralIntegrityKind, string>> =
  Object.freeze({
    "tree-changed-outside-pass": "the workspace changed outside a pass",
    "protected-change-not-applied": "a change of the protected set was not applied",
  });

/** F142-FR-066 — the kinds carry no count. */
export const A_KIND_CARRIES_A_COUNT = false as const;

/** The members row 65 of annex X §X.6 holds. */
export function integrityKindsOfRow65(): readonly string[] {
  return rowOf(INTEGRITY_KIND_ROW)?.literals ?? Object.freeze([]);
}

/** The two kinds this feature adds that row 65 does not hold: empty. */
export function integrityKindDrift(): readonly string[] {
  const row = integrityKindsOfRow65();
  return Object.freeze(NEUTRAL_INTEGRITY_KINDS.filter((kind) => !row.includes(kind)));
}

/**
 * The integrity kinds of this feature that reach the critic (T085,
 * F142-FR-066).
 *
 * Each kind appears **at most once**, whatever happened how often: the list is a
 * set, so it can carry no count. `tree-changed-outside-pass` is raised where the
 * workspace changed during a group (F142-FR-064) or where the worker root was
 * still not empty before a critic-class call (F142-FR-070);
 * `protected-change-not-applied` where a delta's change of the protected set was
 * refused and so never reached the tree.
 */
export function neutralIntegrityKinds(input: {
  readonly treeChangedOutsidePass?: boolean;
  readonly protectedChangeNotApplied?: boolean;
}): readonly NeutralIntegrityKind[] {
  const kinds: NeutralIntegrityKind[] = [];
  if (input.treeChangedOutsidePass === true) kinds.push("tree-changed-outside-pass");
  if (input.protectedChangeNotApplied === true) kinds.push("protected-change-not-applied");
  return Object.freeze(kinds);
}

/** The integrity kinds of a list of groups, as one set and without a count. */
export function integrityKindsOfTheGroups(
  groups: readonly IntegratedGroup[],
): readonly NeutralIntegrityKind[] {
  return neutralIntegrityKinds({
    treeChangedOutsidePass: groups.some((group) => group.treeChangedOutsidePass === true),
    protectedChangeNotApplied: groups.some(
      (group) => (group.protectedChangesNotApplied ?? []).length > 0,
    ),
  });
}

/* ================================================================== *
 * 3. What is withheld (T086, F142-FR-067, PU-61).
 * ================================================================== */

/** The five things F142-FR-067 withholds from every critic-class call. */
export const WITHHELD_FROM_A_CRITIC_CLASS_CALL = Object.freeze([
  "a delta refused for scope alone",
  "an overlap",
  "a path leak",
  "a killed worker",
  "a failed merge check",
] as const);
export type WithheldFact = (typeof WITHHELD_FROM_A_CRITIC_CLASS_CALL)[number];

/** F142-FR-067 — what the withheld facts are: scheduling and repair history. */
export const WHAT_THEY_ARE = "scheduling and repair history" as const;

/** F142-FR-067 — where the withheld facts do stay. */
export const WHERE_THEY_STAY = Object.freeze(["the event file", "the ledger"] as const);

/** The refusal reason of each withheld fact, where it has one (row 63). */
export const REASON_OF_THE_WITHHELD_FACT: Readonly<Partial<Record<WithheldFact, string>>> =
  Object.freeze({
    "a delta refused for scope alone": "scope",
    "an overlap": "overlap",
    "a path leak": "path-leak",
  });

/** The withheld facts a group produced, for the event file and the ledger. */
export function withheldFactsOf(group: IntegratedGroup): readonly WithheldFact[] {
  const facts: WithheldFact[] = [];
  const refusals = group.refusals ?? [];
  if (refusals.includes("scope")) facts.push("a delta refused for scope alone");
  if (refusals.includes("overlap")) facts.push("an overlap");
  if (refusals.includes("path-leak")) facts.push("a path leak");
  if ((group.killed ?? []).length > 0) facts.push("a killed worker");
  if (!group.mergeCheckPassed) facts.push("a failed merge check");
  return Object.freeze(facts);
}

/**
 * F142-FR-067 — a refused change of the protected set is **not** withheld: it is
 * raised as the neutral kind `protected-change-not-applied` (ruling on R29v
 * item O-6, PU-83). The constant is here so that the one exception is written
 * down where the withholding is.
 */
export const A_REFUSED_PROTECTED_CHANGE_IS_WITHHELD = false as const;

/* ================================================================== *
 * 4. The contribution to a critic-class call (T084 to T086).
 * ================================================================== */

/** What the layer contributes to the input of a critic-class call. */
export type CriticContribution = {
  /** One unit per integrated group whose merge check passed (F142-FR-065). */
  readonly units: readonly UnitOfWork[];
  /** The integrity kinds, by kind and without a count (F142-FR-066). */
  readonly integrity: readonly NeutralIntegrityKind[];
};

/**
 * The contribution of the layer to a critic-class call (T084 to T086).
 *
 * It is everything the layer gives a critic and the whole of it: one unit per
 * integrated group, and the integrity kinds as a set. The withheld facts are
 * computed beside it, for the event file and the ledger, and are **not** part of
 * the return — a caller cannot pass them on by mistake because they are not
 * there.
 */
export function contributeCriticInput(input: {
  readonly groups: readonly IntegratedGroup[];
  readonly hash: (text: string) => string;
  /** Set where the worker root was still not empty before the call (F142-FR-070). */
  readonly workerRootNotEmpty?: boolean;
}): CriticContribution {
  const fromTheGroups = integrityKindsOfTheGroups(input.groups);
  const integrity =
    input.workerRootNotEmpty === true && !fromTheGroups.includes("tree-changed-outside-pass")
      ? Object.freeze(["tree-changed-outside-pass" as const, ...fromTheGroups])
      : fromTheGroups;
  return Object.freeze({
    units: unitsOfTheIntegratedGroups(input.groups, input.hash),
    integrity,
  });
}

/** The withheld facts of every group, for the event file and the ledger. */
export function withheldFromTheCall(
  groups: readonly IntegratedGroup[],
): readonly { readonly facts: readonly WithheldFact[] }[] {
  return Object.freeze(groups.map((group) => Object.freeze({ facts: withheldFactsOf(group) })));
}

/**
 * The fields of a contribution that F142-FR-065 or F142-FR-067 forbids: empty.
 * A test over every parallel fixture reads this on the real contribution, which
 * is how F142-SC-005 is observed and not asserted.
 */
export function forbiddenFieldsOf(contribution: CriticContribution): readonly string[] {
  const found: string[] = [];
  for (const unit of contribution.units) {
    found.push(...fieldsThatTellAGroupFromASerialUnit(unit as Readonly<Record<string, unknown>>));
    found.push(...fieldsThatMayNotBeInTheBlock(unit as Readonly<Record<string, unknown>>));
  }
  for (const kind of contribution.integrity) {
    if (!(NEUTRAL_INTEGRITY_KINDS as readonly string[]).includes(kind)) {
      found.push(`integrity kind ${kind}`);
    }
  }
  return Object.freeze([...new Set(found)]);
}
