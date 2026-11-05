/**
 * T070 — the statement of harness-native memory in the descriptor and the
 * record of the setting per run (F138-FR-046; user story 4).
 *
 * Harness-native memory of prime is OFF for every critic-class call and OFF
 * by default for a proposer pass. The consumer MAY switch it on for the
 * proposer with the key `memory.native.proposer`, which is of the trust
 * class widening and is accepted from USER configuration only; project
 * configuration (and the environment, and a flag) is ignored. The setting in
 * force is recorded per run, for the proposer and for the critic.
 *
 * What the adapter treats as native memory of prime, and the switch that
 * turns each part off, is stated in the descriptor data
 * (`data/descriptor.prime.json`, field `memory`): saved sessions, off by the
 * flag that stores none (F138-FR-014); the persistent goal of a session,
 * which the adapter never seeds; and context files, off by their switch
 * (F138-FR-044). Where a capture shows a memory that none of these switches
 * turns off, the descriptor reports it as NULL in its capabilities — and
 * prime does not qualify as critic (F100-FR-082): `criticMemoryEligibility`
 * refuses it. Under the `parity` profile no flag about memory is passed
 * beyond the flag set of the baseline.
 */
import { primeDescriptor, type PrimeDescriptor } from "./index.ts";

/** The user-configuration key that may switch native memory on for the proposer. */
export const NATIVE_MEMORY_KEY = "memory.native.proposer";

/** The trust class of the key: widening (feature 100, annex K). */
export const NATIVE_MEMORY_TRUST_CLASS = "widening" as const;

/** Where an opt-in claim about native memory may have come from. */
export type MemorySource = "user-configuration" | "project-configuration" | "environment" | "flag";

/** The only source that is an opt-in: user configuration. */
export const NATIVE_MEMORY_ACCEPTED_SOURCES: readonly MemorySource[] = Object.freeze([
  "user-configuration",
]);

/** The setting of one role, as the run record spells it. */
export type MemorySetting = "on" | "off";

/** The memory setting in force for both roles, recorded per run. */
export type MemoryRunRecord = {
  /** The run-record field name. */
  readonly field: "nativeMemory";
  /** The proposer's setting: on only via the key, in user configuration. */
  readonly proposer: MemorySetting;
  /** The critic's setting: off, ALWAYS — no key moves it. */
  readonly critic: "off";
  /** Where the proposer's value came from; null while it is the default. */
  readonly via: MemorySource | null;
  /** The key the opt-in travels by, when one was accepted. */
  readonly key: typeof NATIVE_MEMORY_KEY | null;
  readonly requirement: "F138-FR-046";
};

export type NativeMemoryInput = {
  /** The role the call is for: the critic is ALWAYS off. */
  readonly role: "proposer" | "critic";
  /** Where the claim of an opt-in came from. */
  readonly source: MemorySource | null;
  /** What the claim says; a null is the default (off). */
  readonly on?: boolean | null;
};

/**
 * The native-memory setting in force for one call (F138-FR-046). The critic
 * is off always, whatever any key says; the proposer is off unless the key
 * `memory.native.proposer` is set ON in USER configuration — a claim from
 * project configuration, the environment or a flag is ignored and the
 * setting stays off, with the ignored source recorded in `via`.
 */
export function resolveNativeMemory(input: NativeMemoryInput): MemoryRunRecord {
  if (input.role === "critic") {
    return {
      field: "nativeMemory",
      proposer: "off",
      critic: "off",
      via: null,
      key: null,
      requirement: "F138-FR-046",
    };
  }
  const accepted =
    input.source !== null &&
    NATIVE_MEMORY_ACCEPTED_SOURCES.includes(input.source) &&
    input.on === true;
  return {
    field: "nativeMemory",
    proposer: accepted ? "on" : "off",
    critic: "off",
    via: accepted ? input.source : input.source,
    key: accepted ? NATIVE_MEMORY_KEY : null,
    requirement: "F138-FR-046",
  };
}

/** The per-run record of both roles, from the two settings (F138-FR-046). */
export function memoryRunRecord(input: { proposer: MemoryRunRecord; critic: MemoryRunRecord }): {
  field: "nativeMemory";
  proposer: MemorySetting;
  critic: "off";
} {
  return {
    field: "nativeMemory",
    proposer: input.proposer.proposer,
    critic: "off",
  };
}

/** The `memory` field of the descriptor, as data. */
export type MemoryStatement = {
  readonly parts: readonly { readonly part: string; readonly off: string }[];
  readonly critic: string;
  readonly proposer: string;
  readonly recorded: string;
  readonly parity: string;
};

/** Read the native-memory statement out of the descriptor (F138-FR-046). */
export function nativeMemoryStatement(
  descriptor: PrimeDescriptor = primeDescriptor,
): MemoryStatement {
  const memory = descriptor.memory as {
    parts: { part: string; off: string }[];
    critic: string;
    proposer: string;
    recorded: string;
    parity: string;
  };
  return {
    parts: memory.parts,
    critic: memory.critic,
    proposer: memory.proposer,
    recorded: memory.recorded,
    parity: memory.parity,
  };
}

/** The three parts of prime's native memory the descriptor names. */
export function nativeMemoryPartNames(
  descriptor: PrimeDescriptor = primeDescriptor,
): readonly string[] {
  return nativeMemoryStatement(descriptor).parts.map((part) => part.part);
}

/**
 * May prime qualify as CRITIC, given what the descriptor reports about a
 * native memory no switch turns off (F100-FR-082, F138-FR-046)? A descriptor
 * that reports such a memory as NULL in its capabilities — the capture found
 * a memory and no switch turns it off, so no positive statement exists — is
 * refused as critic, with the reason. A descriptor whose capabilities carry
 * no null (the pinned version: every known part has its switch; the fact is
 * `unverified` until a capture) stays eligible.
 */
export function criticMemoryEligibility(descriptor: PrimeDescriptor = primeDescriptor): {
  eligible: boolean;
  reason: string | null;
} {
  const capabilities = (descriptor.memory as { capabilities?: { nativeMemory?: unknown } })
    ?.capabilities;
  if (capabilities !== undefined && "nativeMemory" in capabilities) {
    const stated = capabilities.nativeMemory;
    if (stated === null) {
      return {
        eligible: false,
        reason:
          "prime: refused as critic — the descriptor reports a harness-native memory " +
          "that no switch of the adapter turns off (capabilities.nativeMemory is null); " +
          "prime does not qualify as critic (F100-FR-082, F138-FR-046)",
      };
    }
  }
  return { eligible: true, reason: null };
}

/** The refusal of a critic-class call on a descriptor with a null memory. */
export class MemoryRefusedAsCriticError extends Error {
  constructor(descriptor: PrimeDescriptor = primeDescriptor) {
    super(criticMemoryEligibility(descriptor).reason ?? "prime is refused as critic");
    this.name = "MemoryRefusedAsCriticError";
  }
}

/** Throw when a descriptor with a null native memory is named as critic. */
export function assertCriticMemoryEligible(descriptor: PrimeDescriptor = primeDescriptor): void {
  const verdict = criticMemoryEligibility(descriptor);
  if (!verdict.eligible) throw new MemoryRefusedAsCriticError(descriptor);
}
