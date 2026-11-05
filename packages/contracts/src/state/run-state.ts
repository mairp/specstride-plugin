/**
 * T078 — the run-state machine (annex E, §E.2; F100-FR-141, F100-FR-142).
 *
 * The ten written states and the three derived conditions as types, the
 * transitions T1 to T18 with their trigger, their owner and the record each
 * one writes, read from `data/run-state-machine.json`, and the function
 * `mayWrite(transition, process)` that says whether a transition is allowed
 * for a process: a host never, the CLI only T1, T2, T3 and T17.
 *
 * Rows 1 and 2 of `data/closed-sets.json` are the closed sets of this table.
 * Row 1 gives no literals of its own: it refers to this table, and registers
 * through T070 from here (`runStateSet`). Row 2, the derived conditions, holds
 * its literals in the table of §X.6 itself (`sets-100-104.ts`); this module
 * gives the same three as a type, and the tests bind the two together.
 */
import machine from "../../data/run-state-machine.json" with { type: "json" };
import { defineByReference, type SetByReference } from "../enums/index.ts";

/** The section of annex E that owns this table. */
export const ANNEX_SECTION = "annex E, §E.2" as const;

/** The schema id of the run record and of this machine (annex E, §E.2). */
export const SCHEMA_ID = "specstride.run-state/1" as const;

type RawState = {
  State: string;
  "A process is alive": string;
  "Lock held": string;
  Meaning: string;
};

type RawTransition = {
  "#": string;
  From: string;
  To: string;
  Trigger: string;
  Owner: string;
  Written: string;
};

const RAW = machine as {
  schema: string;
  states: RawState[];
  transitions: RawTransition[];
};

/** A cell of the annex without its back-ticks and its "(derived)" note. */
function bare(cell: string): string {
  return cell
    .replace(/\(derived\)/gi, "")
    .replace(/`/g, "")
    .trim();
}

/* ------------------------------------------------------------------ *
 * The ten written states and the three derived conditions.
 * ------------------------------------------------------------------ */

/**
 * F100-FR-141 — the ten states a run is written in. Exactly one of them
 * holds at a time. `dead`, `stale` and `launch-abandoned` are not among
 * them: readers derive those and no writer writes them.
 */
export const RUN_STATES = [
  "created",
  "starting",
  "running",
  "paused-quota",
  "relaunching",
  "stopping",
  "blocked-on-human",
  "finished",
  "stopped",
  "failed",
] as const;

/** A state of the machine, never a derived condition (annex E, §E.2). */
export type RunState = (typeof RUN_STATES)[number];

/**
 * F100-FR-141 — the three conditions readers derive and no process writes:
 * `dead` (§E.2, the states table), `stale` and `launch-abandoned` (§E.2,
 * the note after the states table). Row 2 of `data/closed-sets.json`.
 */
export const DERIVED_RUN_CONDITIONS = ["dead", "stale", "launch-abandoned"] as const;

/** A condition a reader derives (annex E, §E.2). */
export type DerivedRunCondition = (typeof DERIVED_RUN_CONDITIONS)[number];

/** Row 1 of §X.6 — run states, registered through T070 from this table. */
export const runStateSet: SetByReference<RunState> = defineByReference(1, RUN_STATES);

/** One row of the states table of §E.2. */
export type RunStateRow = {
  /** The state, without its back-ticks. */
  readonly state: RunState | DerivedRunCondition;
  /** The cell "A process is alive". */
  readonly processAlive: string;
  /** The cell "Lock held". */
  readonly lockHeld: string;
  /** The cell "Meaning". */
  readonly meaning: string;
  /** True for `dead`: the row the table marks "(derived)". */
  readonly derived: boolean;
};

/** Every row of the states table, in the order of the annex. */
export const runStateRows: readonly RunStateRow[] = Object.freeze(
  RAW.states.map((row) =>
    Object.freeze({
      state: bare(row.State) as RunState | DerivedRunCondition,
      processAlive: row["A process is alive"],
      lockHeld: row["Lock held"],
      meaning: row.Meaning,
      derived: /\(derived\)/i.test(row.State),
    }),
  ),
);

const STATE_ROW = new Map(runStateRows.map((r) => [r.state, r]));

/** The row of a state, or `undefined` where the table holds none. */
export function runStateRow(state: string): RunStateRow | undefined {
  return STATE_ROW.get(state as RunState);
}

/** True when the value is one of the ten written states (F100-FR-141). */
export function isRunState(value: string): value is RunState {
  return (RUN_STATES as readonly string[]).includes(value);
}

/** True when the value is one of the three derived conditions. */
export function isDerivedRunCondition(value: string): value is DerivedRunCondition {
  return (DERIVED_RUN_CONDITIONS as readonly string[]).includes(value);
}

/** The states whose row says a process is alive (used by `dead`, T18). */
export const LIVE_STATES: readonly RunState[] = Object.freeze(
  runStateRows
    .filter((r) => !r.derived && !/^none$/i.test(r.processAlive.trim()))
    .map((r) => r.state as RunState),
);

/** The states whose row says no process is alive: the resting states. */
export const RESTING_STATES: readonly RunState[] = Object.freeze(
  runStateRows
    .filter((r) => !r.derived && /^none$/i.test(r.processAlive.trim()))
    .map((r) => r.state as RunState),
);

/**
 * F100-FR-141 — a quota pause is a state and never a stop: `paused-quota`
 * is a member of the machine and is not a member of the stop reasons.
 */
export const QUOTA_PAUSE_IS_A_STATE = "paused-quota" as const;
export const QUOTA_PAUSE_IS_A_STOP = false as const;

/**
 * F100-FR-141 — `blocked-on-human` is a resting state: no process, the lock
 * released, and left only by `resume`.
 */
export const RESTING_STATE_BLOCKED_ON_HUMAN = {
  state: "blocked-on-human",
  processAlive: false,
  lockHeld: false,
  leftOnlyBy: "resume",
} as const;

/** True when the state rests: no process and no lock (F100-FR-141). */
export function isRestingState(state: string): boolean {
  return (RESTING_STATES as readonly string[]).includes(state);
}

/* ------------------------------------------------------------------ *
 * The transitions T1 to T18.
 * ------------------------------------------------------------------ */

/** The processes that can be asked whether they may write a transition. */
export const WRITING_PROCESSES = ["cli", "root", "engine", "host", "nobody"] as const;
export type WritingProcess = (typeof WRITING_PROCESSES)[number];

/** The two start modes of the engine (row 19 of §X.6; annex E, §E.4). */
export type EngineStartMode = "standalone" | "child";

/** The number of a transition, `T1` to `T18`. */
export type TransitionId = `T${number}`;

/** One row of the transitions table of §E.2. */
export type Transition = {
  /** `T1` to `T18`. */
  readonly id: TransitionId;
  /**
   * The states the transition leaves; empty for T1, whose cell is "—". T17
   * leaves `dead` too, which is a derived condition and not a written state.
   */
  readonly from: readonly (RunState | DerivedRunCondition)[];
  /** The cell "From", verbatim. */
  readonly fromCell: string;
  /** The state or condition the transition enters. */
  readonly to: RunState | DerivedRunCondition;
  /** The cell "Trigger". */
  readonly trigger: string;
  /** The cell "Owner". */
  readonly owner: string;
  /** The processes the cell "Owner" names. */
  readonly owners: readonly WritingProcess[];
  /** The cell "Written": the record the transition writes. */
  readonly written: string;
  /** True for T18, whose cell "Written" is "Derived". */
  readonly derived: boolean;
};

/** The processes an "Owner" cell names (annex E, §E.2). */
function ownersOf(cell: string): readonly WritingProcess[] {
  const text = cell.toLowerCase();
  const found: WritingProcess[] = [];
  if (/\bcli\b/.test(text)) found.push("cli");
  if (/\broot\b/.test(text)) found.push("root");
  if (/\bengine\b/.test(text)) found.push("engine");
  if (/\bnobody\b/.test(text)) found.push("nobody");
  return Object.freeze(found);
}

/** The states a "From" cell names (annex E, §E.2). */
function fromStatesOf(cell: string): readonly (RunState | DerivedRunCondition)[] {
  const text = bare(cell);
  if (text === "—" || text === "") return Object.freeze([]);
  if (/^any live state$/i.test(text)) return LIVE_STATES;
  return Object.freeze(
    text
      .split(",")
      .map((part) => part.trim())
      .filter(
        (part): part is RunState | DerivedRunCondition =>
          isRunState(part) || isDerivedRunCondition(part),
      ),
  );
}

/** The transitions T1 to T18, in the order of the annex (F100-FR-142). */
export const TRANSITIONS: readonly Transition[] = Object.freeze(
  RAW.transitions.map((row) =>
    Object.freeze({
      id: row["#"] as TransitionId,
      from: fromStatesOf(row.From),
      fromCell: row.From,
      to: bare(row.To) as RunState | DerivedRunCondition,
      trigger: row.Trigger,
      owner: row.Owner,
      owners: ownersOf(row.Owner),
      written: row.Written,
      derived: /^derived$/i.test(row.Written.trim()),
    }),
  ),
);

/** `T1` to `T18`, in the order of the annex. */
export const TRANSITION_IDS: readonly TransitionId[] = Object.freeze(TRANSITIONS.map((t) => t.id));

const TRANSITION_BY_ID = new Map(TRANSITIONS.map((t) => [t.id, t]));

/** The transition of a number, or `undefined` where the table holds none. */
export function transitionOf(id: string): Transition | undefined {
  return TRANSITION_BY_ID.get(id as TransitionId);
}

/** Every transition that leaves the state. */
export function transitionsFrom(state: string): readonly Transition[] {
  return TRANSITIONS.filter((t) => (t.from as readonly string[]).includes(state));
}

/** Every transition that enters the state or condition. */
export function transitionsTo(state: string): readonly Transition[] {
  return TRANSITIONS.filter((t) => t.to === state);
}

/**
 * F100-FR-142 — the transitions the CLI writes, and only those: into and out
 * of `created`.
 */
export const TRANSITIONS_OF_THE_CLI = ["T1", "T2", "T3", "T17"] as const;

/**
 * F100-FR-142 — a host writes no transition of a run. The rule is a
 * constant so that a reader can cite it, not only a branch of `mayWrite`.
 */
export const TRANSITIONS_OF_A_HOST: readonly TransitionId[] = Object.freeze([]);

/**
 * F100-FR-142 — whether a transition is allowed for a process.
 *
 * A host may write none. The CLI may write only T1, T2, T3 and T17. The root
 * and the engine may write the transitions their "Owner" cell names; in start
 * mode `standalone` there is no root and the engine owns every transition the
 * table gives to the root (§E.2, the note before the transitions table).
 * Nobody may write T18: it is derived.
 */
export function mayWrite(
  transition: string,
  process: WritingProcess,
  startMode: EngineStartMode = "child",
): boolean {
  const row = transitionOf(transition);
  if (row === undefined) return false;
  if (process === "host") return false;
  if (process === "nobody") return false;
  if (row.derived) return false;
  if (process === "cli") {
    return (TRANSITIONS_OF_THE_CLI as readonly string[]).includes(row.id);
  }
  if (process === "root") return row.owners.includes("root");
  // The engine.
  if (row.owners.includes("engine")) return true;
  return startMode === "standalone" && row.owners.includes("root");
}

/** The reason `mayWrite` refused, for a message a reader can show. */
export function whyNotWritable(
  transition: string,
  process: WritingProcess,
  startMode: EngineStartMode = "child",
): string | undefined {
  if (mayWrite(transition, process, startMode)) return undefined;
  const row = transitionOf(transition);
  if (row === undefined) {
    return `${transition} is not one of the transitions T1 to T18 of ${ANNEX_SECTION} (F100-FR-142)`;
  }
  if (process === "host") {
    return `a host writes no transition of a run (F100-FR-142)`;
  }
  if (process === "cli") {
    return (
      `the CLI writes only the transitions into and out of \`created\` ` +
      `(${TRANSITIONS_OF_THE_CLI.join(", ")}), not ${row.id} (F100-FR-142)`
    );
  }
  if (row.derived) {
    return `${row.id} is derived by readers and never written (F100-FR-141)`;
  }
  return `${row.id} is owned by "${row.owner}", not by the ${process} (F100-FR-142)`;
}
