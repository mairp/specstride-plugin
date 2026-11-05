/**
 * T058 — the environment builder of the prime harness adapter
 * (covers F138-FR-005, F138-FR-041; user story 6).
 *
 * EVERY process the adapter starts — a proposer pass, a critic call, the
 * version probe, a doctor probe — runs in an environment this module built.
 * The environment is an ALLOW-LIST (F138-FR-005): the search path, the
 * locale, the home the auth tier gives, the session directory variable when
 * the call sets one, the variables the consumer named for the provider in
 * use, the credential of the one role in use — and THE TELEMETRY SWITCHES
 * (F138-FR-041), taken from the `telemetryOff` field of the dialect row, so
 * that the harness reports nothing about the consumer. Nothing else passes:
 * a variable of the parent process that the allow-list does not name is
 * dropped, not inherited.
 *
 * The switches are read from the dialect row (`data/dialects/prime.json`,
 * `telemetryOff.env`), never hard-coded here: the row is the single source
 * of the harness's own telemetry names and values. The doctor and version
 * probes get the narrow form: the search path and the switches only.
 */
import { primeDescriptor } from "../descriptor/index.ts";
import { requireDialectRow, type DialectRow } from "../reader/dialect.ts";
import {
  environmentAllowList,
  filterEnvironment,
  resolveCredential,
  type PrimeRole,
  type ProviderCredential,
} from "./auth.ts";

/** The telemetry switches of one dialect row, as environment entries. */
export type TelemetrySwitches = {
  /** The variables and values the harness must see to stay silent. */
  readonly env: Readonly<Record<string, string>>;
  /** Flags of the row, when the harness carries them (prime: none). */
  readonly flags: readonly string[];
};

/**
 * Read the telemetry switches (F138-FR-041) out of a dialect row's
 * `telemetryOff` field. A row without a non-empty `env` map is refused: a
 * dialect that cannot switch the harness's telemetry off cannot be started
 * by this adapter at all.
 */
const PRIME_ROW: DialectRow = requireDialectRow(
  (primeDescriptor.stream as { dialect: string }).dialect,
);

export function telemetrySwitchesOf(row: DialectRow = PRIME_ROW): TelemetrySwitches {
  const raw = (row.telemetryOff ?? {}) as {
    env?: Record<string, unknown>;
    flags?: unknown;
  };
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw.env ?? {})) {
    if (value !== undefined && value !== null) env[name] = String(value);
  }
  if (Object.keys(env).length === 0) {
    throw new Error(
      `the dialect row ${row.dialect} carries no telemetry switch; the harness ` +
        `would report the consumer (F138-FR-041) — the adapter refuses to start it`,
    );
  }
  const flags = Array.isArray(raw.flags) ? raw.flags.map(String) : [];
  return { env: Object.freeze({ ...env }), flags: Object.freeze(flags) };
}

/** The telemetry switches of the row this adapter is the tested adapter for. */
export const PRIME_TELEMETRY_SWITCHES: TelemetrySwitches = telemetrySwitchesOf();

/** One call the adapter starts a process for. */
export type PrimeCallKind = "proposer-pass" | "critic-call" | "version-probe" | "doctor-probe";

/** What the environment builder is handed for one call. */
export type ProcessEnvironmentInput = {
  /** Which call this is — the allow-list is named per call. */
  readonly kind: PrimeCallKind;
  /** The dialect row; defaults to the prime row of this adapter. */
  readonly dialectRow?: DialectRow;
  /** The parent environment, filtered through the allow-list. */
  readonly base?: Readonly<Record<string, string>>;
  /** The home the auth tier gives (F138-FR-045); `HOME` by default. */
  readonly homeVar?: string;
  /** The session directory variable, when the call sets one. */
  readonly sessionDirVar?: string | null;
  /** The variables the consumer named for the provider in use. */
  readonly providerEnvNames?: readonly string[];
  /** The credential of the ONE role in use, resolved at the moment of use. */
  readonly credential?: {
    readonly role: PrimeRole;
    readonly provider: ProviderCredential;
    readonly resolve: (secretRef: string) => string | null;
  };
};

/**
 * The environment of one process the adapter starts (F138-FR-005,
 * F138-FR-041). Built fresh per call: the allow-list entries, the parent
 * variables the allow-list names — and the telemetry switches, set
 * explicitly so that they hold even when the parent carries a contradicting
 * value. The result is frozen and holds nothing the allow-list does not
 * name: the harness reports nothing about the consumer.
 */
export function buildProcessEnvironment(
  input: ProcessEnvironmentInput,
): Readonly<Record<string, string>> {
  const switches = telemetrySwitchesOf(input.dialectRow);
  const allow = environmentAllowList({
    homeVar: input.homeVar,
    sessionDirVar: input.sessionDirVar,
    providerEnvNames: input.providerEnvNames,
    telemetryEnvNames: Object.keys(switches.env),
  });
  const env: Record<string, string> = {
    ...filterEnvironment(input.base ?? {}, allow),
    ...switches.env,
  };
  if (input.credential !== undefined) {
    const { envName, value } = resolveCredential({
      role: input.credential.role,
      credential: input.credential.provider,
      resolve: input.credential.resolve,
    });
    if (!allow.includes(envName)) {
      throw new Error(
        `internal: the credential variable ${envName} is not in the allow-list of the ` +
          `${input.kind}; the key would leave the adapter outside its own rule`,
      );
    }
    env[envName] = value;
  }
  return Object.freeze(env);
}

/** The narrow input of a probe: the search path and the switches, nothing else. */
export type ProbeEnvironmentInput = {
  readonly dialectRow?: DialectRow;
  /** The parent environment; only `PATH` may pass from it. */
  readonly base?: Readonly<Record<string, string>>;
};

/**
 * The environment of a probe the adapter starts — the version probe of the
 * agent executable, and every doctor probe (F138-FR-041). The search path
 * (so the probe can resolve the executable) and the telemetry switches:
 * nothing else, no credential, no home, no session directory.
 */
export function buildProbeEnvironment(
  input: ProbeEnvironmentInput = {},
): Readonly<Record<string, string>> {
  const switches = telemetrySwitchesOf(input.dialectRow);
  const path = input.base?.PATH;
  return Object.freeze({
    ...(path !== undefined ? { PATH: path } : {}),
    ...switches.env,
  });
}
