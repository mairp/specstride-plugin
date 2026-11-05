/**
 * Transports as a property of a harness entry (T041; F109-FR-011).
 *
 * A harness adapter MAY offer several transports of the closed set
 * `subprocess`, `sdk-in-process`, `direct-call`, each with its own auth tier
 * and its own row of terms-gate data. A transport whose optional dependency
 * is absent is unavailable, with a doctor line, and leaves the other
 * transports of the adapter as they are. A transport other than the default
 * is chosen by the consumer in user configuration, the environment or a flag
 * only — and there is no fallback from one transport to another when a call
 * fails (F109-FR-008): the choice is the consumer's alone.
 */

/** The closed set of transports (annex X §X.6, row 30). */
export const TRANSPORTS = ["subprocess", "sdk-in-process", "direct-call"] as const;
export type Transport = (typeof TRANSPORTS)[number];

/** The default transport, as at the baseline (`harnesses.<id>.transport`). */
export const DEFAULT_TRANSPORT: Transport = "subprocess";

/** One transport offered by one entry. */
export type TransportBinding = {
  transport: Transport;
  /** Auth tier 1 to 3 of this transport. */
  authTier: 1 | 2 | 3;
  /** The row of terms-gate data this transport presents. */
  termsRow: string | null;
  /** The optional dependency the transport needs, if any. */
  optionalDependency: string | null;
};

/** The binding every entry carries unless its adapter declares more. */
export function defaultTransportBinding(): TransportBinding {
  return {
    transport: DEFAULT_TRANSPORT,
    authTier: 1,
    termsRow: null,
    optionalDependency: null,
  };
}

/** Whether a binding can be used: an absent optional dependency makes it not. */
export function transportAvailable(
  binding: TransportBinding,
  installed: (dependency: string) => boolean = () => true,
): boolean {
  if (binding.optionalDependency === null) return true;
  return installed(binding.optionalDependency);
}

/** The doctor line of a transport whose optional dependency is absent. */
export function doctorLineFor(harnessId: string, binding: TransportBinding): string {
  return (
    `${harnessId}: transport ${binding.transport} unavailable: ` +
    `the optional dependency ${binding.optionalDependency} is not installed`
  );
}

/** The transports of an entry that are available, in the entry's own order. */
export function availableTransports(
  harnessId: string,
  bindings: readonly TransportBinding[],
  installed?: (dependency: string) => boolean,
): { available: TransportBinding[]; doctorLines: string[] } {
  const available: TransportBinding[] = [];
  const doctorLines: string[] = [];
  for (const binding of bindings) {
    if (transportAvailable(binding, installed)) available.push(binding);
    else doctorLines.push(doctorLineFor(harnessId, binding));
  }
  return { available, doctorLines };
}

/** Why a consumer's transport choice cannot be honoured. */
export type TransportChoiceRefusal = {
  ok: false;
  reason: "unknown-transport" | "not-offered" | "unavailable";
  message: string;
};

export type TransportChoice = { ok: true; binding: TransportBinding } | TransportChoiceRefusal;

/**
 * The consumer's choice of a transport. The choice comes from the consumer
 * only: a name outside the closed set is refused, a transport the entry does
 * not offer is refused, an unavailable one is refused — and none of the three
 * ever falls back to another transport.
 */
export function chooseTransport(
  harnessId: string,
  bindings: readonly TransportBinding[],
  requested: string | null,
  installed?: (dependency: string) => boolean,
): TransportChoice {
  if (requested === null) {
    const fallback = bindings.find((binding) => binding.transport === DEFAULT_TRANSPORT);
    if (fallback && transportAvailable(fallback, installed)) {
      return { ok: true, binding: fallback };
    }
    const firstAvailable = bindings.find((binding) => transportAvailable(binding, installed));
    if (firstAvailable) return { ok: true, binding: firstAvailable };
    return {
      ok: false,
      reason: "unavailable",
      message: `${harnessId}: no transport is available`,
    };
  }
  if (!(TRANSPORTS as readonly string[]).includes(requested)) {
    return {
      ok: false,
      reason: "unknown-transport",
      message:
        `${harnessId}: unknown transport ${requested}; ` +
        `the transports are: ${TRANSPORTS.join(", ")}`,
    };
  }
  const binding = bindings.find((one) => one.transport === requested);
  if (!binding) {
    return {
      ok: false,
      reason: "not-offered",
      message: `${harnessId}: the transport ${requested} is not offered by this harness`,
    };
  }
  if (!transportAvailable(binding, installed)) {
    return {
      ok: false,
      reason: "unavailable",
      message: doctorLineFor(harnessId, binding),
    };
  }
  return { ok: true, binding };
}
