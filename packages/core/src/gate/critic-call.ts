/**
 * T040 of feature 101 — the critic call (F101-FR-009, F101-FR-010,
 * F101-FR-011).
 *
 * The engine makes EVERY critic call through the operation `judge` of the
 * critic strategy of feature 100 annex E §E.1, with the call function the
 * engine hands to it (`../ep18/critic-strategy.ts`, `judgePhaseGate`). The
 * strategy receives the input of the phase gate and that call function and
 * NOTHING else — no nonce, no session minter, no harness port — so every
 * guarantee of the seam rests on the core and not on the strategy.
 *
 * This module is the engine's side of one call:
 *
 * | What | Requirement |
 * |---|---|
 * | the nine inputs of a call | F101-FR-009 |
 * | the role `critic`, the as-is pass ordinal 0, the invocation identity and its record | F101-FR-009 |
 * | the time limit, 300 seconds by default, which also bounds the diagnostician | F101-FR-009 |
 * | the result record, with the five codes of the table "Critic call" of §E.4 | F101-FR-009 |
 * | which failures are a configuration error and which are MALFORMED | F101-FR-010 |
 * | the missing credential of the critic, under the switch | F101-FR-010 |
 * | that the KIND of a verdict is read from the verdict record and never from the result code | F101-FR-011 |
 */
import type { Verdict } from "@specstride/contracts/ep/critic-strategy";
import {
  criticResultOf,
  type CriticCallResultRecord,
} from "@specstride/contracts/codes/result-records";
import type { MalformedDetail } from "@specstride/contracts/enums/gate";
import {
  judgePhaseGate,
  type JudgeDependencies,
  type PhaseGateJudgment,
} from "../ep18/critic-strategy.ts";
import {
  CLASS_WHEN_UNKNOWN,
  CLASSES as QUOTA_CLASSES,
  CONFIDENCE_WHEN_UNKNOWN,
  POINT_ID as QUOTA_CLASSIFIER_ID,
  type Classification,
  type ClassifyInput,
  type QuotaClass,
  type QuotaClassifier,
} from "@specstride/contracts/ep/quota-classifier";
import {
  blockedEvent,
  blockedReasonRow,
  type BlockedEvent,
} from "@specstride/contracts/state/blocked-reasons";

/** F101-FR-009 — the operation of the seam every critic call goes through. */
export const OPERATION = "judge" as const;

/** The point of the seam (annex E §E.1). */
export const POINT_ID = "specstride.critic-strategy/1" as const;

/** F101-FR-009 — the time limit of a critic-class call, in seconds. */
export const TIME_LIMIT_DEFAULT_SECONDS = 300 as const;

/** F101-FR-009 — the same limit bounds a call of the diagnostician. */
export const THE_TIME_LIMIT_BOUNDS_THE_DIAGNOSTICIAN = true as const;

/** F101-FR-009 — the role of the call. */
export const ROLE = "critic" as const;

/** F101-FR-009 — the as-is value for the ordinal of the pass of a critic call. */
export const PASS_ORDINAL_OF_A_CRITIC_CALL = 0 as const;

/** F101-FR-009 — the critic is not a command of the CLI. */
export const THE_CRITIC_IS_A_COMMAND_OF_THE_CLI = false as const;

/** F101-FR-009 — the ordinal and the reject limit are for records only. */
export const USED_FOR_RECORDS_ONLY = Object.freeze(["ordinal", "rejectLimit"]);

/**
 * F101-FR-009 — none of the role, the pass ordinal, the invocation identity or
 * the invocation record reaches the environment of a LATER pass.
 */
export const REACHES_THE_ENVIRONMENT_OF_A_LATER_PASS = false as const;

/**
 * F101-FR-009 — the nine inputs of a critic call, in the order of the
 * requirement. The list is data so that the test of T027 can read it.
 */
export const INPUTS_OF_A_CRITIC_CALL = Object.freeze([
  "workdir",
  "phase",
  "ordinal",
  "rejectLimit",
  "critic",
  "timeLimitSeconds",
  "specFormat",
  "featureSlug",
  "verificationPlan",
]);

/** The nine inputs themselves (F101-FR-009; B-0321, B-0322). */
export type CriticCallInputs = {
  /** The working directory as an ABSOLUTE path (B-0794). */
  readonly workdir: string;
  readonly phase: number;
  /** The ordinal of the phase attempt; for records only (B-0797). */
  readonly ordinal: number;
  /** The reject limit; for records only, echoed in the event (B-0798). */
  readonly rejectLimit: number;
  /** The critic of the role plan (B-0799). */
  readonly critic: string;
  /** The time limit of the call, in seconds (B-0800). */
  readonly timeLimitSeconds: number;
  readonly specFormat: string;
  readonly featureSlug: string;
  /** The verification plan where one exists; absent in mode `off` (B-0322). */
  readonly verificationPlan?: string | undefined;
};

/** The inputs with the defaults of F101-FR-009 applied. */
export function criticCallInputs(
  given: Omit<CriticCallInputs, "timeLimitSeconds"> & {
    readonly timeLimitSeconds?: number | undefined;
  },
): CriticCallInputs {
  return Object.freeze({
    ...given,
    timeLimitSeconds: given.timeLimitSeconds ?? TIME_LIMIT_DEFAULT_SECONDS,
  });
}

/** The invocation identity of a call, as its four parts (F101-FR-009). */
export type InvocationIdentity = {
  readonly runId: string;
  readonly role: typeof ROLE;
  readonly phase: number;
  /** The ordinal of the PHASE ATTEMPT, not of the pass. */
  readonly ordinal: number;
  /** The four parts in the as-is form of B-0315. */
  readonly id: string;
};

/**
 * F101-FR-009 — the invocation identity in the as-is form: the baseline builds
 * it as `<run-id>-<role>-phase-<N>-attempt-<M>` (B-0315), and a critic-class
 * call carries the role `critic`.
 */
export function invocationIdentity(inputs: {
  readonly runId: string;
  readonly phase: number;
  readonly ordinal: number;
}): InvocationIdentity {
  return Object.freeze({
    runId: inputs.runId,
    role: ROLE,
    phase: inputs.phase,
    ordinal: inputs.ordinal,
    id: `${inputs.runId}-${ROLE}-phase-${inputs.phase}-attempt-${inputs.ordinal}`,
  });
}

/** The invocation record of the call (`attempt:<N>:<k>:<n>:critic-invocation`). */
export const INVOCATION_RECORD_LOGICAL_NAME = "attempt:<N>:<k>:<n>:critic-invocation" as const;

/* ------------------------------------------------------------------ *
 * F101-FR-009 — the result record of a critic call (§E.4, "Critic call").
 * ------------------------------------------------------------------ */

/** The five codes of the table, by what they mean for the engine. */
export const RESULT_CODES = Object.freeze({
  approved: 0,
  error: 1,
  usage: 2,
  configError: 3,
  rejectedOrMalformed: 10,
});

/** F101-FR-011 — 10 stands for REJECTED and for MALFORMED alike. */
export const ONE_CODE_FOR_REJECTED_AND_MALFORMED = RESULT_CODES.rejectedOrMalformed;

/**
 * The result record of one critic call. The `result` is the member of the
 * column `result` of §E.4 for the code, which `criticResultOf` reads from the
 * annex table, so the two cannot drift.
 */
export function resultRecordOfTheVerdict(verdict: Verdict): CriticCallResultRecord {
  const exit_code =
    verdict === "APPROVED" ? RESULT_CODES.approved : RESULT_CODES.rejectedOrMalformed;
  const results = criticResultOf(exit_code) ?? [];
  const result =
    verdict === "APPROVED"
      ? (results[0] ?? "approved")
      : verdict === "REJECTED"
        ? (results[0] ?? "rejected")
        : (results[1] ?? "malformed");
  return Object.freeze({ exit_code, result });
}

/** The result record of a configuration error of the critic (F101-FR-010). */
export function resultRecordOfAConfigError(): CriticCallResultRecord {
  return Object.freeze({
    exit_code: RESULT_CODES.configError,
    result: criticResultOf(RESULT_CODES.configError)?.[0] ?? "config_error",
  });
}

/**
 * F101-FR-011 — the KIND of a verdict is taken from the verdict record and
 * NEVER from the result code, which is 10 for REJECTED and MALFORMED alike.
 * This function is the only way the engine reads it.
 */
export function verdictOfTheRecord(record: { readonly verdict: Verdict }): Verdict {
  return record.verdict;
}

/** F101-FR-011 — the result code never tells REJECTED from MALFORMED. */
export function theResultCodeTellsTheKind(code: number): boolean {
  return code !== RESULT_CODES.rejectedOrMalformed;
}

/* ------------------------------------------------------------------ *
 * F101-FR-010 — what halts the run and what is scored MALFORMED.
 * ------------------------------------------------------------------ */

/**
 * F101-FR-010 — the configuration errors of the critic. Every one of them is
 * found BEFORE the call is made, which is what makes it a halt and not a
 * rejection (B-0861 to B-0865).
 */
export const CONFIG_ERRORS = Object.freeze([
  "missing-specification",
  "invalid-format",
  "phase-not-found",
  "invalid-verification-plan",
  "missing-phase-evidence",
  "critic_not_toolless",
]);
export type CriticConfigError = (typeof CONFIG_ERRORS)[number];

/** True when the failure is one of the configuration errors of F101-FR-010. */
export function isAConfigError(failure: string): failure is CriticConfigError {
  return CONFIG_ERRORS.includes(failure);
}

/** F101-FR-010 — a configuration error halts the run with this code and reason. */
export const CONFIG_ERROR_EXIT_CODE = 3 as const;
export const CONFIG_ERROR_STOP_REASON = "critic_config" as const;

/** F101-FR-010 — and no count changes on that halt. */
export const A_CONFIG_ERROR_CHANGES_A_COUNT = false as const;

/**
 * F101-FR-010 — every OTHER failure of a critic call is scored MALFORMED with
 * the detail `call-failed`, which rejects the phase attempt: a transport
 * error, a time-out, a crash, a result outside the result set, an error raised
 * inside the call.
 */
export const FAILURES_SCORED_MALFORMED = Object.freeze([
  "transport-error",
  "time-out",
  "crash",
  "result-outside-the-result-set",
  "error-raised-inside-the-call",
]);

/** The detail such a failure carries. */
export const DETAIL_OF_A_FAILED_CALL: MalformedDetail = "call-failed";

/** The key of the switch that rules a missing credential of the critic. */
export const MISSING_CREDENTIAL_SWITCH_ROW = "a missing credential of the critic" as const;

/**
 * F101-FR-010 — the missing credential of the critic.
 *
 * With the switch ON, which is the DEFAULT, the engine finds it before the
 * call through `preflight` of the harness port, which makes no paid call, and
 * halts with exit 3 and `critic_config`; the message names the credential BY
 * THE NAME OF ITS VARIABLE OR KEY and never by a value.
 *
 * With the switch OFF, which is its value under the `parity` profile, the
 * missing credential is a FAILED CALL as at the baseline: every phase attempt
 * is scored MALFORMED and the run ends at the MALFORMED limit with exit 1 and
 * the stop reason `critic_unavailable` (CQ-187).
 */
export function missingCredentialOutcome(switchIsOn: boolean): {
  readonly halts: boolean;
  readonly exitCode?: number;
  readonly stopReason?: string;
  readonly scoredAs?: Verdict;
  readonly detail?: MalformedDetail;
} {
  return switchIsOn
    ? Object.freeze({
        halts: true,
        exitCode: CONFIG_ERROR_EXIT_CODE,
        stopReason: CONFIG_ERROR_STOP_REASON,
      })
    : Object.freeze({
        halts: false,
        scoredAs: "MALFORMED" as Verdict,
        detail: DETAIL_OF_A_FAILED_CALL,
      });
}

/** The message of a missing credential: the NAME of the variable, never a value. */
export function missingCredentialMessage(variableOrKey: string): string {
  return `the credential of the critic is not set: ${variableOrKey}`;
}

/**
 * F101-FR-010 — where the quota classifier gives a failure a quota class, the
 * rules of the quota pause apply and NOTHING is scored.
 */
export const A_QUOTA_CLASS_SCORES_NOTHING = true as const;

/* ------------------------------------------------------------------ *
 * The call itself.
 * ------------------------------------------------------------------ */

/** A configuration error found before the call: the call is never made. */
export type CriticCallHalt = {
  readonly halted: true;
  /** A configuration error of F101-FR-010, or a missing credential (T111). */
  readonly failure: CriticConfigError | "missing-credential";
  readonly message: string;
  readonly result: CriticCallResultRecord;
  readonly exitCode: typeof CONFIG_ERROR_EXIT_CODE;
  readonly stopReason: typeof CONFIG_ERROR_STOP_REASON;
};

/** A call that was made, with the judgment of the seam. */
export type CriticCallMade = {
  readonly halted: false;
  readonly judgment: PhaseGateJudgment;
  readonly verdict: Verdict;
  readonly result: CriticCallResultRecord;
  readonly invocation: InvocationIdentity;
  readonly inputs: CriticCallInputs;
};

/**
 * F101-FR-041 — a failed call that the quota classifier classes as
 * `quota_credit` or as `auth`: the run rests BLOCKED on the consumer and
 * nothing is scored (T069, below).
 */
export type CriticCallBlocked = {
  readonly halted: false;
  readonly blocked: true;
  /**
   * What the classifier said, where a failed CALL was classified. Absent for a
   * blocked path that is no failed call: the source that changed, which is
   * found when the critic STARTS under the `parity` profile.
   */
  readonly failed?: (FailedCallOutcome & { readonly outcome: "blocked" }) | undefined;
  /** The end of the blocked path: the reason, the stop reason, the exit code. */
  readonly path: BlockedPathOutcome;
  /** Nothing is scored: there is no verdict and no count changes. */
  readonly verdict: undefined;
};

export type CriticCallOutcomeOfTheEngine = CriticCallHalt | CriticCallMade | CriticCallBlocked;

/** True where the critic call halted the run before it was made. */
export function halted(outcome: CriticCallOutcomeOfTheEngine): outcome is CriticCallHalt {
  return outcome.halted;
}

/** True where the call failed in a way that leaves the run blocked on a human. */
export function blocked(outcome: CriticCallOutcomeOfTheEngine): outcome is CriticCallBlocked {
  return outcome.halted === false && (outcome as CriticCallBlocked).blocked === true;
}

/** What `callTheCritic` needs besides the nine inputs. */
export type CriticCallDependenciesOfTheEngine = {
  readonly judge: JudgeDependencies;
  readonly runId: string;
  /**
   * The configuration errors found BEFORE the call, in the order of
   * F101-FR-010. The caller finds them — the specification, the format, the
   * phase, the plan, the phase evidence and the proof of the form are its
   * inputs — and hands over the first one found, or `undefined`.
   */
  readonly configErrorFoundBeforeTheCall?: CriticConfigError | undefined;
  /** The message of that error; it names a logical name, never a value. */
  readonly configErrorMessage?: string | undefined;
  /** The seam, so a test can hand in its own. */
  readonly judgePhaseGate?: typeof judgePhaseGate;
  /**
   * T111 — the check of the credential of the critic before the call. Given,
   * and with its switch on, `preflight` of the harness port is asked about the
   * role `critic` BEFORE the call and a missing credential halts with exit 3
   * and `critic_config` (F101-FR-010). Absent, or with the switch off, nothing
   * is checked: the missing credential fails inside the call and is scored
   * MALFORMED, which is its behaviour under the `parity` profile.
   */
  readonly credential?:
    | {
        readonly switchIsOn: boolean;
        /** The name of the variable or key; the message names it, never a value. */
        readonly variableOrKey: string;
        readonly harness: CriticPreflightPort;
      }
    | undefined;
  /**
   * T069 — the quota classifier of EP-12. Given, a call that FAILED is
   * classified through it, and a failure classed `quota_credit` or `auth`
   * leaves the run blocked instead of scoring the phase attempt
   * (F101-FR-010, F101-FR-041).
   */
  readonly quota?:
    | {
        readonly classifier: Pick<QuotaClassifier, "classify">;
        /** What the harness adapter saw, for `classify`. */
        readonly seen?: ((failure: string) => ClassifyInput) | undefined;
        /** What the run needs of the consumer, for the event `blocked`. */
        readonly needs?: string | undefined;
      }
    | undefined;
};

/**
 * F101-FR-009 to F101-FR-011 — make one critic call.
 *
 * A configuration error found before the call halts the run and the call is
 * never made. Otherwise the call goes through `judge` of the seam, exactly
 * once per phase gate, and the verdict comes from the VERDICT RECORD the seam
 * returns and never from the result code.
 */
export async function callTheCritic(
  inputs: CriticCallInputs,
  deps: CriticCallDependenciesOfTheEngine,
): Promise<CriticCallOutcomeOfTheEngine> {
  if (deps.configErrorFoundBeforeTheCall !== undefined) {
    return Object.freeze({
      halted: true as const,
      failure: deps.configErrorFoundBeforeTheCall,
      message: deps.configErrorMessage ?? deps.configErrorFoundBeforeTheCall,
      result: resultRecordOfAConfigError(),
      exitCode: CONFIG_ERROR_EXIT_CODE,
      stopReason: CONFIG_ERROR_STOP_REASON,
    });
  }

  // T111 — the credential of the critic, BEFORE the call, behind the switch.
  if (deps.credential !== undefined) {
    const credential = await checkTheCredentialOfTheCritic(
      {
        switchIsOn: deps.credential.switchIsOn,
        variableOrKey: deps.credential.variableOrKey,
      },
      { harness: deps.credential.harness },
    );
    if (credential.checked && !credential.present) {
      return Object.freeze({
        halted: true as const,
        failure: credential.failure,
        message: credential.message,
        result: credential.result,
        exitCode: credential.exitCode,
        stopReason: credential.stopReason,
      });
    }
  }

  const judge = deps.judgePhaseGate ?? judgePhaseGate;
  const judgment = await judge(deps.judge.gate, deps.judge);

  // T069 — a call that FAILED is classified through the quota classifier; a
  // failure classed `quota_credit` or `auth` blocks and is never scored. A
  // failure is either the STRATEGY's (it threw) or a CALL's: a transport
  // error, which the call function records on the call it failed on.
  const failureOfTheCall =
    judgment.failure ??
    judgment.calls.find((call) => call.transportError !== undefined)?.transportError;
  if (failureOfTheCall !== undefined && deps.quota !== undefined) {
    const failed = classifyAFailedCriticCall(
      deps.quota.seen?.(failureOfTheCall) ?? { errorText: failureOfTheCall },
      deps.quota.classifier,
      ...(deps.quota.needs === undefined ? [] : ([deps.quota.needs] as const)),
    );
    if (failed.outcome === "blocked") {
      return Object.freeze({
        halted: false as const,
        blocked: true as const,
        failed,
        path: blockedPath(failed.reason, failed.needs),
        verdict: undefined,
      });
    }
  }

  const verdict = verdictOfTheRecord(judgment.record);
  return Object.freeze({
    halted: false as const,
    judgment,
    verdict,
    result: resultRecordOfTheVerdict(verdict),
    invocation: invocationIdentity({
      runId: deps.runId,
      phase: inputs.phase,
      ordinal: inputs.ordinal,
    }),
    inputs,
  });
}

/* ==================================================================== *
 * T111 — F101-FR-010: the check of the CREDENTIAL of the critic before
 * the call, behind the switch.
 *
 * With the switch ON, which is the default, the engine finds a missing
 * credential BEFORE the call, through the operation `preflight` of the
 * harness port (annex C §C.1), which makes no paid call, and halts with
 * exit 3 and `critic_config`. With the switch OFF, which is its value
 * under the `parity` profile, nothing is checked before the call: the
 * missing credential fails INSIDE the call and is scored MALFORMED with
 * the detail `call-failed`, as the baseline does (CQ-187).
 *
 * The engine READS NO CREDENTIAL. It asks `preflight` whether one is
 * present and is told yes or no; the value never enters the core, and the
 * message of the halt names the VARIABLE OR KEY and never a value.
 *
 * This check at the phase gate is the LAST LINE: the preflight of every
 * role at launch, which finds a missing credential before the first pass,
 * belongs to feature 124.
 * ==================================================================== */

/** F101-FR-010 — the operation of the harness port the check goes through. */
export const PREFLIGHT_OPERATION = "preflight" as const;

/** F101-FR-010 — `preflight` makes a paid call. */
export const PREFLIGHT_MAKES_A_PAID_CALL = false as const;

/** F101-FR-010 — the engine reads a credential. */
export const THE_ENGINE_READS_A_CREDENTIAL = false as const;

/** F101-FR-010 — the switch is on by DEFAULT. */
export const CREDENTIAL_SWITCH_DEFAULT = true as const;

/** F101-FR-010 — the profile under which the switch is off (CQ-187). */
export const PROFILE_THAT_SWITCHES_IT_OFF = "parity" as const;

/** F101-FR-010 — the feature that owns the preflight of every role at launch. */
export const PREFLIGHT_AT_LAUNCH_BELONGS_TO = "124" as const;

/** F101-FR-010 — whether the check before the call is on, by profile. */
export function theCredentialSwitchIsOn(profile?: string | undefined): boolean {
  return profile === PROFILE_THAT_SWITCHES_IT_OFF ? false : CREDENTIAL_SWITCH_DEFAULT;
}

/** The result of `preflight`, as this module reads it (annex C §C.1). */
export type PreflightOfTheCritic = {
  readonly credentialPresent: boolean;
  readonly refused: boolean;
  readonly reason?: string | undefined;
};

/** The one operation of the harness port the check calls. */
export type CriticPreflightPort = {
  /** `preflight` of the harness port; it makes no paid call (annex C §C.1). */
  preflight(role: string): Promise<PreflightOfTheCritic>;
};

/** The failure of a missing credential, as this module names it. */
export const MISSING_CREDENTIAL = "missing-credential" as const;

/** Every failure that is found BEFORE the call and halts with exit 3. */
export const FAILURES_FOUND_BEFORE_THE_CALL = Object.freeze([...CONFIG_ERRORS, MISSING_CREDENTIAL]);

/** What the check of the credential reports back. */
export type CredentialCheckOutcome =
  | { readonly checked: false; readonly because: "the switch is off" }
  | { readonly checked: true; readonly present: true }
  | {
      readonly checked: true;
      readonly present: false;
      readonly failure: typeof MISSING_CREDENTIAL;
      /** The name of the variable or key, never a value. */
      readonly variableOrKey: string;
      readonly message: string;
      readonly exitCode: typeof CONFIG_ERROR_EXIT_CODE;
      readonly stopReason: typeof CONFIG_ERROR_STOP_REASON;
      readonly result: CriticCallResultRecord;
    };

/**
 * F101-FR-010 — check the credential of the critic before the call.
 *
 * With the switch off nothing is asked and nothing is checked, and the
 * function says so: the missing credential then fails inside the call and is
 * scored MALFORMED. With the switch on, `preflight` of the harness port is
 * asked about the role `critic`; a refusal or a thrown error counts as a
 * credential that is not present, because the safe failure of a check that
 * cannot answer is to stop before a paid call and not to make one.
 */
export async function checkTheCredentialOfTheCritic(
  inputs: {
    /** Whether the switch is on; `theCredentialSwitchIsOn` gives it. */
    readonly switchIsOn: boolean;
    /** The name of the variable or key the message names, never a value. */
    readonly variableOrKey: string;
    /** The role `preflight` is asked about. */
    readonly role?: string | undefined;
  },
  deps: { readonly harness: CriticPreflightPort },
): Promise<CredentialCheckOutcome> {
  if (!inputs.switchIsOn) {
    return Object.freeze({ checked: false as const, because: "the switch is off" as const });
  }
  let result: PreflightOfTheCritic;
  try {
    result = await deps.harness.preflight(inputs.role ?? ROLE);
  } catch {
    result = { credentialPresent: false, refused: true, reason: "preflight failed" };
  }
  if (result.credentialPresent && !result.refused) {
    return Object.freeze({ checked: true as const, present: true as const });
  }
  return Object.freeze({
    checked: true as const,
    present: false as const,
    failure: MISSING_CREDENTIAL,
    variableOrKey: inputs.variableOrKey,
    message: missingCredentialMessage(inputs.variableOrKey),
    exitCode: CONFIG_ERROR_EXIT_CODE,
    stopReason: CONFIG_ERROR_STOP_REASON,
    result: resultRecordOfAConfigError(),
  });
}

/**
 * F101-FR-010 — a halt by a missing credential changes NO count, exactly as a
 * configuration error does: it is found before the call, so no phase attempt
 * was judged.
 */
export const A_MISSING_CREDENTIAL_CHANGES_A_COUNT = A_CONFIG_ERROR_CHANGES_A_COUNT;

/* ==================================================================== *
 * T069 — F101-FR-010 and F101-FR-041: the classification of a failed
 * critic-class call through the QUOTA CLASSIFIER port (EP-12), and the
 * BLOCKED PATHS of the phase gate.
 *
 * A failed critic-class call is not one thing. The quota classifier of
 * EP-12 says which it is, and the answer decides what the engine does:
 *
 * | What the classifier says | What the engine does |
 * |---|---|
 * | `quota_credit`, `auth` | the run rests BLOCKED on the consumer, with the blocked reason of §E.2; nothing is scored |
 * | another quota class | the rules of the quota pause apply; nothing is scored |
 * | anything else | the phase attempt is scored MALFORMED with the detail `call-failed` |
 *
 * The third row is the ordinary path of F101-FR-010; the first two are why
 * the engine may not simply score every failure. Nothing of this module
 * classifies for itself: the classifier is a port, and a classifier that
 * fails gives `provider_other` by its own failure path, which lands in the
 * third row — the safe failure of a classifier is to let the phase
 * attempt be rejected, never to let the run wait forever.
 * ==================================================================== */

/** The point of the quota classifier (annex C §C.13). */
export const QUOTA_CLASSIFIER_POINT_ID = QUOTA_CLASSIFIER_ID;

/**
 * F101-FR-041 — the blocked reasons a path of THE PHASE GATE may end with, of
 * the closed set of feature 100 annex E §E.2. The phase gate has three and no
 * fourth: a source that changed, found when the critic starts under the
 * `parity` profile, and a failed critic-class call that the classifier classes
 * as `quota_credit` or as `auth`.
 */
export const BLOCKED_REASONS_OF_THE_PHASE_GATE = [
  "source-changed",
  "quota-credit",
  "auth",
] as const;
export type BlockedReasonOfThePhaseGate = (typeof BLOCKED_REASONS_OF_THE_PHASE_GATE)[number];

/** F101-FR-041 — when the source hash is compared: as the critic starts, under `parity`. */
export const SOURCE_CHANGED_IS_FOUND = "when the critic starts under the `parity` profile" as const;

/** F101-FR-041 — the event `blocked` projects to nothing. */
export const THE_EVENT_BLOCKED_PROJECTS_TO_AN_AS_IS_EVENT = false as const;

/** The quota classes that make the run rest blocked on the consumer (§C.13). */
export const QUOTA_CLASSES_THAT_BLOCK_THE_PHASE_GATE: readonly QuotaClass[] = Object.freeze([
  "quota_credit",
  "auth",
]);

/** The blocked reason of a quota class, where that class blocks the phase gate. */
export function blockedReasonOfAQuotaClass(
  quotaClass: QuotaClass,
): BlockedReasonOfThePhaseGate | undefined {
  if (quotaClass === "quota_credit") return "quota-credit";
  if (quotaClass === "auth") return "auth";
  return undefined;
}

/**
 * The quota classes for which the rules of the QUOTA PAUSE apply and nothing
 * is scored (F101-FR-010, last sentence). `budget_cap` blocks on a human too,
 * but its blocked reason belongs to the feature that owns the budget and not
 * to the phase gate, so from here it is a pause and never a halt of this
 * feature.
 */
export const QUOTA_CLASSES_THAT_PAUSE: readonly QuotaClass[] = Object.freeze([
  "quota_window",
  "rate_limit_transient",
  "overload",
  "budget_cap",
]);

/** The classes for which the phase attempt IS scored MALFORMED (F101-FR-010). */
export const QUOTA_CLASSES_THAT_ARE_SCORED: readonly QuotaClass[] = Object.freeze(
  QUOTA_CLASSES.filter(
    (c) =>
      !QUOTA_CLASSES_THAT_BLOCK_THE_PHASE_GATE.includes(c) && !QUOTA_CLASSES_THAT_PAUSE.includes(c),
  ),
);

/** F101-FR-010 — where the classifier gives a quota class, nothing is scored. */
export const A_QUOTA_CLASS_IS_SCORED = false as const;

/** What the classification of a failed critic-class call ends in. */
export type FailedCallOutcome =
  | {
      readonly outcome: "blocked";
      readonly classification: Classification;
      /** The blocked reason, of the closed set of §E.2. */
      readonly reason: BlockedReasonOfThePhaseGate;
      /** What the run needs of the consumer, for the event `blocked`. */
      readonly needs: string;
      /** Nothing is scored on this path (F101-FR-010). */
      readonly scored: false;
    }
  | {
      readonly outcome: "quota-pause";
      readonly classification: Classification;
      readonly scored: false;
    }
  | {
      readonly outcome: "scored";
      readonly classification: Classification;
      readonly scored: true;
      readonly verdict: Verdict;
      readonly detail: MalformedDetail;
    };

/**
 * F101-FR-010 and F101-FR-041 — classify ONE failed critic-class call through
 * the quota classifier port, and say what the engine does with it.
 *
 * A classifier that throws is read as its own failure path gives it
 * (`provider_other`), which is scored: a broken classifier may never turn a
 * rejection into a wait.
 */
export function classifyAFailedCriticCall(
  seen: ClassifyInput,
  classifier: Pick<QuotaClassifier, "classify">,
  needs = "a person must restore the access of the critic before the run can go on",
): FailedCallOutcome {
  let classification: Classification;
  try {
    classification = classifier.classify(seen);
  } catch {
    classification = Object.freeze({
      quotaClass: CLASS_WHEN_UNKNOWN,
      confidence: CONFIDENCE_WHEN_UNKNOWN,
      resetsAt: null,
      retryable: true,
    });
  }
  const reason = blockedReasonOfAQuotaClass(classification.quotaClass);
  if (reason !== undefined) {
    return Object.freeze({
      outcome: "blocked" as const,
      classification,
      reason,
      needs,
      scored: false as const,
    });
  }
  if (QUOTA_CLASSES_THAT_PAUSE.includes(classification.quotaClass)) {
    return Object.freeze({
      outcome: "quota-pause" as const,
      classification,
      scored: false as const,
    });
  }
  return Object.freeze({
    outcome: "scored" as const,
    classification,
    scored: true as const,
    verdict: "MALFORMED" as Verdict,
    detail: DETAIL_OF_A_FAILED_CALL,
  });
}

/** What a blocked path of the phase gate ends the run with (annex E §E.2). */
export type BlockedPathOutcome = {
  readonly reason: BlockedReasonOfThePhaseGate;
  readonly needs: string;
  readonly stopReason: string;
  readonly exitCode: number;
  /** A blocked run is never retryable and is never relaunched (F101-FR-041). */
  readonly retryable: false;
  /** The event the run emits; it projects to no as-is event. */
  readonly event: BlockedEvent;
};

/**
 * F101-FR-041 — the end of a blocked path of the phase gate. The stop reason
 * and the exit code come from the TABLE OF BLOCKED REASONS of feature 100
 * (annex E §E.2) and never from this module, which is why the phase gate can
 * add neither.
 */
export function blockedPath(
  reason: BlockedReasonOfThePhaseGate,
  needs: string,
): BlockedPathOutcome {
  const row = blockedReasonRow(reason);
  if (row === undefined) {
    throw new Error(
      `\`${reason}\` is no blocked reason of feature 100, annex E §E.2 (F101-FR-041)`,
    );
  }
  return Object.freeze({
    reason,
    needs,
    stopReason: row.stopReason,
    exitCode: row.engineExit,
    retryable: false as const,
    event: blockedEvent(reason, needs),
  });
}

/**
 * F101-FR-041 — a blocked path of the phase gate that is NO failed call: the
 * source changed, found when the critic STARTS under the `parity` profile.
 * The critic is not called at all on this path, so nothing is scored and no
 * count changes.
 */
export function criticCallBlockedBy(
  reason: BlockedReasonOfThePhaseGate,
  needs: string,
): CriticCallBlocked {
  return Object.freeze({
    halted: false as const,
    blocked: true as const,
    path: blockedPath(reason, needs),
    verdict: undefined,
  });
}
