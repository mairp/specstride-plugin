/**
 * T049 — the environment allow-list, the telemetry mode, the trace parent
 * and the usage statement of the dsh adapter (F130-FR-039, F130-FR-040,
 * F130-FR-041).
 *
 * The environment of EVERY call is an allow-list: the search path, the
 * locale, the home or its overlay, the permission mode and the telemetry
 * mode, and what the descriptor names (`isolation.envAllow` of
 * `data/descriptor-dsh.json`). Of the harness's own variables only the home,
 * the permission mode and the telemetry mode are set; the consumer's other
 * provider keys are never inherited, and a credential of one role is never
 * in the environment of the other (the allow-list carries none). A secret
 * is never passed in an argument list: where a call at auth tier 2 needs
 * one, the secret resolver (EP-10) resolves it at the moment of use and the
 * process takes it in its environment only.
 *
 * The harness's own telemetry is switched off for every process by
 * `DSH_TELEMETRY_MODE`; the off value waits for capture 5 and stays
 * `unverified`. The trace parent of the open pass span is exported as the
 * standard `TRACEPARENT` only when traces are on; the adapter does nothing
 * more for the harness's own trace plugin.
 *
 * The harness reports no usage: every pass emits `usage.unavailable` with
 * the reason `harness-does-not-report`, the descriptor declares
 * `usageSource: none`, no token count and no cost is invented, and a killed
 * pass is counted as unknown.
 */

/** The telemetry-mode variable of the harness (the descriptor's telemetry-off field). */
export const DSH_TELEMETRY_VARIABLE = "DSH_TELEMETRY_MODE" as const;

/**
 * The off value of the telemetry variable. The NAME is verified; the VALUE
 * and its effect wait for capture 5 and stay `unverified` — the adapter
 * exports the empty value, which is the most conservative statement of
 * "off", and re-states the fact instead of inventing a form.
 */
export const DSH_TELEMETRY_OFF_VALUE = "" as const;

/** The provenance of the telemetry off value (F130-FR-040, capture 5). */
export const DSH_TELEMETRY_OFF_STATUS = "unverified (capture 5)" as const;

/** The standard trace-parent variable (F130-FR-040). */
export const DSH_TRACEPARENT_VARIABLE = "TRACEPARENT" as const;

/** The allow-list of every call (F130-FR-041, the descriptor's `envAllow`). */
export const DSH_ENV_ALLOW_LIST: readonly string[] = Object.freeze([
  "PATH",
  "LANG",
  "LC_*",
  "DSH_HOME",
  "DSH_PERMISSION_MODE",
  "DSH_TELEMETRY_MODE",
  "TRACEPARENT",
]);

/** The harness's own variables the adapter sets (F130-FR-041) — these only. */
export const DSH_OWN_VARIABLES: readonly string[] = Object.freeze([
  "DSH_HOME",
  "DSH_PERMISSION_MODE",
  "DSH_TELEMETRY_MODE",
]);

/** True where a variable name is on the allow-list (`LC_*` is a prefix form). */
export function dshVariableIsAllowed(name: string): boolean {
  return DSH_ENV_ALLOW_LIST.some((allowed) =>
    allowed.endsWith("*") ? name.startsWith(allowed.slice(0, -1)) : allowed === name,
  );
}

/** The input of the allow-list builder: the consumer env and what to state. */
export type DshEnvironmentInput = {
  /** The environment of the consumer (inherited ONLY through the list). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The home of the harness, or the overlay home of the pass. */
  readonly home: string;
  /** The permission mode of the call (proposer: stated; critic: `read-only`). */
  readonly permissionMode: string;
  /** The trace parent of the open pass span, or undefined with traces off. */
  readonly traceparent?: string;
};

/**
 * Builds the environment of one call (F130-FR-041): the allow-listed
 * variables of the consumer, then the three own variables of the harness,
 * then `TRACEPARENT` only when a trace parent is given. Nothing else passes.
 */
export function buildDshEnvironment(input: DshEnvironmentInput): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.env ?? {})) {
    if (value !== undefined && dshVariableIsAllowed(name)) env[name] = value;
  }
  env["DSH_HOME"] = input.home;
  env["DSH_PERMISSION_MODE"] = input.permissionMode;
  env[DSH_TELEMETRY_VARIABLE] = DSH_TELEMETRY_OFF_VALUE;
  if (input.traceparent !== undefined) {
    env[DSH_TRACEPARENT_VARIABLE] = input.traceparent;
  }
  return env;
}

/**
 * The telemetry environment of a process (F130-FR-040): the variable always
 * present, set to its off value, whether or not traces are on.
 */
export function dshTelemetryEnvironment(): Record<string, string> {
  return { [DSH_TELEMETRY_VARIABLE]: DSH_TELEMETRY_OFF_VALUE };
}

/**
 * The trace-parent environment (F130-FR-040): `TRACEPARENT` exported only when
 * the pass span is open (a parent is given); nothing otherwise.
 */
export function dshTraceParentEnvironment(traceparent: string | undefined): Record<string, string> {
  return traceparent === undefined ? {} : { [DSH_TRACEPARENT_VARIABLE]: traceparent };
}

/** The usage statement of a pass (F130-FR-039). */
export type DshUsageStatement = {
  /** The event type the pass emits. */
  readonly type: "usage.unavailable";
  /** Why no usage exists. */
  readonly reason: "harness-does-not-report" | "pass-killed-unknown";
  /** The usage source of the descriptor: none. */
  readonly usageSource: "none";
  /** No token count is invented. */
  readonly tokens: null;
  /** No cost is invented; only the consumer's declared estimate stands apart. */
  readonly cost: null;
};

/**
 * The usage statement of EVERY pass (F130-FR-039): `usage.unavailable` with
 * the reason `harness-does-not-report`, no token count and no cost. A killed
 * pass is counted as unknown (`pass-killed-unknown`).
 */
export function dshUsageStatement(
  input: {
    readonly killed?: boolean;
  } = {},
): DshUsageStatement {
  return {
    type: "usage.unavailable",
    reason: input.killed === true ? "pass-killed-unknown" : "harness-does-not-report",
    usageSource: "none",
    tokens: null,
    cost: null,
  };
}

/**
 * Guards the argument list of a call (F130-FR-041): a secret is NEVER passed
 * in an argument list, so every argument must be free of an assigned secret.
 * Returns the arguments that carry one, in the form the caller reports;
 * an empty array means the list is clean.
 */
export function dshArgumentsCarrySecret(argv: readonly string[]): string[] {
  return argv.filter((argument) => /(?:key|token|secret|password|credential)\s*=/i.test(argument));
}

/** The secret resolver interface this adapter consumes (EP-10, §C.11): only
 *  the `resolve` operation, called at the moment of use. */
export type DshSecretResolver = {
  readonly resolve: (
    reference: string,
  ) => Promise<{ readonly value: string; readonly registeredWithTheRedactor: true }>;
};

/** The outcome of one secret resolution for a call at auth tier 2. */
export type DshSecretCallEnvironment = {
  /** The value reaches the process in ITS ENVIRONMENT, under this name, only. */
  readonly env: Record<string, string>;
  /** The argument list is returned unchanged and never carries the value. */
  readonly argv: readonly string[];
  /** The resolution happened AT THE MOMENT OF USE (§C.11). */
  readonly resolvedAt: "moment-of-use";
  /** The reference that was resolved (never the value). */
  readonly reference: string;
  readonly envName: string;
};

/**
 * F130-FR-041 — resolves ONE secret of a call at auth tier 2 through the
 * secret resolver (EP-10) at the moment of use and returns it as the ONLY
 * new entry of the process environment. The adapter reads no credential
 * file here: the resolution is the resolver's, and the adapter touches no
 * path. If the argument list already carries the value, or carries any
 * credential assignment, the call is refused with `secret-in-argv`.
 */
export async function dshSecretEnvironment(input: {
  readonly resolver: DshSecretResolver;
  readonly reference: string;
  readonly envName: string;
  readonly argv: readonly string[];
}): Promise<DshSecretCallEnvironment> {
  const carried = dshArgumentsCarrySecret(input.argv);
  if (carried.length > 0) {
    throw new Error(
      `pass-loop: secret-in-argv: a secret is never passed in an argument list ` +
        `(${carried.length} argument(s) refused)`,
    );
  }
  // THE MOMENT OF USE: the resolver is called here and nowhere earlier.
  const resolved = await input.resolver.resolve(input.reference);
  for (const argument of input.argv) {
    if (argument.includes(resolved.value)) {
      throw new Error(
        "pass-loop: secret-in-argv: the resolved value reached the argument list; the call is refused",
      );
    }
  }
  return {
    env: { [input.envName]: resolved.value },
    argv: input.argv,
    resolvedAt: "moment-of-use",
    reference: input.reference,
    envName: input.envName,
  };
}
