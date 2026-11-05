/**
 * The announcements of the observability mode of a prime pass (T023; covers
 * F138-FR-012 and F138-FR-013, parity items C-053 / B-0547, C-154 / B-2120,
 * tests PT-138-C-053-* and PT-138-C-154-*).
 *
 * - A pass WITHOUT the stream capture announces `mode=raw-text`, the as-is
 *   reason `structured schema unavailable — parsing plain output`, the role,
 *   and the supported signals `text,result` (B-0547).
 * - A pass WITH the stream capture is routed to the reader with the provider
 *   format `prime-v3` — that literal is what the invocation metadata carries
 *   (B-0747) — and announces `mode=structured`, the reason `Prime JSON schema
 *   v3 selected`, the provider format `prime-v3`, the role, and the five
 *   signals `init,text,tool,evidence,result` (B-2120).
 */

/** The observability event the pass emits at its start. */
export const OBSERVABILITY_EVENT = "agent_observability";

/** The as-is reason of a raw-text pass (B-0547). */
export const RAW_TEXT_REASON = "structured schema unavailable — parsing plain output";

/** The two signals a raw-text pass supports. */
export const RAW_TEXT_SIGNALS = ["text", "result"] as const;

/** The provider format literal of the prime stream (B-0747). */
export const PRIME_PROVIDER_FORMAT = "prime-v3";

/** The as-is reason of a structured pass (B-2120). */
export const STRUCTURED_REASON = "Prime JSON schema v3 selected";

/** The five signals a structured pass supports, in the as-is order. */
export const STRUCTURED_SIGNALS = ["init", "text", "tool", "evidence", "result"] as const;

/** The role a pass runs in. */
export type PassRole = "proposer" | "critic";

/** Shape of the announcement record. */
export type ObservabilityAnnouncement = {
  event: typeof OBSERVABILITY_EVENT;
  mode: "raw-text" | "structured";
  reason: string;
  role: PassRole;
  /** The supported signals, joined in the as-is spelling. */
  supportedSignals: string;
  /** The provider format; present on a structured pass only. */
  providerFormat?: typeof PRIME_PROVIDER_FORMAT;
};

/** The announcement of a prime pass running in raw-text mode (B-0547). */
export function rawTextAnnouncement(role: PassRole): ObservabilityAnnouncement {
  return {
    event: OBSERVABILITY_EVENT,
    mode: "raw-text",
    reason: RAW_TEXT_REASON,
    role,
    supportedSignals: RAW_TEXT_SIGNALS.join(","),
  };
}

/**
 * The announcement of a prime pass running in structured mode: the provider
 * format `prime-v3` and the five signals (B-2120).
 */
export function structuredAnnouncement(role: PassRole): ObservabilityAnnouncement {
  return {
    event: OBSERVABILITY_EVENT,
    mode: "structured",
    reason: STRUCTURED_REASON,
    role,
    supportedSignals: STRUCTURED_SIGNALS.join(","),
    providerFormat: PRIME_PROVIDER_FORMAT,
  };
}

/**
 * The provider format written to the metadata of the invocation of a
 * structured pass: the literal `prime-v3` (B-0747; F138-FR-013). The reader
 * is reached through the dialect row that carries this format, never through
 * the registry entry (F138-FR-001).
 */
export function invocationMetadataProviderFormat(): string {
  return PRIME_PROVIDER_FORMAT;
}
