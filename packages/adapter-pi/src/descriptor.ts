/**
 * The descriptor of pi as product data (T018, T019; F134-FR-001).
 *
 * `descriptor.json` beside this module is the shipped descriptor of the
 * adapter: the data the descriptor of feature 100 (annex C §C.2) can express.
 * It is read once at module load and validated against the same descriptor
 * schema of feature 100 that phase 2 validates the contract against; a
 * refused descriptor is a build fault of this adapter, not a runtime
 * condition. Code exists only for what the data cannot say — the hooks of
 * `hooks.ts`.
 *
 * T019 adds the environment allow-list table by provider
 * (`isolation.envAllowByProvider`: the key variable per provider, handed to
 * the process by environment and never by argument) and the overlay
 * declaration (`isolation.configHome`: the agent directory and the session
 * directory of pi are redirected, no seed is copied, scope `attempt`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validate } from "@specstride/contracts/records/compile";

/** The descriptor schema id of feature 100 (annex C §C.2). */
export const DESCRIPTOR_SCHEMA_ID = "specstride.harness/1:descriptor";

/** The path of the shipped descriptor data, beside this module. */
export const DESCRIPTOR_PATH = fileURLToPath(new URL("./descriptor.json", import.meta.url));

/** The raw descriptor as it stands in the data file. */
export function readRawDescriptorData(): unknown {
  return JSON.parse(readFileSync(DESCRIPTOR_PATH, "utf8")) as unknown;
}

const validated = validate(DESCRIPTOR_SCHEMA_ID, readRawDescriptorData());
if (!validated.ok) {
  throw new Error(
    `packages/adapter-pi/src/descriptor.json is refused by the descriptor schema of feature 100: ${JSON.stringify(
      validated.ok ? null : validated.errors,
    )}`,
  );
}

/** The validated descriptor of pi (annex C §C.2 record). */
export const piDescriptor = validated.record;

/** Loose read access to the descriptor as data. */
export type PiDescriptorData = typeof piDescriptor & {
  readonly isolation: {
    readonly envAllow: readonly string[];
    readonly envAllowBase: readonly string[];
    readonly envAllowHarness: readonly string[];
    readonly envAllowByProvider: Readonly<Record<string, { readonly keyEnv: string }>>;
    readonly configHome: { readonly vars: readonly string[]; readonly seeds: readonly never[] };
  };
  readonly containment: {
    readonly ceiling: "C0";
    readonly provenance: "adapter";
    readonly optInKey: string;
    readonly optInSource: "user-configuration-only";
    readonly parallelUnits: { readonly key: string; readonly source: string };
  };
};

/** The descriptor with the tables phase 3 reads, as typed data. */
export const piDescriptorData = piDescriptor as PiDescriptorData;

type InvokeProposer = {
  readonly toolAllowList: readonly string[];
  readonly toolSelection: string;
  readonly laterVersionDefault: string;
  readonly denyList: null;
};

type CustomisationsData = {
  readonly proposerDefault: string;
  readonly offFlags: readonly string[];
  readonly optInKey: string;
};

type HomeData = {
  readonly tier1: string;
  readonly tier2: string;
  readonly credentialByEnvironmentOnly: string;
};

/** The tool allow-list table of the proposer, under `invoke.proposer`. */
export const PI_TOOLS: InvokeProposer = (
  piDescriptorData.invoke as unknown as { readonly proposer: InvokeProposer }
).proposer;

/** The customisations table: the `customisations` field of the memory table. */
export const PI_CUSTOMISATIONS: CustomisationsData = (
  piDescriptorData.memory as unknown as { customisations: CustomisationsData }
).customisations;

/** The home rules, under `isolation.home`. */
export const PI_HOME: HomeData = (piDescriptorData.isolation as unknown as { home: HomeData }).home;

/** The id of the harness this adapter serves. */
export const PI_ID = "pi" as const;
/** The pinned version range of the tested adapter (F134-FR-003). */
export const PI_VERSION_RANGE = ">=0.80.6 <0.81" as const;
/** The date the facts of the descriptor were verified (F134-FR-003). */
export const PI_VERIFIED_ON = "2026-09-29" as const;
/** The exact pin of the fixture capture (the weaker proof of F134-FR-019). */
export const PI_EXACT_PIN = "0.80.6" as const;
/** The stream format and dialect of pi. */
export const PI_STREAM_FORMAT = "jsonl" as const;
export const PI_DIALECT = "pi" as const;

/** The harness's own environment variables the descriptor allows. */
export const PI_HARNESS_ENV_ALLOW: readonly string[] = piDescriptorData.isolation.envAllowHarness;
/** The base of the allow-list: search path, locale, home. */
export const PI_BASE_ENV_ALLOW: readonly string[] = piDescriptorData.isolation.envAllowBase;
/** The per-provider key variable table (T019). */
export const PI_ENV_BY_PROVIDER: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(piDescriptorData.isolation.envAllowByProvider).map(([provider, row]) => [
    provider,
    row.keyEnv,
  ]),
);

/**
 * The key variable of one provider, from the descriptor table; null for a
 * provider the table does not name (the launch then refuses at preflight,
 * naming the provider, and never guesses a variable).
 */
export function providerKeyVar(provider: string | null | undefined): string | null {
  if (typeof provider !== "string" || provider.trim() === "") return null;
  return PI_ENV_BY_PROVIDER[provider] ?? null;
}

/**
 * The environment allow-list of one proposer call: the base, the harness's
 * own variables, and the key variable of the provider in use. The value is
 * read from the consumer's environment only for these names, by
 * `buildCallEnvironment` of the seam.
 */
export function envAllowListFor(provider: string | null | undefined): readonly string[] {
  const keyVar = providerKeyVar(provider);
  const names = [...PI_BASE_ENV_ALLOW, ...PI_HARNESS_ENV_ALLOW];
  if (keyVar !== null && !names.includes(keyVar)) names.push(keyVar);
  return names;
}

/** The overlay declaration of the entry (F109-FR-030; F134-FR-015). */
export function overlayDeclaration(): {
  readonly vars: readonly string[];
  readonly seeds: readonly never[];
} {
  return {
    vars: [...piDescriptorData.isolation.configHome.vars],
    seeds: [],
  };
}

/** The tool allow-list of the proposer (F134-FR-012); never a deny list. */
export function toolAllowList(): readonly string[] {
  return [...PI_TOOLS.toolAllowList];
}

type InvokeCritic = {
  readonly args: readonly string[];
  readonly flagSet: readonly string[];
  readonly projectLocalResources: string;
  readonly memoryAndContext: string;
  readonly session: string;
  readonly contextWindow: { readonly inUse: string; readonly unknownModel: string };
};

type RolesCritic = {
  readonly toolless: "flag" | "structural" | "config" | "none";
  readonly readOnlyTools: string;
  readonly forms: readonly string[];
  readonly secondForm: string;
  readonly automaticPick: {
    readonly testedAdapterOnly: boolean;
    readonly providerRow: string;
    readonly metered: string;
  };
};

/** The critic invocation table, of the invoke table, the critic row (T023; F134-FR-018). */
export const PI_CRITIC_INVOKE: InvokeCritic = (
  piDescriptorData.invoke as unknown as { readonly critic: InvokeCritic }
).critic;

/** The critic role table, of the roles table, the critic row (T023; F134-FR-021). */
export const PI_CRITIC_ROLE: RolesCritic = (
  piDescriptorData.roles as unknown as { readonly critic: RolesCritic }
).critic;

/**
 * The flag set of the critic call (F134-FR-018): the flags of the descriptor,
 * the same list the proof record holds — no flag of it may allow a tool (a
 * test asserts that, never a promise).
 */
export function criticFlagSet(): readonly string[] {
  return [...PI_CRITIC_INVOKE.flagSet];
}

/** The full argv of one critic call: the flag set plus the model of the call. */
export function criticArgv(input: { readonly model: string }): string[] {
  return PI_CRITIC_INVOKE.args.map((one) => (one === "{model}" ? input.model : one));
}
