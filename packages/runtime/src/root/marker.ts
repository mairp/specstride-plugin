/**
 * T066 — the advisory marker `workspace:active`: write it, check it at a
 * launch, write it again at a heartbeat, and raise an integrity event when it
 * was missing (F122-FR-038; feature 100, F100-FR-042 and
 * `packages/contracts/src/ids/layout-rules.ts`, `advisoryMarker`).
 *
 * F122-FR-038, in full: *While a run is alive the runtime root MUST keep the
 * advisory marker `workspace:active` in the workspace part, with the owner
 * record. A launch that finds a marker whose owner it cannot probe MUST be
 * refused with `foreign-owner`. A marker whose owner is provably dead MUST NOT
 * refuse a launch. The marker MUST decide nothing else. When the marker is
 * missing while the run lives, the runtime root MUST write it again and an
 * integrity event MUST be raised.*
 *
 * WHY THE MARKER IS IN THE WORKSPACE PART AND STILL DECIDES ONE THING.
 * SL-1 (F100-FR-035) says a file in the workspace part decides nothing — and
 * the marker lies in the workspace part, where a proposer pass can reach it.
 * F122-FR-038 gives it exactly ONE decision and no other: a marker whose owner
 * cannot be probed refuses a launch. That is safe in the direction it points,
 * because the only thing a writer of the workspace part can achieve with it is
 * to STOP a launch of their own workspace, never to start one or to take a lock.
 * `MARKER_DECIDES` below is the complete list, and `markerDecides()` answers
 * `false` for everything else, so a later reader cannot quietly widen it.
 *
 * WHY AN UNREADABLE MARKER DOES NOT REFUSE. A marker that is not a valid owner
 * record holds no owner to probe at all. Were that a refusal, any process that
 * can write the workspace part could deny every launch of the workspace by
 * writing one junk byte — and the marker is advisory. So an unreadable marker
 * is treated as a MISSING marker: the launch is not refused, and the root
 * writes it again with an integrity event, which is exactly what the
 * requirement asks for a marker that is gone.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { atomicWriteJson } from "@specstride/kernel";
import type { OwnerRecord } from "@specstride/contracts/records/owner-record";
import {
  advisoryMarker,
  advisoryMarkerName,
  advisoryMarkerRefusal,
} from "@specstride/contracts/ids/layout-rules";
import { ADVISORY_MARKER_LOGICAL_NAME, lockPathsOf, type LockPlace } from "../lock/paths.ts";
import { compareWithThisProcess, validateOwnerRecord } from "../lock/owner-record.ts";
import {
  recordedProcessLives,
  type LivenessReason,
  type PlatformIo,
  platformIo,
} from "../procs/platform.ts";
import { processPrimitive } from "@specstride/kernel";
import type { ProcessPrimitive } from "@specstride/contracts/ep/kernel-services";

/* ------------------------------------------------------------------ *
 * What the requirement fixes.
 * ------------------------------------------------------------------ */

/** The logical name of the marker (annex B, §B.5). */
export const MARKER_LOGICAL_NAME = ADVISORY_MARKER_LOGICAL_NAME;

/** Feature 100 names the same thing; the two must agree. */
export const MARKER_LOGICAL_NAME_OF_FEATURE_100 = advisoryMarkerName;

/** The requirement and the rule row this module carries. */
export const MARKER_REQUIREMENT = "F122-FR-038" as const;
export const MARKER_RULE = advisoryMarker;

/** The marker holds the owner record of §B.9 (F100-FR-042). */
export const MARKER_HOLDS = "owner-record" as const;

/** F122-FR-038 — the one refusal the marker can cause. */
export const MARKER_REFUSAL = advisoryMarkerRefusal;

/** F122-FR-038 — *the marker MUST decide nothing else*: the complete list. */
export const MARKER_DECIDES = ["refuse-a-launch-whose-owner-cannot-be-probed"] as const;
export type MarkerDecision = (typeof MARKER_DECIDES)[number];

/** True for the one thing the marker decides, and false for everything else. */
export function markerDecides(question: string): boolean {
  return (MARKER_DECIDES as readonly string[]).includes(question);
}

/** The marker is advisory: nothing of the run rests on it. */
export const THE_MARKER_IS_ADVISORY = true as const;

/** F122-FR-038 — the event raised when the marker was missing while the run lived. */
export const MARKER_INTEGRITY_EVENT = "integrity.marker-removed" as const;

/** The two fields this module adds to the owner record in the marker. */
export const MARKER_LAUNCH_FIELD = "launchId" as const;
export const MARKER_WRITTEN_AT_FIELD = "writtenAt" as const;

/** The mode of the marker file. The workspace part is not the control plane. */
export const MARKER_FILE_MODE = 0o600 as const;

/* ------------------------------------------------------------------ *
 * Where it lies, and what it holds.
 * ------------------------------------------------------------------ */

/** The path of the marker, resolved from the layout table. */
export function markerPathOf(place: LockPlace): string {
  return lockPathsOf(place).advisoryMarkerFile;
}

/** The marker as it lies on disk: the owner record, the launch, the time. */
export type Marker = OwnerRecord & {
  readonly launchId?: string;
  readonly writtenAt?: string;
};

/** What a reading of the marker answers. */
export type MarkerReading =
  | { readonly present: false; readonly path: string }
  | {
      readonly present: true;
      readonly path: string;
      readonly readable: false;
      readonly detail: string;
    }
  | {
      readonly present: true;
      readonly path: string;
      readonly readable: true;
      readonly marker: Marker;
    };

/** Read the marker. A file that is not a valid owner record is `readable: false`. */
export function readTheMarker(place: LockPlace): MarkerReading {
  const path = markerPathOf(place);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return Object.freeze({ present: false as const, path });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return Object.freeze({
      present: true as const,
      path,
      readable: false as const,
      detail: `the marker is no JSON document (${error instanceof Error ? error.message : String(error)})`,
    });
  }
  const validation = validateOwnerRecord(parsed);
  if (!validation.ok) {
    return Object.freeze({
      present: true as const,
      path,
      readable: false as const,
      detail: `the marker is no owner record: ${validation.refusal}`,
    });
  }
  return Object.freeze({
    present: true as const,
    path,
    readable: true as const,
    marker: parsed as Marker,
  });
}

/**
 * F122-FR-038 — write the marker. It holds the owner record, which is what
 * §B.9 says the marker is part of. Writing it is IDEMPOTENT, so the root may
 * call this at any boundary and at every heartbeat, and the atomic write means
 * a reader never meets a half marker.
 */
export function writeTheMarker(
  place: LockPlace,
  owner: OwnerRecord,
  launchId: string,
  now: () => Date = () => new Date(),
): string {
  const path = markerPathOf(place);
  atomicWriteJson(
    path,
    { ...owner, [MARKER_LAUNCH_FIELD]: launchId, [MARKER_WRITTEN_AT_FIELD]: now().toISOString() },
    { mode: MARKER_FILE_MODE, createDirectory: true },
  );
  return path;
}

/** Remove the marker. The root does it on every exit path (F122-FR-014). */
export function removeTheMarker(place: LockPlace): boolean {
  const path = markerPathOf(place);
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return !existsSync(path);
}

/* ------------------------------------------------------------------ *
 * The check at a launch (F122-FR-038).
 * ------------------------------------------------------------------ */

/** What a probe of the OWNER OF THE MARKER can conclude. */
export const MARKER_PROBE_ANSWERS = [
  /** The owner of the marker lives. The LOCK decides what follows, not this. */
  "live",
  /** The owner is provably dead; a launch is NOT refused (F122-FR-038). */
  "dead",
  /** It cannot be probed at all; the launch is refused with `foreign-owner`. */
  "cannot-be-probed",
  /** There is no owner to probe: no marker, or a marker that is not one. */
  "no-owner",
] as const;
export type MarkerProbeAnswer = (typeof MARKER_PROBE_ANSWERS)[number];

/**
 * Which readings of `recordedProcessLives` prove death, and which leave the
 * owner unprobeable.
 *
 * `permission-refused` is the case the spec's edge list names in so many
 * words: *a second user or a container starts a run on the same tree ... the
 * marker names an owner it cannot probe, and the launch is refused with
 * `foreign-owner`*. Another user's process exists and this user may not even
 * ask about it, so nothing about it can be concluded.
 *
 * `pid-reuse-cannot-be-told` is the other one: the recorded start time is
 * missing or unreadable, so whether the id still belongs to the owner cannot
 * be told, and a reading that cannot tell is not a probe.
 */
export const READINGS_THAT_PROVE_DEATH: readonly LivenessReason[] = Object.freeze([
  "gone",
  "exited-not-collected",
  "pid-reused",
  "not-a-process",
]);
export const READINGS_THAT_CANNOT_BE_PROBED: readonly LivenessReason[] = Object.freeze([
  "permission-refused",
  "pid-reuse-cannot-be-told",
]);

/** What a probe of the marker's owner answers, and why. */
export type MarkerProbe = {
  readonly answer: MarkerProbeAnswer;
  readonly because: string;
  /** The reading of the process table, where one was taken. */
  readonly reason?: LivenessReason | undefined;
};

/**
 * Probe the owner the marker names, WITHOUT signalling it.
 *
 * The comparison of the owner record comes first, because a record made on
 * another host or in another pid namespace names a process id that means
 * nothing here — it cannot be probed at all — and a record whose boot identity
 * is another boot names an owner that *MUST count as dead, whatever process
 * now has its pid* (F122-FR-013). Only in the same world is the process table
 * asked.
 */
export function probeTheOwnerOfTheMarker(
  marker: Marker,
  io: PlatformIo = platformIo,
  primitive: ProcessPrimitive = processPrimitive,
): MarkerProbe {
  const comparison = compareWithThisProcess(marker, io, primitive);
  if (comparison.comparison === "foreign") {
    return Object.freeze({
      answer: "cannot-be-probed" as const,
      because: `the marker was made in another world: ${comparison.detail}`,
    });
  }
  if (comparison.comparison === "unknown") {
    return Object.freeze({
      answer: "cannot-be-probed" as const,
      because: `the marker cannot be compared with this process: ${comparison.detail}`,
    });
  }
  if (comparison.comparison === "other-boot") {
    return Object.freeze({
      answer: "dead" as const,
      because: "the marker names another boot, so its owner counts as dead (F122-FR-013)",
    });
  }
  if (comparison.comparison === "self") {
    return Object.freeze({
      answer: "live" as const,
      because: "the marker names this very process",
    });
  }
  const recordedStart = Number(marker.startTime);
  const liveness = recordedProcessLives(
    {
      pid: Number(marker.pid),
      ...(Number.isFinite(recordedStart) ? { startTimeMs: recordedStart } : {}),
    },
    io,
    primitive,
  );
  if (READINGS_THAT_PROVE_DEATH.includes(liveness.reason)) {
    return Object.freeze({
      answer: "dead" as const,
      because: `the process table says \`${liveness.reason}\``,
      reason: liveness.reason,
    });
  }
  if (READINGS_THAT_CANNOT_BE_PROBED.includes(liveness.reason)) {
    return Object.freeze({
      answer: "cannot-be-probed" as const,
      because: `the owner cannot be probed: \`${liveness.reason}\``,
      reason: liveness.reason,
    });
  }
  return Object.freeze({
    answer: "live" as const,
    because: `the process table says \`${liveness.reason}\``,
    reason: liveness.reason,
  });
}

/** What the check at a launch answers. */
export type MarkerCheck = {
  /** True where the launch is refused. */
  readonly refuse: boolean;
  /** `foreign-owner`, or null where nothing is refused. */
  readonly refusal: typeof MARKER_REFUSAL | null;
  readonly probe: MarkerProbeAnswer;
  readonly because: string;
  /** Where the marker lies, so a doctor finding can name it. */
  readonly path: string;
  /** True where the marker is there but is not an owner record. */
  readonly unreadable: boolean;
};

/**
 * F122-FR-038 — the check at a launch. The ONE thing the marker decides.
 *
 * No marker, an unreadable marker, a live owner and a provably dead owner all
 * refuse nothing: the lock decides those (a live owner gives `held-live`, which
 * is `attached` and no refusal at all, F122-FR-006). Only an owner that cannot
 * be probed refuses, and the refusal is `foreign-owner`.
 */
export function checkTheMarkerAtLaunch(
  place: LockPlace,
  io: PlatformIo = platformIo,
  primitive: ProcessPrimitive = processPrimitive,
): MarkerCheck {
  const reading = readTheMarker(place);
  if (!reading.present) {
    return Object.freeze({
      refuse: false,
      refusal: null,
      probe: "no-owner" as const,
      because: "there is no marker",
      path: reading.path,
      unreadable: false,
    });
  }
  if (!reading.readable) {
    return Object.freeze({
      refuse: false,
      refusal: null,
      probe: "no-owner" as const,
      because: `${reading.detail}; an unreadable marker is treated as a missing one and refuses nothing`,
      path: reading.path,
      unreadable: true,
    });
  }
  const probe = probeTheOwnerOfTheMarker(reading.marker, io, primitive);
  const refuse = probe.answer === "cannot-be-probed";
  return Object.freeze({
    refuse,
    refusal: refuse ? MARKER_REFUSAL : null,
    probe: probe.answer,
    because: probe.because,
    path: reading.path,
    unreadable: false,
  });
}

/* ------------------------------------------------------------------ *
 * The heartbeat (F122-FR-038).
 * ------------------------------------------------------------------ */

/** What one heartbeat of the marker did. */
export type MarkerHeartbeat = {
  /** True where the marker was missing or unreadable and was written again. */
  readonly rewritten: boolean;
  /** Why it was rewritten, where it was. */
  readonly because: string | null;
  readonly path: string;
  /** The integrity event this heartbeat asks the caller to raise. */
  readonly integrityEvent: {
    readonly type: typeof MARKER_INTEGRITY_EVENT;
    readonly data: Readonly<Record<string, unknown>>;
  } | null;
};

/**
 * F122-FR-038 — *when the marker is missing while the run lives, the runtime
 * root MUST write it again and an integrity event MUST be raised*.
 *
 * The event is RETURNED and not appended here, so that this module needs no
 * event stream and the one writer of the stream stays the one writer
 * (`appendEvent` of `root/start.ts`, annex X §X.1). `markerHeartbeat` of
 * `root/start.ts` is the wiring that appends it.
 */
export function rewriteTheMarkerIfMissing(
  place: LockPlace,
  owner: OwnerRecord,
  launchId: string,
  now: () => Date = () => new Date(),
): MarkerHeartbeat {
  const reading = readTheMarker(place);
  const missing = !reading.present;
  const unreadable = reading.present && !reading.readable;
  if (!missing && !unreadable) {
    return Object.freeze({
      rewritten: false,
      because: null,
      path: reading.path,
      integrityEvent: null,
    });
  }
  const at = now();
  const path = writeTheMarker(place, owner, launchId, () => at);
  const because = missing
    ? "the marker was missing while the run lives"
    : `the marker was not an owner record while the run lives (${(reading as { detail: string }).detail})`;
  return Object.freeze({
    rewritten: true,
    because,
    path,
    integrityEvent: Object.freeze({
      type: MARKER_INTEGRITY_EVENT,
      data: Object.freeze({
        logicalName: MARKER_LOGICAL_NAME,
        path,
        launchId,
        wasMissing: missing,
        wasUnreadable: unreadable,
        rewrittenAt: at.toISOString(),
        detail: because,
      }),
    }),
  });
}
