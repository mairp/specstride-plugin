/**
 * T089 — end the processes and sweep once before a critic-class call
 * (feature 142, F142-FR-070; rules PU-63, PU-91).
 *
 * No worker tree exists when a critic-class call starts. Before such a call the
 * engine ends the processes of the workers and sweeps **once**, and the call is
 * never delayed beyond that. If the worker root is still not empty afterwards:
 *
 *  - a critic **without tools** is called, and the neutral integrity kind
 *    `tree-changed-outside-pass` is raised;
 *  - a critic **with read-only tools** is called only where its harness adapter
 *    confirmed the read denial of the worker root and of the store; otherwise
 *    the next critic of the critic order is used, and that is announced.
 *
 * PU-91 amends PU-63 on exactly this point: PU-63 delayed the call until the
 * sweep had removed the tree, PU-91 does not. One sweep, then the call. The
 * module therefore has no loop and no wait: a second sweep is not something it
 * can ask for.
 *
 * The module is pure in the sense the package graph means: the three acts it
 * needs — ending processes, sweeping, reading the worker root — arrive as
 * functions from the composition root (annex A §A.3), and the package is `core`,
 * so `node:fs` and `node:child_process` are forbidden to it.
 */
import { rowOf } from "@specstride/contracts/enums";

/* ================================================================== *
 * 1. What F142-FR-070 fixes.
 * ================================================================== */

/** F142-FR-070 — no worker tree exists when a critic-class call starts. */
export const WORKER_TREES_AT_A_CRITIC_CLASS_CALL = 0 as const;

/** F142-FR-070, PU-91 — exactly one sweep runs before the call. */
export const SWEEPS_BEFORE_THE_CALL = 1 as const;

/** F142-FR-070, PU-91 — the call is never delayed beyond the one sweep. */
export const THE_CALL_IS_DELAYED_BEYOND_THE_SWEEP = false as const;

/** The two acts that run before the call, in order (F142-FR-070). */
export const ACTS_BEFORE_THE_CALL = Object.freeze([
  "end the processes of the workers",
  "sweep the worker root and the store once",
] as const);

/** The neutral integrity kind a worker root that is still not empty raises. */
export const TREE_CHANGED_OUTSIDE_PASS = "tree-changed-outside-pass" as const;

/** The row of annex X §X.6 that holds the integrity kinds that reach the critic. */
export const INTEGRITY_KIND_ROW = 65 as const;

/** True where row 65 of annex X §X.6 holds the kind. */
export function rowHoldsTheKind(kind: string): boolean {
  return (rowOf(INTEGRITY_KIND_ROW)?.literals ?? []).includes(kind);
}

/** The two forms of critic F142-FR-070 tells apart (Principle IX, ruling 57a). */
export const CRITIC_FORMS = Object.freeze(["without-tools", "with-read-only-tools"] as const);
export type CriticForm = (typeof CRITIC_FORMS)[number];

/** One critic of the critic order, as the engine resolved it. */
export type CriticOfTheOrder = {
  readonly id: string;
  readonly form: CriticForm;
  /**
   * For a critic with read-only tools: whether its harness adapter confirmed
   * that reads of the worker root and of the store are denied (F142-FR-070, D1).
   * A critic without tools needs no confirmation.
   */
  readonly readDenialConfirmed?: boolean;
};

/**
 * True where this critic may be called with a worker root that is not empty
 * (F142-FR-070). A critic without tools always may: it reads nothing. A critic
 * with read-only tools may only where the adapter confirmed the read denial.
 */
export function mayBeCalledWithALeftoverTree(critic: CriticOfTheOrder): boolean {
  if (critic.form === "without-tools") return true;
  return critic.readDenialConfirmed === true;
}

/* ================================================================== *
 * 2. The one sweep and the decision after it.
 * ================================================================== */

/** The three acts the engine lends this module (annex A §A.3). */
export type BeforeCriticServices = {
  /** End the processes of every worker of the attempt; the ids it ended. */
  endProcessesOfWorkers(): Promise<readonly string[]>;
  /** Sweep the worker root and the store once; the trees it removed. */
  sweep(): Promise<readonly string[]>;
  /** Read the worker root: the entries that are still there after the sweep. */
  workerRootEntries(): Promise<readonly string[]>;
};

/** What the decision before a critic-class call is given. */
export type BeforeCriticInput = {
  readonly services: BeforeCriticServices;
  /** The critic order of decision 17, highest first; the first is the one asked for. */
  readonly criticOrder: readonly CriticOfTheOrder[];
};

/** What the engine does for one critic-class call (F142-FR-070). */
export type BeforeCriticDecision = {
  /** The worker processes that were ended, in the order the service ended them. */
  readonly endedProcesses: readonly string[];
  /** How many sweeps ran: one, always (PU-91). */
  readonly sweeps: typeof SWEEPS_BEFORE_THE_CALL;
  readonly sweptTrees: readonly string[];
  /** The entries of the worker root after the sweep; empty is the ordinary case. */
  readonly workerRootEntries: readonly string[];
  readonly workerRootIsEmpty: boolean;
  /** The call is never delayed beyond the one sweep (PU-91). */
  readonly delayed: false;
  /** The critic that is called; the first of the order that may be. */
  readonly critic: CriticOfTheOrder | null;
  /** True where the first critic of the order was passed over. */
  readonly usedTheNextCriticOfTheOrder: boolean;
  /** The announcement of a critic that was passed over, or `null`. */
  readonly announcement: string | null;
  /** The integrity kinds raised, by kind and without a count (F142-FR-066). */
  readonly integrityKinds: readonly string[];
};

/** The announcement of a critic of the order that was passed over (F142-FR-070). */
export function announcementOf(passedOver: CriticOfTheOrder, used: CriticOfTheOrder): string {
  return (
    `the critic ${passedOver.id} holds read-only tools and its harness adapter ` +
    `confirmed no read denial of the worker root and the store; the next critic ` +
    `of the order, ${used.id}, is used instead (F142-FR-070)`
  );
}

/**
 * Run the two acts before a critic-class call and decide which critic is called
 * (T089, F142-FR-070).
 *
 * The processes are ended first and the sweep runs once, whatever the sweep
 * finds: there is no second sweep and no wait, so the call cannot be delayed by
 * a tree that would not go away (PU-91 amending PU-63). Where the worker root is
 * empty afterwards — the ordinary case — the first critic of the order is called
 * and no kind is raised. Where it is not empty the kind
 * `tree-changed-outside-pass` is raised and the order is walked until a critic
 * that may be called with a leftover tree is found; passing one over is
 * announced.
 */
export async function beforeACriticClassCall(
  input: BeforeCriticInput,
): Promise<BeforeCriticDecision> {
  const endedProcesses = await input.services.endProcessesOfWorkers();
  const sweptTrees = await input.services.sweep();
  const entries = await input.services.workerRootEntries();
  const workerRootIsEmpty = entries.length === 0;
  const first = input.criticOrder[0] ?? null;
  if (workerRootIsEmpty) {
    return Object.freeze({
      endedProcesses: Object.freeze([...endedProcesses]),
      sweeps: SWEEPS_BEFORE_THE_CALL,
      sweptTrees: Object.freeze([...sweptTrees]),
      workerRootEntries: Object.freeze([]),
      workerRootIsEmpty: true,
      delayed: false as const,
      critic: first,
      usedTheNextCriticOfTheOrder: false,
      announcement: null,
      integrityKinds: Object.freeze([]),
    });
  }
  const index = input.criticOrder.findIndex((critic) => mayBeCalledWithALeftoverTree(critic));
  const used = index === -1 ? null : input.criticOrder[index]!;
  const passedOver = index > 0 ? first : null;
  return Object.freeze({
    endedProcesses: Object.freeze([...endedProcesses]),
    sweeps: SWEEPS_BEFORE_THE_CALL,
    sweptTrees: Object.freeze([...sweptTrees]),
    workerRootEntries: Object.freeze([...entries]),
    workerRootIsEmpty: false,
    delayed: false as const,
    critic: used,
    usedTheNextCriticOfTheOrder: index > 0,
    announcement: passedOver !== null && used !== null ? announcementOf(passedOver, used) : null,
    integrityKinds: Object.freeze([TREE_CHANGED_OUTSIDE_PASS]),
  });
}
