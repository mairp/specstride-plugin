/**
 * T074 — the refusal of the critic role on native memory and on a
 * customisation shown to be loaded into a critic-class call, and the record
 * of the states for a critic-class call (F130-FR-045; CQ-232).
 *
 * Outside the `parity` profile the critic role is REFUSED unless the state of
 * native memory for a critic-class call is `off` or `absent`. The refusal is
 * reported to role resolution with the reason `memory-not-off` (row 182 of
 * annex X §X.6) and as the typed failure `capability_absent`. No opt-in lifts
 * it: memory is always off for a critic-class call, and
 * `harnesses.dsh.proposerCustomisations` has NO effect on a critic-class
 * call. A customisation that a recorded capture shows to be loaded into a
 * critic-class call and that the patch does not cover refuses the role the
 * same way (CQ-232). Under `parity` no check is made and the record says
 * `as-is`.
 */
import { CUSTOMISATION_KINDS, type CustomisationKind } from "../descriptor/index.ts";
import {
  resolveCustomisationStates,
  resolveMemoryState,
  type CustomisationCapture,
  type CustomisationState,
} from "./index.ts";

/** The refusal reason of F130-FR-045 (row 182 of annex X §X.6). */
export const MEMORY_NOT_OFF = "memory-not-off" as const;
export type MemoryNotOffReason = typeof MEMORY_NOT_OFF;

/** The typed failure the refusal is reported as. */
export const CRITIC_MEMORY_TYPED_FAILURE = "capability_absent" as const;
export type CriticMemoryTypedFailure = typeof CRITIC_MEMORY_TYPED_FAILURE;

/** The input of the refusal of the critic role. */
export type CriticMemoryInput = {
  readonly profile: string;
  /** `harnesses.dsh.proposerCustomisations` read as `on` — WITHOUT effect here. */
  readonly customisationsOptIn?: boolean;
  readonly memoryOptIn?: boolean;
  readonly capture?: CustomisationCapture | null;
};

/** The refusal of the NATIVE MEMORY half of F130-FR-045. */
export type CriticMemoryRefusal = {
  readonly refused: boolean;
  readonly reason: MemoryNotOffReason;
  readonly typedFailure: CriticMemoryTypedFailure;
  /** The state the refusal was decided on. */
  readonly memoryState: CustomisationState;
};

/**
 * F130-FR-045 — the critic role is refused while the state of native memory
 * is neither `off` nor `absent`. Under `parity` no check is made. The opt-in
 * of `memory.native.proposer` has NO effect on a critic-class call.
 */
export function criticMemoryRefusal(input: CriticMemoryInput): CriticMemoryRefusal {
  const memoryState = resolveMemoryState({ ...input, role: "critic" });
  const refused = input.profile !== "parity" && memoryState !== "off" && memoryState !== "absent";
  return {
    refused,
    reason: MEMORY_NOT_OFF,
    typedFailure: CRITIC_MEMORY_TYPED_FAILURE,
    memoryState,
  };
}

/**
 * F130-FR-045 (CQ-232) — a customisation shown by a recorded capture to be
 * loaded into a critic-class call and NOT covered by the patch refuses the
 * role exactly as native memory does. `patchCoveredKinds` are the kinds the
 * coverage check of F130-FR-024 showed the patch to take out of the call
 * (plugins and tool servers included).
 */
export function criticCustomisationRefusal(
  input: CriticMemoryInput & {
    readonly patchCoveredKinds?: readonly CustomisationKind[];
  },
): CriticMemoryRefusal & {
  /** The kinds that triggered the refusal; empty where memory alone refused. */
  readonly kinds: readonly CustomisationKind[];
} {
  const memory = criticMemoryRefusal(input);
  if (input.profile === "parity" || input.capture == null) {
    return { ...memory, kinds: [] };
  }
  const covered = new Set(input.patchCoveredKinds ?? []);
  const loaded = (input.capture.criticLoadedKinds ?? []).filter((kind) => !covered.has(kind));
  return {
    refused: memory.refused || loaded.length > 0,
    reason: MEMORY_NOT_OFF,
    typedFailure: CRITIC_MEMORY_TYPED_FAILURE,
    memoryState: memory.memoryState,
    kinds: loaded,
  };
}

/** The record of ONE critic-class call (F130-FR-045): the state of each kind. */
export type CriticClassRecord = {
  readonly role: "critic";
  readonly profile: string;
  readonly memory: { readonly valueAsked: "off"; readonly state: CustomisationState };
  readonly customisations: readonly {
    readonly kind: CustomisationKind;
    readonly state: CustomisationState;
  }[];
  readonly refusal: CriticMemoryRefusal & { readonly kinds: readonly CustomisationKind[] };
};

/** Builds the record of a critic-class call. The opt-ins have no effect here. */
export function criticClassRecord(
  input: CriticMemoryInput & {
    readonly patchCoveredKinds?: readonly CustomisationKind[];
  },
): CriticClassRecord {
  const memoryState = resolveMemoryState({ ...input, role: "critic" });
  const states = resolveCustomisationStates({ ...input, customisationsOptIn: false });
  return {
    role: "critic",
    profile: input.profile,
    memory: { valueAsked: "off", state: memoryState },
    customisations: CUSTOMISATION_KINDS.map((kind) => ({
      kind,
      state: states.find((s) => s.kind === kind)?.state ?? "not-switchable",
    })),
    refusal: criticCustomisationRefusal(input),
  };
}
