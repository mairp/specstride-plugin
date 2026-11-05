/**
 * @specstride/adapter-dsh — the entry of the dsh harness adapter (feature 130).
 *
 * T006 — created by phase 1 with the directory layout of `plan.md` (Source
 * Code): `descriptor/`, `detect/`, `proposer/`, `model/`, `overlay/`,
 * `critic/`, `coverage/`, `customisations/`, `plugins/`, `environment/`,
 * `classifier/`, `doctor/` under `src/`, and `test/` for CT-130-*.
 *
 * This entry exports the descriptor and the hooks. The descriptor is data
 * (`data/descriptor-dsh.json`, validated against the harness descriptor schema
 * of `@specstride/contracts`). The hooks are the three things the data cannot
 * say — the settings overlay, the critic patch and coverage, the plugin
 * protocol — exported as the registry `DSH_HOOKS` of `src/hooks/`; each entry
 * names the module that implements it and the task that lands it, and the
 * implementing phases fill their modules in.
 *
 * The adapter imports the port and the overlay tool of `@specstride/harness`
 * and imports nothing from another adapter; nothing else of the product names
 * the harness (plan.md, Structure Decision).
 */
export {
  dshDescriptor,
  readRawDescriptorData,
  DESCRIPTOR_DATA_PATH,
  DSH_PIN,
  DSH_VERIFIED_ON,
} from "./descriptor/data.ts";
export { DSH_HOOKS, DSH_HOOK_IDS, dshHookOf, allHooksImplemented } from "./hooks/index.ts";
export type { DshHookId, DshHookEntry } from "./hooks/index.ts";
export {
  loadedDshDescriptor,
  loadDshDescriptor,
  dshCapabilities,
  dshCustomisations,
  dshIdentityOfQualifier,
  CUSTOMISATION_KINDS,
  DSH_LOGICAL_NAME,
  DSH_KIND,
  DSH_STREAM_FORMAT,
} from "./descriptor/index.ts";
export type {
  LoadedDshDescriptor,
  CapabilityStatement,
  CustomisationStatement,
  CustomisationKind,
  DshIdentity,
} from "./descriptor/index.ts";
export {
  detectDsh,
  dshPinState,
  dshVersionChangeWarning,
  dshVersionRecord,
  dshHomeState,
  probeDshVersion,
  DSH_BIN,
  DSH_VERSION_FLAG,
  DSH_HOME_VARIABLE,
  DSH_DEFAULT_HOME,
  DSH_NOT_FOUND_PREFIX,
} from "./detect/index.ts";
export type {
  DshDetection,
  DshPinState,
  DshVersionRecord,
  DshHomeState,
  ExecutableRefusalReason,
} from "./detect/index.ts";
export {
  dshTermsRow,
  dshTermsDecision,
  dshNamedForRole,
  dshIsDefault,
  dshIsAutoPickCandidate,
  dshRoleResolutionPassOver,
  DSH_TERMS_ROW,
  DSH_PASS_OVER_REASON,
} from "./descriptor/terms.ts";
export type {
  DshTermsRow,
  DshTermsDecision,
  DshNaming,
  TermsAudience,
  DshPassOverReason,
} from "./descriptor/terms.ts";
export {
  runDshProposer,
  proposerArgv,
  PROPOSER_ARGV_TEMPLATE,
  PROPOSER_ENV_NAMES,
  ALLOW_ALL_FLAGS,
  TRACEPARENT_ENV_NAME,
  DSH_TELEMETRY_VARIABLE,
  DSH_NOT_FOUND_PREFIX as PROPOSER_NOT_FOUND_PREFIX,
  PROMPT_LIMIT_BYTES,
  prepareDshProposerPass,
} from "./proposer/index.ts";
export type { ProposerRun, ProposerPassInput, PreparedProposerPass } from "./proposer/index.ts";
export {
  dshStartPass,
  sessionDirectiveRefusal,
  writeRootRefusal,
  promptOfAReference,
  removePassOutput,
  START_PASS_ANNEX_SECTION,
  WRITE_ROOT_IS_THE_WORKING_DIRECTORY,
  WORKER_SESSION_IS_ALWAYS_FRESH,
  START_PASS_OUTPUT_PREFIX,
} from "./start-pass/index.ts";
export type { DshStartPassInput, DshPassHandle, DshStartPassResult } from "./start-pass/index.ts";
export {
  DSH_SETTING_KEYS,
  DSH_SETTING_ALIASES,
  DSH_DEFAULT_PROFILE,
  DSH_DEFAULT_BIN,
  DSH_DEFAULT_PERMISSION_MODE,
  resolveDshSettings,
} from "./proposer/settings.ts";
export type { DshSettings, ConfigSource as DshConfigSource } from "./proposer/settings.ts";
export {
  resolvePermissionMode,
  permissionModeStatement,
  fullAccessOptIn,
  PROPOSER_PERMISSION_MODE,
  CRITIC_PERMISSION_MODE,
  FULL_ACCESS_MODE,
  C0_CONTAINMENT_LEVEL,
} from "./proposer/permission.ts";
export type {
  PermissionModeDecision,
  PermissionModeInput,
  ConfigOrigin as PermissionConfigOrigin,
} from "./proposer/permission.ts";
export {
  promptArguments,
  splitPromptAtSpaces,
  PromptTooLargeError,
  PROMPT_LIMIT_BYTES as PROMPT_LIMIT,
  PROMPT_LIMIT_LABEL,
} from "./proposer/chunks.ts";
export {
  resolveDshModel,
  bareModelTable,
  BUILT_IN_BARE_MODEL_ROWS,
  PASS_LOOP_COMPONENT,
  NO_PROVIDER_MESSAGE,
  CONFLICTING_PROVIDERS_MESSAGE,
  INVALID_MODEL_REF_MESSAGE,
  QUALIFIER_AND_FLAG_MESSAGE,
} from "./model/index.ts";
export type { ModelReference, ModelResolution, BareModelRow } from "./model/index.ts";
export {
  buildOverlay,
  removeRealModelBlock,
  overlaySettingsContent,
  overlayModelBlock,
  overlayFailureLine,
  OverlayBuildError,
  OVERLAY_PREFIX,
  OVERLAY_SETTINGS_FILE,
  OVERLAY_MODEL_BLOCK,
  OVERLAY_LOGICAL_NAME,
} from "./overlay/index.ts";
export type { DshOverlay } from "./overlay/index.ts";
export {
  DSH_CONTINUATION_STATEMENT,
  DSH_APPROVAL_STATEMENT,
  DSH_CONTAINMENT_STATEMENT,
  continuationSwitchRecord,
  dshMicroLoopLevel,
  dshParallelUnitsDecision,
} from "./descriptor/statements.ts";
export type {
  ContinuationSwitchRecord,
  ParallelUnitsDecision,
  ConfigOrigin as StatementConfigOrigin,
} from "./descriptor/statements.ts";
export {
  iterDoneFields,
  projectIterDone,
  assemblePrompt,
  protocolPromptSection,
  PROMPT_BLOCK_ORDER,
  PLUGIN_SECTION_HEADING,
  ITER_DONE_EVIDENCE_MISSING,
  ITER_DONE_PLUGIN_RESTART,
} from "./plugins/prompt-block.ts";
export type {
  IterDoneFields,
  PromptBlocks,
  PromptBlockName,
  ProtocolSectionInput,
} from "./plugins/prompt-block.ts";
export {
  runDshCritic,
  criticArgv,
  CRITIC_ARGV_TEMPLATE,
  CRITIC_PERMISSION_ENV,
  CRITIC_EMPTY_CWD_PREFIX,
} from "./critic/index.ts";
export type { CriticRun, CriticCallInput } from "./critic/index.ts";
export {
  CRITIC_SETTING_KEYS,
  CRITIC_SETTING_ALIASES,
  CRITIC_PROOF_VALUES,
  CRITIC_PROOF_DEFAULT,
  CRITIC_PROOF_PARITY,
  CRITIC_MODE_EXPORTED,
  resolveCriticSettings,
} from "./critic/settings.ts";
export type {
  CriticSettings,
  CriticProposerFallback,
  CriticSettingName,
} from "./critic/settings.ts";
export {
  writeCriticPatch,
  criticPatchDocument,
  criticPatchHash,
  criticPatchLogicalName,
  CRITIC_PATCH_IDS,
  CRITIC_PATCH_ENTRY_COUNT,
  CRITIC_PATCH_LOGICAL_PREFIX,
  CRITIC_PATCH_LOGICAL_SUFFIX,
} from "./critic/patch.ts";
export type { CriticPatchFile, DisabledTool } from "./critic/patch.ts";
export { resolveCriticModel, buildCriticOverlay } from "./critic/model.ts";
export type { ResolveCriticModelInput } from "./critic/model.ts";
export { resolveCriticWindow, criticWindowKey, CRITIC_DEFAULT_WINDOW } from "./critic/window.ts";
export type {
  CriticWindowInput,
  CriticWindowResolution,
  CriticWindowSource,
} from "./critic/window.ts";
export {
  firstCharacters,
  criticNonZeroExitMessage,
  criticEmptyStdoutMessage,
  criticTimeoutMessage,
  criticLaunchMessage,
  criticReferenceFailure,
  CRITIC_ERROR_TAIL,
  CRITIC_ERROR_PREFIX,
  CRITIC_UNAVAILABLE,
  CRITIC_REFERENCE_SCENARIOS,
} from "./critic/errors.ts";
export type { CriticUnavailableEnd } from "./critic/errors.ts";
export {
  enumerateDshToolIds,
  checkCriticCoverage,
  checkCriticVersionPin,
  buildCriticProof,
  CRITIC_NOT_TOOLLESS,
  CRITIC_PROOF_SWITCH,
  DSH_TOOL_INTROSPECTION_FLAG,
} from "./coverage/index.ts";
export type { CoverageCheck, CriticProofRecord, EnumerateInput } from "./coverage/index.ts";
export {
  scanDshStreams,
  parseDshSignalLine,
  parseResetTime,
  classifyDshSignal,
  classifyDshStreams,
  dshClassifierEntryOf,
  DSH_CLASSIFIER_ENTRIES,
  DSH_NO_MATCH,
  DSH_SIGNAL_FORM,
  DSH_SIGNAL_PREFIX,
  DSH_SIGNAL_STREAMS,
} from "./classifier/index.ts";
export type {
  DshClassifierEntry,
  DshSignal,
  DshSignalScan,
  DshSignalStream,
} from "./classifier/index.ts";
export {
  buildDshEnvironment,
  dshTelemetryEnvironment,
  dshTraceParentEnvironment,
  dshUsageStatement,
  dshVariableIsAllowed,
  dshArgumentsCarrySecret,
  DSH_ENV_ALLOW_LIST,
  DSH_OWN_VARIABLES,
  DSH_TELEMETRY_OFF_VALUE,
  DSH_TELEMETRY_OFF_STATUS,
  DSH_TRACEPARENT_VARIABLE,
} from "./environment/index.ts";
export type { DshEnvironmentInput, DshUsageStatement } from "./environment/index.ts";
export {
  processPluginRequest,
  runPluginProcessor,
  parseProcessorArgv,
  readRequestClaim,
  parseAllowlist,
  allowlistAdmits,
  isExactSpec,
  requestErrorLine,
  utcStamp,
  installerArgv,
  PROCESSOR_FLAGS,
  PROCESSOR_DEFAULTS,
  REQUEST_SCHEMA_ID,
  RECEIPT_SCHEMA_ID,
  REQUEST_LOGICAL_NAME,
  ARCHIVE_LOGICAL_NAME,
  LOCK_LOGICAL_NAME,
  PLUGIN_COMPONENT,
  REQUEST_ERROR_PREFIX,
  REQUEST_MAX_BYTES,
  REASON_MAX_BYTES,
  PLUGIN_MIN_ITEMS,
  PLUGIN_MAX_ITEMS,
} from "./plugins/request.ts";
export type {
  PluginRequest,
  RequestRead,
  ProcessorArgs,
  ProcessorResult,
  InstallReceipt,
  ProcessInput,
} from "./plugins/request.ts";
export {
  runInstaller,
  INSTALLER_ARGV_TEMPLATE,
  INSTALLER_TIMEOUT_DEFAULT_SEC,
} from "./plugins/install.ts";
export type { InstallerRun } from "./plugins/install.ts";
export {
  betweenPasses,
  pluginRequestsCapability,
  pluginProtocolEnabled,
  outcomeOfProcessor,
  renderPluginEvent,
  allowlistEmptyLine,
  restartLine,
  finalPassLine,
  PLUGIN_REQUESTS_CAPABILITY,
  betweenPassesOutcome,
} from "./plugins/between-passes.ts";
export type {
  BetweenPassesInput,
  BetweenPassesDecision,
  PluginRequestOutcome,
} from "./plugins/between-passes.ts";
export {
  resolveAllowlistConsent,
  consentRecord,
  installRunRecord,
  realHomeWriteAllowed,
  pluginSettings,
  allowlistIgnoredLaunchMessage,
  allowlistIgnoredDoctorWarning,
  PLUGIN_ALLOWLIST_SETTING,
  PLUGIN_TIMEOUT_SETTING,
  PLUGIN_ALLOWLIST_ALIAS,
  PLUGIN_TIMEOUT_ALIAS,
  PLUGIN_TIMEOUT_DEFAULT_SEC,
} from "./plugins/consent.ts";
export type {
  AllowlistConsent,
  AllowlistSource,
  ConsentRecord,
  InstallRunRecord,
  PluginSettings,
} from "./plugins/consent.ts";

export {
  dshDoctorFindings,
  dshDoctorChecks,
  registerDshDoctorChecks,
  dshCustomisationStates,
  dshMemoryState,
  dshCriticMemoryRefusal,
  dshUnverifiedFactLine,
  dshDatedFacts,
  dshFactDatingAudit,
  defaultDshDoctorObserved,
  DSH_DOCTOR_CHECK_IDS,
  DSH_UNVERIFIED_FACTS,
} from "./doctor/index.ts";
export type {
  DshDoctorObserved,
  DshDoctorFinding,
  DshDoctorCheck,
  DshDoctorCheckId,
  DshDoctorProfile,
  DshDoctorSeverity,
  CustomisationDoctorState,
  MemoryDoctorState,
  UnverifiedFact,
  DatedFact,
} from "./doctor/index.ts";
export {
  CUSTOMISATION_STATES,
  CUSTOMISATION_SWITCH_VALUES,
  CUSTOMISATION_SWITCH_DEFAULT,
  PROPOSER_CUSTOMISATIONS_SWITCH,
  MEMORY_NATIVE_PROPOSER_SWITCH,
  readCustomisationsSwitch,
  readMemorySwitch,
  resolveCustomisationState,
  resolveCustomisationStates,
  resolveMemoryState,
  customisationsLaunchLine,
  memoryLaunchLine,
  customisationRunRecord,
  customisationCallRecord,
} from "./customisations/index.ts";
export type {
  CustomisationState,
  CustomisationSwitchValue,
  CustomisationCapture,
  CustomisationProfile,
  CustomisationsInput,
  CustomisationRecordEntry,
  MemoryRecord,
  CustomisationRunRecord,
} from "./customisations/index.ts";
export {
  criticMemoryRefusal,
  criticCustomisationRefusal,
  criticClassRecord,
  MEMORY_NOT_OFF,
  CRITIC_MEMORY_TYPED_FAILURE,
} from "./customisations/critic.ts";
export type {
  CriticMemoryInput,
  CriticMemoryRefusal,
  CriticClassRecord,
  MemoryNotOffReason,
  CriticMemoryTypedFailure,
} from "./customisations/critic.ts";
export { dshSecretEnvironment } from "./environment/index.ts";
export type { DshSecretResolver, DshSecretCallEnvironment } from "./environment/index.ts";
