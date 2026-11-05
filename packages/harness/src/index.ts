/**
 * The public entry of `@specstride/harness`.
 *
 * Owners of the package: feature 109 (this feature: registry, port, generic
 * harness adapter, containment, overlay, critic forms, versions, conformance
 * support), feature 124, feature 126 and feature 146. The entry exports only
 * what its owners have built — and nothing at all of features 124 and 126.
 * `test/index/surface.test.ts` pins that surface.
 */
import {
  CONTAINMENT_PROVENANCE,
  CONTAINMENT_OPT_IN_KEY,
  OPT_IN_SOURCES,
  ContainmentRefusedError,
  c0OptedIn,
  containmentCeiling,
  defaultLevel,
  protectionOf,
  resolveRunLevel,
} from "./containment/levels.ts";
import {
  AS_IS_SANDBOX_NOTE,
  SANDBOX_ASSERTION_VARIABLE,
  asIsSandboxAssertion,
} from "./containment/as-is.ts";
import {
  CREDENTIAL_WORDS,
  DECLARATION_FIELDS,
  DECLARATION_KEY_PATTERN,
  DECLARATION_VAR_PATTERN,
  RESERVED_NAMES,
  RESERVED_PREFIXES,
  SEED_FIELDS,
  declarationTable,
  looksLikeCredential,
  seedPathEscapes,
  validateDeclaration,
} from "./overlay/declaration.ts";
import {
  AUTH_TIERS,
  TIER_ONE_SWITCHES_OFF,
  credentialsNeverCopied,
  homePolicy,
} from "./overlay/policy.ts";
import {
  CONFIGURED_SCOPES,
  SCOPE_NONE,
  invalidScopeMessage,
  noOverlayWarning,
  resolveScopes,
  scopeVariableOf,
  startup,
} from "./overlay/scope.ts";
import {
  BASE_DIRECTORY_VARIABLES,
  GENERAL_IDENTITY_KEYS,
  GIT_CONFIG_GLOBAL_FILE,
  GIT_CONFIG_GLOBAL_VARIABLE,
  IDENTITY_VARIABLES,
  buildOverlay,
  populateFailureMessage,
  readEnvironmentRecord,
  resolveGitIdentity,
} from "./overlay/build.ts";
import {
  ENVIRONMENT_NEVER_REACHES,
  ENVIRONMENT_REACHES,
  TERMINATE_GRACE_MS,
  acquireOverlay,
  endOfInvocation,
  environmentMayReach,
  overlayPlanForPass,
  reapAfterPass,
  releaseOverlay,
} from "./overlay/lifecycle.ts";
import {
  OVERLAY_OPERATIONS,
  PASS_LOOP_CODES,
  operationPopulate,
  operationReap,
  operationRemove,
  operationScope,
  operationStartup,
  operationSweep,
  passLoopExitCode,
  signalExitCode,
} from "./overlay/operations.ts";
import {
  MARKER_FILE,
  OVERLAY_MARKER_CONTRACT,
  OVERLAY_TMP_PREFIX,
  isOverlayTree,
  lives,
  overlayRoots,
  processExists,
  processStart,
  readMarker,
  removalWarning,
  removeTree,
  staleLine,
} from "./overlay/sweep.ts";
import { CRITIC_SCOPE_WORD, withCriticOverlay } from "./overlay/critic.ts";
import {
  HARNESS_DOCTOR_CHECK_KINDS,
  evidenceOf,
  findingOf,
  harnessDoctorCheckId,
  harnessDoctorCheckIds,
  harnessDoctorChecks,
  registerHarnessDoctorChecks,
  runHarnessDoctorChecks,
} from "./doctor/checks.ts";
import {
  VERIFICATION_DIR,
  VERIFICATION_FIELDS,
  VERIFICATION_SCHEMA_ID,
  VERIFY_EXIT_FAILED,
  VERIFY_EXIT_OK,
  VERIFY_EXIT_USAGE,
  VerifyUsageError,
  descriptorHashOf,
  parseBudget,
  readVerification,
  runHarnessVerify,
  storeVerification,
  validateVerificationRecord,
  verificationHolds,
  verificationPath,
} from "./verify/verify.ts";
import {
  INSTALL_ACTIONS,
  OUTSIDE_RANGE_WARNING,
  VERSION_CHANGE_WARNING,
  VERSION_RANGE_FIELD,
  VERIFIED_ON_FIELD,
  checkVersionStability,
  isTestedVersioned,
  outsideRangeWarning,
  parseVersion,
  recordCallVersion,
  recordVersion,
  versionChangeWarning,
  versionDoctorWarning,
  versionInRange,
  versionRangeOf,
  verifiedOnOf,
} from "./versions/versions.ts";
import type { HarnessDoctorCheckKind, HarnessDoctorFacts } from "./doctor/checks.ts";
import type {
  VerificationCase,
  VerificationField,
  VerifyBudget,
  VerifyOptions,
  VerifyOutcome,
  HarnessVerificationRecord,
  SuiteRun,
} from "./verify/verify.ts";
import type { ParsedVersion, RecordedCallVersion } from "./versions/versions.ts";
import {
  CAPABILITY_LEVELS,
  COMPLETION_CAPABILITIES,
  LEVEL_CAPABILITY_IDS,
  PROPOSER_CAPABILITIES,
  checkRegistration,
} from "./registry/levels.ts";
import {
  TESTED_ORIGIN,
  UNVERIFIED_ALLOWED_PROVENANCE,
  UNVERIFIED_ALLOWED_TIERS,
  checkAuthTiers,
  isTestedHarnessAdapter,
  unverifiedRules,
} from "./registry/unverified.ts";
import {
  ACCEPTED_DESCRIPTOR_VERSIONS,
  KNOWN_TOP_LEVEL_KEYS,
  PLACEHOLDERS,
  SOURCE_PRECEDENCE,
  loadDescriptors,
  placeholderOutsideClosedSet,
  validateDescriptor,
} from "./descriptor/loader.ts";
import {
  ACCEPTED_SOURCES,
  PROJECT_CONFIG_KEYS_IGNORED,
  collectDescriptors,
} from "./descriptor/sources.ts";
import {
  BETWEEN_PASSES_OUTCOMES,
  PORT_OPERATIONS,
  TYPED_FAILURES,
  callOperation,
  createHarnessPort,
} from "./port/port.ts";
import {
  CAPABILITY_NAMES,
  CAPABILITY_PROVENANCE,
  buildCapabilityMap,
  sessionDirectiveFor,
} from "./port/capabilities.ts";
import {
  BETWEEN_PASSES_OUTCOMES as STOP_OUTCOMES,
  STOP_MODES,
  betweenPasses,
  resultCodeOf,
  startInOwnGroup,
  stopProcess,
} from "./port/stop.ts";
import { BASE_ALLOW_LIST, allowListOf, buildCallEnvironment } from "./environment/allow-list.ts";
import {
  NOT_SERVED,
  QUALIFIER_FORMS,
  REGISTRY_ROLES,
  RegistryUnreadableError,
  createRegistry,
  parityEntries,
  readRegistry,
  servingRole,
  type EntryRole,
  type HarnessRegistry,
  type OverlayDeclaration,
  type QualifierForm,
  type RegistryEntry,
  type RegistryRole,
} from "./registry/registry.ts";
import {
  UNREADABLE_COMPAT_LINE,
  UNREADABLE_DEFAULT_LINE,
  compatibilityHelpLine,
  display,
  helpLine,
  spelling,
} from "./registry/display.ts";
import {
  isRegistryRole,
  queryInvocationModel,
  queryNames,
  queryStream,
} from "./registry/queries.ts";
import {
  MODEL_QUALIFIER_LABEL,
  RAW_TEXT,
  invocationModel,
  overlayOrDefault,
  streamOrDefault,
} from "./registry/invocation-model.ts";
import { resolveReference } from "./registry/resolve.ts";
import {
  BUILTIN_CODES,
  TEXT_RULES,
  UNKNOWN_FAILURE,
  classify,
  readFailuresMap,
} from "./failures/classify.ts";
import {
  CRITIC_TIMEOUT_ALIAS,
  CRITIC_TIMEOUT_DEFAULT_SECONDS,
  CRITIC_TIMEOUT_KEY,
  CriticCallError,
  CriticTransportError,
  criticCall,
  criticTimeoutSeconds,
} from "./critic-call/call.ts";
import {
  DEFAULT_TRANSPORT,
  TRANSPORTS,
  availableTransports,
  chooseTransport,
  defaultTransportBinding,
  doctorLineFor,
  transportAvailable,
} from "./transports/transports.ts";
import {
  EXECUTABLE_NOT_FOUND_CODE,
  resolveExecutable,
  searchDirsFromPath,
} from "./executable/resolve.ts";
import {
  applyTelemetrySwitch,
  reconcileTelemetryFlags,
  telemetrySwitch,
} from "./generic/switches.ts";
import { memoryDecision } from "./generic/memory.ts";
import {
  DEFAULT_PROMPT_LIMIT_BYTES,
  buildCliInvocation,
  cleanupCliInvocation,
  materialiseFirstFormDirectory,
  readRecordedCalls,
  runCliInvocation,
  writeCliFiles,
} from "./generic/cli.ts";
import {
  defaultModelOf,
  endpointOf,
  providerOf,
  completeOpenaiChat,
} from "./generic/openai-chat.ts";
import { completeAnthropicMessages } from "./generic/anthropic-messages.ts";
import { handOverStream, refuseDescriptorStream, streamOf } from "./generic/stream-handover.ts";
import { isLoopbackAddress, LOOPBACK_NAMES } from "./generic/loopback.ts";
import {
  MAX_MODEL_LIST_MS,
  guardAddress,
  guardCredentialHost,
  guardRedirect,
  guardSecretOutOfArguments,
  listModels,
} from "./endpoint/guard.ts";
import {
  BUNDLED_DESCRIPTORS_DIR,
  bundledLogicalName,
  loadBundledDescriptors,
  textIsMachineSpecific,
} from "./descriptor/bundled.ts";
import {
  ALL_TOOLS_FLAGS,
  COMPLETION_FORMS,
  CRITIC_CONFIG_STOP_REASON,
  CRITIC_NOT_TOOLLESS,
  ENGINE_EXIT_CODE_OF_CRITIC_CONFIG,
  FIRST_FORM,
  SECOND_FORM,
  admitForm,
  fixFormBeforeCall,
  formNeedsTestedAdapter,
  isAllToolsFlag,
  isCompletionForm,
  knownContextWindow,
} from "./proof/forms.ts";
import {
  INITIAL_RECORD_PROOF,
  PINNED_CONFIGURATION_PROOF,
  mintSessionId,
  proveFirstForm,
  readAcceptedReply,
} from "./proof/first-form.ts";
import {
  READ_ONLY_SANDBOX_MODE,
  SANDBOX_MODES,
  WITHHELD_LOCATIONS,
  ActJournal,
  confirmationIsComplete,
  proveSecondForm,
  refuseAct,
} from "./proof/second-form.ts";
import {
  CONTAINMENT_LEVELS,
  PROOF_KINDS,
  PROOF_RESULTS,
  containmentLevelsForRun,
  recordOfFirstForm,
  recordOfSecondForm,
} from "./proof/record.ts";

export {
  // registry: capability levels (T008)
  CAPABILITY_LEVELS,
  COMPLETION_CAPABILITIES,
  LEVEL_CAPABILITY_IDS,
  PROPOSER_CAPABILITIES,
  checkRegistration,
  // registry: unverified harness (T015)
  TESTED_ORIGIN,
  UNVERIFIED_ALLOWED_PROVENANCE,
  UNVERIFIED_ALLOWED_TIERS,
  checkAuthTiers,
  isTestedHarnessAdapter,
  unverifiedRules,
  // descriptor: loader (T011)
  ACCEPTED_DESCRIPTOR_VERSIONS,
  KNOWN_TOP_LEVEL_KEYS,
  PLACEHOLDERS,
  SOURCE_PRECEDENCE,
  loadDescriptors,
  placeholderOutsideClosedSet,
  validateDescriptor,
  // descriptor: sources (T013)
  ACCEPTED_SOURCES,
  PROJECT_CONFIG_KEYS_IGNORED,
  collectDescriptors,
  // port: the core side (T017)
  BETWEEN_PASSES_OUTCOMES,
  PORT_OPERATIONS,
  TYPED_FAILURES,
  callOperation,
  createHarnessPort,
  // port: capability map (T019)
  CAPABILITY_NAMES,
  CAPABILITY_PROVENANCE,
  buildCapabilityMap,
  sessionDirectiveFor,
  // port: stop and betweenPasses (T023)
  STOP_MODES,
  STOP_OUTCOMES,
  betweenPasses,
  resultCodeOf,
  startInOwnGroup,
  stopProcess,
  // environment: the allow-list (T021)
  BASE_ALLOW_LIST,
  allowListOf,
  buildCallEnvironment,
  // registry: the one registry (T025)
  NOT_SERVED,
  QUALIFIER_FORMS,
  REGISTRY_ROLES,
  RegistryUnreadableError,
  createRegistry,
  parityEntries,
  readRegistry,
  servingRole,
  // registry: display (T029)
  UNREADABLE_COMPAT_LINE,
  UNREADABLE_DEFAULT_LINE,
  compatibilityHelpLine,
  display,
  helpLine,
  spelling,
  // registry: the three queries (T027)
  isRegistryRole,
  queryInvocationModel,
  queryNames,
  queryStream,
  // registry: defaults and the invocation model (T031)
  MODEL_QUALIFIER_LABEL,
  RAW_TEXT,
  invocationModel,
  overlayOrDefault,
  streamOrDefault,
  // registry: resolution of a harness reference (T033)
  resolveReference,
  // failures: classify (T036)
  BUILTIN_CODES,
  TEXT_RULES,
  UNKNOWN_FAILURE,
  classify,
  readFailuresMap,
  // critic-class call (T039)
  CRITIC_TIMEOUT_ALIAS,
  CRITIC_TIMEOUT_DEFAULT_SECONDS,
  CRITIC_TIMEOUT_KEY,
  CriticCallError,
  CriticTransportError,
  criticCall,
  criticTimeoutSeconds,
  // transports (T041)
  DEFAULT_TRANSPORT,
  TRANSPORTS,
  availableTransports,
  chooseTransport,
  defaultTransportBinding,
  doctorLineFor,
  transportAvailable,
  // executable resolution (T043)
  EXECUTABLE_NOT_FOUND_CODE,
  resolveExecutable,
  searchDirsFromPath,
  // generic adapter: the telemetry switch (T055)
  applyTelemetrySwitch,
  reconcileTelemetryFlags,
  telemetrySwitch,
  // generic adapter: the memory switch and its record (T057)
  memoryDecision,
  // generic adapter: the kind `cli` (T045)
  DEFAULT_PROMPT_LIMIT_BYTES,
  buildCliInvocation,
  cleanupCliInvocation,
  materialiseFirstFormDirectory,
  readRecordedCalls,
  runCliInvocation,
  writeCliFiles,
  // generic adapter: the two completion clients (T049)
  defaultModelOf,
  endpointOf,
  providerOf,
  completeOpenaiChat,
  completeAnthropicMessages,
  // generic adapter: the stream hand-over (T053)
  handOverStream,
  refuseDescriptorStream,
  streamOf,
  // generic adapter: loopback (T051 support)
  isLoopbackAddress,
  LOOPBACK_NAMES,
  // endpoint guard (T051)
  MAX_MODEL_LIST_MS,
  guardAddress,
  guardCredentialHost,
  guardRedirect,
  guardSecretOutOfArguments,
  listModels,
  // descriptor: the bundled descriptors (T059)
  BUNDLED_DESCRIPTORS_DIR,
  bundledLogicalName,
  loadBundledDescriptors,
  textIsMachineSpecific,
  // proof: the forms and their admission (T063)
  ALL_TOOLS_FLAGS,
  COMPLETION_FORMS,
  CRITIC_CONFIG_STOP_REASON,
  CRITIC_NOT_TOOLLESS,
  ENGINE_EXIT_CODE_OF_CRITIC_CONFIG,
  FIRST_FORM,
  SECOND_FORM,
  admitForm,
  fixFormBeforeCall,
  formNeedsTestedAdapter,
  isAllToolsFlag,
  isCompletionForm,
  knownContextWindow,
  // proof: the first form (T065)
  INITIAL_RECORD_PROOF,
  PINNED_CONFIGURATION_PROOF,
  mintSessionId,
  proveFirstForm,
  readAcceptedReply,
  // proof: the second form (T067)
  READ_ONLY_SANDBOX_MODE,
  SANDBOX_MODES,
  WITHHELD_LOCATIONS,
  ActJournal,
  confirmationIsComplete,
  proveSecondForm,
  refuseAct,
  // proof: the record of the proof (T069)
  CONTAINMENT_LEVELS,
  PROOF_KINDS,
  PROOF_RESULTS,
  containmentLevelsForRun,
  recordOfFirstForm,
  recordOfSecondForm,
  // containment: levels and ceilings (T073)
  CONTAINMENT_OPT_IN_KEY,
  CONTAINMENT_PROVENANCE,
  OPT_IN_SOURCES,
  ContainmentRefusedError,
  c0OptedIn,
  containmentCeiling,
  defaultLevel,
  protectionOf,
  resolveRunLevel,
  // containment: the as-is sandbox assertion (T075)
  AS_IS_SANDBOX_NOTE,
  SANDBOX_ASSERTION_VARIABLE,
  asIsSandboxAssertion,
  // overlay: the declaration (T079)
  CREDENTIAL_WORDS,
  DECLARATION_FIELDS,
  DECLARATION_KEY_PATTERN,
  DECLARATION_VAR_PATTERN,
  RESERVED_NAMES,
  RESERVED_PREFIXES,
  SEED_FIELDS,
  declarationTable,
  looksLikeCredential,
  seedPathEscapes,
  validateDeclaration,
  // overlay: the policy per auth tier (T077)
  AUTH_TIERS,
  TIER_ONE_SWITCHES_OFF,
  credentialsNeverCopied,
  homePolicy,
  // overlay: the scope and the start-up (T081)
  CONFIGURED_SCOPES,
  SCOPE_NONE,
  invalidScopeMessage,
  noOverlayWarning,
  resolveScopes,
  scopeVariableOf,
  startup,
  // overlay: the build (T083)
  BASE_DIRECTORY_VARIABLES,
  GENERAL_IDENTITY_KEYS,
  GIT_CONFIG_GLOBAL_FILE,
  GIT_CONFIG_GLOBAL_VARIABLE,
  IDENTITY_VARIABLES,
  buildOverlay,
  populateFailureMessage,
  readEnvironmentRecord,
  resolveGitIdentity,
  // overlay: the lifecycle (T085)
  ENVIRONMENT_NEVER_REACHES,
  ENVIRONMENT_REACHES,
  TERMINATE_GRACE_MS,
  acquireOverlay,
  endOfInvocation,
  environmentMayReach,
  overlayPlanForPass,
  reapAfterPass,
  releaseOverlay,
  // overlay: the operations (T087)
  OVERLAY_OPERATIONS,
  PASS_LOOP_CODES,
  operationPopulate,
  operationReap,
  operationRemove,
  operationScope,
  operationStartup,
  operationSweep,
  passLoopExitCode,
  signalExitCode,
  // overlay: sweep and reap (T089)
  MARKER_FILE,
  OVERLAY_MARKER_CONTRACT,
  OVERLAY_TMP_PREFIX,
  isOverlayTree,
  lives,
  overlayRoots,
  processExists,
  processStart,
  readMarker,
  removalWarning,
  removeTree,
  staleLine,
  // overlay: the critic-class call (T091)
  CRITIC_SCOPE_WORD,
  withCriticOverlay,
  // doctor: the three checks per harness (T096)
  HARNESS_DOCTOR_CHECK_KINDS,
  evidenceOf,
  findingOf,
  harnessDoctorCheckId,
  harnessDoctorCheckIds,
  harnessDoctorChecks,
  registerHarnessDoctorChecks,
  runHarnessDoctorChecks,
  // verify: the command `harness verify` (T098)
  VERIFICATION_DIR,
  VERIFICATION_FIELDS,
  VERIFICATION_SCHEMA_ID,
  VERIFY_EXIT_FAILED,
  VERIFY_EXIT_OK,
  VERIFY_EXIT_USAGE,
  VerifyUsageError,
  descriptorHashOf,
  parseBudget,
  readVerification,
  runHarnessVerify,
  storeVerification,
  validateVerificationRecord,
  verificationHolds,
  verificationPath,
  // versions: the range, the date and the purity of the record (T100)
  INSTALL_ACTIONS,
  OUTSIDE_RANGE_WARNING,
  VERSION_CHANGE_WARNING,
  VERSION_RANGE_FIELD,
  VERIFIED_ON_FIELD,
  checkVersionStability,
  isTestedVersioned,
  outsideRangeWarning,
  parseVersion,
  recordCallVersion,
  recordVersion,
  versionChangeWarning,
  versionDoctorWarning,
  versionInRange,
  versionRangeOf,
  verifiedOnOf,
};
export {};
export type {
  EntryRole,
  HarnessRegistry,
  OverlayDeclaration,
  QualifierForm,
  RegistryEntry,
  RegistryRole,
  HarnessDoctorCheckKind,
  HarnessDoctorFacts,
  VerificationField,
  VerificationCase,
  HarnessVerificationRecord,
  VerifyBudget,
  VerifyOptions,
  VerifyOutcome,
  SuiteRun,
  ParsedVersion,
  RecordedCallVersion,
};
