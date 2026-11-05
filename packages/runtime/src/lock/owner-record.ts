/**
 * T012 — the owner record: built, validated against the schema of feature 100,
 * and compared with the present process (F122-FR-013; annex B §B.9).
 *
 * The owner record is not a record of this feature: feature 100 owns its schema
 * (`specstride.lease/1:owner`) and its eight fields. What this feature owns is
 * the three things done WITH it, and they are the three parts of this module:
 *
 *   1. **build** — fill the eight fields from the platform readers of T010, so
 *      that a record is never assembled from guesses. A reading the platform
 *      will not give is `null`, never an invention.
 *   2. **validate** — read it back through the validator of feature 100, so a
 *      record that lacks a required field is refused HERE and not deep inside a
 *      probe. F122-FR-013 and the unknown-value rule of annex F §F.5 agree on
 *      what that means: an unknown FIELD is accepted and a missing REQUIRED
 *      field makes the probe `unknown`, which counts as held.
 *   3. **compare** — hold a record against the process that is reading it. This
 *      is what tells `held-live` from `held-foreign` from `stale-owner-dead`
 *      (rows P3 to P6 of `probe-decision-table.json`). The comparison answers
 *      in those terms and the probe does not re-derive them.
 *
 * The record is only ever written as part of something else — the lock, the
 * lease and the advisory marker (F100-FR-062) — so nothing here writes a file.
 */
import {
  SCHEMA_ID,
  isOwnerRecord,
  tryReadOwnerRecord,
  type OwnerRecord,
} from "@specstride/contracts/records/owner-record";
import {
  bootIdentity,
  hostNameOfTheMachine,
  pidNamespaceOf,
  platformIo,
  startTimeOfProcess,
  type PlatformIo,
} from "../procs/platform.ts";
import { processGroupOf, processPrimitive } from "@specstride/kernel";
import type { ProcessPrimitive } from "@specstride/contracts/ep/kernel-services";

export type { OwnerRecord };
export { SCHEMA_ID };

/** The requirement this module carries, and the annex that owns the fields. */
export const OWNER_RECORD_REQUIREMENT = "F122-FR-013" as const;
export const OWNER_RECORD_ANNEX_SECTION = "annex B, §B.9" as const;

/** The eight fields of §B.9, in the order the annex lists them. */
export const OWNER_RECORD_FIELDS = [
  "pid",
  "processGroup",
  "startTime",
  "bootId",
  "hostName",
  "pidNamespace",
  "launchId",
  "runTokenHash",
] as const;
export type OwnerRecordField = (typeof OWNER_RECORD_FIELDS)[number];

/**
 * F122-FR-013 — *the owner record cannot be read or lacks a required field:
 * the probe says `unknown`*. The text a missing field is reported as, so that
 * a reading of `unknown` is a value and not an empty string.
 */
export const UNKNOWN_FIELD = "unknown" as const;

/* ------------------------------------------------------------------ *
 * 1. Build.
 * ------------------------------------------------------------------ */

/**
 * The record as this module builds it: the eight fields of §B.9 and the id of
 * the schema. The generated type of feature 100 does not name `schema` —
 * the schema of §B.9 allows additional properties — so it is named here, and
 * every record this module builds carries it.
 */
export type BuiltOwnerRecord = OwnerRecord & { readonly schema: typeof SCHEMA_ID };

/** What the caller knows that the platform cannot tell it. */
export type OwnerRecordInput = {
  /** The launch this owner belongs to. */
  readonly launchId: string;
  /** The HASH of the run token; the token itself never reaches a record. */
  readonly runTokenHash: string;
  /** The process the record is about; this process where none is named. */
  readonly pid?: number;
};

/**
 * Build the owner record of a process from the platform readers of T010.
 *
 * Every field that the platform will not give becomes the text `unknown`
 * rather than a guess or an empty string, because the schema of §B.9 types
 * five of the eight as text and a reader of a field it does not understand is
 * told to accept it (annex B §B.4). `pidNamespace` is the one field the schema
 * types as text OR null, and macOS has no pid namespace, so there `null` is
 * the true answer and not an absence.
 *
 * `startTime` is text in the schema and a number on the platform: it is
 * written as the decimal of the milliseconds since the epoch, so two readings
 * of one process compare as equal and a reading that failed does not compare
 * equal to anything.
 */
export function buildOwnerRecord(
  input: OwnerRecordInput,
  io: PlatformIo = platformIo,
  primitive: ProcessPrimitive = processPrimitive,
): BuiltOwnerRecord {
  const pid = input.pid ?? process.pid;
  const startTimeMs = startTimeOfProcess(pid, primitive);
  return Object.freeze({
    // F100-FR-048 — every record carries the id of its schema, and the
    // validator of feature 100 refuses one that does not (`missing-schema`).
    // It is written HERE and not by a caller, so a record this function built
    // always passes the validator in the next section: the two cannot drift.
    schema: SCHEMA_ID,
    pid,
    processGroup: processGroupOf(pid, io) ?? pid,
    startTime: startTimeMs === null ? UNKNOWN_FIELD : String(startTimeMs),
    bootId: bootIdentity(io) ?? UNKNOWN_FIELD,
    hostName: hostNameOfTheMachine(io) ?? UNKNOWN_FIELD,
    pidNamespace: pidNamespaceOf(pid, io),
    launchId: input.launchId,
    runTokenHash: input.runTokenHash,
  });
}

/* ------------------------------------------------------------------ *
 * 2. Validate, against the schema of feature 100.
 * ------------------------------------------------------------------ */

/** Why a value is not a usable owner record. */
export const OWNER_RECORD_REFUSALS = [
  /** It is not an object, or a required field of §B.9 is absent. */
  "missing-required-field",
  /** It carries no `schema` field at all (F100-FR-048). */
  "missing-schema",
  /** It declares a schema no reader of this product knows. */
  "unknown-schema",
  /** It declares a different major of the schema. */
  "different-major",
  /** The validator refused it for another reason. */
  "invalid",
] as const;
export type OwnerRecordRefusal = (typeof OWNER_RECORD_REFUSALS)[number];

/** What `validateOwnerRecord` answers. */
export type OwnerRecordValidation =
  | { readonly ok: true; readonly record: OwnerRecord }
  | {
      readonly ok: false;
      readonly refusal: OwnerRecordRefusal;
      /** The required fields of §B.9 that are absent. */
      readonly missing: readonly OwnerRecordField[];
      readonly message: string;
    };

/**
 * F122-FR-013 — validate a value against `specstride.lease/1:owner`, the
 * schema of feature 100.
 *
 * The validator of feature 100 is the judge and this module adds nothing to
 * it; what it adds is the ANSWER a probe needs: which required fields were
 * absent. Row P2 of `probe-decision-table.json` turns any refusal here into
 * `unknown`, which counts as held, so a record that cannot be read never
 * reads as a free lock.
 *
 * An unknown field is accepted (annex B §B.4,
 * `OWNER_RECORD_UNKNOWN_FIELD_IS_ACCEPTED` of the EP-13 contract): the schema
 * allows additional properties, and a reader of a later version must not be
 * refused by an older one.
 */
export function validateOwnerRecord(value: unknown): OwnerRecordValidation {
  const missing = missingRequiredFields(value);
  const read = tryReadOwnerRecord(value);
  if (read.ok) return Object.freeze({ ok: true as const, record: read.record });

  // The reason is the VALIDATOR's own field and is not re-derived from its
  // prose: a message is for a person to read and a reason is for a caller to
  // branch on. A missing required field of §B.9 is reported as such even
  // though the validator calls it `invalid`, because that is the distinction
  // row P2 of the probe decision table and F122-FR-013 draw.
  const message = read.error.message;
  const refusal: OwnerRecordRefusal =
    read.error.reason === "missing-schema"
      ? "missing-schema"
      : read.error.reason === "unknown-schema"
        ? "unknown-schema"
        : read.error.reason === "different-major"
          ? "different-major"
          : missing.length > 0
            ? "missing-required-field"
            : "invalid";
  return Object.freeze({
    ok: false as const,
    refusal,
    missing,
    message,
  });
}

/** The required fields of §B.9 a value does not carry. */
export function missingRequiredFields(value: unknown): readonly OwnerRecordField[] {
  if (value === null || typeof value !== "object") return Object.freeze([...OWNER_RECORD_FIELDS]);
  const held = value as Record<string, unknown>;
  return Object.freeze(
    OWNER_RECORD_FIELDS.filter((field) => {
      const at = held[field];
      // `pidNamespace` is the one field whose `null` is a value and not an
      // absence: macOS has no pid namespace (D-6).
      if (field === "pidNamespace") return at === undefined;
      return at === undefined || at === null;
    }),
  );
}

/** True where the value validates against the schema of feature 100. */
export function isValidOwnerRecord(value: unknown): value is OwnerRecord {
  return isOwnerRecord(value);
}

/* ------------------------------------------------------------------ *
 * 3. Compare with the present process.
 * ------------------------------------------------------------------ */

/**
 * How a record stands to the process reading it. Each value is the question a
 * row of `probe-decision-table.json` asks, so a probe reads these and derives
 * nothing of its own.
 */
export const OWNER_COMPARISONS = [
  /** Another host name or another pid namespace: row P3, `held-foreign`. */
  "foreign",
  /** The record is of THIS process. */
  "self",
  /** Same world, same boot, a different process: it may live or be dead. */
  "same-boot",
  /** Another boot: the owner counts as dead whatever has its pid now (P6). */
  "other-boot",
  /** Something could not be read, so nothing may be concluded: row P2. */
  "unknown",
] as const;
export type OwnerComparison = (typeof OWNER_COMPARISONS)[number];

/** What `compareWithThisProcess` answers. */
export type OwnerComparisonResult = {
  readonly comparison: OwnerComparison;
  /** True where the host name or the pid namespace differs (row P3). */
  readonly foreign: boolean;
  /** True where the boot identity of the record is the present boot. */
  readonly sameBoot: boolean;
  /** True where the record names this very process. */
  readonly isThisProcess: boolean;
  /** Which of the compared readings could not be taken. */
  readonly unreadable: readonly string[];
  /** A line for a doctor finding or a refusal; never a secret. */
  readonly detail: string;
};

/**
 * F122-FR-013 — compare an owner record with the present process.
 *
 * The three readings that decide it, in the order the decision table asks
 * them:
 *
 *   - the HOST NAME and the PID NAMESPACE, which say whether the record was
 *     made in the same world at all. A record from another host, or from
 *     another pid namespace, names a process id that means nothing here, so it
 *     is `foreign` and is never reclaimed automatically
 *     (`A_FOREIGN_OWNER_IS_RECLAIMED_AUTOMATICALLY` is `false` in the EP-13
 *     contract). Note that this is checked BEFORE the boot, because a foreign
 *     record's boot identity is not ours to compare.
 *   - the BOOT IDENTITY. *An owner whose boot identity differs from the
 *     present boot MUST count as dead, whatever process now has its pid*
 *     (F122-FR-013). That sentence is why the comparison is here and not in a
 *     liveness check: no probe of a socket could discover it.
 *   - whether the record is of THIS process, which a reader needs so that its
 *     own lock does not look to it like someone else's.
 *
 * A reading the platform would not give makes the answer `unknown`: the
 * comparison never turns an absence into agreement.
 */
export function compareWithThisProcess(
  record: OwnerRecord,
  io: PlatformIo = platformIo,
  primitive: ProcessPrimitive = processPrimitive,
): OwnerComparisonResult {
  const unreadable: string[] = [];

  const hostNow = hostNameOfTheMachine(io);
  if (hostNow === null) unreadable.push("hostName");
  const namespaceNow = pidNamespaceOf(process.pid, io);
  if (namespaceNow === null && io.platform === "linux") unreadable.push("pidNamespace");
  const bootNow = bootIdentity(io);
  if (bootNow === null) unreadable.push("bootId");

  // A field the record itself carries as `unknown` is a field that could not
  // be read when the record was made, so it cannot be compared now either.
  for (const field of ["hostName", "bootId"] as const) {
    if (record[field] === UNKNOWN_FIELD) unreadable.push(`record.${field}`);
  }
  // On Linux a record whose `pidNamespace` is null is a record made where the
  // link could not be read; on a platform that has no pid namespace the same
  // null is the true answer and nothing is missing.
  if (io.platform === "linux" && record.pidNamespace === null) {
    unreadable.push("record.pidNamespace");
  }

  // `foreign` needs a POSITIVE, readable difference on both sides. An absence
  // is not a difference: were an unreadable reading allowed to make a record
  // foreign, a machine on which `/proc/self/ns/pid` cannot be read would
  // refuse every launch with `foreign-owner` — exit 4, and a foreign owner is
  // never reclaimed automatically — where the honest answer is `unknown`,
  // exit 24, which `resume` can still clear. That is the difference between a
  // run a consumer can recover and one they cannot.
  const hostDiffers =
    hostNow !== null && record.hostName !== UNKNOWN_FIELD && record.hostName !== hostNow;
  // On a platform with no pid namespace both sides are legitimately `null`,
  // which is agreement. On Linux a `null` means the link could not be read, so
  // the two are not comparable at all and no difference may be concluded.
  const namespaceIsComparable =
    io.platform !== "linux" || (namespaceNow !== null && record.pidNamespace !== null);
  const namespaceDiffers = namespaceIsComparable && record.pidNamespace !== namespaceNow;
  const foreign = hostDiffers || namespaceDiffers;

  const sameBoot = bootNow !== null && record.bootId !== UNKNOWN_FIELD && record.bootId === bootNow;
  const isThisProcess =
    record.pid === process.pid &&
    sameBoot &&
    !foreign &&
    startTimeAgrees(record, process.pid, primitive);

  const comparison: OwnerComparison = foreign
    ? "foreign"
    : isThisProcess
      ? "self"
      : unreadable.length > 0
        ? "unknown"
        : sameBoot
          ? "same-boot"
          : "other-boot";

  return Object.freeze({
    comparison,
    foreign,
    sameBoot,
    isThisProcess,
    unreadable: Object.freeze(unreadable),
    detail: detailOf(comparison, record, { hostNow, namespaceNow, bootNow, unreadable }),
  });
}

/** Whether the `startTime` of a record agrees with the platform's reading. */
function startTimeAgrees(record: OwnerRecord, pid: number, primitive: ProcessPrimitive): boolean {
  if (record.startTime === UNKNOWN_FIELD) return false;
  const recorded = Number(record.startTime);
  if (!Number.isFinite(recorded)) return false;
  const observed = startTimeOfProcess(pid, primitive);
  if (observed === null) return false;
  // The same margin the platform readers use: the boot time is recorded in
  // seconds, so two readers that rounded differently still agree.
  return Math.abs(observed - recorded) <= 1_000;
}

/** A line a refusal or a doctor finding can print. It carries no token. */
function detailOf(
  comparison: OwnerComparison,
  record: OwnerRecord,
  now: {
    hostNow: string | null;
    namespaceNow: string | null;
    bootNow: string | null;
    unreadable: readonly string[];
  },
): string {
  switch (comparison) {
    case "foreign":
      return (
        `the owner record was made on host \`${record.hostName}\` in the pid namespace ` +
        `\`${record.pidNamespace ?? "(none)"}\`, and this process is on ` +
        `\`${now.hostNow ?? UNKNOWN_FIELD}\` in \`${now.namespaceNow ?? "(none)"}\`: its ` +
        `process id ${record.pid} names nothing here, and a foreign owner is never reclaimed ` +
        `automatically (F122-FR-013)`
      );
    case "self":
      return `the owner record names this very process (pid ${record.pid})`;
    case "same-boot":
      return (
        `the owner record names process ${record.pid} of this boot and this host; whether it ` +
        `lives is for the liveness check to say`
      );
    case "other-boot":
      return (
        `the owner record was made in boot \`${record.bootId}\` and this is boot ` +
        `\`${now.bootNow ?? UNKNOWN_FIELD}\`: the owner counts as dead, whatever process has ` +
        `pid ${record.pid} now (F122-FR-013)`
      );
    case "unknown":
      return (
        `the owner record cannot be compared with this process: ` +
        `${now.unreadable.join(", ")} could not be read, so the probe is \`unknown\`, which ` +
        `counts as held (F122-FR-013)`
      );
  }
}
