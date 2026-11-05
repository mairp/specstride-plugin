/**
 * T182 — the process model of a run: the eight process kinds of the table of
 * §F.1 with their class in the process registry, read from
 * `data/process-model.json` (annex F, §F.1; F100-FR-155, F100-FR-156,
 * F100-FR-157, F100-FR-158).
 *
 * The class is the closed set of §B.10 that T044 exports (`ProcessClass`);
 * a row whose cell is the dash has no class, because no such process is
 * registered: the CLI command and the runtime root are not children of the
 * run.
 */
import processModel from "../../data/process-model.json" with { type: "json" };
import { PROCESS_CLASSES, type ProcessClass } from "../records/process-registry.ts";

/** The section of annex F that owns the table. */
export const ANNEX_SECTION = "annex F, §F.1" as const;

/** The key of `data/process-model.json` this module reads. */
export const DATA_KEY = "processes" as const;

/** The cell the table writes where a process has no class in the registry. */
export const NO_CLASS_CELL = "—" as const;

type RawProcess = {
  Process: string;
  "Started by": string;
  Lifetime: string;
  "Class in the process registry": string;
};

/** One row of the table of §F.1. */
export type ProcessModelRow = {
  /** The process, as the table names it. */
  readonly process: string;
  /** Who starts it. */
  readonly startedBy: string;
  /** Its lifetime. */
  readonly lifetime: string;
  /** Its class in the process registry, or `null` where the cell is the dash. */
  readonly registryClass: ProcessClass | null;
};

const unbacktick = (cell: string): string => cell.replace(/`/g, "").trim();

/** Load the table of §F.1 from `data/process-model.json` (F100-FR-155). */
export function loadProcessModel(): readonly ProcessModelRow[] {
  return Object.freeze(
    (processModel as { processes: RawProcess[] }).processes.map((row) => {
      const cell = unbacktick(row["Class in the process registry"]);
      const registryClass = (PROCESS_CLASSES as readonly string[]).includes(cell)
        ? (cell as ProcessClass)
        : null;
      return Object.freeze({
        process: row.Process,
        startedBy: row["Started by"],
        lifetime: row.Lifetime,
        registryClass,
      });
    }),
  );
}

/** The rows of the table of §F.1, in the order of the annex. */
export const processModelRows: readonly ProcessModelRow[] = loadProcessModel();

/** The row whose `process` cell starts with the text, or `undefined`. */
export function processRow(startsWith: string): ProcessModelRow | undefined {
  return processModelRows.find((row) => row.process.startsWith(startsWith));
}

/** The class of a process of the table, or `null` where it has none. */
export function registryClassOf(startsWith: string): ProcessClass | null | undefined {
  return processRow(startsWith)?.registryClass;
}

/** The rows the process registry holds: those with a class. */
export const REGISTERED_ROWS: readonly ProcessModelRow[] = Object.freeze(
  processModelRows.filter((row) => row.registryClass !== null),
);

/** The one row whose class is `adoptable`: the detached job of a yield (§F.1). */
export const ADOPTABLE_ROWS: readonly ProcessModelRow[] = Object.freeze(
  processModelRows.filter((row) => row.registryClass === "adoptable"),
);

/* ------------------------------------------------------------------ *
 * F100-FR-155 — a run is a detached tree of processes.
 * ------------------------------------------------------------------ */

/** One runtime root per launch, and the engine as its child (F100-FR-155). */
export const ONE_RUNTIME_ROOT_PER_LAUNCH = true as const;
export const THE_ENGINE_IS_A_CHILD_OF_THE_ROOT = true as const;

/** What the root MUST NOT be connected to after the handshake (F100-FR-155). */
export const NEVER_AFTER_THE_HANDSHAKE = [
  "a pipe",
  "a socket the host must keep",
  "a parent that waits",
] as const;

/** What a run MUST NOT depend on (F100-FR-155). */
export const A_RUN_NEVER_DEPENDS_ON = ["a host hook", "a monitor", "a host process"] as const;

/** F100-FR-155 is recorded `unverified` until the spike of annex F runs. */
export const F100_FR_155_STATUS = "unverified" as const;

/* ------------------------------------------------------------------ *
 * F100-FR-156 — one lock per workspace, handed down as a lease.
 * ------------------------------------------------------------------ */

/** One lock per workspace, taken by the runtime root (F100-FR-156). */
export const LOCK_SCOPE = "workspace" as const;
export const LOCK_TAKEN_BY = "the runtime root" as const;
export const HANDED_DOWN_TO_THE_ENGINE_AS = "a lease" as const;

/** A child never takes a second lock (F100-FR-156). */
export const A_CHILD_TAKES_A_SECOND_LOCK = false as const;

/** The code of a second pipeline on a held workspace (F100-FR-156). */
export const SECOND_PIPELINE_ON_A_HELD_WORKSPACE = 24 as const;

/** The code of a foreground `specstride run` on a held workspace (F100-FR-156). */
export const FOREGROUND_RUN_ON_A_HELD_WORKSPACE = 5 as const;

/** The exit code of a start on a held workspace, by the kind of start. */
export function exitCodeOnAHeldWorkspace(start: "pipeline" | "foreground-run"): number {
  return start === "pipeline"
    ? SECOND_PIPELINE_ON_A_HELD_WORKSPACE
    : FOREGROUND_RUN_ON_A_HELD_WORKSPACE;
}

/* ------------------------------------------------------------------ *
 * F100-FR-157 — the launcher is a file the operator can see and run.
 * ------------------------------------------------------------------ */

/** The one job of the launcher (F100-FR-157). */
export const LAUNCHER_CALLS = "the pipeline entry with the hash of the launch bundle" as const;

/** What the runtime root verifies, and when (F100-FR-157). */
export const VERIFIED_HASHES = ["the launch bundle", "the launcher itself"] as const;
export const VERIFIED_AT = ["launch", "every relaunch"] as const;

/** An edited launcher is refused (F100-FR-157). */
export const AN_EDITED_LAUNCHER_IS_REFUSED = true as const;

/* ------------------------------------------------------------------ *
 * F100-FR-158 — a crash of the engine, and a dead runtime root.
 * ------------------------------------------------------------------ */

/** The engine exit codes of the closed set of annex E §E.4. */
export const ENGINE_CODES = [0, 1, 2, 3, 4, 5, 6] as const;

/** True where the engine ended outside 0 to 6, or by a signal (F100-FR-158). */
export function engineCrashed(exit: { code?: number | null; signal?: string | null }): boolean {
  if (exit.signal !== undefined && exit.signal !== null && exit.signal !== "") return true;
  const code = exit.code;
  if (code === undefined || code === null) return true;
  return !(ENGINE_CODES as readonly number[]).includes(code);
}

/** What the runtime root does on a crash of the engine (F100-FR-158). */
export const ON_A_CRASH_OF_THE_ENGINE = Object.freeze({
  writesASynthesizedTerminalRecord: true as const,
  cause: "crash" as const,
  endsEveryOwnedProcess: true as const,
  consultsTheRelaunchClassifier: true as const,
});

/**
 * F100-FR-158 — when the runtime root itself dies, or the machine reboots, a
 * relaunch does not happen by itself in Wave 1: the run reads as `dead`, and
 * `resume` reclaims the lock, closes the dead launch with a synthesized end
 * event, and continues at the first phase without a valid approval record.
 */
export const ON_A_DEAD_RUNTIME_ROOT = Object.freeze({
  relaunchesByItselfInWave1: false as const,
  theRunReadsAs: "dead" as const,
  resumeReclaimsTheLock: true as const,
  resumeClosesTheDeadLaunchWith: "a synthesized end event" as const,
  resumeContinuesAt: "the first phase without a valid approval record" as const,
});

/**
 * F100-FR-158 — when the owner is dead and an `owned` process group is alive,
 * `resume` refuses and names the survivors.
 */
export function resumeRefusesWithSurvivors(input: {
  readonly ownerDead: boolean;
  readonly ownedGroupAlive: readonly string[];
}): { readonly refused: boolean; readonly survivors: readonly string[] } {
  const refused = input.ownerDead && input.ownedGroupAlive.length > 0;
  return Object.freeze({ refused, survivors: Object.freeze([...input.ownedGroupAlive]) });
}

export { PROCESS_CLASSES, type ProcessClass };
