/**
 * The announcement of a prime critic-class call (T048; covers F138-FR-019,
 * parity items C-061 / B-0839 and C-062 / B-0856, tests PT-138-C-061-* and
 * PT-138-C-062-*).
 *
 * The role is `critic` and the supported signals are `text,result` — the two
 * signals the text path supports (B-0856). The MODE follows the capture
 * switch, the as-is variable `SPECSTRIDE_AGENT_STREAM` (B-0839): `structured`
 * with the reason `Prime JSON schema v3 selected` and the provider format
 * `prime-v3` when the switch is exactly `true`, and `raw-text` with the
 * as-is reason and no provider format otherwise. The announcement is made
 * only for prime — never for another harness (B-0856).
 */
import {
  OBSERVABILITY_EVENT,
  PRIME_PROVIDER_FORMAT,
  RAW_TEXT_REASON,
  STRUCTURED_REASON,
  type ObservabilityAnnouncement,
} from "../proposer/announce.ts";

/** The as-is variable that decides the announced mode of a prime critic. */
export const CRITIC_CAPTURE_ENV = "SPECSTRIDE_AGENT_STREAM";

/** The two supported signals of a prime critic announcement (B-0856). */
export const CRITIC_SIGNALS = ["text", "result"] as const;

/** True when the as-is capture switch reads exactly `true` (B-0839). */
export function captureSwitchIsTrue(value: string | undefined): boolean {
  return value === "true";
}

/**
 * The announcement of a prime critic-class call (F138-FR-019): mode
 * `structured` only when the capture switch is exactly `true`, `raw-text`
 * otherwise, whatever the mode of the call itself is — under `parity` the
 * call is in text mode although the announcement may say `structured`
 * (F138-FR-018, B-0994). The supported signals are `text,result` in BOTH
 * modes (B-0856): the critic parses the visible text and the result, never
 * the five signals of a proposer pass with the stream capture.
 */
export function criticAnnouncement(captureSwitch: string | undefined): ObservabilityAnnouncement {
  if (captureSwitchIsTrue(captureSwitch)) {
    return {
      event: OBSERVABILITY_EVENT,
      mode: "structured",
      reason: STRUCTURED_REASON,
      role: "critic",
      supportedSignals: CRITIC_SIGNALS.join(","),
      providerFormat: PRIME_PROVIDER_FORMAT,
    };
  }
  return {
    event: OBSERVABILITY_EVENT,
    mode: "raw-text",
    reason: RAW_TEXT_REASON,
    role: "critic",
    supportedSignals: CRITIC_SIGNALS.join(","),
  };
}

/** The announcement from the environment of the call (B-0839). */
export function criticAnnouncementFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): ObservabilityAnnouncement {
  return criticAnnouncement(env[CRITIC_CAPTURE_ENV]);
}

/** True only where the announcement is made: prime and `prime:<variant>` (B-0856). */
export function criticAnnouncesForHarness(harness: string): boolean {
  return harness === "prime";
}

/** The event name and the literals the announcement carries, re-exported. */
export { OBSERVABILITY_EVENT, RAW_TEXT_REASON, STRUCTURED_REASON, PRIME_PROVIDER_FORMAT };
