/**
 * T011 — the data of the Claude harness adapter, validated at load.
 *
 * `data/descriptor.json` is the harness descriptor (F125-FR-002); it is
 * validated against the descriptor schema of feature 100
 * (`specstride.harness/1:descriptor`, annex C §C.2) WHEN IT IS LOADED, and
 * the module throws `DescriptorRefusedError` where it does not validate.
 * `data/models.json` is the model-tier ladder, the context windows and the
 * default critic model as data (F125-FR-033, D-14), validated here against
 * the ladder's own shape (lowest first, the effort levels of the harness).
 *
 * A value the adapter has not established is null and is not guessed
 * (F125-FR-002): `concurrentSessions`, `spendLimit` and the telemetry
 * switch are null in the descriptor.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { harnessDescriptor } from "@specstride/contracts";

export {
  BACKEND_LABEL_VARIABLE,
  DEFAULT_BACKEND_LABEL,
  EFFORT_LEVELS,
  GIT_INSTRUCTIONS_SWITCH,
  INVOCATION_METADATA_RECORD,
  MODEL_LADDER,
  PROMPT_FILE_PATTERN,
  STDIN_FILE_VARIABLE,
  ModelRefusedError,
  PromptFileRefusedError,
  assertNoFallbackModel,
  backendLabel,
  invocationDirectory,
  ladderRungFor,
  modelIsOnLadder,
  modelTierArguments,
  promptFileDirectory,
  promptTransferLogicalName,
  removePromptFile,
  writePromptFile,
  ARGUMENT_TABLE_PIN,
  BASE_ALLOW_LIST,
  CALL_ROLES,
  CREDENTIAL_VARS,
  DESCRIPTOR_ENV_ALLOW,
  POLITE_GRACE_MS,
  POLITE_STOP_SIGNAL,
  PARITY_ENV_ALLOW,
  PROCESS_GROUP_SPAWN_OPTIONS,
  InvokeRefusedError,
  ProcessGroupRefusedError,
  argumentTable,
  buildCallEnvironment,
  buildCriticArgv,
  buildProposerArgv,
  carriesNoSessionContinuation,
  environmentAllowList,
  pgidIsValid,
  stopCall,
} from "./invoke-proposer.ts";
export { STOP_KINDS, TERMINATED_EXIT_CODE, exitIsProviderFailure } from "./stop.ts";
export type {
  InvocationDirectory,
  ModelRefusalReason,
  PassEnding,
  PromptFile,
  PromptFileRefusalReason,
} from "./invoke-proposer.ts";

export {
  CLI_FLOOR,
  CLI_PIN,
  CLI_RESTRICTED_FLOOR,
  EXECUTABLE_NOT_FOUND_CODE,
  HARNESS_STATE,
  VERIFIED_ON,
  claudeConfigHome,
  detectClaude,
  dirIsWorldWritable,
  readClaudeVersion,
  resolveClaudeExecutable,
  searchPathDirs,
  versionIsInRange,
  CONTAINMENT_LEVELS,
  CONTAINMENT_PROVENANCE,
  concurrentSessionsCapability,
  containmentCeiling,
  parallelUnitsSetting,
  HIDDEN_FLAGS,
  flagAvailability,
  hiddenFlagIsGatedByFloor,
  versionAtFloor,
} from "./detect.ts";
export type {
  ConcurrentSessionsCapability,
  ContainmentCeiling,
  ContainmentLevel,
  ParallelUnitsSetting,
} from "./detect.ts";
export type {
  DetectDependencies,
  DetectOutcome,
  PathDir,
  FlagAvailability,
  FlagDecisionBasis,
  HiddenFlag,
} from "./detect.ts";

/* Phase 8 — the doctor checks of the harness adapter (T074, F125-FR-006). */
export {
  CLAUDE_DOCTOR_CHECK_IDS,
  claudeDoctorChecks,
  registerClaudeDoctorChecks,
} from "./checks.ts";
export type { ClaudeDoctorCheckId, ClaudeDoctorFacts } from "./checks.ts";

export {
  FRESH_CASES,
  SessionRefusedError,
  SessionRun,
  buildThrowawayHome,
  continuedSessionDelta,
  directiveForPass,
  continueDirective,
  continuationIsInForce,
  endPhaseAttempt,
  freshDirective,
  mintSessionId,
  sessionIdIsUsable,
} from "./session.ts";
export type {
  FreshCase,
  PassDirectiveInput,
  SessionDirective,
  SessionRecord,
  ThrowawayHome,
} from "./session.ts";

/* Phase 4 — the tool-less critic (T043 to T046). The request-building and
 * alias-resolution symbols live in critic-direct.ts; critic-cli.ts re-exports
 * them so the package seam stays in one place. */
export {
  ANTHROPIC_VERSION,
  CONTEXT_WINDOW_TABLE,
  CONTEXT_WINDOW_VARIABLE_PLACEHOLDER,
  CRITIC_BASE_URL_VARIABLES,
  CRITIC_CONTEXT_TOKENS_VARIABLE,
  CRITIC_ENGINE_EXIT,
  CRITIC_KEY_VARIABLES,
  CRITIC_MAX_TOKENS,
  CRITIC_NOT_TOOLLESS,
  CRITIC_ONE_TURN,
  CRITIC_PROMPT_SIZE_BUDGET_TOKENS,
  CRITIC_STOP_REASON,
  DEFAULT_CRITIC_BASE_URL,
  DEFAULT_CRITIC_MODEL,
  PARITY_FALLBACK_CONTEXT_TOKENS,
  PROOF_OUTCOMES,
  CriticConfigError,
  CriticDirectRefusedError,
  CriticDirectTransportError,
  CriticTransportError,
  TermsGateRefusedError,
  assertAddressAllowed,
  assertCriticTransportAllowed,
  assertProofHolds,
  bodyNamesNoTool,
  budgetCaps,
  budgetCapMissing,
  buildMessagesRequest,
  callCriticCli,
  callCriticDirect,
  criticDiversity,
  contextWindowFor,
  lastCriticCallRecordOf,
  proveToolless,
  readInitialRecord,
  replyTextOf,
  replyTextOfDirect,
  resolveCriticAliases,
} from "./critic-cli.ts";
export type {
  BudgetCaps,
  CriticAliases,
  CriticCallRecord,
  CriticDirectCallRecord,
  CriticDiversity,
  CriticProof,
  InitialRecord,
  ProofOutcome,
  SpawnCritic,
} from "./critic-cli.ts";

/* Phase 5 — the isolation of a pass (T052, T053). */
export {
  CAPTURE_E_FIXTURE,
  CUSTOMISATION_KINDS,
  CUSTOMISATION_OFF,
  HOST_PLUGIN_ID,
  NATIVE_MEMORY_SWITCH,
  OVERLAY_SCHEMA,
  OVERLAY_SCOPES,
  PROPOSER_MEMORY_OPT_IN,
  OverlayRefusedError,
  assertInitialRecordForCritic,
  assertInitialRecordForProposer,
  buildOverlayHome,
  compareHomeTrees,
  customisationFindings,
  customisationOffMode,
  homeComparisonPlan,
  hostPluginHookFindings,
  memorySwitchSetting,
  minimalModeAllowed,
  overlayScope,
  removeOverlayHome,
} from "./isolation.ts";
export type {
  CustomisationFinding,
  CustomisationKind,
  HomeComparisonPlan,
  HostHook,
  IsolationWarning,
  MemorySwitchSetting,
  OverlayHome,
  OverlayRefusalReason,
  OverlayScope,
} from "./isolation.ts";

/** The data directory of the adapter package. */
export const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

function readData(name: string): unknown {
  return JSON.parse(readFileSync(path.join(DATA_DIR, name), "utf8"));
}

/** The harness descriptor of Claude, read from `data/descriptor.json`. */
export const descriptor = harnessDescriptor.readHarnessDescriptor(readData("descriptor.json"));

/** One rung of the model-tier ladder (F125-FR-033). */
export type LadderRung = {
  readonly model: string;
  readonly effort: string;
  readonly order: number;
  readonly status: string;
  readonly note?: string;
};

/** The model data of the adapter, read from `data/models.json`. */
export type ModelsData = {
  readonly pin: { readonly cli: string; readonly floor: string; readonly verifiedOn: string };
  readonly ladder: readonly LadderRung[];
  readonly effortLevels: readonly string[];
  readonly contextWindows: Readonly<Record<string, unknown>>;
  readonly defaultCriticModel: string;
  readonly rule: string;
};

/** Why a models file was refused. */
export class ModelsDataRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelsDataRefusedError";
  }
}

/** Validates the ladder shape: rungs lowest first, model and effort set. */
export function validateModelsData(value: unknown): ModelsData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ModelsDataRefusedError("refused the models data: it is not a record");
  }
  const data = value as ModelsData;
  if (!Array.isArray(data.ladder) || data.ladder.length === 0) {
    throw new ModelsDataRefusedError("refused the models data: the ladder is empty");
  }
  const efforts = new Set<string>(data.effortLevels ?? []);
  let previousOrder = -Infinity;
  for (const rung of data.ladder) {
    if (typeof rung.model !== "string" || rung.model === "") {
      throw new ModelsDataRefusedError("refused the models data: a rung names no model");
    }
    if (typeof rung.effort !== "string" || !efforts.has(rung.effort)) {
      throw new ModelsDataRefusedError(
        `refused the models data: the rung ${rung.model} names the effort ` +
          `${JSON.stringify(rung.effort)}, which is not one of the harness's effort levels`,
      );
    }
    if (typeof rung.order !== "number" || rung.order <= previousOrder) {
      throw new ModelsDataRefusedError(
        "refused the models data: the ladder is not ordered lowest first (F125-FR-033)",
      );
    }
    previousOrder = rung.order;
  }
  return data;
}

/** The model-tier ladder, the context windows, the default critic model. */
export const models = validateModelsData(readData("models.json"));

/* ------------------------------------------------------------------ *
 * Phase 6 — the ladder read and the pin (T060, F125-FR-033, CT-125-24).
 * ------------------------------------------------------------------ */

/** The version pin the ladder is read under (data/models.json, "pin"). */
export const LADDER_PIN: {
  readonly cli: string;
  readonly floor: string;
  readonly verifiedOn: string;
  readonly source: "data/models.json";
  /** The ladder is data pinned at launch, not swapped mid-run. */
  readonly pinnedAtLaunch: true;
} = Object.freeze({
  cli: models.pin.cli,
  floor: models.pin.floor,
  verifiedOn: models.pin.verifiedOn,
  source: "data/models.json" as const,
  pinnedAtLaunch: true as const,
});

/**
 * The ladder as read at launch (F125-FR-033): frozen rungs, lowest first,
 * each stating its model and its effort. The function returns the data
 * that was read when the module loaded; a call never re-reads and never
 * reorders it — the ladder is pinned at launch.
 */
export function ladderAtLaunch(): readonly LadderRung[] {
  return models.ladder.map(
    (rung) =>
      Object.freeze({ model: rung.model, effort: rung.effort, order: rung.order }) as LadderRung,
  );
}

/**
 * True when the plan (the role plan of the consumer) names a rung the
 * pinned ladder holds: the same model AND the same effort. A rung the plan
 * lacks is unknown — the adapter never substitutes a neighbouring rung and
 * never passes a fallback model (F125-FR-033).
 */
export function ladderRungIsKnown(model: string, effort: string): boolean {
  return models.ladder.some((rung) => rung.model === model && rung.effort === effort);
}

/* Phase 6 — the quota classifier (T058) and the usage increments (T059). */
export {
  classifierTable,
  classify,
  classifyDirect,
  classIsRetryable,
  textPatterns,
} from "./classify.ts";
export type {
  ClassifierData,
  Classification,
  DirectOutcome,
  QuotaClass,
  StreamEvent,
} from "./classify.ts";
export {
  finalRecordUsage,
  killedPassIncrement,
  messagesCallUsage,
  notionalLabel,
  totalTokens,
  usageIncrement,
} from "./usage.ts";
export type { NotionalReason, UsageFigures, UsageIncrement } from "./usage.ts";

/* ------------------------------------------------------------------ *
 * Phase 7 — the SDK transport (T066 to T068, F125-FR-034 to F125-FR-038).
 * ------------------------------------------------------------------ */

export {
  SDK_PACKAGE,
  SDK_TESTED_VERSION,
  SDK_VERSION_RANGE,
  SDK_AVAILABILITY_STATES,
  loadSdk,
  resolveSdkLocation,
  sdkVersionInRange,
  sdkVersionWarning,
} from "./sdk/load.ts";

import {
  SDK_AVAILABILITY_STATES,
  SDK_PACKAGE,
  sdkVersionInRange,
  sdkVersionWarning,
} from "./sdk/load.ts";
export type {
  ClaudeAgentSdkModule,
  QueryImpl,
  SdkAvailability,
  SdkLoadOutcome,
} from "./sdk/load.ts";
export {
  NULL_USAGE,
  SDK_SUBSCRIPTION_CREDENTIAL_VARS,
  SESSION_START_ONLY_OPTIONS,
  ClaudeAgentSdkHarness,
  baseSdkOptions,
  claudeAgentDisallowedTools,
  claudeAgentEnvironment,
  continuationOptions,
  runSdkCriticCall,
  sdkApiKey,
  sdkAuthEnvironment,
  sessionStartOptions,
  summarizeToolInput,
  usageFromSdkResult,
} from "./sdk/harness.ts";
export type {
  HarnessEvent,
  HarnessPassRequest,
  HarnessUsage,
  SdkCriticCall,
  SecretReference,
} from "./sdk/harness.ts";

/** The closed set of the transports of Claude (contracts/transport-and-sdk.md). */
export const TRANSPORTS = ["subprocess", "direct-call", "sdk-in-process"] as const;
export type Transport = (typeof TRANSPORTS)[number];

/**
 * The consumer's ONLY channels for choosing a transport (F125-FR-034): the
 * user configuration, the environment (`SPECSTRIDE_CLAUDE_TRANSPORT`) or a
 * flag. There is NO project-level channel: a project cannot choose, and a
 * `parity` run forces the subprocess.
 */
export const TRANSPORT_ENV_VARIABLE = "SPECSTRIDE_CLAUDE_TRANSPORT" as const;

/** Why the transport state is what it is; shown by the doctor (F125-FR-036). */
export type TransportState = {
  readonly transport: Transport;
  readonly availability: (typeof SDK_AVAILABILITY_STATES)[number];
  readonly reason: string | null;
  readonly version: string | null;
};

/** What the selection reads. Everything except `authTier` is optional. */
export type TransportSelectionInput = {
  readonly authTier: 1 | 2;
  /** Under `parity` the subprocess is FORCED and the direct call is used for the critic. */
  readonly parity?: boolean;
  /** The user configuration's transport key (`harnesses.claude.transport`). */
  readonly userConfiguration?: { readonly transport?: string };
  /** The process environment; read only through `TRANSPORT_ENV_VARIABLE`. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /** The command-line flag of the consumer. */
  readonly flag?: string;
  /** The SDK, as the loader found it; `undefined` when never probed. */
  readonly sdk?: {
    readonly present: boolean;
    readonly version?: string | null;
  };
};

/** The transport `sdk-in-process` chosen where it cannot be used (F125-FR-034). */
export class TransportChoiceRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportChoiceRefusedError";
  }
}

const CHOSEN_VALUES: ReadonlySet<string> = new Set(["subprocess", "direct-call", "sdk-in-process"]);

/**
 * THE selection order, in ONE function (contracts/transport-and-sdk.md; no
 * name test anywhere else):
 *   (1) `parity` forces the `subprocess` transport — a consumer choice is
 *       IGNORED there;
 *   (2) an explicit choice of the consumer — the user configuration, the
 *       environment or the flag, in that order;
 *   (3) the default, the `subprocess`.
 * NEVER automatic: with no channel set, the SDK is never picked up even
 * when it is installed and in range (F125-FR-034).
 */
export function selectTransport(input: TransportSelectionInput): TransportState {
  const chosen =
    input.parity === true
      ? null
      : (input.userConfiguration?.transport ??
        input.environment?.[TRANSPORT_ENV_VARIABLE] ??
        input.flag ??
        null);
  if (chosen !== null && !CHOSEN_VALUES.has(chosen)) {
    throw new TransportChoiceRefusedError(
      `refused the transport choice ${JSON.stringify(chosen)}: it is not one of ` +
        `${[...CHOSEN_VALUES].join(", ")}`,
    );
  }

  // (1) parity — and (3) the default — run on the subprocess.
  if (chosen === null || chosen === "subprocess" || chosen === "direct-call") {
    return {
      transport: chosen === "direct-call" ? "direct-call" : "subprocess",
      availability: "available",
      reason:
        chosen === null
          ? "no transport is chosen: the default, the subprocess (never automatic)"
          : null,
      version: null,
    };
  }

  // The consumer explicitly chose the SDK transport.
  if (input.authTier !== 2) {
    throw new TransportChoiceRefusedError(
      `refused the transport choice "sdk-in-process" at auth tier ${input.authTier}: the ` +
        `SDK transport is auth tier 2, API keys only (F125-FR-034, ruling 70)`,
    );
  }
  const sdk = input.sdk;
  if (sdk === undefined || !sdk.present) {
    return {
      transport: "sdk-in-process",
      availability: "absent-dependency",
      reason:
        `${SDK_PACKAGE} is not installed: it is an optional peer dependency the ` +
        `consumer installs; the product never installs it (F125-FR-036)`,
      version: null,
    };
  }
  if (!sdkVersionInRange(sdk.version ?? null)) {
    return {
      transport: "sdk-in-process",
      availability: "out-of-range",
      reason: sdkVersionWarning(sdk.version ?? null),
      version: sdk.version ?? null,
    };
  }
  return {
    transport: "sdk-in-process",
    availability: "available",
    reason: null,
    version: sdk.version ?? null,
  };
}

/**
 * The doctor's transport states (F125-FR-036): every transport with its
 * availability, and the SDK state NAMING the package when it is absent.
 * A choice whose dependency is absent is `unavailable` and the doctor says
 * so; a run on the subprocess is unchanged by it.
 */
export function doctorTransportStates(input: {
  readonly authTier: 1 | 2;
  readonly parity?: boolean;
  readonly userConfiguration?: { readonly transport?: string };
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly flag?: string;
  readonly sdk?: { readonly present: boolean; readonly version?: string | null };
}): readonly TransportState[] {
  const states: TransportState[] = [
    {
      transport: "subprocess",
      availability: "available",
      reason: null,
      version: null,
    },
  ];
  try {
    states.push(selectTransport(input));
  } catch (error) {
    if (!(error instanceof TransportChoiceRefusedError)) throw error;
    states.push({
      transport: "sdk-in-process",
      availability: "refused-at-tier",
      reason: error.message,
      version: null,
    });
  }
  // A run on the subprocess is unchanged: the doctor reports the SDK state
  // WITHOUT selecting it for the default path.
  if (!states.some((state) => state.transport === "sdk-in-process")) {
    const sdk = input.sdk;
    states.push({
      transport: "sdk-in-process",
      availability: "not-chosen",
      reason:
        sdk !== undefined && !sdk.present
          ? `${SDK_PACKAGE} is not installed (optional peer dependency; the product never installs it)`
          : null,
      version: sdk?.version ?? null,
    });
  }
  return states;
}

/* The terms rows of Claude and of its SDK transport (F125-FR-005, F125-FR-037). */

/** One row of the terms data (data-model.md, "Terms row"). */
export type TermsRow = {
  readonly id: string;
  readonly provider: string;
  readonly authTier: number;
  readonly audience: string;
  readonly transport: string | readonly string[];
  readonly status: string;
  readonly basis: string;
  readonly source: string;
  readonly accessDate: string;
  readonly verifiedOn: string | null;
};

/** Why a terms data file was refused. */
export class TermsRowsRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TermsRowsRefusedError";
  }
}

/** Validates the terms data: every row complete, every row unverified. */
export function validateTermsRows(value: unknown): {
  readonly rows: readonly TermsRow[];
  readonly sdkTransport: Record<string, unknown>;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TermsRowsRefusedError("refused the terms data: it is not a record");
  }
  const data = value as { rows?: unknown; sdkTransport?: unknown };
  if (!Array.isArray(data.rows) || data.rows.length === 0) {
    throw new TermsRowsRefusedError("refused the terms data: it holds no row");
  }
  const rows = data.rows.map((entry, index): TermsRow => {
    const row = entry as TermsRow;
    for (const field of [
      "id",
      "provider",
      "authTier",
      "audience",
      "transport",
      "status",
      "basis",
      "source",
      "accessDate",
    ] as const) {
      if (row[field] === undefined || row[field] === null || row[field] === "") {
        throw new TermsRowsRefusedError(`refused the terms data: row ${index} states no ${field}`);
      }
    }
    // Documentation only: unverified until the owner re-reads it (ruling 59).
    if (row.verifiedOn !== null && row.verifiedOn !== undefined) {
      throw new TermsRowsRefusedError(
        `refused the terms data: row ${row.id} claims verifiedOn; the rows rest on ` +
          `documentation only and stay unverified (ruling 59)`,
      );
    }
    return row;
  });
  if (
    typeof data.sdkTransport !== "object" ||
    data.sdkTransport === null ||
    Array.isArray(data.sdkTransport)
  ) {
    throw new TermsRowsRefusedError("refused the terms data: no sdkTransport record");
  }
  return { rows, sdkTransport: data.sdkTransport as Record<string, unknown> };
}

/** The terms rows of the adapter, read from `data/terms-rows.json`. */
export const termsRows = validateTermsRows(readData("terms-rows.json"));

/* ------------------------------------------------------------------ *
 * T075 — the hand-over of the terms rows to the terms file of feature 147
 * (EP-11 `specstride.terms/1`, annex C §C.12).
 *
 * Feature 147 owns the terms gate, its evaluator and the shipped terms file
 * (`terms-rows.tsv`); this adapter supplies the FACTS. The hand-over states
 * every row in the row shape the terms gate reads (`TermsRow` of
 * `@specstride/contracts/ep/terms`), with the transport named alongside —
 * a row of the gate is per provider, tier and audience, so the audience
 * `any` of the adapter's rows is handed over as one row per audience, and
 * the transport stays a property of the fact, never dropped.
 * ------------------------------------------------------------------ */

/** One row as the terms file of feature 147 reads it (annex C §C.12). */
export type TermsGateRow = {
  readonly provider: string;
  readonly authTier: 1 | 2 | 3;
  readonly audience: "personal" | "distributed";
  /** The transport the fact applies to, as the adapter's row names it. */
  readonly transport: string | readonly string[];
  readonly status: "allowed" | "conditional" | "personal-only" | "refused";
  readonly source: string;
  readonly accessDate: string;
  /** The quoted sentence of the source, as the gate's row shape names it. */
  readonly quotedSentence: string;
  readonly verifiedOn: string | null;
};

/** Why a row cannot be handed over to the terms gate. */
export class TermsHandoverRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TermsHandoverRefusedError";
  }
}

/**
 * Hands the terms rows of the adapter to the terms file of feature 147
 * (F125-FR-005, F125-FR-037): every row in the gate's row shape, the
 * audience `any` expanded to one row per audience, every row still
 * `unverified` (documentation only, ruling 59).
 */
export function termsRowsForTermsGate(): readonly TermsGateRow[] {
  const handed: TermsGateRow[] = [];
  for (const row of termsRows.rows) {
    const audiences: readonly ("personal" | "distributed")[] =
      row.audience === "any" ? ["personal", "distributed"] : [row.audience as never];
    if (audiences.length === 0 || audiences.some((a) => a !== "personal" && a !== "distributed")) {
      throw new TermsHandoverRefusedError(
        `refused the hand-over of the terms row ${row.id}: its audience is not one the gate reads`,
      );
    }
    for (const audience of audiences) {
      handed.push({
        provider: row.provider,
        authTier: row.authTier as 1 | 2 | 3,
        audience,
        transport: row.transport,
        status: row.status as TermsGateRow["status"],
        source: row.source,
        accessDate: row.accessDate,
        quotedSentence: row.basis,
        verifiedOn: row.verifiedOn,
      });
    }
  }
  return handed;
}

/**
 * The default of the audience `distributed` (F125-FR-005): auth tier 2.
 * Auth tier 1 stays an opt-in in user configuration marked "personal use
 * only", with a warning.
 */
export const DISTRIBUTED_AUDIENCE_DEFAULT_AUTH_TIER = 2 as const;
