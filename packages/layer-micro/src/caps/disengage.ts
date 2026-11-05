/**
 * T077 — `layerOffForAttempt`, for every cause of F115-FR-025 (IR-07).
 *
 * The layer returns `layerOffForAttempt` when a cap of cycles is spent, when
 * two units are unresolved, when two consecutive units are `unchecked` and
 * the inner set is empty, when a check cannot start, when its own code
 * fails, or on an integrity event other than a taint. The classic loop then
 * carries on from the tree as it is. No exit code, no stop reason and no run
 * state results: the value carries none. A taint never switches the layer
 * off.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */

/** The closed set of the causes of F115-FR-025. */
export const DISENGAGE_CAUSES = [
  "cycles-spent",
  "unresolved-units",
  "unchecked-empty-streak",
  "check-cannot-start",
  "layer-error",
  "integrity-event",
] as const;
export type DisengageCause = (typeof DISENGAGE_CAUSES)[number];

/** The integrity events that are not a taint (annex X §X.6 row 65). */
export const INTEGRITY_EVENT_KINDS = [
  "ledger-invalid",
  "manifest-mismatch",
  "pin-mismatch",
] as const;
export type IntegrityEventKind = (typeof INTEGRITY_EVENT_KINDS)[number];

/** The taint: an integrity fact that never switches the layer off. */
export const TAINT_KIND = "changed-during-check";

/**
 * The value `layerOffForAttempt` carries. No exit code, no stop reason and
 * no run state is part of it (IR-07): the record holds none of the three.
 */
export type LayerOff = {
  readonly directive: "layerOffForAttempt";
  readonly cause: DisengageCause;
  /** The kind of the integrity event, for the cause `integrity-event`. */
  readonly integrityKind?: IntegrityEventKind;
  /** IR-07 — the value carries no exit code: `undefined` by construction. */
  readonly exitCode: undefined;
  /** IR-07 — the value carries no stop reason: `undefined` by construction. */
  readonly stopReason: undefined;
  /** IR-07 — the value carries no run state: `undefined` by construction. */
  readonly runState: undefined;
};

/**
 * F115-FR-025 — the layer goes off for the phase attempt for the cause.
 * The classic loop carries on from the tree as it is; nothing here touches
 * the tree.
 */
export function layerOffForAttempt(cause: DisengageCause): LayerOff {
  return {
    directive: "layerOffForAttempt",
    cause,
    exitCode: undefined,
    stopReason: undefined,
    runState: undefined,
  };
}

/** The same, for an integrity event other than a taint. */
export function layerOffForIntegrity(kind: IntegrityEventKind): LayerOff {
  return {
    directive: "layerOffForAttempt",
    cause: "integrity-event",
    integrityKind: kind,
    exitCode: undefined,
    stopReason: undefined,
    runState: undefined,
  };
}

/**
 * F115-FR-025 — a taint never switches the layer off. The kinds that do are
 * exactly the integrity events of `INTEGRITY_EVENT_KINDS`; the taint kind
 * and anything else read as no disengage.
 */
export function disengageForIntegrityKind(kind: string): LayerOff | undefined {
  if ((INTEGRITY_EVENT_KINDS as readonly string[]).includes(kind)) {
    return layerOffForIntegrity(kind as IntegrityEventKind);
  }
  return undefined;
}

/**
 * F115-FR-025 — a taint is not a disengage cause: the result carries
 * `tainted`, the unit is not kept, the failure counts against the repairs,
 * and the layer stays on.
 */
export function isTaint(kind: string): boolean {
  return kind === TAINT_KIND;
}

/**
 * The run record of one phase attempt, as the runtime keeps it for an
 * independent reader. The layer is pure (F100-FR-012), so the record is a
 * seam the runtime hands in; the durable read is the fields of the record
 * after the write, which the write itself never answers.
 */
export type DirectiveLog = { events: string[]; stopReason?: string; exitCode?: number };

/**
 * IR-07 — write the disengage directive onto the run record. Only the event
 * of the directive is recorded: a stop reason and an exit code result from
 * nothing here, and the record never gains one.
 */
export function recordLayerOff(log: DirectiveLog, off: LayerOff): void {
  log.events.push(`layerOffForAttempt:${off.cause}`);
}
