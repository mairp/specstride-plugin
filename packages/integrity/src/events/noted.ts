// T075 (F116-FR-022) — the emission of `integrity.noted` for the kinds this
// feature raises, through the engine.
//
// For every integrity event this feature raises — the kinds
// `changed-during-check`, `phase-entry-mismatch`, `toolchain-config-changed`
// and `pin-mismatch` (all members of closed set row 65) — the engine emits
// ONE event of the type `integrity.noted` of the event catalogue, with the
// fields `kind` and `detail`. `detail` holds the paths concerned, marked as
// values of the workspace, and never the content of a file nor the output of
// a command. This feature emits no other event type. With no loop layer on
// AND the switch of the comparison at phase entry (F116-FR-012) off, no such
// event is emitted.
export const NOTED_EVENT_TYPE = "integrity.noted";

/** The four integrity kinds this feature raises (row 65 of annex X §X.6). */
export const NOTED_KINDS: readonly string[] = Object.freeze([
  "changed-during-check",
  "phase-entry-mismatch",
  "toolchain-config-changed",
  "pin-mismatch",
]);

/** One integrity event of this feature, before it is noted. */
export interface IntegrityEvent {
  kind: string;
  /** The paths concerned; values of the workspace, marked in `detail`. */
  paths: string[];
}

/** A path as it reaches the critic prompt: a marked workspace value. */
export interface MarkedWorkspaceValue {
  value: string;
  origin: "workspace";
}

/** The one event the engine emits per integrity event (annex X §X.1). */
export interface NotedEvent {
  type: "integrity.noted";
  kind: string;
  detail: {
    paths: MarkedWorkspaceValue[];
  };
}

export interface NotedOptions {
  /** Whether a loop layer is on for this run. */
  loopLayerOn: boolean;
  /** The value of the switch of the comparison at phase entry (DV-077). */
  phaseEntrySwitch: "on" | "off";
}

/**
 * Emit one `integrity.noted` event for an integrity event of this feature,
 * or null when the kind is not one of this feature's, or when no loop layer
 * is on and the switch of the comparison at phase entry is off.
 */
export function noteIntegrityEvent(
  event: IntegrityEvent,
  options: NotedOptions,
): NotedEvent | null {
  if (!NOTED_KINDS.includes(event.kind)) return null;
  if (!options.loopLayerOn && options.phaseEntrySwitch === "off") return null;
  return {
    type: NOTED_EVENT_TYPE,
    kind: event.kind,
    detail: {
      paths: event.paths.map((p) => ({ value: p, origin: "workspace" as const })),
    },
  };
}
