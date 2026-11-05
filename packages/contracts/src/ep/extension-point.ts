/**
 * The common rules of every extension point as types and data (annex A, §A.4;
 * F100-FR-013, F100-FR-014, F100-FR-020, F100-FR-021).
 *
 * The nineteen interface types of `src/ep/` share this module: the form of an
 * id, the range of majors the core supports, the three classes of
 * implementation (row 83 of annex X §X.6), which points are public contracts
 * and which one is an internal seam, and the default unknown-value rule.
 *
 * The thirteen sub-headings under which every point is described are the same
 * in every annex, and `EXTENSION_POINT_SUB_HEADINGS` pins them; the frame of
 * the test kit reads them from the contract file of each point.
 */
/** F100-FR-013 — the form of the id of an extension point. */
export const EXTENSION_POINT_ID_FORM = /^specstride\.[a-z][a-z0-9-]*\/(\d+)$/;

/** The parts of an id of the form `specstride.<name>/<major>`. */
export type ExtensionPointId = {
  readonly id: string;
  readonly name: string;
  readonly major: number;
};

/** Read an id of the form `specstride.<name>/<major>`, or `undefined`. */
export function parseExtensionPointId(id: string): ExtensionPointId | undefined {
  const m = EXTENSION_POINT_ID_FORM.exec(id);
  if (m === null) return undefined;
  const major = Number(m[1]);
  return Object.freeze({ id, name: id.slice("specstride.".length, id.indexOf("/")), major });
}

/** The current major of every extension point of Wave 1 (annex A, §A.4). */
export const CURRENT_MAJOR = 1 as const;

/**
 * F100-FR-013 — the core supports the current major and the one before it.
 * Major 0 is no major of this product, so at the current major 1 the range
 * holds the one value 1; at a later current major it holds two.
 */
export function supportedMajors(current: number = CURRENT_MAJOR): readonly number[] {
  return Object.freeze(current > 1 ? [current - 1, current] : [current]);
}

/** True when a declared major lies inside the range the core supports. */
export function majorIsSupported(major: number, current: number = CURRENT_MAJOR): boolean {
  return supportedMajors(current).includes(major);
}

/**
 * F100-FR-013 — the message with which the registry refuses an implementation
 * outside the supported range, and which the doctor reports.
 */
export function majorOutOfRangeMessage(
  pointId: string,
  declared: readonly number[],
  current: number = CURRENT_MAJOR,
): string {
  return (
    `refused: the implementation of \`${pointId}\` declares the major ` +
    `${declared.join(", ")}; the core supports ${supportedMajors(current).join(" and ")} ` +
    `(F100-FR-013)`
  );
}

/* ------------------------------------------------------------------ *
 * The three classes of implementation (row 83 of annex X §X.6).
 * ------------------------------------------------------------------ */

/** F100-FR-014 — the three classes an implementation can be of. */
export const IMPLEMENTATION_CLASSES = ["data", "first-party", "third-party"] as const;
export type ImplementationClass = (typeof IMPLEMENTATION_CLASSES)[number];

/**
 * Row 83 of annex X §X.6, "Classes of implementation of an extension point",
 * registers by reference to `IMPLEMENTATION_CLASSES`, in the batch file of
 * its owner (`src/enums/sets-100-104.ts`, T250). An unknown class is refused
 * at registration.
 */
export const CLOSED_SET_ROW_OF_THE_CLASSES = 83 as const;

/** F100-FR-014 — Wave 1 accepts data and first-party code; not third-party. */
export const CLASSES_ACCEPTED_IN_WAVE_1: readonly ImplementationClass[] = Object.freeze([
  "data",
  "first-party",
]);

/** F100-FR-014 — the message with which a third-party class is refused. */
export function thirdPartyRefusedMessage(pointId: string): string {
  return (
    `refused: the class \`third-party\` is not enabled in Wave 1; the ` +
    `implementation of \`${pointId}\` is refused at registration, and its ` +
    `interface is designed and not enabled (F100-FR-014)`
  );
}

/* ------------------------------------------------------------------ *
 * F100-FR-020 — public contracts and the one internal seam.
 * ------------------------------------------------------------------ */

/** The one extension point that is an internal seam (F100-FR-020). */
export const INTERNAL_SEAM_POINT = "EP-18" as const;

/** F100-FR-020 — `public-contract` for EP-01 to EP-17 and EP-19; EP-18 is `internal-seam`. */
export type ExtensionPointStanding = "public-contract" | "internal-seam";

export function standingOf(ep: string): ExtensionPointStanding {
  return ep === INTERNAL_SEAM_POINT ? "internal-seam" : "public-contract";
}

/** True where the point carries a compatibility promise per major (F100-FR-020). */
export function hasCompatibilityPromise(ep: string): boolean {
  return standingOf(ep) === "public-contract";
}

/* ------------------------------------------------------------------ *
 * F100-FR-021 — the default unknown-value rule.
 * ------------------------------------------------------------------ */

/** The three cases the default rule of F100-FR-021 covers. */
export const UNKNOWN_VALUE_CASES = [
  "unknown-field",
  "unknown-closed-member",
  "unknown-open-member",
] as const;
export type UnknownValueCase = (typeof UNKNOWN_VALUE_CASES)[number];

/**
 * F100-FR-021 — where the section of a point states nothing more specific:
 * an unknown field is ignored by a reader and kept by a writer that copies
 * the record; an unknown member of a closed set refuses the record with a
 * message that names the set and the value; an unknown member of an open set
 * is resolved through the registry and refused only if no entry matches.
 */
export const DEFAULT_UNKNOWN_VALUE_RULE: Readonly<Record<UnknownValueCase, string>> = Object.freeze(
  {
    "unknown-field": "ignored by a reader and kept by a writer that copies the record",
    "unknown-closed-member": "refuses the record with a message that names the set and the value",
    "unknown-open-member": "resolved through the registry and refused only if no entry matches",
  },
);

/** The thirteen sub-headings under which every point is described (annex A, §A.4). */
export const EXTENSION_POINT_SUB_HEADINGS = [
  "Id and version",
  "Purpose",
  "Caller and time",
  "Inputs",
  "Outputs",
  "Errors",
  "Guarantees of the core",
  "Guarantees of an implementation",
  "Failure of an implementation",
  "Unknown-value rule",
  "Wave 1 implementations",
  "Content owner",
  "Proving test",
] as const;
export type ExtensionPointSubHeading = (typeof EXTENSION_POINT_SUB_HEADINGS)[number];

/**
 * F100-FR-019 — a failing implementation produces no verdict, no exit code
 * and no stop reason of its own. These are the field names a degradation
 * record must not carry.
 */
export const FIELDS_A_DEGRADATION_NEVER_CARRIES = [
  "verdict",
  "exit_code",
  "exitCode",
  "stop_reason",
  "stopReason",
] as const;
