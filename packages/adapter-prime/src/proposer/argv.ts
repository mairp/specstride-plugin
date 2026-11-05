/**
 * The argument table loader and the proposer argument builder (T021; covers
 * F138-FR-008, F138-FR-009 and F138-FR-010, parity items C-058 / B-0692,
 * B-0693, B-0694, B-0695, B-0696, B-0747, test PT-138-C-058-*).
 *
 * The exact flags live in the contract `argument-table.json`
 * (`specstride.adapter-argument-table/1`); this module loads that data and
 * expands it for one pass. It never spawns a process: the builder RETURNS the
 * invocation (or the refusal), and the caller alone starts one.
 *
 * Refusals, in the order of F138-FR-010, none of which starts a process:
 *  1. an empty variant   → exit 1, `<component>: empty Prime variant; use
 *     'prime' or 'prime:<variant>'` (B-0694);
 *  2. a launcher not found → F138-FR-011 (exit 127, the as-is message);
 *  3. a model with a variant → exit 1, `<component>: --model is unsupported
 *     with prime:<variant>; the variant selects its model` (B-0695).
 */
import { readFileSync } from "node:fs";
import { resolveExecutableNames, type NameEnvironment, type PrimeSettings } from "./names.ts";
import { agentExecutableNotFound, launcherNotFound, type NotFoundResult } from "./not-found.ts";
import { PRIME_PROVIDER_FORMAT } from "./announce.ts";
import { continuationArguments, sessionFlags, toolArguments } from "./continuation.ts";

/** The schema id the argument table carries. */
export const ARGUMENT_TABLE_SCHEMA = "specstride.adapter-argument-table/1";

/** Where the argument table ships from: the contract of the feature. */
export const ARGUMENT_TABLE_CONTRACT_PATH = (() => {
  const here = new URL(import.meta.url);
  return new URL("../../../../specs/138-adapter-prime/contracts/argument-table.json", here)
    .pathname;
})();

/** The argument table, as loaded data. */
export type ArgumentTable = {
  schema: string;
  harness: string;
  pin: string;
  verifiedOn: string;
  roles: {
    proposer: Record<string, unknown>;
    critic: Record<string, unknown>;
  };
  version: string[];
  environment: Record<string, unknown>;
  [key: string]: unknown;
};

/** One refusal of the table: the file does not carry what the schema says. */
export class ArgumentTableRefusedError extends Error {
  constructor(path: string, problem: string) {
    super(`the argument table at ${path} is refused: ${problem}`);
    this.name = "ArgumentTableRefusedError";
  }
}

/** Load and check the argument table of the feature. */
export function loadArgumentTable(path: string = ARGUMENT_TABLE_CONTRACT_PATH): ArgumentTable {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ArgumentTableRefusedError(path, `not readable JSON (${String(error)})`);
  }
  const table = raw as ArgumentTable;
  if (table.schema !== ARGUMENT_TABLE_SCHEMA) {
    throw new ArgumentTableRefusedError(
      path,
      `schema ${String(table.schema)} is not ${ARGUMENT_TABLE_SCHEMA}`,
    );
  }
  if (table.harness !== "prime") {
    throw new ArgumentTableRefusedError(path, `harness ${String(table.harness)} is not prime`);
  }
  if (typeof table.roles?.proposer !== "object" || table.roles.proposer === null) {
    throw new ArgumentTableRefusedError(path, "no proposer role in the table");
  }
  return table;
}

/** The profile of the run: `parity` pins the baseline, `default` is the call outside it. */
export type Profile = "parity" | "default";

/**
 * The mode of a proposer pass (F138-FR-009, B-0692): JSON mode when the
 * stream tap is on or the as-is flag `-j` was given, text mode otherwise.
 * The capture is on by default, so `streamTap` defaults to true.
 */
export function selectMode(options: { streamTap?: boolean; flagJ?: boolean }): "json" | "text" {
  return options.streamTap !== false || options.flagJ === true ? "json" : "text";
}

/** A refusal: no command, a result code and the as-is message. */
export type ProposerRefusal = {
  kind: "refused";
  command: undefined;
  exitCode: number;
  component: string;
  message: string;
  requirement: string;
};

/** The invocation the caller would start. */
export type ProposerInvocation = {
  kind: "invoke";
  /** The command line, agent executable or launcher first. */
  command: string[];
  /** The prompt always travels on standard input (F138-FR-008). */
  stdin: "prompt";
  profile: Profile;
  mode: "json" | "text";
  /** The invocation metadata; `prime-v3` on a structured pass (B-0747). */
  metadata: { providerFormat?: typeof PRIME_PROVIDER_FORMAT };
  requirement: string;
};

/** Everything one proposer pass needs to build its command line. */
export type ProposerCallOptions = {
  /** The component named in the messages; default `proposer`. */
  component?: string;
  /** The variant of `prime:<variant>`, without the `prime:` prefix. */
  variant?: string | undefined;
  /** The model, named on bare prime only (F138-FR-008). */
  model?: string | undefined;
  /** The working directory of the pass (`--cwd`). */
  workdir: string;
  profile: Profile;
  /** The stream tap; on by default (F138-FR-009). */
  streamTap?: boolean;
  /** The as-is flag `-j` that turns the capture on. */
  flagJ?: boolean;
  /** The consumer's settings for the two names (F138-FR-003). */
  settings?: PrimeSettings;
  /** The environment for the alias table. */
  env?: NameEnvironment;
  /** Whether the resolved executable (agent or launcher) was found. */
  executableFound?: boolean;
  /** The allow-list of tools; default allow-list when omitted (F138-FR-016). */
  allowList?: string[] | undefined;
  /** Opt-in to harness customisations; off by default (F138-FR-044). */
  customisationsOn?: boolean;
  /**
   * Where the opt-in claim came from; resolved by
   * `resolveProposerCustomisations` when `customisationsOn` is not given.
   */
  customisationsSource?: CustomisationsSource | null;
  /** Continuation: resume this session id of the same phase attempt (F138-FR-014). */
  continueSessionId?: string | undefined;
  /** The session directory of the phase attempt (`attempt:<N>:<k>:<n>:session`). */
  attemptSessionDir?: string | undefined;
};

/** The flags that must never reach a prime command line (argument table). */
export const NEVER_PASSED = ["--goal"] as const;

/**
 * T068 — the key that may switch the four kinds of auto-loaded context on
 * for a proposer pass (F138-FR-044): `harnesses.prime.proposerCustomisations`.
 * Trust class widening; USER configuration only. There is NO key that
 * removes a switch of a critic-class call: the critic templates carry the
 * restriction flags always (table `customisationsOptIn: "none"`).
 */
export const PROPOSER_CUSTOMISATIONS_KEY = "harnesses.prime.proposerCustomisations";

/** The trust class of the key (feature 100, annex K). */
export const PROPOSER_CUSTOMISATIONS_TRUST_CLASS = "widening" as const;

/** Where a claim about the key may have come from. */
export type CustomisationsSource =
  "user-configuration" | "project-configuration" | "environment" | "flag";

/** The only source that is accepted: user configuration. */
export const CUSTOMISATIONS_ACCEPTED_SOURCES: readonly CustomisationsSource[] = Object.freeze([
  "user-configuration",
]);

/** The resolution of the key: what the argument list will carry. */
export type CustomisationsResolution = {
  /** True when the four switches-off are dropped from the argument list. */
  readonly on: boolean;
  /** The source that decided; named even when it was ignored. */
  readonly via: CustomisationsSource | null;
  /** The four flags, as the argument table states them. */
  readonly flags: readonly string[];
  /** Under `parity` no flag about customisations is passed at all (row 131). */
  readonly parity: boolean;
  readonly key: typeof PROPOSER_CUSTOMISATIONS_KEY;
  readonly requirement: "F138-FR-044";
};

/**
 * Resolve the key `harnesses.prime.proposerCustomisations` (F138-FR-044).
 * The default is OFF: the proposer call carries the four switches-off. The
 * key is accepted from USER configuration only — a claim from project
 * configuration, the environment or a flag is IGNORED and the switches stay
 * on the command line, with the ignored source named in `via`. Under the
 * `parity` profile nothing about customisations is passed either way
 * (row 131): the parity templates hold no `{customisationsOff}` token.
 */
export function resolveProposerCustomisations(
  input: {
    source: CustomisationsSource | null;
    /** What the source says; a null is the default (off). */
    on: boolean | null;
    profile: Profile;
  },
  table: ArgumentTable = loadArgumentTable(),
): CustomisationsResolution {
  const flags = Object.freeze(
    ((
      (table.roles.proposer as Record<string, unknown>).customisationsOff as
        { flags: string[] } | undefined
    )?.flags ?? []) as string[],
  );
  const accepted =
    input.source !== null &&
    CUSTOMISATIONS_ACCEPTED_SOURCES.includes(input.source) &&
    input.on === true &&
    input.profile !== "parity";
  return {
    on: accepted,
    via: accepted ? input.source : input.source,
    flags,
    parity: input.profile === "parity",
    key: PROPOSER_CUSTOMISATIONS_KEY,
    requirement: "F138-FR-044",
  };
}

/** The per-run record of the setting in force (F138-FR-044). */
export function customisationsRunRecord(resolution: CustomisationsResolution): {
  field: "proposerCustomisations";
  value: "on" | "off";
  via: CustomisationsSource | null;
  key: typeof PROPOSER_CUSTOMISATIONS_KEY | null;
} {
  return {
    field: "proposerCustomisations",
    value: resolution.on ? "on" : "off",
    via: resolution.via,
    key: resolution.on ? PROPOSER_CUSTOMISATIONS_KEY : null,
  };
}

/** True when the command carries a flag that allows all tools or `--goal`. */
export function carriesForbiddenFlag(command: readonly string[]): boolean {
  return command.some(
    (word) =>
      NEVER_PASSED.includes(word as (typeof NEVER_PASSED)[number]) ||
      // any flag whose name admits "all tools" is the allow-all flag the
      // argument table refuses; prime has no such flag in its table.
      /^--(allow-all-tools|all-tools|dangerously-skip)/.test(word),
  );
}

/** Expand one template word: tokens, then bracket groups already removed. */
function substitute(word: string, values: Record<string, string | undefined>): string | null {
  if (!word.includes("{")) return word;
  const out = word.replace(/\{(\w+)\}/g, (_all, key: string) => {
    const value = values[key];
    return value === undefined ? "" : value;
  });
  return out.length > 0 ? out : null;
}

/**
 * Expand a template: `[...]` groups are dropped whole when their value is
 * absent, tokens are substituted, and empty words disappear.
 */
export function expandTemplate(
  template: readonly string[],
  values: Record<string, string | undefined>,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < template.length; i += 1) {
    const word = template[i];
    if (word.startsWith("[") && word.endsWith("]")) {
      const inner = word.slice(1, -1).split(" ");
      if (
        inner.every((part) => {
          const match = part.match(/^\{(\w+)\}$/);
          return !match || values[match[1] as string] !== undefined;
        })
      ) {
        for (const part of inner) {
          const piece = substitute(part, values);
          if (piece !== null) out.push(piece);
        }
      }
      continue;
    }
    const piece = substitute(word, values);
    if (piece !== null) out.push(piece);
  }
  return out;
}

/**
 * Build the invocation of one proposer pass, or its refusal. No code path
 * here starts a process; the refusals carry `command: undefined` (F138-FR-010).
 */
export function buildProposerInvocation(
  options: ProposerCallOptions,
  table: ArgumentTable = loadArgumentTable(),
): ProposerInvocation | ProposerRefusal | NotFoundResult {
  const component = options.component ?? "proposer";
  const roles = table.roles.proposer as Record<string, Record<string, string[]>>;
  const variant = options.variant;
  const hasVariant = variant !== undefined;

  // 1. An empty variant (B-0694): `prime:` with nothing behind the colon.
  if (hasVariant && variant.trim() === "") {
    return {
      kind: "refused",
      command: undefined,
      exitCode: 1,
      component,
      message: `${component}: empty Prime variant; use 'prime' or 'prime:<variant>'`,
      requirement: "F138-FR-010",
    };
  }

  const names = resolveExecutableNames(options.settings, options.env ?? {});

  // 2. A launcher that is not found (F138-FR-011, B-0573) — before the
  //    model check, in the order of F138-FR-010.
  if (hasVariant && options.executableFound === false) {
    return launcherNotFound(names.launcher.name, component);
  }

  // 3. A model named together with a variant (B-0695).
  if (hasVariant && options.model !== undefined) {
    return {
      kind: "refused",
      command: undefined,
      exitCode: 1,
      component,
      message:
        `${component}: --model is unsupported with prime:<variant>; ` +
        `the variant selects its model`,
      requirement: "F138-FR-010",
    };
  }

  // The agent executable that is not found (F138-FR-011, B-0572) on the bare form.
  if (!hasVariant && options.executableFound === false) {
    return agentExecutableNotFound(names.agent.name, component);
  }

  const mode = selectMode(options);
  // The four switches-off ride the call unless the key was accepted from
  // user configuration (F138-FR-044); an explicit `customisationsOn` wins.
  const customisationsOn =
    options.customisationsOn ??
    resolveProposerCustomisations({
      source: options.customisationsSource ?? null,
      on: true,
      profile: options.profile,
    }).on;
  const form = hasVariant ? roles.variant : roles.bare;
  const template = form[options.profile];
  if (!Array.isArray(template)) {
    throw new ArgumentTableRefusedError(
      ARGUMENT_TABLE_CONTRACT_PATH,
      `no ${options.profile} template for the ${hasVariant ? "variant" : "bare"} form`,
    );
  }

  const values: Record<string, string | undefined> = {
    agent: names.agent.name,
    launcher: names.launcher.name,
    variant,
    mode,
    workdir: options.workdir,
    model: options.model,
    allowList: options.allowList?.join(","),
  };

  // The bare templates start at the first flag: the agent executable is the
  // process name in front. The variant templates already name the launcher
  // and the variant as their first words, so nothing is prepended there.
  const firstWord = template[0] ?? "";
  const namesLauncher = firstWord === "{launcher}";
  const command = [
    ...(namesLauncher ? [] : [names.agent.name]),
    ...expandTemplate(template, {
      ...values,
      sessionFlags: sessionFlags({
        profile: options.profile,
        continueSessionId: options.continueSessionId,
        attemptSessionDir: options.attemptSessionDir,
      }).join(" "),
      customisationsOff: customisationsOn
        ? ""
        : ((
            (roles as Record<string, unknown>).customisationsOff as { flags: string[] } | undefined
          )?.flags.join(" ") ?? ""),
    })
      .flatMap((word) => word.split(" "))
      .filter((word) => word.length > 0),
  ];

  if (carriesForbiddenFlag(command)) {
    throw new Error("internal: the expanded command carries a forbidden flag");
  }

  return {
    kind: "invoke",
    command,
    stdin: "prompt",
    profile: options.profile,
    mode,
    metadata: mode === "json" ? { providerFormat: PRIME_PROVIDER_FORMAT } : {},
    requirement: "F138-FR-008",
  };
}

/** Re-exported for the seam: the continuation arguments of one pass. */
export { continuationArguments, toolArguments };
