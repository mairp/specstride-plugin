/**
 * T244 — the layout rules SL-3 to SL-7 as data of the `contracts` package
 * (annex B, §B.2; F100-FR-037 to F100-FR-042).
 *
 * The rules that are behaviour live in the kernel (SL-1 and SL-2, T023 and
 * T243). What is data — which logical names grounding refuses, the layout
 * version and the name of its file, the two names written from outside after
 * launch, the value of `protection` per containment level, and the refusal of
 * the advisory marker — is here, read from `data/layout.json` and
 * `data/harness-tables.json`.
 */
import layout from "../../data/layout.json" with { type: "json" };
import harnessTables from "../../data/harness-tables.json" with { type: "json" };

type RawName = {
  logicalName: string;
  root: string;
  writer: string;
  readers: string;
  content: string;
  path: string;
};

const NAMES = (layout as { logicalNames: RawName[] }).logicalNames;

/** The layout version of the table (annex B, §B.2, SL-4; F100-FR-038). */
export const layoutVersion: string = (layout as { layoutVersion: string }).layoutVersion;

/**
 * The logical name of the file that carries the layout version in the
 * workspace part, so that a workspace can be told apart from an old tree of
 * the same name (annex B, §B.2, SL-7; F100-FR-041).
 */
export const layoutVersionName = "workspace:layout-version" as const;

/** The event stream of a run (F100-FR-037). */
export const eventStreamName = "run:<runId>:events" as const;
/** The outbox of the proposer (F100-FR-037). */
export const outboxName = "feature:<slug>:outbox" as const;
/** The carry-over files: the handoff and the proposer's notebook (F100-FR-037). */
export const carryOverNames = ["feature:<slug>:handoff", "feature:<slug>:notebook"] as const;
/** The worker root and the tree store (F100-FR-037, F100-FR-033). */
export const workerRootName = "worker-root" as const;
export const treeStoreName = "tree-store" as const;

/** Every logical name whose root is the control plane (F100-FR-037). */
export const controlPlaneNames: readonly string[] = Object.freeze(
  NAMES.filter((n) => n.root.startsWith("control")).map((n) => n.logicalName),
);

/**
 * F100-FR-037 (SL-3). Grounding refuses, by real path, every path of the
 * control plane, of the event stream, of the outbox, of the carry-over files,
 * of the worker root and of the tree store — whatever the phase evidence
 * cites, and whether a loop layer is on or off.
 */
export const groundingRefusedNames: readonly string[] = Object.freeze([
  ...new Set<string>([
    ...controlPlaneNames,
    eventStreamName,
    outboxName,
    ...carryOverNames,
    workerRootName,
    treeStoreName,
  ]),
]);

/**
 * F100-FR-037 also refuses every path under the project's repository
 * directory, whatever the phase evidence cites. The rule is data, not a list
 * of names: grounding resolves the real path and refuses it when it lies
 * under the repository directory of the project.
 */
export const groundingRefusesRepositoryDirectory = true as const;

/** The rule of F100-FR-037 in the form a reader of this package consumes. */
export type GroundingRefusal = {
  readonly names: readonly string[];
  readonly refusesRepositoryDirectory: boolean;
  readonly byRealPath: true;
};

export const groundingRefusal: GroundingRefusal = Object.freeze({
  names: groundingRefusedNames,
  refusesRepositoryDirectory: groundingRefusesRepositoryDirectory,
  byRealPath: true as const,
});

/**
 * F100-FR-039 (SL-5). After launch the inbox is the only place where a
 * process outside the runtime tree writes, apart from the supervision record
 * of §B.16. These are the two: every inbox name, and the supervision record.
 */
export const inboxNames: readonly string[] = Object.freeze(
  NAMES.filter((n) => n.logicalName.startsWith("inbox:")).map((n) => n.logicalName),
);
export const supervisionRecordName = "launch:<launchId>:supervision" as const;

export const writtenFromOutsideAfterLaunch: readonly string[] = Object.freeze([
  ...inboxNames,
  supervisionRecordName,
]);

/** True for a name that a process outside the runtime tree may write after launch. */
export function mayBeWrittenFromOutsideAfterLaunch(logicalName: string): boolean {
  return writtenFromOutsideAfterLaunch.includes(logicalName);
}

/** The closed set of `protection` (annex X §X.6 row 27). */
export const PROTECTION_VALUES = ["prevent", "detect"] as const;
export type Protection = (typeof PROTECTION_VALUES)[number];

/** The containment levels, from `data/harness-tables.json` (annex C, §C.15). */
export const CONTAINMENT_LEVELS: readonly string[] = Object.freeze(
  (harnessTables as { containmentLevels: Record<string, string>[] }).containmentLevels.map(
    (row) => row["Level"] ?? "",
  ),
);
export type ContainmentLevel = "C0" | "C1" | "C2" | "C3";

/**
 * F100-FR-040 (SL-6). At C0 and C1 the control plane is protected by its
 * location and by detection, not by the operating system, and the run record
 * and the `[LOOP]` line say `protection=detect`. At C2 and above they say
 * `protection=prevent` only when the harness adapter confirmed that the
 * sandbox denies writes to the control plane; else `detect`.
 */
export function protectionFor(level: string, sandboxDeniesControlPlaneWrites: boolean): Protection {
  if (level === "C0" || level === "C1") return "detect";
  if (!CONTAINMENT_LEVELS.includes(level)) return "detect";
  return sandboxDeniesControlPlaneWrites ? "prevent" : "detect";
}

/** The value of `protection` per containment level, as a table for a reader. */
export const protectionByLevel: Readonly<
  Record<string, { readonly confirmed: Protection; readonly unconfirmed: Protection }>
> = Object.freeze(
  Object.fromEntries(
    CONTAINMENT_LEVELS.map((level) => [
      level,
      Object.freeze({
        confirmed: protectionFor(level, true),
        unconfirmed: protectionFor(level, false),
      }),
    ]),
  ),
);

/**
 * F100-FR-042. While a run is alive the runtime root keeps an advisory marker
 * in the workspace part that holds the owner record of §B.9. A launch that
 * finds a marker whose owner it cannot probe is refused with `foreign-owner`.
 */
export const advisoryMarkerName = "workspace:active" as const;
export const advisoryMarkerRefusal = "foreign-owner" as const;

/** The advisory marker rule, as data (F100-FR-042). */
export const advisoryMarker = Object.freeze({
  logicalName: advisoryMarkerName,
  holds: "owner-record" as const,
  refusalWhenOwnerCannotBeProbed: advisoryMarkerRefusal,
  /** The marker decides nothing else; its removal by a pass is an integrity event. */
  decidesNothingElse: true as const,
  removalIsIntegrityEvent: true as const,
});

/**
 * F100-FR-035 (SL-1). A file in the workspace part decides nothing: the
 * runtime reads the outbox and the phase evidence as claims, after the pass
 * has exited, as regular files and without following links.
 */
export const claimNames = ["feature:<slug>:outbox", "gate:<N>:evidence"] as const;
export const claimsDecideNothing = true as const;
export const claimsAreReadNoFollow = true as const;
