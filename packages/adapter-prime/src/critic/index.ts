/**
 * The critic-class call of the prime adapter (User Story 4): the argument
 * builder (`./argv.ts`), the announcement (`./announce.ts`), the JSON-mode
 * critic (`./json-mode.ts`), the proof of the form (`./proof.ts`) and the
 * context window statement (`./window.ts`).
 */
export {
  CRITIC_COMPONENT,
  EMPTY_VARIANT_ERROR,
  buildCriticInvocation,
  criticFailureReport,
  type CriticCallOptions,
  type CriticFailureKind,
  type CriticFailureReport,
  type CriticInvocation,
  type CriticRefusal,
} from "./argv.ts";
export {
  CRITIC_CAPTURE_ENV,
  CRITIC_SIGNALS,
  captureSwitchIsTrue,
  criticAnnouncement,
  criticAnnouncementFromEnv,
  criticAnnouncesForHarness,
} from "./announce.ts";
export {
  criticJsonResult,
  errorDiagnosticCodes,
  visibleTextReply,
  type CriticJsonResult,
  type CriticObservation,
  type CriticVerdict,
} from "./json-mode.ts";
export {
  CRITIC_ENGINE_EXIT,
  CRITIC_NOT_TOOLLESS,
  CRITIC_STOP_REASON,
  carriesAllowAllToolsFlag,
  carriesResumeFlag,
  proofOfForm,
  streamHasToolRecord,
  type CriticHalt,
  type CriticProof,
  type CriticProofInput,
  type ProofVerdict,
} from "./proof.ts";
export {
  PARITY_CATALOGUE_WINDOW,
  contextWindowStatement,
  refuseUnknownWindow,
  windowQualifies,
  type ContextWindowStatement,
  type WindowInput,
  type WindowSource,
} from "./window.ts";
