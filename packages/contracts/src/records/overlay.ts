/**
 * T172 — the type and the validator of the overlay from
 * `schemas/overlay.schema.json` (annex C, §C.16; F100-FR-113).
 *
 * Schema id `specstride-overlay/v1` — the as-is name is kept
 * (contracts/README.md, "The `$id` of a schema file"). The logical name is
 * `overlay:<id>:tree`. The harness layer writes it per pass or per phase
 * attempt and is its only reader.
 *
 * The record names its schema in the field `contract`, not `schema`, so it is
 * validated by schema id: a `contract` that names another major is refused
 * with both majors.
 */
import type { Overlay as Generated } from "./generated/overlay.ts";
import { validate, type SchemaError } from "./compile.ts";
import { majorOf } from "./validate.ts";

/** The schema id the record carries in its field `contract`. */
export const SCHEMA_ID = "specstride-overlay/v1" as const;

/** The field that carries the schema id of this record (§C.16). */
export const SCHEMA_FIELD = "contract" as const;

/** The logical name of the overlay tree (annex B, §B.5). */
export const LOGICAL_NAME = "overlay:<id>:tree" as const;

/** The section of annex C that owns the field list. */
export const ANNEX_SECTION = "annex C, §C.16" as const;

/** The content owner of §C.16. */
export const CONTENT_OWNER = "109" as const;

/** The scopes of an overlay (row 88 of annex X §X.6). */
export const SCOPES = ["none", "pass", "attempt"] as const;
export type OverlayScope = (typeof SCOPES)[number];

/** Unknown-value rule of row 88: a configuration error, exit 3. */
export const SCOPE_WHEN_UNKNOWN = Object.freeze({
  outcome: "configuration-error" as const,
  exitCode: 3 as const,
});

/** The scope words of an overlay marker (row 129 of annex X §X.6). */
export const MARKER_SCOPES = ["pass", "attempt", "critic"] as const;
export type MarkerScope = (typeof MARKER_SCOPES)[number];

/**
 * Unknown-value rule of row 129: the tree is not an overlay of the product
 * and is left alone.
 */
export const MARKER_SCOPE_WHEN_UNKNOWN = Object.freeze({
  treeIsNotOursAndIsLeftAlone: true as const,
});

/** The kinds of record of the environment record of an overlay (row 130). */
export const ENVIRONMENT_RECORD_KINDS = ["unset", "set"] as const;

/** One entry of `seeds`: the variable, the path and the content (§C.16). */
export type OverlaySeed = {
  readonly var: string;
  readonly path: string;
  readonly content: string;
};

/** The overlay of a configuration home (annex C, §C.16). */
export type Overlay = Omit<Generated, "vars" | "seeds" | "unset"> & {
  readonly vars: readonly string[];
  readonly seeds?: readonly OverlaySeed[];
  readonly unset?: readonly string[];
};

/** The fields that are present in the marker of an overlay tree only (§C.16). */
export const MARKER_ONLY_FIELDS = ["ownerPid", "ownerStart", "createdAt", "markerScope"] as const;

/** The field of §C.16 whose value the harness layer derives. */
export const DERIVED_FIELDS = ["unset"] as const;

/** Why an overlay record was refused. */
export type OverlayRefusal = "not-a-record" | "missing-contract" | "different-major" | "invalid";

/** An overlay record that §C.16 refuses. */
export class OverlayRefusedError extends Error {
  readonly reason: OverlayRefusal;
  readonly majorFound: string;
  readonly majorSupported: string;
  readonly errors: readonly SchemaError[];

  constructor(init: {
    reason: OverlayRefusal;
    message: string;
    majorFound?: string;
    majorSupported?: string;
    errors?: readonly SchemaError[];
  }) {
    super(init.message);
    this.name = "OverlayRefusedError";
    this.reason = init.reason;
    this.majorFound = init.majorFound ?? "—";
    this.majorSupported = init.majorSupported ?? majorOf(SCHEMA_ID);
    this.errors = Object.freeze([...(init.errors ?? [])]);
  }
}

/**
 * Read an overlay record (annex C, §C.16).
 *
 * The field `contract` is required and names `specstride-overlay/v1`; another
 * major is refused with the major found and the major supported; every
 * required field of §C.16 is required. An unknown field follows the rule of
 * the schema, which is open: a reader ignores it (annex B, §B.4).
 */
export function readOverlay(value: unknown): Overlay {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OverlayRefusedError({
      reason: "not-a-record",
      message: "refused the overlay: it is no record (annex C, §C.16)",
    });
  }
  const carried = (value as { contract?: unknown }).contract;
  if (typeof carried !== "string" || carried === "") {
    throw new OverlayRefusedError({
      reason: "missing-contract",
      message:
        `refused the overlay: it carries no field \`${SCHEMA_FIELD}\`, which names the ` +
        `schema id "${SCHEMA_ID}" (annex C, §C.16)`,
    });
  }
  if (carried !== SCHEMA_ID) {
    const majorFound = majorOf(carried);
    const majorSupported = majorOf(SCHEMA_ID);
    throw new OverlayRefusedError({
      reason: "different-major",
      majorFound,
      majorSupported,
      message:
        `refused the overlay of the logical name "${LOGICAL_NAME}": the major found is ` +
        `${majorFound}, the major supported is ${majorSupported} (F100-FR-049)`,
    });
  }
  const result = validate<Overlay>(SCHEMA_ID, value);
  if (!result.ok) {
    throw new OverlayRefusedError({
      reason: "invalid",
      message:
        `refused the overlay: ` + result.errors.map((e) => `${e.path}: ${e.message}`).join("; "),
      errors: result.errors,
    });
  }
  return result.record;
}

/** `readOverlay` that returns a result instead of throwing. */
export function tryReadOverlay(
  value: unknown,
): { ok: true; record: Overlay } | { ok: false; error: OverlayRefusedError } {
  try {
    return { ok: true, record: readOverlay(value) };
  } catch (err) {
    if (err instanceof OverlayRefusedError) return { ok: false, error: err };
    throw err;
  }
}

/** True when the value validates against `specstride-overlay/v1`. */
export function isOverlay(value: unknown): value is Overlay {
  return validate<Overlay>(SCHEMA_ID, value).ok;
}

/* ------------------------------------------------------------------ *
 * F100-FR-113 — what each auth tier uses.
 * ------------------------------------------------------------------ */

/**
 * F100-FR-113 — at auth tier 1 a call uses the consumer's real configuration
 * home, never written by the run, with plugins, host hooks, skills and tool
 * servers of the harness off.
 */
export const SWITCHED_OFF_AT_TIER_1 = ["plugins", "host-hooks", "skills", "tool-servers"] as const;

/** What a call of each auth tier uses for its configuration home. */
export const HOME_BY_AUTH_TIER = Object.freeze({
  1: Object.freeze({
    home: "the consumer's real configuration home" as const,
    writtenByTheRun: false as const,
    switchedOff: SWITCHED_OFF_AT_TIER_1,
    overlay: false as const,
  }),
  2: Object.freeze({
    home: "a throwaway home built from an overlay of §C.16" as const,
    writtenByTheRun: true as const,
    switchedOff: SWITCHED_OFF_AT_TIER_1,
    overlay: true as const,
  }),
});

/** F100-FR-113 — the auth tier that uses an overlay. */
export function usesAnOverlay(authTier: number): boolean {
  return authTier === 2;
}

/**
 * F100-FR-113 — session state lives per phase attempt and is removed when the
 * phase attempt ends.
 */
export const SESSION_STATE_SCOPE: MarkerScope = "attempt";
export const SESSION_STATE_IS_REMOVED_WHEN_THE_ATTEMPT_ENDS = true as const;

/** The scope of the overlay under the `parity` profile (row 30 of annex X §X.7). */
export const SCOPE_UNDER_PARITY: OverlayScope = "none";

export type { SchemaError };
