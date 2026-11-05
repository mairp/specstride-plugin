/**
 * T002 — the entry of `@specstride/harness` exports nothing of features 124
 * and 126 (F109-FR-001: exactly one registry, owned here; the stream readers
 * of 124 and the stream plumbing of 126 reach the consumer through their own
 * packages, never through this entry).
 *
 * The test reads the entry two ways, so the claim does not rest on one
 * read path:
 *  1. the live module surface: every exported name is on the allow-list of
 *     feature 109, which Phase 1 holds empty;
 *  2. the source text of the entry: it imports no module of the package that
 *     belongs to 124 or 126, and names them only in comments.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as entry from "../../src/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY_SOURCE = readFileSync(join(HERE, "..", "..", "src", "index.ts"), "utf8");

/** The export names feature 109 owns. Phase 2 adds the foundational modules. */
const FEATURE_109_EXPORTS: readonly string[] = [
  // registry: capability levels (T008)
  "CAPABILITY_LEVELS",
  "COMPLETION_CAPABILITIES",
  "LEVEL_CAPABILITY_IDS",
  "PROPOSER_CAPABILITIES",
  "checkRegistration",
  // registry: unverified harness (T015)
  "TESTED_ORIGIN",
  "UNVERIFIED_ALLOWED_PROVENANCE",
  "UNVERIFIED_ALLOWED_TIERS",
  "checkAuthTiers",
  "isTestedHarnessAdapter",
  "unverifiedRules",
  // descriptor: loader (T011)
  "ACCEPTED_DESCRIPTOR_VERSIONS",
  "KNOWN_TOP_LEVEL_KEYS",
  "PLACEHOLDERS",
  "SOURCE_PRECEDENCE",
  "loadDescriptors",
  "placeholderOutsideClosedSet",
  "validateDescriptor",
  // descriptor: sources (T013)
  "ACCEPTED_SOURCES",
  "PROJECT_CONFIG_KEYS_IGNORED",
  "collectDescriptors",
  // port: the core side (T017)
  "BETWEEN_PASSES_OUTCOMES",
  "PORT_OPERATIONS",
  "TYPED_FAILURES",
  "callOperation",
  "createHarnessPort",
  // port: capability map (T019)
  "CAPABILITY_NAMES",
  "CAPABILITY_PROVENANCE",
  "buildCapabilityMap",
  "sessionDirectiveFor",
  // port: stop and betweenPasses (T023)
  "STOP_MODES",
  "STOP_OUTCOMES",
  "betweenPasses",
  "resultCodeOf",
  "startInOwnGroup",
  "stopProcess",
  // environment: the allow-list (T021)
  "BASE_ALLOW_LIST",
  "allowListOf",
  "buildCallEnvironment",
  // registry: the one registry (T025)
  "NOT_SERVED",
  "QUALIFIER_FORMS",
  "REGISTRY_ROLES",
  "RegistryUnreadableError",
  "createRegistry",
  "parityEntries",
  "readRegistry",
  "servingRole",
  // registry: display (T029)
  "UNREADABLE_COMPAT_LINE",
  "UNREADABLE_DEFAULT_LINE",
  "compatibilityHelpLine",
  "display",
  "helpLine",
  "spelling",
  // registry: the three queries (T027)
  "isRegistryRole",
  "queryInvocationModel",
  "queryNames",
  "queryStream",
  // registry: defaults and the invocation model (T031)
  "MODEL_QUALIFIER_LABEL",
  "RAW_TEXT",
  "invocationModel",
  "overlayOrDefault",
  "streamOrDefault",
  // registry: resolution of a harness reference (T033)
  "resolveReference",
  // failures: classify (T036)
  "BUILTIN_CODES",
  "TEXT_RULES",
  "UNKNOWN_FAILURE",
  "classify",
  "readFailuresMap",
  // critic-class call (T039)
  "CRITIC_TIMEOUT_ALIAS",
  "CRITIC_TIMEOUT_DEFAULT_SECONDS",
  "CRITIC_TIMEOUT_KEY",
  "CriticCallError",
  "CriticTransportError",
  "criticCall",
  "criticTimeoutSeconds",
  // transports (T041)
  "DEFAULT_TRANSPORT",
  "TRANSPORTS",
  "availableTransports",
  "chooseTransport",
  "defaultTransportBinding",
  "doctorLineFor",
  "transportAvailable",
  // executable resolution (T043)
  "EXECUTABLE_NOT_FOUND_CODE",
  "resolveExecutable",
  "searchDirsFromPath",
  // generic adapter: telemetry switch (T055)
  "applyTelemetrySwitch",
  "reconcileTelemetryFlags",
  "telemetrySwitch",
  // generic adapter: memory switch (T057)
  "memoryDecision",
  // generic adapter: kind `cli` (T045)
  "DEFAULT_PROMPT_LIMIT_BYTES",
  "buildCliInvocation",
  "cleanupCliInvocation",
  "materialiseFirstFormDirectory",
  "readRecordedCalls",
  "runCliInvocation",
  "writeCliFiles",
  // generic adapter: the two completion clients (T049)
  "defaultModelOf",
  "endpointOf",
  "providerOf",
  "completeOpenaiChat",
  "completeAnthropicMessages",
  // generic adapter: stream hand-over (T053)
  "handOverStream",
  "refuseDescriptorStream",
  "streamOf",
  // generic adapter: loopback
  "isLoopbackAddress",
  "LOOPBACK_NAMES",
  // endpoint guard (T051)
  "MAX_MODEL_LIST_MS",
  "guardAddress",
  "guardCredentialHost",
  "guardRedirect",
  "guardSecretOutOfArguments",
  "listModels",
  // descriptor: bundled descriptors (T059)
  "BUNDLED_DESCRIPTORS_DIR",
  "bundledLogicalName",
  "loadBundledDescriptors",
  "textIsMachineSpecific",
  // proof: the forms and their admission (T063)
  "ALL_TOOLS_FLAGS",
  "COMPLETION_FORMS",
  "CRITIC_CONFIG_STOP_REASON",
  "CRITIC_NOT_TOOLLESS",
  "ENGINE_EXIT_CODE_OF_CRITIC_CONFIG",
  "FIRST_FORM",
  "SECOND_FORM",
  "admitForm",
  "fixFormBeforeCall",
  "formNeedsTestedAdapter",
  "isAllToolsFlag",
  "isCompletionForm",
  "knownContextWindow",
  // proof: the first form (T065)
  "INITIAL_RECORD_PROOF",
  "PINNED_CONFIGURATION_PROOF",
  "mintSessionId",
  "proveFirstForm",
  "readAcceptedReply",
  // proof: the second form (T067)
  "READ_ONLY_SANDBOX_MODE",
  "SANDBOX_MODES",
  "WITHHELD_LOCATIONS",
  "ActJournal",
  "confirmationIsComplete",
  "proveSecondForm",
  "refuseAct",
  // proof: the record of the proof (T069)
  "CONTAINMENT_LEVELS",
  "PROOF_KINDS",
  "PROOF_RESULTS",
  "containmentLevelsForRun",
  "recordOfFirstForm",
  "recordOfSecondForm",
  // containment: levels and ceilings (T073)
  "CONTAINMENT_OPT_IN_KEY",
  "CONTAINMENT_PROVENANCE",
  "OPT_IN_SOURCES",
  "ContainmentRefusedError",
  "c0OptedIn",
  "containmentCeiling",
  "defaultLevel",
  "protectionOf",
  "resolveRunLevel",
  "AS_IS_SANDBOX_NOTE",
  "SANDBOX_ASSERTION_VARIABLE",
  "asIsSandboxAssertion",
  "CREDENTIAL_WORDS",
  "DECLARATION_FIELDS",
  "DECLARATION_KEY_PATTERN",
  "DECLARATION_VAR_PATTERN",
  "RESERVED_NAMES",
  "RESERVED_PREFIXES",
  "SEED_FIELDS",
  "declarationTable",
  "looksLikeCredential",
  "seedPathEscapes",
  "validateDeclaration",
  "AUTH_TIERS",
  "TIER_ONE_SWITCHES_OFF",
  "credentialsNeverCopied",
  "homePolicy",
  "CONFIGURED_SCOPES",
  "SCOPE_NONE",
  "invalidScopeMessage",
  "noOverlayWarning",
  "resolveScopes",
  "scopeVariableOf",
  "startup",
  "BASE_DIRECTORY_VARIABLES",
  "GENERAL_IDENTITY_KEYS",
  "GIT_CONFIG_GLOBAL_FILE",
  "GIT_CONFIG_GLOBAL_VARIABLE",
  "IDENTITY_VARIABLES",
  "buildOverlay",
  "populateFailureMessage",
  "readEnvironmentRecord",
  "resolveGitIdentity",
  "ENVIRONMENT_NEVER_REACHES",
  "ENVIRONMENT_REACHES",
  "TERMINATE_GRACE_MS",
  "acquireOverlay",
  "endOfInvocation",
  "environmentMayReach",
  "overlayPlanForPass",
  "reapAfterPass",
  "releaseOverlay",
  "OVERLAY_OPERATIONS",
  "PASS_LOOP_CODES",
  "operationPopulate",
  "operationReap",
  "operationRemove",
  "operationScope",
  "operationStartup",
  "operationSweep",
  "passLoopExitCode",
  "signalExitCode",
  "MARKER_FILE",
  "OVERLAY_MARKER_CONTRACT",
  "OVERLAY_TMP_PREFIX",
  "isOverlayTree",
  "lives",
  "overlayRoots",
  "processExists",
  "processStart",
  "readMarker",
  "removalWarning",
  "removeTree",
  "staleLine",
  "CRITIC_SCOPE_WORD",
  "withCriticOverlay",
  // doctor: the three checks per harness (T096)
  "HARNESS_DOCTOR_CHECK_KINDS",
  "evidenceOf",
  "findingOf",
  "harnessDoctorCheckId",
  "harnessDoctorCheckIds",
  "harnessDoctorChecks",
  "registerHarnessDoctorChecks",
  "runHarnessDoctorChecks",
  // verify: the command `harness verify` (T098)
  "VERIFICATION_DIR",
  "VERIFICATION_FIELDS",
  "VERIFICATION_SCHEMA_ID",
  "VERIFY_EXIT_FAILED",
  "VERIFY_EXIT_OK",
  "VERIFY_EXIT_USAGE",
  "VerifyUsageError",
  "descriptorHashOf",
  "parseBudget",
  "readVerification",
  "runHarnessVerify",
  "storeVerification",
  "validateVerificationRecord",
  "verificationHolds",
  "verificationPath",
  // versions: the range, the date and the purity of the record (T100)
  "INSTALL_ACTIONS",
  "OUTSIDE_RANGE_WARNING",
  "VERSION_CHANGE_WARNING",
  "VERSION_RANGE_FIELD",
  "VERIFIED_ON_FIELD",
  "checkVersionStability",
  "isTestedVersioned",
  "outsideRangeWarning",
  "parseVersion",
  "recordCallVersion",
  "recordVersion",
  "versionChangeWarning",
  "versionDoctorWarning",
  "versionInRange",
  "versionRangeOf",
  "verifiedOnOf",
].sort();

test("T002: the live module surface of @specstride/harness exports only feature 109 names", () => {
  const exported = Object.keys(entry).sort();
  for (const name of exported) {
    assert.ok(
      FEATURE_109_EXPORTS.includes(name),
      `the entry exports "${name}", which feature 109 does not own`,
    );
  }
  assert.deepEqual(
    exported,
    FEATURE_109_EXPORTS,
    "Phase 1 pins an empty surface; extend FEATURE_109_EXPORTS when a 109 module lands",
  );
});

test("T002: the entry source imports no module of features 124 and 126", () => {
  // Every `import` of the entry must stay inside this package. An export of
  // 124 or 126 could only arrive through one.
  for (const match of ENTRY_SOURCE.matchAll(/from\s+["']([^"']+)["']/g)) {
    const specifier = match[1];
    assert.ok(
      specifier.startsWith(".") || specifier.startsWith("@specstride/harness"),
      `the entry imports "${specifier}", which is not inside the package`,
    );
  }
  // The import statement list of the entry is empty of product modules.
  assert.match(
    ENTRY_SOURCE,
    /export\s*\{\s*\};/,
    "the entry no longer ends in the bare `export {};` of Phase 1; re-check that what it now exports is owned by 109",
  );
  // Nothing re-exports another owner's surface by name.
  assert.doesNotMatch(ENTRY_SOURCE, /export\s+\*?\s*from/);
});

test("T002: the plan.md directories of the package exist", () => {
  const pkgRoot = resolve(HERE, "..", "..");
  const srcDirs = [
    "containment",
    "critic-call",
    "descriptor",
    "doctor",
    "endpoint",
    "environment",
    "executable",
    "failures",
    "generic",
    "overlay",
    "port",
    "proof",
    "registry",
    "transports",
    "verify",
    "versions",
  ];
  const testDirs = [
    "budget",
    "containment/levels",
    "descriptor/bundled",
    "descriptor/sources",
    "descriptor/validate",
    "doctor/checks",
    "endpoint/safety",
    "environment/allow-list",
    "failures/classify",
    "failures/lisa-classify",
    "generic/cli",
    "generic/endpoints",
    "generic/lisa-clients",
    "generic/lisa-no-tools",
    "generic/memory",
    "generic/stream-handover",
    "generic/telemetry-off",
    "perf/baseline",
    "port/capabilities",
    "port/operations",
    "port/stop",
    "proof/first-form",
    "proof/forms",
    "proof/record",
    "proof/second-form",
    "registry/levels",
    "registry/lisa-registration",
    "registry/unverified",
    "transports/transports",
    "verify/verify",
    "versions/versions",
  ];
  for (const dir of [
    ...srcDirs.map((d) => join("src", d)),
    ...testDirs.map((d) => join("test", d)),
  ]) {
    assert.ok(
      existsSync(join(pkgRoot, dir)),
      `the plan.md directory ${dir} of the package is missing`,
    );
  }
});
