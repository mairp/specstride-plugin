/**
 * T071 — the facts of the check telemetry.endpoint (F128-FR-041; CT-128-21).
 *
 * F128-FR-041: *The exporter MUST give the doctor the facts of its
 * configuration, and the doctor MUST NOT open a connection unless the
 * consumer asked for an online check: for each sink the address with no
 * credential, whether the sink is on, whether traces are on, whether content
 * capture is on, the receiver state of F128-FR-028 when probed, and the
 * version of the redaction pattern set in force. The check
 * telemetry.endpoint of the doctor MUST be able to present them with the
 * severity `info`, and `warn` when capture is on.*
 *
 * CQ-126: the facts are given HERE; feature 112 registers the check. This
 * module therefore holds no `registerDoctorCheck` call and no message
 * template: it is the read-only mirror of the configuration, and every
 * connection it may open — exactly one TCP probe per sink — happens ONLY when
 * the caller asked for the online check. Nothing here resolves a credential:
 * the address is stripped of any user information before it is shown, so the
 * facts can never carry a user name or a password to the output of the
 * doctor (F128-FR-040).
 */
import {
  type ReceiverState,
  receiverStateOf,
  probeEndpoint,
  type StateProofs,
} from "../probe/state.ts";
import { contentCaptureOn, contentValueOf } from "../content/switch.ts";

/** The id of the doctor check the facts are for (F128-FR-041; CQ-126). */
const CHECK_NAMESPACE = "telemetry" as const;
export const TELEMETRY_ENDPOINT_CHECK_ID = `${CHECK_NAMESPACE}.endpoint`;

/** The severity when the facts are shown without capture on (F128-FR-041). */
export const FACTS_SEVERITY_INFO = "info" as const;

/** The severity when content capture is on (F128-FR-041). */
export const FACTS_SEVERITY_WARN = "warn" as const;

/** The facts of one sink: the address without a credential, on, state. */
export type DoctorSinkFacts = {
  /** `loki` or `otel` — the label of the sink. */
  readonly label: string;
  /** The address, without a trailing slash and WITHOUT any credential. */
  readonly address: string;
  /** Whether the sink is on. */
  readonly enabled: boolean;
  /**
   * The receiver state of F128-FR-028, present only when the facts were
   * asked for online (`probe: true`): the doctor MUST NOT open a connection
   * otherwise, so the field is simply absent when it did not probe.
   */
  readonly receiverState?: ReceiverState;
};

/** The whole set of facts of F128-FR-041. */
export type TelemetryEndpointFacts = {
  /** The id of the doctor check that presents them. */
  readonly check: typeof TELEMETRY_ENDPOINT_CHECK_ID;
  /** One block per sink, in the order `loki`, `otel`. */
  readonly sinks: readonly DoctorSinkFacts[];
  /** Whether traces are on. */
  readonly traces: boolean;
  /** Whether content capture is on (F128-FR-036). */
  readonly capture: boolean;
  /** The version of the redaction pattern set in force. */
  readonly patternSetVersion: string;
};

/** An address as the doctor shows it: no user name, no password (F128-FR-040). */
export function addressWithoutCredential(address: string): string {
  try {
    const url = new URL(address);
    if (url.username === "" && url.password === "") return address;
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    // not a URL: show nothing that could carry a credential, show nothing
    return "";
  }
}

/** The inputs of the facts: the resolved configuration, read only. */
export type TelemetryEndpointFactsOptions = {
  /** The addresses and the enablement of the two sinks (F128-FR-002). */
  readonly loki: { readonly enabled: boolean; readonly url: string };
  readonly otel: { readonly enabled: boolean; readonly url: string };
  /** Whether traces are on (F128-FR-013). */
  readonly traces: boolean;
  /** The resolved value of `telemetry.content` (F128-FR-036). */
  readonly content?: unknown;
  /** The profile in force; capture is off under `parity`. */
  readonly profile?: string | null;
  /** The version of the redaction pattern set in force. */
  readonly patternSetVersion: string;
  /**
   * Ask for the online check: the only thing that may open a connection.
   * Without it no probe runs and no `receiverState` is shown.
   */
  readonly online?: boolean;
  /**
   * The proofs of the receiver state when the caller already holds them (a
   * reachability from an earlier probe, the delivery records of the run).
   * Absent proofs leave the state at what they prove: `configured`.
   */
  readonly proofs?: Readonly<Record<string, StateProofs>>;
  /**
   * The probe, injectable for the tests; the real one is the TCP probe of
   * F128-FR-028 with its 1.5-second limit.
   */
  readonly probe?: typeof probeEndpoint;
};

/**
 * The facts of F128-FR-041. The function never throws, and — unless
 * `online` is true — opens no connection at all: the receiver state is only
 * computed when the consumer asked for the online check, and even then a
 * probe that fails simply leaves the state lower, never an error.
 */
export async function telemetryEndpointFacts(
  options: TelemetryEndpointFactsOptions,
): Promise<TelemetryEndpointFacts> {
  const capture = contentCaptureOn({
    tracesOn: options.traces,
    content: options.content,
    profile: options.profile,
  });
  const sinks: DoctorSinkFacts[] = [];
  for (const sink of [
    { label: "loki", enabled: options.loki.enabled, url: options.loki.url },
    { label: "otel", enabled: options.otel.enabled, url: options.otel.url },
  ]) {
    const facts: {
      label: string;
      address: string;
      enabled: boolean;
      receiverState?: ReceiverState;
    } = {
      label: sink.label,
      address: addressWithoutCredential(sink.url),
      enabled: sink.enabled,
    };
    // The state is meaningful only for a sink that is on (F128-FR-028:
    // `configured` holds when the sink is on), and it is computed ONLY when
    // the consumer asked for the online check.
    if (options.online === true && sink.enabled) {
      const proofs = options.proofs?.[sink.label];
      const reachable =
        proofs?.reachable ??
        (sink.enabled ? await (options.probe ?? probeEndpoint)(sink.url) : undefined);
      facts.receiverState = receiverStateOf({
        enabled: sink.enabled,
        sink: sink.label,
        reachable,
        records: proofs?.records,
      });
    }
    sinks.push(Object.freeze(facts));
  }
  return Object.freeze({
    check: TELEMETRY_ENDPOINT_CHECK_ID,
    sinks: Object.freeze(sinks),
    traces: options.traces,
    capture,
    patternSetVersion: options.patternSetVersion,
  });
}

/**
 * The severity of the check for one set of facts (F128-FR-041): `warn` when
 * content capture is on — the doctor tells the consumer that prompt and
 * reply text leaves the machine — and `info` otherwise.
 */
export function severityForFacts(
  facts: TelemetryEndpointFacts,
): typeof FACTS_SEVERITY_INFO | typeof FACTS_SEVERITY_WARN {
  return facts.capture ? FACTS_SEVERITY_WARN : FACTS_SEVERITY_INFO;
}

/**
 * The severity straight from the inputs, for a caller that has not built the
 * facts yet. Same rule: capture on is `warn`, everything else is `info`.
 */
export function severityForInputs(
  options: Pick<TelemetryEndpointFactsOptions, "traces" | "content" | "profile">,
): typeof FACTS_SEVERITY_INFO | typeof FACTS_SEVERITY_WARN {
  const capture = contentCaptureOn({
    tracesOn: options.traces,
    content: options.content,
    profile: options.profile,
  });
  return capture ? FACTS_SEVERITY_WARN : FACTS_SEVERITY_INFO;
}

/** The value of the capture switch, for a caller that only displays it. */
export function captureValueOf(raw: unknown): string {
  return contentValueOf(raw);
}
