/**
 * `@specstride/adapter-pi` — the tested harness adapter for the pi agent
 * (feature 134), written against the harness seam of feature 100 annex C as
 * the prime adapter is.
 *
 * T040 (phase 3) fills the registration call: the descriptor of
 * `descriptor.json` and the hooks of `hooks.ts` are registered as ONE NEW
 * entry of the open harness registry through EP-02 `specstride.harness/1`,
 * in the state `tested` (a version range and a `verified-on` date are both
 * present) with the origin `adapter` (F134-FR-001). No core file names the
 * harness, and no other entry of the registry changes — this package is the
 * only place in the product that names pi as a harness.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { registerDialectRow, type DialectRow } from "@specstride/adapter-prime";
import {
  createRegistry,
  defaultTransportBinding,
  type HarnessRegistry,
  type RegistryEntry,
} from "@specstride/harness";
import {
  PI_ID,
  PI_STREAM_FORMAT,
  overlayDeclaration,
  piDescriptor,
  readRawDescriptorData,
} from "./descriptor.ts";
import { PI_HOOKS, type PiHookEntry } from "./hooks.ts";

/**
 * The dialect row of pi (feature 134 T028, F134-FR-023): the data file
 * `data/dialects/pi.json`, written from the recorded captures, one row of
 * the dialect table of the JSONL reader of feature 138 that pi and prime
 * share. The row is data beside the row of prime; the reader holds no
 * branch for pi — every pi-specific fact of the stream lives in this row.
 */
const PI_SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** The data file of the dialect row of pi. */
export const PI_DIALECT_ROW_DATA_PATH = join(PI_SRC_DIR, "..", "data", "dialects", "pi.json");

/** The raw data of the dialect row of pi, as read from the data file. */
export function readPiDialectRowData(): unknown {
  return JSON.parse(readFileSync(PI_DIALECT_ROW_DATA_PATH, "utf8")) as unknown;
}

/**
 * The validated dialect row of pi (`specstride.stream-dialect/1`), exactly
 * as the reader of feature 138 holds it once registered. Idempotent: the
 * first call registers the row, later calls return the row the table holds.
 */
let registeredRow: DialectRow | null = null;

export function piDialectRow(): DialectRow {
  registeredRow ??= registerDialectRow(readPiDialectRowData());
  return registeredRow;
}

export {
  DESCRIPTOR_PATH,
  PI_CRITIC_INVOKE,
  PI_CRITIC_ROLE,
  PI_DIALECT,
  PI_EXACT_PIN,
  PI_ID,
  PI_STREAM_FORMAT,
  PI_VERIFIED_ON,
  PI_VERSION_RANGE,
  overlayDeclaration,
  piDescriptor,
  piDescriptorData,
  readRawDescriptorData,
  toolAllowList,
} from "./descriptor.ts";
export {
  MACOS_RUNNER_CHECKS,
  MACOS_STATEMENT_UNVERIFIED,
  PI_DOCTOR_CHECK_IDS,
  PI_DOCTOR_IGNORE_FLAGS,
  PI_DOCTOR_LAUNCH_CHECK_IDS,
  PI_DOCTOR_CHECK_PREFIX,
  piDoctorChecks,
  piUnverifiedFactsLine,
  registerPiDoctorChecks,
  type PiDoctorObserved,
} from "./doctor.ts";
export {
  PI_ALLOW_DETECT,
  PI_BASE_ENV_ALLOW,
  PI_C0_OPT_IN,
  PI_VERSION_FACTS,
  PI_CRITIC_FORBIDDEN_FLAGS,
  PI_CRITIC_REFUSAL,
  PI_CUSTOMISATIONS_KEY,
  PI_HELP_MUST_CONTAIN,
  PI_HOOKS,
  PI_HOOK_IDS,
  PI_HARNESS_ENV_ALLOW,
  PI_NO_LOGIN_GUARANTEES,
  type AutomaticCriticPick,
  type CallRole,
  type ConfigOrigin,
  type CustomisationsDecision,
  type HomeDecision,
  type InitialRecord,
  type PiCallIdentity,
  type PiContainment,
  type PiCriticCallFacts,
  type PiDetection,
  type PiDiversityResult,
  type PiFirstFormProof,
  type PiHookEntry,
  type PiHookId,
  type PiInvocationRecord,
  type PiSubscriptionLoginInput,
  type PiSubscriptionLoginRefusal,
  type PiTermsDecision,
  type PiTermsInput,
  type PiParallelDecision,
  PiPreflightRefusedError,
  type PiProbe,
  type ProposerLaunchInput,
  type SeenValue,
  type SessionDecision,
  automaticCriticPick,
  buildProposerInvocation,
  c0OptInHeld,
  criticArgv,
  criticFlagSet,
  criticFormsOffered,
  criticMemoryDecision,
  criticOfferedForModel,
  criticSessionClash,
  contextWindowInUse,
  detectPi,
  endPhaseAttempt,
  homeDecision,
  mintSessionId,
  piCallIdentity,
  piContainment,
  piContainmentDoctorLine,
  piCriticFlagGuard,
  piCriticProof,
  piDiversityDecision,
  piDiversityResult,
  piHookOf,
  piParallelUnitsDecision,
  piPreflight,
  piProjectLocalTrustDecision,
  piSubscriptionLoginRefusal,
  piTermsDecision,
  piVersionChangeWarning,
  piVersionWarning,
  proposerArgv,
  proposerCustomisationsDecision,
  removeOverlayHome,
  seedOverlayHome,
  sessionDecision,
  telemetryEnv,
} from "./hooks.ts";

/**
 * The registry entry of the adapter (F134-FR-001): a new entry, origin
 * `adapter`, serving both roles the descriptor declares, the stream format
 * `jsonl`, the overlay declaration of `isolation.configHome`, and the
 * subprocess transport of the descriptor.
 */
export function piRegistryEntry(): RegistryEntry {
  const roles = piDescriptor.roles as {
    proposer?: { supported?: boolean };
    critic?: { supported?: boolean };
  };
  const form = { served: true, form: "optional" as const, label: "provider/model" };
  const notServed = { served: false, form: "none" as const, label: null };
  return {
    id: PI_ID,
    origin: "adapter",
    roles: {
      proposer: roles.proposer?.supported === true ? { ...form } : { ...notServed },
      critic: roles.critic?.supported === true ? { ...form } : { ...notServed },
    },
    stream: PI_STREAM_FORMAT,
    overlay: { vars: [...overlayDeclaration().vars], seeds: [] },
    transports: [defaultTransportBinding()],
  };
}

/** The entries this adapter brings to a registry: exactly one, `pi`. */
export function piRegistrySource(): readonly RegistryEntry[] {
  return [piRegistryEntry()];
}

/**
 * The adapter as one EP-02 source: the descriptor data, the hooks and the
 * registry entry, handed to `createRegistry({ sources: [...] })` of the
 * seam. Nothing else of the product changes the registry.
 */
export function piAdapterSource(): {
  readonly descriptor: unknown;
  readonly hooks: readonly PiHookEntry[];
  readonly entries: readonly RegistryEntry[];
} {
  return { descriptor: readRawDescriptorData(), hooks: PI_HOOKS, entries: piRegistrySource() };
}

let defaultRegistry: HarnessRegistry | null = null;

/**
 * The registration call (EP-02). Registers the entry of the adapter into the
 * given registry, or into this adapter's default registry, and returns
 * nothing: the registry keeps the registration order, and `pi` enters as a
 * NEW id — a duplicate id is refused by the registry itself.
 */
export function registerPiAdapter(registry?: HarnessRegistry): void {
  piDialectRow(); // the dialect row of pi enters the reader's table (T028)
  const target = registry ?? (defaultRegistry ??= createRegistry({}));
  target.register(piRegistryEntry());
}

/**
 * The registry the adapter holds when no registry was handed to the
 * registration call: the entry of `pi`, registered through `createRegistry`
 * with this adapter as the only source.
 */
export function piDefaultRegistry(): HarnessRegistry {
  if (defaultRegistry === null) {
    defaultRegistry = createRegistry({ sources: [piRegistrySource] });
  }
  return defaultRegistry;
}
