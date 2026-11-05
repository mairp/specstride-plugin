/**
 * T073 — the kinds and states of the customisations of the profile and of the
 * native memory, the customisation record per run and per call, the launch
 * line, and the reading of `harnesses.dsh.proposerCustomisations` and
 * `memory.native.proposer` (F130-FR-003, F130-FR-043, F130-FR-044).
 *
 * A pass on dsh boots a profile of the harness's home, and the profile
 * composes what the consumer installed there. The adapter has NO switch that
 * takes a kind of customisation out of a pass (the throwaway home of
 * F130-FR-014 links every entry of the real home), so it REPORTS, WARNS and
 * RECORDS. The kinds are a closed set (`plugins`, `host-hooks`, `skills`,
 * `tool-servers`); the states are a closed set (`off`, `absent`, `opted-in`,
 * `not-switchable`, `as-is`).
 *
 * `off` and `absent` are NEVER recorded unless a recorded capture shows it
 * (capture 6, F130-FR-042): the resolvers below admit them only through the
 * injected capture record. The opt-ins are read from USER CONFIGURATION only
 * — no environment alias, no flag, no project configuration reaches them.
 * Under the `parity` profile the state is `as-is`, no flag is passed and no
 * line is printed (rows 29 and 131 of annex X §X.7).
 */
import { CUSTOMISATION_KINDS, type CustomisationKind } from "../descriptor/index.ts";
import { PASS_LOOP_COMPONENT } from "../model/index.ts";
import type { ConfigSource } from "../proposer/settings.ts";

export type { CustomisationKind };

/** The closed set of states (F130-FR-043). */
export const CUSTOMISATION_STATES = [
  "off",
  "absent",
  "opted-in",
  "not-switchable",
  "as-is",
] as const;
export type CustomisationState = (typeof CUSTOMISATION_STATES)[number];

/** The opt-in switch of the customisations of the proposer (row 131). */
export const PROPOSER_CUSTOMISATIONS_SWITCH = "harnesses.dsh.proposerCustomisations" as const;

/** The opt-in switch of the native memory of the proposer (row 29). */
export const MEMORY_NATIVE_PROPOSER_SWITCH = "memory.native.proposer" as const;

/** The values each switch accepts; the default of both is `off`. */
export const CUSTOMISATION_SWITCH_VALUES = ["off", "on"] as const;
export type CustomisationSwitchValue = (typeof CUSTOMISATION_SWITCH_VALUES)[number];
export const CUSTOMISATION_SWITCH_DEFAULT: CustomisationSwitchValue = "off";

/**
 * A recorded capture (capture 6, F130-FR-042) that settles what the profile
 * loads and what the harness keeps. The ONLY source of the states `off` and
 * `absent`: a resolver never derives them from configuration.
 */
export type CustomisationCapture = {
  /** The capture that produced the record ("capture 6" at this feature). */
  readonly capture: string;
  /** The pin the capture was taken at. */
  readonly pin: string;
  /** What the capture shows for the native memory; null where it shows none. */
  readonly memory: "off" | "absent" | null;
  /** What the capture shows per kind of customisation. */
  readonly kinds: Readonly<Partial<Record<CustomisationKind, "off" | "absent">>>;
  /** Kinds the capture shows LOADED into a critic-class call (CQ-232). */
  readonly criticLoadedKinds?: readonly CustomisationKind[];
};

/** The profile a resolution reads its rule from (`parity` vs everything else). */
export type CustomisationProfile = "parity" | "strict";

/** The input of every state resolution of this module. */
export type CustomisationsInput = {
  readonly profile: CustomisationProfile | string;
  /** `harnesses.dsh.proposerCustomisations` read as `on` (user configuration). */
  readonly customisationsOptIn?: boolean;
  /** `memory.native.proposer` read as `on` (user configuration). */
  readonly memoryOptIn?: boolean;
  /** The recorded capture that admits `off` or `absent`; null where none ran. */
  readonly capture?: CustomisationCapture | null;
};

/**
 * Reads `harnesses.dsh.proposerCustomisations` from USER CONFIGURATION only
 * (row 131): the key of the consumer configuration, no environment alias, no
 * flag. `off` where the key is absent or holds anything but `on`.
 */
export function readCustomisationsSwitch(source: ConfigSource = {}): CustomisationSwitchValue {
  const value = source.get?.(PROPOSER_CUSTOMISATIONS_SWITCH);
  return value === "on" ? "on" : CUSTOMISATION_SWITCH_DEFAULT;
}

/**
 * Reads `memory.native.proposer` from USER CONFIGURATION only (row 29): the
 * key of the consumer configuration, no environment alias, no flag.
 */
export function readMemorySwitch(source: ConfigSource = {}): CustomisationSwitchValue {
  const value = source.get?.(MEMORY_NATIVE_PROPOSER_SWITCH);
  return value === "on" ? "on" : CUSTOMISATION_SWITCH_DEFAULT;
}

/** The state of ONE kind of customisation for a proposer pass (F130-FR-043). */
export function resolveCustomisationState(
  input: CustomisationsInput & { readonly kind: CustomisationKind },
): CustomisationState {
  if (input.profile === "parity") return "as-is";
  if (input.capture?.kinds?.[input.kind] !== undefined) return input.capture.kinds[input.kind]!;
  return input.customisationsOptIn === true ? "opted-in" : "not-switchable";
}

/** The states of every kind, in the closed set's order (F130-FR-043). */
export function resolveCustomisationStates(
  input: CustomisationsInput,
): readonly { readonly kind: CustomisationKind; readonly state: CustomisationState }[] {
  return CUSTOMISATION_KINDS.map((kind) => ({
    kind,
    state: resolveCustomisationState({ ...input, kind }),
  }));
}

/**
 * The state of the native memory for one role (F130-FR-044). For the proposer
 * the opt-in `memory.native.proposer: on` gives `opted-in`; for a
 * critic-class call no opt-in lifts anything (F130-FR-045): only a capture
 * gives `off` or `absent`.
 */
export function resolveMemoryState(
  input: CustomisationsInput & { readonly role: "proposer" | "critic" },
): CustomisationState {
  if (input.profile === "parity") return "as-is";
  if (input.capture?.memory !== undefined && input.capture.memory !== null) {
    return input.capture.memory;
  }
  if (input.role === "critic") return "not-switchable";
  return input.memoryOptIn === true ? "opted-in" : "not-switchable";
}

/**
 * The launch line of F130-FR-043: ONE line that names the kinds the adapter
 * cannot switch off. Null under `parity` (no line is printed) and where no
 * kind is left `not-switchable` (an opt-in or a capture settled them all).
 */
export function customisationsLaunchLine(
  states: readonly { readonly kind: CustomisationKind; readonly state: CustomisationState }[],
): string | null {
  const notSwitchable = states.filter((s) => s.state === "not-switchable").map((s) => s.kind);
  if (notSwitchable.length === 0) return null;
  return (
    `${PASS_LOOP_COMPONENT}: dsh customisations are not switched off ` +
    `(${notSwitchable.join(", ")}): the profile loads them into every pass`
  );
}

/** The launch line of the native memory of F130-FR-044 (proposer only). */
export function memoryLaunchLine(state: CustomisationState): string | null {
  if (state !== "not-switchable") return null;
  return (
    `${PASS_LOOP_COMPONENT}: dsh keeps a native memory that the adapter cannot switch off ` +
    `(state not-switchable)`
  );
}

/** One entry of the customisation record: the value ASKED and the state. */
export type CustomisationRecordEntry = {
  readonly kind: CustomisationKind;
  /** The value asked for the kind, as the switch reads (`off` default). */
  readonly valueAsked: CustomisationSwitchValue;
  readonly state: CustomisationState;
};

/** The memory entries of the record: the proposer's ask and the critic's fixed one. */
export type MemoryRecord = {
  readonly proposer: {
    readonly valueAsked: CustomisationSwitchValue;
    readonly state: CustomisationState;
  };
  /** The value asked for every critic-class call is the FIXED `off` (F130-FR-044). */
  readonly critic: { readonly valueAsked: "off"; readonly state: CustomisationState };
};

/** The customisation record of one RUN (F130-FR-043, F130-FR-044). */
export type CustomisationRunRecord = {
  readonly profile: string;
  readonly customisations: readonly CustomisationRecordEntry[];
  readonly memory: MemoryRecord;
  /** The capture the states rest on, or null while none has run. */
  readonly capture: { readonly capture: string; readonly pin: string } | null;
  /** The one launch line, where the launch states one; null under `parity`. */
  readonly launchLine: string | null;
};

/** Builds the record of one run. `off` and `absent` arrive ONLY via a capture. */
export function customisationRunRecord(
  input: CustomisationsInput & {
    readonly customisationsValue?: CustomisationSwitchValue;
    readonly memoryValue?: CustomisationSwitchValue;
  },
): CustomisationRunRecord {
  const customisationsValue = input.customisationsValue ?? CUSTOMISATION_SWITCH_DEFAULT;
  const memoryValue = input.memoryValue ?? CUSTOMISATION_SWITCH_DEFAULT;
  const states = resolveCustomisationStates(input);
  const proposerMemory = resolveMemoryState({ ...input, role: "proposer" });
  const criticMemory = resolveMemoryState({ ...input, role: "critic" });
  return {
    profile: input.profile,
    customisations: states.map((s) => ({
      kind: s.kind,
      valueAsked: customisationsValue,
      state: s.state,
    })),
    memory: {
      proposer: { valueAsked: memoryValue, state: proposerMemory },
      critic: { valueAsked: "off", state: criticMemory },
    },
    capture:
      input.capture === undefined || input.capture === null
        ? null
        : { capture: input.capture.capture, pin: input.capture.pin },
    launchLine: customisationsLaunchLine(states),
  };
}

/**
 * The record of ONE CALL, repeating the state of every kind and the state of
 * the memory for the call's role (F130-FR-043: "the record of every pass MUST
 * repeat the state"; F130-FR-045 for a critic-class call).
 */
export function customisationCallRecord(
  run: CustomisationRunRecord,
  role: "proposer" | "critic",
): {
  readonly role: "proposer" | "critic";
  readonly customisations: readonly CustomisationRecordEntry[];
  readonly memory: CustomisationState;
  readonly memoryValueAsked: CustomisationSwitchValue;
} {
  return {
    role,
    customisations: run.customisations,
    memory: role === "proposer" ? run.memory.proposer.state : run.memory.critic.state,
    memoryValueAsked: role === "proposer" ? run.memory.proposer.valueAsked : "off",
  };
}
