/**
 * The public surface of the `contracts` package: the single source of every
 * interface that two or more features share (feature 100, plan.md).
 *
 * Phase 1 left this file empty; Phase 3 fills it, because T257 requires the
 * map of the closed sets to be re-exported from here.
 */

// Annex X §X.6 — the closed sets, assembled and asserted at load (T070, T250
// to T257).
export * from "./enums/all-sets.ts";
export {
  type ClosedSet,
  type ClosedSetRow,
  type UnknownValueKind,
  type UnknownValueOutcome,
  type UnknownValueRule,
  closedSetRows,
  loadClosedSetRows,
  defineClosedSet,
  defineByReference,
  unknownValueRuleOf,
  readMember,
  registeredSets,
  firstOwnerNumber,
  ALL_SET_NUMBERS,
  UNKNOWN_VALUE_KINDS,
  NoUnknownBranchError,
  ClosedSetRegistrationError,
} from "./enums/index.ts";

// Annex B §B.1, §B.2, §B.3, §B.5 — the roots, the layout rules, the
// identifiers and the resolver of logical names (T021, T244, T026, T245, T034).
export * from "./ids/roots.ts";
export * from "./ids/identifiers.ts";
export * from "./ids/attempt-names.ts";

// Annex B §B.4 — the common rules of records (T028, T246).
export {
  readRecord,
  tryReadRecord,
  RecordRefusedError,
  refusalMessage,
  majorOf,
  schemaIdOfLogicalName,
} from "./records/validate.ts";
export * from "./records/rules.ts";
export * from "./records/state-archive.ts";

// Annex X §X.5 — the interface of the canonical hasher (T068).
export * from "./ep/hasher.ts";

// Annex A §A.4 — the interface through which the engine calls finalization
// (T302, F100-FR-237). No extension point in Wave 1.
export * from "./engine/finalization.ts";

// Annex A §A.4 — the common rules of every extension point (T096 reads them
// in the frame of the test kit; the types live here).
export * from "./ep/extension-point.ts";

// Annex C, D, E, F, G, H — the interface types of the nineteen extension
// points (T099, T102, T106, T109, T112, T115, T118, T121, T124, T127, T129,
// T132, T135, T138, T141, T144, T147, T150, T153, T157). Each module is a
// namespace of its own, because the points share the names `OPERATIONS`,
// `POINT_ID`, `FAILURE_PATHS` and so on.
export * as epHarness from "./ep/harness.ts";
export * as epSpecFormat from "./ep/spec-format.ts";
export * as epCheckRunner from "./ep/check-runner.ts";
export * as epVerificationSource from "./ep/verification-source.ts";
export * as epEventSink from "./ep/event-sink.ts";
export * as epSecretResolver from "./ep/secret-resolver.ts";
export * as epTerms from "./ep/terms.ts";
export * as epQuotaClassifier from "./ep/quota-classifier.ts";
export * as epToolchain from "./ep/toolchain.ts";
export * as epLoopLayer from "./ep/loop-layer.ts";
export * as epTreeStore from "./ep/tree-store.ts";
export * as epRouterRules from "./ep/router-rules.ts";
export * as epPromptBlock from "./ep/prompt-block.ts";
export * as epCriticStrategy from "./ep/critic-strategy.ts";
export * as epLock from "./ep/lock.ts";
export * as epDetach from "./ep/detach.ts";
export * as epStageKind from "./ep/stage-kind.ts";
export * as epView from "./ep/view.ts";
export * as epDoctor from "./ep/doctor.ts";
export * as epHost from "./ep/host.ts";

// Annex C §C.7 and annex G §G.7 — the two record types of this phase (T103,
// T154).
export * as canonicalSpecModel from "./records/canonical-spec-model.ts";
export * as doctorFindings from "./records/doctor-findings.ts";

// Annex C §C.3 and §C.15 — the two forms of the `completion` level and the
// containment levels as data (T162, T170). Namespaces of their own: both hold
// `ANNEX_SECTION` and `CLOSED_SET_ROW`.
export * as completionForms from "./enums/completion-forms.ts";
export * as containment from "./enums/containment.ts";

// Annex C §C.2, §C.4, §C.5, §C.6 and §C.16 — the five record types of user
// story 4 (T160, T164, T166, T168, T172). Namespaces of their own, because
// every record module holds `SCHEMA_ID`, `ANNEX_SECTION` and `LOGICAL_NAME`.
export * as harnessDescriptor from "./records/harness-descriptor.ts";
export * as withheldPaths from "./records/withheld-paths.ts";
export * as streamDialectRow from "./records/stream-dialect-row.ts";
export * as resolvedRegistry from "./records/resolved-registry.ts";
export * as overlay from "./records/overlay.ts";

// Annex D §D.3, §D.6 to §D.8 and annex G §G.8 — the five record types of user
// story 5 (T174, T176, T178, T180, T196). Namespaces of their own, because
// every record module holds `SCHEMA_ID`, `ANNEX_SECTION` and `LOGICAL_NAME`.
export * as parallelPlan from "./records/parallel-plan.ts";
export * as yieldArtifact from "./records/yield-artifact.ts";
export * as factBlock from "./records/fact-block.ts";
export * as checkManifest from "./records/check-manifest.ts";
export * as launchContract from "./records/launch-contract.ts";

// Annex F §F.1, §F.2, §F.4 — the process model, the two kinds of run request
// and the owner of relaunch (T182, T184, T186).
export * as processModel from "./state/process-model.ts";
export * as runRequests from "./state/run-requests.ts";
export * as relaunchOwner from "./state/relaunch-owner.ts";

// Annex G §G.1 to §G.3, §G.9 — the CLI protocol, the flags, the output modes,
// the line grammar with the digest and the line keys, and the judgment
// exchange (T188, T281, T190, T192, T282, T283, T198). Namespaces of their
// own: every module holds `ANNEX_SECTION`, and several hold `CLOSED_SET_ROW`.
export * as protocol from "./grammar/protocol.ts";
export * as flags from "./grammar/flags.ts";
export * as outputModes from "./grammar/output-modes.ts";
export * as lines from "./grammar/lines.ts";
export * as digest from "./grammar/digest.ts";
export * as lineKeys from "./grammar/line-keys.ts";
export * as judgment from "./grammar/judgment.ts";

// Annex X §X.4 — the interface of the redactor and the validator of its
// pattern set (T200). The redactor itself belongs to feature 111.
export * as redactor from "./ep/redactor.ts";

// Annex B §B.20 and §B.5 — the further schema ids and the sixteen logical names
// the amendments after the fan-out added (T212, T295).
export * as furtherSchemaIds from "./ids/further-schema-ids.ts";
export * as logicalNamesAmendments from "./ids/logical-names-amendments.ts";

// Annex C §C.3 — the proof of a critic-class call and the rule for the context
// window of a critic (T216). A namespace of its own: it holds `ANNEX_SECTION`
// and `CLOSED_SET_ROW`, as `completionForms` does.
export * as criticProof from "./enums/critic-proof.ts";

// Annex C §C.8 and annex G §G.10 — the reuse of a staged command and the
// interface of the presenter (T218, T220).
export * as epCheckRunnerPrestage from "./ep/check-runner-prestage.ts";
export * as epPresenter from "./ep/presenter.ts";

// Annex A §A.3 and §A.4 — the kernel services the core receives as arguments
// and the calls of the engine into learning (T222). No extension point in
// Wave 1; the types are exported by name, as the finalization interface is.
export * from "./ep/kernel-services.ts";

// Feature 149, data-model.md — the two values of EP-18 that no record carries:
// the plan of the next phase attempt and the outcome of one critic call, each
// with its guard (T004). A namespace of its own, as every EP module is.
export * as ep18Values from "./ep/ep18-values.ts";

// Feature 101, data-model.md — the five records of the phase gate (T002), the
// three closed sets of the phase gate (T003) and the table of halts with its
// validation at load (T004). Namespaces of their own: every record module holds
// `SCHEMA_ID`, `ANNEX_SECTION` and `LOGICAL_NAME`, and `gate` holds
// `ANNEX_SECTION`.
export * as attemptRecord from "./records/attempt-record.ts";
export * as verdictRecord from "./records/verdict-record.ts";
export * as recoveryMarkers from "./records/recovery-markers.ts";
export * as approvalKey from "./records/approval-key.ts";
export * as acceleratorSnapshot from "./records/accelerator-snapshot.ts";
export * as gate from "./enums/gate.ts";
export * as gateHalts from "./engine/gate-halts.ts";

// Feature 115, plan.md — the interfaces of the two ports of the micro-loop
// layer: the claim reader of a checkpoint and the tripwire store (T003).
// Interface only; the implementations are the edge package's (feature 116).
export * from "./ports/layer-micro.ts";
