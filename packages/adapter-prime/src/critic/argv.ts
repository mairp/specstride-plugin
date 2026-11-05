/**
 * The critic argument builder for both modes and the failure reports (T047;
 * covers F138-FR-017 and F138-FR-018, parity items C-066 / B-0991, B-0994,
 * B-0995, tests PT-138-C-066-* in `tests/parity/138/c066-critic.test.ts`).
 *
 * A critic-class call on prime is a FRESH session with tools, skills and
 * context files switched off (F138-FR-017; the descriptor rows `toolless:
 * flag`, `freshSession`). Under the `parity` profile the call is in TEXT
 * mode, in the form of the argument table (B-0991); outside it the call is
 * in JSON mode (F138-FR-020, `./json-mode.ts`). The baseline holds a
 * JSON-mode critic function its dispatcher never calls: under `parity` the
 * verdict path uses text mode WHATEVER the capture switch says (B-0994,
 * F138-FR-018) — that is why the mode here is decided by the profile alone.
 *
 * The prompt travels on standard input, the working directory is passed only
 * when one was given, and no process is ever started here: the builder
 * RETURNS the invocation (or the refusal), and the caller alone starts one.
 * The launcher is not probed for a version and the resolution of the two
 * names is the one of F138-FR-003 (`../proposer/names.ts`).
 */
import {
  loadArgumentTable,
  expandTemplate,
  type ArgumentTable,
  type Profile,
} from "../proposer/argv.ts";
import {
  resolveExecutableNames,
  type NameEnvironment,
  type PrimeSettings,
} from "../proposer/names.ts";
import {
  agentExecutableNotFound,
  launcherNotFound,
  type NotFoundResult,
} from "../proposer/not-found.ts";
import { PRIME_PROVIDER_FORMAT } from "../proposer/announce.ts";

/** The component every critic-class message names. */
export const CRITIC_COMPONENT = "critic";

/** The as-is error of `prime:` with an empty variant (B-0995). */
export const EMPTY_VARIANT_ERROR = "empty Prime variant; use 'prime' or 'prime:<variant>'";

/** A refusal of a critic-class call: no command, a result code, the message. */
export type CriticRefusal = {
  kind: "refused";
  command: undefined;
  exitCode: number;
  component: typeof CRITIC_COMPONENT;
  /** The message the critic-class call reports: `critic call error: <error>`. */
  message: string;
  /** The raw error, before the `critic call error:` prefix. */
  error: string;
  requirement: string;
};

/** The invocation of one critic-class call that the caller would start. */
export type CriticInvocation = {
  kind: "invoke";
  /** The command line, agent executable or launcher first (B-0991). */
  command: string[];
  /** The prompt always travels on standard input (F138-FR-017). */
  stdin: "prompt";
  profile: Profile;
  /** `text` under `parity`, `json` outside it (F138-FR-017, F138-FR-020). */
  mode: "text" | "json";
  /** `prime-v3` in JSON mode; absent in text mode. */
  metadata: { providerFormat?: typeof PRIME_PROVIDER_FORMAT };
  /** The critic is always a fresh session (F138-FR-021). */
  freshSession: true;
  /** Harness-native memory is off for every critic call (F138-FR-046). */
  memory: "off";
  requirement: string;
};

/** Everything one critic-class call needs to build its command line. */
export type CriticCallOptions = {
  /** The variant of `prime:<variant>`, without the `prime:` prefix. */
  variant?: string | undefined;
  /** The working directory; `--cwd` is passed only when one was given. */
  workdir?: string | undefined;
  profile: Profile;
  /** The consumer's settings for the two names (F138-FR-003). */
  settings?: PrimeSettings;
  /** The environment for the alias table. */
  env?: NameEnvironment;
  /** Whether the resolved executable (agent or launcher) was found. */
  executableFound?: boolean;
  /** The argument table; the contract of the feature when omitted. */
  table?: ArgumentTable | undefined;
};

/**
 * Build the invocation of one critic-class call, or its refusal. The mode is
 * a function of the profile ALONE (F138-FR-018): the capture switch decides
 * the ANNOUNCEMENT (`./announce.ts`), never the mode of the call under
 * `parity` — the baseline's dispatcher never calls its JSON-mode function
 * (B-0994).
 */
export function buildCriticInvocation(
  options: CriticCallOptions,
  table: ArgumentTable = loadArgumentTable(),
): CriticInvocation | CriticRefusal | NotFoundResult {
  const roles = table.roles.critic as Record<string, unknown>;
  const variant = options.variant;
  const hasVariant = variant !== undefined;

  // An empty variant (B-0995), reported as `critic call error: <error>`.
  if (hasVariant && variant.trim() === "") {
    return {
      kind: "refused",
      command: undefined,
      exitCode: 1,
      component: CRITIC_COMPONENT,
      message: `${CRITIC_COMPONENT} call error: ${EMPTY_VARIANT_ERROR}`,
      error: EMPTY_VARIANT_ERROR,
      requirement: "F138-FR-017",
    };
  }

  const names = resolveExecutableNames(options.settings, options.env ?? {});
  const mode: "text" | "json" = options.profile === "parity" ? "text" : "json";

  // A launcher that is not found (F138-FR-011), on the variant form.
  if (hasVariant && options.executableFound === false) {
    return launcherNotFound(names.launcher.name, CRITIC_COMPONENT);
  }
  // The agent executable that is not found, on the bare form.
  if (!hasVariant && options.executableFound === false) {
    return agentExecutableNotFound(names.agent.name, CRITIC_COMPONENT);
  }

  const prefix = hasVariant
    ? ((roles.variantPrefix as string[] | undefined) ?? [])
    : ((roles.barePrefix as string[] | undefined) ?? ["{agent}"]);
  const template = roles[options.profile] as string[] | undefined;
  if (!Array.isArray(template)) {
    throw new Error(`internal: the argument table holds no critic template for ${options.profile}`);
  }

  const command = expandTemplate([...prefix, ...template], {
    agent: names.agent.name,
    launcher: names.launcher.name,
    variant,
    mode,
    workdir: options.workdir,
  })
    .flatMap((word) => word.split(" "))
    .filter((word) => word.length > 0);

  return {
    kind: "invoke",
    command,
    stdin: "prompt",
    profile: options.profile,
    mode,
    metadata: mode === "json" ? { providerFormat: PRIME_PROVIDER_FORMAT } : {},
    freshSession: true,
    memory: "off",
    requirement: "F138-FR-017",
  };
}

/** The kinds of critic-call failure the seam scores (F138-FR-017). */
export type CriticFailureKind = "exit_nonzero" | "empty_output" | "time_limit" | "launcher_start";

/** How one failed critic-class call is reported to the seam. */
export type CriticFailureReport = {
  kind: "failed";
  component: typeof CRITIC_COMPONENT;
  failure: CriticFailureKind;
  /** The as-is message the report carries. */
  message: string;
  /** The result code the seam scores the call with. */
  exitCode: number;
  requirement: string;
};

const FAILURE_MESSAGES: Record<CriticFailureKind, string> = {
  exit_nonzero: "critic call failed: the process exited non-zero",
  empty_output: "critic call failed: the process produced no output",
  time_limit: "critic call failed: the call passed its time limit",
  launcher_start: "critic call failed: the launcher could not be started",
};

/**
 * The failure report of a critic-class call (F138-FR-017): a non-zero exit
 * code, an empty output, a time limit passed and a launcher that cannot
 * start are failures of the call, which the seam and the phase gate score.
 */
export function criticFailureReport(failure: CriticFailureKind): CriticFailureReport {
  return {
    kind: "failed",
    component: CRITIC_COMPONENT,
    failure,
    message: FAILURE_MESSAGES[failure],
    exitCode: 1,
    requirement: "F138-FR-017",
  };
}
