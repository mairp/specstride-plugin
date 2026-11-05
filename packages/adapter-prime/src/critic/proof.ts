/**
 * The proof of the critic's form and the halt on a tool record (T050;
 * covers F138-FR-021, test CT-138-21 in
 * `tests/characterization/138/critic.test.ts`).
 *
 * Outside the `parity` profile the record of every prime critic-class call
 * holds the proof of its form: the flag set in the call record; in JSON
 * mode, from the initial record, a tool list that is empty and a session id
 * that equals NO session id of any pass of the run (F100-FR-230, case 2),
 * the case being recorded; and that no tool record appears anywhere in the
 * stream. An initial record that states no tool list or no session id is a
 * MISSING proof — the weaker proof is open only to a stream that carries no
 * initial record at all (Principle IX): there the flag set, the version pin
 * and the preflight stand as the weaker proof. A tool record in a critic
 * stream, or a missing proof, is the failure `critic_not_toolless` and halts
 * the run: engine exit 3, stop reason `critic_config`. No critic path ever
 * receives a flag that allows all tools, and a critic call never resumes a
 * session.
 *
 * Under the `parity` profile the call is in text mode and has no stream: no
 * proof is made or checked — the deviation feature 100 records for every
 * harness (F100-FR-230; annex X §X.7 rows 28 and 117).
 */

/** The failure a tool record, a missing proof or a resumed session raises. */
export const CRITIC_NOT_TOOLLESS = "critic_not_toolless";

/** The engine exit a halted run carries. */
export const CRITIC_ENGINE_EXIT = 3;

/** The stop reason a halted run carries. */
export const CRITIC_STOP_REASON = "critic_config";

/** What the proof is checked against, for one critic call. */
export type CriticProofInput = {
  profile: "parity" | "default";
  /** The mode of the call: the full proof is a JSON-mode proof. */
  mode: "text" | "json";
  /** The flag set of the call, as the call record holds it. */
  command: readonly string[];
  /** The initial record of the stream, or null where the stream has none. */
  initialRecord?:
    | {
        toolList?: readonly unknown[] | null | undefined;
        sessionId?: string | null | undefined;
      }
    | null
    | undefined;
  /** Every session id any pass of this run used. */
  passSessionIds?: readonly string[] | undefined;
  /** True where a tool record appears anywhere in the stream. */
  toolRecordInStream?: boolean | undefined;
};

/** A made proof, with the case that produced it. */
export type CriticProof = {
  made: true;
  /** `full` (the initial record proved both facts) or `weaker` (no initial record). */
  strength: "full" | "weaker";
  /** The recorded case: what the proof rests on. */
  case: "empty-tool-list-and-fresh-session" | "no-initial-record-weaker-proof";
  /** The flag set of the call, as the call record holds it. */
  flagSet: readonly string[];
};

/** A halted run: the failure, the engine exit and the stop reason. */
export type CriticHalt = {
  failure: typeof CRITIC_NOT_TOOLLESS;
  engineExit: typeof CRITIC_ENGINE_EXIT;
  stopReason: typeof CRITIC_STOP_REASON;
  /** Why the run halted. */
  reason: string;
};

/** Either a made proof or the halt. */
export type ProofVerdict = CriticProof | CriticHalt;

function halt(reason: string): CriticHalt {
  return {
    failure: CRITIC_NOT_TOOLLESS,
    engineExit: CRITIC_ENGINE_EXIT,
    stopReason: CRITIC_STOP_REASON,
    reason,
  };
}

/** True where the flag set carries a flag that allows all tools. */
export function carriesAllowAllToolsFlag(command: readonly string[]): boolean {
  return command.some((word) => /^--(allow-all-tools|all-tools|dangerously-skip)/.test(word));
}

/** True where the flag set resumes a session — a critic call never does. */
export function carriesResumeFlag(command: readonly string[]): boolean {
  return command.some((word) => word === "-r" || word === "--session-dir" || word === "--resume");
}

/**
 * The proof of the critic's form for one call (F138-FR-021), or the halt
 * that ends the run. Under `parity` no proof is made: the answer is
 * `{ made: false }` and nothing is checked.
 */
export function proofOfForm(input: CriticProofInput): ProofVerdict | { made: false } {
  // Under `parity` there is no stream: no proof is made or checked.
  if (input.profile === "parity") return { made: false };

  // A flag that allows all tools never reaches a critic path.
  if (carriesAllowAllToolsFlag(input.command)) {
    return halt("the critic call carries a flag that allows all tools");
  }
  // A critic call never resumes a session.
  if (carriesResumeFlag(input.command)) {
    return halt("the critic call resumes a session");
  }
  // A tool record anywhere in the stream halts the run.
  if (input.toolRecordInStream === true) {
    return halt("a tool record appears in the stream of the critic call");
  }

  // In JSON mode the initial record proves the tool list and the session id.
  if (input.mode === "json") {
    const initial = input.initialRecord;
    if (initial === null || initial === undefined) {
      // No initial record: the weaker proof of Principle IX — the flag set
      // stands, nothing contradicts it in the stream.
      return {
        made: true,
        strength: "weaker",
        case: "no-initial-record-weaker-proof",
        flagSet: [...input.command],
      };
    }
    if (initial.toolList === null || initial.toolList === undefined) {
      return halt("the initial record states no tool list: a missing proof");
    }
    if (initial.sessionId === null || initial.sessionId === undefined) {
      return halt("the initial record states no session id: a missing proof");
    }
    if (initial.toolList.length > 0) {
      return halt("the initial record states a non-empty tool list");
    }
    const used = input.passSessionIds ?? [];
    if (used.includes(initial.sessionId)) {
      return halt("the session id of the initial record is one a pass of the run used");
    }
    return {
      made: true,
      strength: "full",
      case: "empty-tool-list-and-fresh-session",
      flagSet: [...input.command],
    };
  }

  // Text mode outside `parity` has no stream: the flag set is the proof.
  return {
    made: true,
    strength: "weaker",
    case: "no-initial-record-weaker-proof",
    flagSet: [...input.command],
  };
}

/**
 * Scan the records of a finished stream for a tool record and set the
 * `toolRecordInStream` input of `proofOfForm` (F138-FR-021).
 */
export function streamHasToolRecord(records: readonly { kind: string }[]): boolean {
  return records.some((record) => record.kind === "tool");
}
