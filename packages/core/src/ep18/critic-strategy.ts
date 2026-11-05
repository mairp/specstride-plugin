/**
 * T006 — the registry of critic strategies of EP-18
 * (`specstride.critic-strategy/1`; F149-FR-001, F100-FR-016).
 *
 * The registry is FILLED AT PROCESS START and READ-ONLY AFTER LAUNCH: a
 * first-party module registers its strategy at load, the launch seals the
 * registry, and every registration offered afterwards is refused with the
 * reason `after-launch`. Nothing is removed and nothing is replaced, so what a
 * run resolved stays readable for the whole run.
 *
 * EP-18 is the one internal seam (F100-FR-020), so Wave 1 accepts the
 * implementation classes `data` and `first-party` and refuses `third-party`,
 * exactly as the registry of the conformance frame does.
 *
 * The seam itself follows below: T009 is the call function the engine hands to
 * a strategy, T010 the strategy with one critic together with the comparison of
 * the model of a call with the models that produced passes.
 */
import {
  CLASSES_ACCEPTED_IN_WAVE_1,
  EXTENSION_POINT_ID_FORM,
  IMPLEMENTATION_CLASSES,
  INTERNAL_SEAM_POINT,
  standingOf,
  type ExtensionPointStanding,
  type ImplementationClass,
} from "@specstride/contracts/ep/extension-point";
import { createHash, randomBytes } from "node:crypto";
import {
  CRITIC_STRATEGY_ID,
  DIVERSITY_RESULTS_THAT_WARN,
  EP,
  NONCE_BITS,
  TRANSPORT_ERROR_IS_SCORED_AS,
  VERDICTS,
  VERDICT_WHEN_UNKNOWN,
  WARNING_NAME,
  type CriticStrategy,
  type GateInput,
  type Verdict,
  type VerdictRecord,
} from "@specstride/contracts/ep/critic-strategy";
import {
  FIRST_FORM,
  SECOND_FORM,
  FIRST_FORM_FACTS,
  SECOND_FORM_FACTS,
  WEAKER_PROOF_FACTS,
  WEAKER_SESSION_PROOF_CASE,
  FAILURE_WHEN_THE_PROOF_IS_MISSING,
  callIsRefused,
  proofRequiredFor,
  type CompletionForm,
  type CriticProofResult,
  type ProofKind,
  type SessionProofCase,
} from "@specstride/contracts/enums/completion-forms";
import {
  judgeProof,
  type CriticProofKind,
  type CriticProvenance,
  type SessionProof,
} from "@specstride/contracts/enums/critic-proof";
import { resultsOfTheDiversityTest } from "@specstride/contracts/enums/all-sets";
import { isCriticCallOutcome, type CriticCallOutcome } from "@specstride/contracts/ep/ep18-values";

/** The point this registry belongs to. */
export const POINT_ID = CRITIC_STRATEGY_ID;
/** EP-18, the one internal seam (F100-FR-020). */
export const POINT = EP;
/** The standing of the point: `internal-seam`. */
export const STANDING: ExtensionPointStanding = standingOf(INTERNAL_SEAM_POINT);
/** The operation of this seam (annex E §E.1). */
export const OPERATION = "judge" as const;

/** What a first-party module gives when it registers a strategy. */
export type CriticStrategyRegistration = {
  /** The id of the implementation; `single` is the one of Wave 1. */
  readonly id: string;
  /** The id of the point; anything else is refused. */
  readonly pointId: string;
  /** The class, from the closed set of row 83 of annex X §X.6. */
  readonly implementationClass: ImplementationClass;
  /**
   * The strategy itself, with its operation `judge`. A strategy of this product
   * takes the call function of T009 (`EngineCriticCall`), which hands it an
   * outcome that carries no nonce (research.md D3); the type of feature 100 is
   * accepted as well, so that a strategy written against annex E §E.1 directly
   * registers unchanged.
   */
  readonly strategy: CriticStrategy | EngineCriticStrategy;
};

/** A registered strategy, as the registry holds it. */
export type RegisteredCriticStrategy = CriticStrategyRegistration & {
  /** The position of the registration, from 1, in the order of registration. */
  readonly ordinal: number;
};

/** The reasons the registry refuses a registration. */
export const REFUSAL_REASONS = [
  "after-launch",
  "twice",
  "unknown-point",
  "unknown-class",
  "third-party-class",
  "no-operation",
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/** A registration the rules of the point refuse. */
export class CriticStrategyRegistrationError extends Error {
  readonly id: string;
  readonly reason: RefusalReason;
  constructor(id: string, reason: RefusalReason, message: string) {
    super(message);
    this.name = "CriticStrategyRegistrationError";
    this.id = id;
    this.reason = reason;
  }
}

const REGISTRY = new Map<string, RegisteredCriticStrategy>();
let sealed = false;

/** F100-FR-016 — the launch seals the registry; it is read-only from then on. */
export function sealCriticStrategies(): void {
  sealed = true;
}

/** True once the launch has sealed the registry. */
export function criticStrategiesAreSealed(): boolean {
  return sealed;
}

/**
 * Empty the registry and unseal it. For a test that fills the registry again;
 * never called by a run, which fills it once at process start.
 */
export function resetCriticStrategiesForTest(): void {
  REGISTRY.clear();
  sealed = false;
}

/**
 * Register a strategy (F100-FR-016). A registration after the launch, a second
 * registration of one id, an id that is not an id of this point, a class
 * outside the closed set, the class `third-party` in Wave 1, and a strategy
 * without its operation `judge` are each refused.
 */
export function registerCriticStrategy(
  registration: CriticStrategyRegistration,
): RegisteredCriticStrategy {
  if (sealed) {
    throw new CriticStrategyRegistrationError(
      registration.id,
      "after-launch",
      `the registry of ${POINT} (${POINT_ID}) is read-only after launch; ` +
        `\`${registration.id}\` was offered after the launch (F100-FR-016)`,
    );
  }
  if (REGISTRY.has(registration.id)) {
    throw new CriticStrategyRegistrationError(
      registration.id,
      "twice",
      `the critic strategy \`${registration.id}\` is registered twice (F100-FR-016)`,
    );
  }
  if (!EXTENSION_POINT_ID_FORM.test(registration.pointId) || registration.pointId !== POINT_ID) {
    throw new CriticStrategyRegistrationError(
      registration.id,
      "unknown-point",
      `\`${registration.pointId}\` is no id of the critic strategy of ${POINT}; ` +
        `its id is ${POINT_ID} (F100-FR-013)`,
    );
  }
  if (!(IMPLEMENTATION_CLASSES as readonly string[]).includes(registration.implementationClass)) {
    throw new CriticStrategyRegistrationError(
      registration.id,
      "unknown-class",
      `\`${registration.implementationClass}\` is no class of an implementation; ` +
        `the classes are ${IMPLEMENTATION_CLASSES.join(", ")} (F100-FR-014)`,
    );
  }
  if (!CLASSES_ACCEPTED_IN_WAVE_1.includes(registration.implementationClass)) {
    throw new CriticStrategyRegistrationError(
      registration.id,
      "third-party-class",
      `${POINT} is an internal seam: it makes no promise to an implementer outside ` +
        `the repository of the product in Wave 1, so the class ` +
        `\`${registration.implementationClass}\` is refused (F100-FR-020)`,
    );
  }
  if (typeof registration.strategy?.judge !== "function") {
    throw new CriticStrategyRegistrationError(
      registration.id,
      "no-operation",
      `the critic strategy \`${registration.id}\` carries no operation ` +
        `\`${OPERATION}\` (annex E §E.1)`,
    );
  }
  const entry: RegisteredCriticStrategy = Object.freeze({
    ...registration,
    ordinal: REGISTRY.size + 1,
  });
  REGISTRY.set(registration.id, entry);
  return entry;
}

/** Every registered strategy, in the order of registration. */
export function criticStrategies(): readonly RegisteredCriticStrategy[] {
  return Object.freeze([...REGISTRY.values()]);
}

/** The ids of the registered strategies, in the order of registration. */
export function criticStrategyIds(): readonly string[] {
  return Object.freeze([...REGISTRY.keys()]);
}

/** The registration of one id, or `undefined`. */
export function criticStrategy(id: string): RegisteredCriticStrategy | undefined {
  return REGISTRY.get(id);
}

/**
 * The state of the registry as one canonical line: the point, whether the
 * registry is sealed, and the ids with their class in the order of
 * registration. A reader that holds two of these can tell whether the registry
 * changed without holding a reference into it; a test hashes it.
 */
export function criticStrategyRegistryFingerprint(): string {
  const entries = criticStrategies().map((e) => `${e.ordinal}=${e.id}:${e.implementationClass}`);
  return `${POINT_ID} sealed=${String(sealed)} count=${String(entries.length)} [${entries.join(" ")}]`;
}

/* ==================================================================== *
 * T009 — the seam of the critic strategy: the call function that the
 * engine hands to a strategy (F149-FR-001; annex E §E.1, "Inputs" and
 * "Guarantees of the core"; `contracts/ep18-seams.md`, "The call
 * function").
 *
 * The contract of the function, in the words of `ep18-seams.md`: "Given by
 * the engine. It mints the nonce and the session id, hands the demand for
 * the verdict to the assembler of the critic prompt, calls `complete` of
 * the harness port, checks the proof of the form, parses the reply and
 * returns the outcome of the call. A strategy cannot make a call in any
 * other way and never sees a nonce."
 *
 * So the six steps below are the whole of a critic-class call of the phase
 * gate, and a strategy holds none of them:
 *
 *  1 the diversity test, before the call (T010, `diversityResultOf`);
 *  2 the nonce of 64 bits and the fresh session id (F100-FR-139);
 *  3 the demand for the verdict, handed to the assembler;
 *  4 `complete` of the harness port, with no tools or the read-only set;
 *  5 the proof of the form of §C.3, checked and recorded;
 *  6 the reply parsed into a verdict of the closed set.
 *
 * The harness port, the assembler of the critic prompt and the verdict
 * parser belong to other features (annex C §C.1, feature 117, the first
 * part of the split of 101). A core package holds no I/O and imports no
 * implementation (F100-FR-012, F100-FR-234), so each of the three is a
 * dependency the engine hands in. Each has a default here that is honest
 * about what it is: the parser applies the grammar of §E.1 ("a full line,
 * with exactly one match"), and is replaced by the parser of the first part
 * of the split when that ships.
 * ==================================================================== */

/** F100-FR-139 — the nonce of one call: 64 bits from a secure random source. */
export const NONCE_BITS_OF_A_CALL = NONCE_BITS;

/** The bytes of a nonce of `NONCE_BITS` bits. */
const NONCE_BYTES = NONCE_BITS / 8;

/** Mint one nonce: 64 bits from a secure random source, as hexadecimal. */
export function mintNonce(): string {
  return randomBytes(NONCE_BYTES).toString("hex");
}

/**
 * The hash of a nonce. Events, spans, the ledger and the approval record hold
 * this and never the nonce itself (`PLACES_THAT_HOLD_ONLY_THE_HASH`).
 */
export function nonceHashOf(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

/** Mint one session id. A call of the phase gate never reuses a session. */
export function mintSessionId(): string {
  return `critic-${randomBytes(16).toString("hex")}`;
}

/**
 * How often a fresh session id is minted again when the minted id is one a
 * pass of the phase attempt, or an earlier call of this phase gate, already
 * used. A minter that cannot produce a fresh id inside this many tries makes
 * the call MALFORMED: the critic never runs in a session of the proposer
 * (F149-FR-001), so an exhausted minter refuses the call rather than reusing.
 */
export const FRESH_SESSION_TRIES = 8 as const;

/** The reason a call was refused before it reached the harness port. */
export const CALL_REFUSALS = ["session-not-fresh", "proof-refused", "no-outcome"] as const;
export type CallRefusal = (typeof CALL_REFUSALS)[number];

/** F100-FR-087 — a critic of the first form receives no tool at all. */
export const TOOLS_OF_THE_FIRST_FORM: readonly string[] = Object.freeze([]);

/**
 * The tools one call carries: none for the first form, and only the read-only
 * tools of the second form for the second (F149-FR-001, "MUST hold no tools or
 * only the read-only tools of the second form of the `completion` level").
 */
export function toolsOfTheCall(
  form: CompletionForm,
  readOnlyTools: readonly string[] = [],
): readonly string[] {
  return form === SECOND_FORM ? Object.freeze([...readOnlyTools]) : TOOLS_OF_THE_FIRST_FORM;
}

/* ------------------------------------------------------------------ *
 * Step 3 — the demand for the verdict, and the assembler of the prompt.
 * ------------------------------------------------------------------ */

/**
 * What the call function hands to the assembler of the critic prompt: the
 * input of the phase gate, the text the strategy asked for, and the nonce the
 * verdict must be bound to (F100-FR-088). The assembler belongs to feature
 * 117; the engine hands one in.
 */
export type VerdictDemand = {
  readonly gate: GateInput;
  /** What the strategy asked, which is the only thing a strategy contributes. */
  readonly demand: string;
  /** The nonce of this call. The strategy never sees it. */
  readonly nonce: string;
  /** The ordinal of the call inside this phase gate, from 1. */
  readonly callOrdinal: number;
};

/** The assembler of the critic prompt (feature 117); the engine hands one in. */
export type CriticPromptAssembler = (demand: VerdictDemand) => string;

/**
 * The assembler used where the engine hands none in: the demand of the
 * strategy, the nonce the verdict must carry, and nothing else. It is a
 * stand-in for the assembler of feature 117 and builds no grounding snapshot.
 */
export const defaultCriticPromptAssembler: CriticPromptAssembler = (demand) =>
  `${demand.demand}\n\nAnswer with one line: <VERDICT> ${demand.nonce}\n`;

/* ------------------------------------------------------------------ *
 * Step 4 — `complete` of the harness port.
 * ------------------------------------------------------------------ */

/** The one `completion` call the call function makes (annex C §C.1). */
export type CompletionRequest = {
  /** Always the critic class: this seam makes no other call. */
  readonly role: "critic";
  /** The prompt the assembler built. */
  readonly prompt: string;
  /** The nonce the verdict is bound to. */
  readonly nonce: string;
  /** The fresh session of this call. */
  readonly sessionId: string;
  /** The form of the `completion` level (§C.3). */
  readonly form: CompletionForm;
  /** No tool at all, or the read-only tools of the second form. */
  readonly tools: readonly string[];
  /** The model of the critic, where the role plan names one. */
  readonly model: string | null;
};

/** What `complete` of the harness port returns, as the proof of §C.3 reads it. */
export type CompletionCallFacts = {
  readonly reply: string;
  /** The initial record of the stream, where the harness writes one. */
  readonly initialRecord?: {
    readonly tools?: readonly string[];
    readonly sessionId?: string | null;
  } | null;
  /** The sandbox mode of the call record (second form). */
  readonly sandboxMode?: string | null;
  /** Whether the network was off (second form). */
  readonly networkOff?: boolean;
  /** Whether the harness adapter confirmed the withheld paths of §C.4. */
  readonly withheldPathsConfirmed?: boolean;
  /** The exact version pin of the harness (the weaker proof). */
  readonly versionPin?: string | null;
  /** Whether the preflight of the harness adapter ran (the weaker proof). */
  readonly preflight?: boolean;
  /** Whether the flag set of the call was the tool-less one (the weaker proof). */
  readonly flagSet?: boolean;
  /** The model the harness reports for the call, where it reports one. */
  readonly model?: string | null;
  readonly usage?: Readonly<Record<string, number>> | null;
  readonly latency?: number | null;
};

/** `complete` of the harness port, as the engine hands it in (annex C §C.1). */
export type CompletionPortCall = (request: CompletionRequest) => Promise<CompletionCallFacts>;

/* ------------------------------------------------------------------ *
 * Step 5 — the proof of the form (§C.3, F100-FR-087, F100-FR-230).
 * ------------------------------------------------------------------ */

/** The kind of proof of row 128 that a form rests on (§C.3). */
export function criticProofKindOf(form: CompletionForm, weaker: boolean): CriticProofKind {
  if (form === SECOND_FORM) return "read-only-sandbox";
  return weaker ? "pinned-configuration" : "initial-record";
}

/**
 * Which of the three ways of F100-FR-230 this call takes:
 *
 *  1 the harness takes a session id from the caller, so the initial record
 *    shows the id the runtime minted;
 *  2 the harness gives the id itself, so the id of the initial record equals
 *    no session id of any pass;
 *  3 the initial record carries no session, and the weaker proof applies.
 */
export function sessionProofCaseOf(
  facts: CompletionCallFacts,
  sessionIdIsTakenFromTheCaller: boolean,
): SessionProofCase {
  if (sessionIdIsTakenFromTheCaller) return "caller-minted-id";
  const reported = facts.initialRecord?.sessionId;
  if (typeof reported === "string" && reported.length > 0) return "harness-given-id";
  return WEAKER_SESSION_PROOF_CASE;
}

/** What the proof of one call needs to settle (§C.3, F100-FR-230). */
export type ProofInput = {
  readonly form: CompletionForm;
  readonly facts: CompletionCallFacts;
  /** The id the call function minted for this call. */
  readonly sessionId: string;
  /** The session ids of the passes of the phase attempt. */
  readonly sessionIdsOfThePasses: readonly string[];
  /** Whether the harness takes a session id from the caller (case 1). */
  readonly sessionIdIsTakenFromTheCaller: boolean;
  /** Whether the harness adapter is a tested one (case 3 is open to it only). */
  readonly testedHarnessAdapter: boolean;
  /** How the critic came to be the critic of the run (F100-FR-230). */
  readonly provenance: CriticProvenance;
  /** True under the `parity` profile, where no proof is made (rows 28, 117). */
  readonly underParity: boolean;
};

/**
 * Check the proof of the form of one critic-class call and return the result
 * that the call record carries (F100-FR-087: "the result of the proof MUST be
 * recorded for every critic-class call").
 *
 * The facts of each form are those of §C.3, which `FIRST_FORM_FACTS`,
 * `WEAKER_PROOF_FACTS` and `SECOND_FORM_FACTS` of the contracts name. The
 * judgment itself is `judgeProof` of feature 100, so the two cannot drift.
 */
export function proofOfTheCall(input: ProofInput): CriticProofResult {
  const sessionProofCase = sessionProofCaseOf(input.facts, input.sessionIdIsTakenFromTheCaller);
  const weaker = sessionProofCase === WEAKER_SESSION_PROOF_CASE;
  const requirement = proofRequiredFor(input.form);
  const kind: ProofKind =
    weaker && requirement.fallback ? requirement.fallback.kind : requirement.kind;

  const facts: Record<string, boolean> = {};
  if (input.form === FIRST_FORM) {
    const tools = input.facts.initialRecord?.tools ?? [];
    facts[FIRST_FORM_FACTS[0]] = tools.length === 0;
    const reported = input.facts.initialRecord?.sessionId ?? null;
    facts[FIRST_FORM_FACTS[1]] =
      sessionProofCase === "caller-minted-id"
        ? reported === input.sessionId
        : sessionProofCase === "harness-given-id"
          ? reported !== null && !input.sessionIdsOfThePasses.includes(reported)
          : // Case 3: the initial record carries no session at all.
            reported === null;
    if (weaker) {
      facts[WEAKER_PROOF_FACTS[0]] =
        typeof input.facts.versionPin === "string" && input.facts.versionPin.length > 0;
      facts[WEAKER_PROOF_FACTS[1]] = input.facts.preflight === true;
      facts[WEAKER_PROOF_FACTS[2]] = input.facts.flagSet === true;
    }
  } else {
    facts[SECOND_FORM_FACTS[0]] = input.facts.sandboxMode === "read-only";
    facts[SECOND_FORM_FACTS[1]] = input.facts.networkOff === true;
    facts[SECOND_FORM_FACTS[2]] = input.facts.withheldPathsConfirmed === true;
  }

  const passed = Object.values(facts).every((held) => held);
  const proof: SessionProof = {
    form: input.form,
    kind: criticProofKindOf(input.form, weaker),
    sessionProofCase,
    weakerProof: weaker,
    testedHarnessAdapter: input.testedHarnessAdapter,
    passed,
    provenance: input.provenance,
    underParity: input.underParity,
  };
  const judgment = judgeProof(proof);

  // F100-FR-230 — under the `parity` profile no proof is made, as at the
  // baseline; the result is recorded as `not-made` and refuses nothing.
  if (input.underParity) {
    return Object.freeze({
      form: input.form,
      outcome: "not-made" as const,
      kind,
      sessionProofCase,
      weakerProof: weaker,
      facts: Object.freeze({ ...facts }),
      underParity: true,
    });
  }
  return Object.freeze({
    form: input.form,
    outcome: judgment.accepted ? ("passed" as const) : ("failed" as const),
    kind,
    sessionProofCase,
    weakerProof: judgment.accepted ? judgment.weakerProof : weaker,
    facts: Object.freeze({ ...facts }),
    ...(judgment.accepted ? {} : { failure: FAILURE_WHEN_THE_PROOF_IS_MISSING }),
    underParity: false,
  });
}

/* ------------------------------------------------------------------ *
 * Step 6 — the verdict, parsed from the reply alone.
 * ------------------------------------------------------------------ */

/** The parser of the verdict; the first part of the split of 101 owns it. */
export type VerdictParser = (reply: string, nonce: string) => Verdict;

/**
 * Row 8 of annex X §X.6 and §E.1: an unknown verdict is MALFORMED. Used on
 * everything a strategy or a reply offers as a verdict.
 */
export function verdictOfTheClosedSet(value: unknown): Verdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value)
    ? (value as Verdict)
    : VERDICT_WHEN_UNKNOWN;
}

/**
 * The grammar of §E.1, "Guarantees of the core": a verdict is parsed only from
 * the reply, as a FULL LINE, with EXACTLY ONE MATCH; everything else is
 * MALFORMED, which rejects. The line carries the nonce of the call, so that a
 * verdict line planted in phase evidence or in a grounded file is no verdict
 * (annex X §X.7, threat T-01).
 *
 * This is the stand-in named in the module header: the first part of the split
 * of 101 owns the parser, and the engine hands it in through
 * `CriticCallDependencies.parseVerdict` once it exists. The grammar it applies
 * is the one of §E.1 and nothing more.
 */
export function parseVerdictFromTheReply(reply: string, nonce: string): Verdict {
  if (typeof reply !== "string" || nonce.length === 0) return VERDICT_WHEN_UNKNOWN;
  const matches: Verdict[] = [];
  for (const line of reply.split(/\r?\n/)) {
    const trimmed = line.trim();
    for (const verdict of VERDICTS) {
      // A full line, and the nonce of this call on it: nothing else matches.
      if (trimmed === `${verdict} ${nonce}` || trimmed === `${nonce} ${verdict}`) {
        matches.push(verdict);
      }
    }
  }
  return matches.length === 1 ? matches[0] : VERDICT_WHEN_UNKNOWN;
}

/* ------------------------------------------------------------------ *
 * What the engine records, and what the strategy receives.
 * ------------------------------------------------------------------ */

/** The result of the diversity test (row 183 of annex X §X.6). */
export type DiversityResult = (typeof resultsOfTheDiversityTest.members)[number];

/** Row 183 — a value outside the set is `unverified`, which warns. */
export const DIVERSITY_RESULT_WHEN_UNKNOWN: DiversityResult = "unverified";

/**
 * The record of one critic call that the engine writes: the surface
 * `transcript.critic` of the own test. It holds the hash of the nonce and
 * never the nonce (`PLACES_THAT_HOLD_ONLY_THE_HASH`), and it is what the
 * strategy does NOT receive.
 */
export type CriticCallRecord = {
  readonly callOrdinal: number;
  readonly sessionId: string;
  readonly nonceHash: string;
  readonly form: CompletionForm;
  readonly tools: readonly string[];
  readonly proof: CriticProofResult;
  readonly model: string | null;
  readonly diversity: DiversityResult;
  readonly sameModelWarning: boolean;
  readonly verdict: Verdict;
  readonly usage: Readonly<Record<string, number>> | null;
  readonly latency: number | null;
  /** Where the call was refused or failed before a reply was parsed. */
  readonly refusal?: CallRefusal;
  /** The message of a transport error, which is scored as MALFORMED (§E.1). */
  readonly transportError?: string;
};

/** The names of the events this seam raises on the primary stream. */
export const CRITIC_CALL_EVENT = "ep18.critic.call" as const;
export const CRITIC_DIVERSITY_WARNING_EVENT = "ep18.critic.diversity-warning" as const;
export const CRITIC_EVENT_NAMES = [CRITIC_CALL_EVENT, CRITIC_DIVERSITY_WARNING_EVENT] as const;

/**
 * One event of the primary stream. The catalogue of events belongs to feature
 * 111; the field `sameModelWarning` is its field and the name is unchanged
 * (F149-FR-001). The names above are this feature's until the catalogue
 * carries them.
 */
export type CriticCallEvent = {
  readonly name: (typeof CRITIC_EVENT_NAMES)[number];
  readonly callOrdinal: number;
  readonly sessionId: string;
  readonly nonceHash: string;
  readonly diversity: DiversityResult;
  readonly sameModelWarning: boolean;
  /** The warning never blocks: an event of it halts nothing (F149-FR-001). */
  readonly blocking: false;
  readonly warning?: typeof WARNING_NAME;
  readonly verdict?: Verdict;
  readonly proofOutcome?: CriticProofResult["outcome"];
};

/**
 * The call function of the engine, as a strategy receives it: a prompt in, the
 * outcome of one call out. There is no second argument and no nonce anywhere
 * in it (research.md D3).
 */
export type EngineCriticCall = (demand: string) => Promise<CriticCallOutcome>;

/** Everything the engine hands in to build one call function. */
export type CriticCallDependencies = {
  /** `complete` of the harness port (annex C §C.1). */
  readonly complete: CompletionPortCall;
  /** The input of the phase gate, which the assembler of the prompt receives. */
  readonly gate: GateInput;
  /** The form of the `completion` level this critic runs in (§C.3). */
  readonly form: CompletionForm;
  /** The model of the critic from the role plan, or null where none is known. */
  readonly criticModel: string | null;
  /** The models that produced passes in the phase attempt (the diversity test). */
  readonly modelsThatProducedPasses: readonly string[];
  /** The session ids of the passes of the phase attempt. */
  readonly sessionIdsOfThePasses: readonly string[];
  /** The read-only tools of the second form; empty for the first. */
  readonly readOnlyTools?: readonly string[];
  /** Whether the harness takes a session id from the caller (F100-FR-230 case 1). */
  readonly sessionIdIsTakenFromTheCaller?: boolean;
  /** Whether the harness adapter is a tested one (case 3 is open to it only). */
  readonly testedHarnessAdapter?: boolean;
  /** How the critic came to be the critic of the run. */
  readonly provenance?: CriticProvenance;
  /** True under the `parity` profile, where no proof is made. */
  readonly underParity?: boolean;
  /** The assembler of the critic prompt (feature 117). */
  readonly assemble?: CriticPromptAssembler;
  /** The verdict parser (the first part of the split of 101). */
  readonly parseVerdict?: VerdictParser;
  /** The minters, for a test that needs them fixed; secure random by default. */
  readonly mintNonce?: () => string;
  readonly mintSessionId?: () => string;
  /** Where the engine writes the record of a call (`transcript.critic`). */
  readonly onCallRecord?: (record: CriticCallRecord) => void;
  /** Where the engine writes an event (`events-primary`). */
  readonly onEvent?: (event: CriticCallEvent) => void;
};

/** The call function with the two readers the engine keeps for itself. */
export type EngineCriticCallFunction = {
  /** What the strategy receives. */
  readonly call: EngineCriticCall;
  /** The record of every call made, in order. */
  records(): readonly CriticCallRecord[];
  /** Every event raised, in order. */
  events(): readonly CriticCallEvent[];
};

/**
 * T009 — build the call function the engine hands to a strategy.
 *
 * Every guarantee of §E.1 that rests on the core lives here and nowhere else:
 * the nonce of its own per call, the fresh session, the tools, the proof, the
 * parse of the reply, and the diversity test before the call. A strategy can
 * make a call in no other way, because it receives nothing but this function.
 */
export function createCriticCall(deps: CriticCallDependencies): EngineCriticCallFunction {
  const records: CriticCallRecord[] = [];
  const events: CriticCallEvent[] = [];
  const sessionsOfThisGate: string[] = [];
  const assemble = deps.assemble ?? defaultCriticPromptAssembler;
  const parse = deps.parseVerdict ?? parseVerdictFromTheReply;
  const newNonce = deps.mintNonce ?? mintNonce;
  const newSession = deps.mintSessionId ?? mintSessionId;

  const keep = (record: CriticCallRecord, event: CriticCallEvent): void => {
    records.push(record);
    events.push(event);
    deps.onCallRecord?.(record);
    deps.onEvent?.(event);
  };

  const call: EngineCriticCall = async (demand: string): Promise<CriticCallOutcome> => {
    const callOrdinal = records.length + 1;

    // 1 — the diversity test, before the call. It never blocks.
    const diversity = diversityResultOf(deps.criticModel, deps.modelsThatProducedPasses);
    const sameModelWarning = theCriticDiversityWarningIsDue(diversity);
    if (sameModelWarning) {
      const warning: CriticCallEvent = Object.freeze({
        name: CRITIC_DIVERSITY_WARNING_EVENT,
        callOrdinal,
        sessionId: "",
        nonceHash: "",
        diversity,
        sameModelWarning: true,
        blocking: false as const,
        warning: WARNING_NAME,
      });
      events.push(warning);
      deps.onEvent?.(warning);
    }

    // 2 — the nonce of this call, and a session no pass and no earlier call used.
    const nonce = newNonce();
    const nonceHash = nonceHashOf(nonce);
    let sessionId: string | null = null;
    for (let tries = 0; tries < FRESH_SESSION_TRIES; tries += 1) {
      const candidate = newSession();
      if (
        !deps.sessionIdsOfThePasses.includes(candidate) &&
        !sessionsOfThisGate.includes(candidate)
      ) {
        sessionId = candidate;
        break;
      }
    }
    if (sessionId === null) {
      // The critic never runs in a session of the proposer: a minter that
      // offers none but used ids refuses the call instead of reusing one.
      const refused = outcomeOfARefusedCall({
        callOrdinal,
        nonceHash,
        form: deps.form,
        tools: toolsOfTheCall(deps.form, deps.readOnlyTools),
        model: deps.criticModel,
        diversity,
        sameModelWarning,
        refusal: "session-not-fresh",
      });
      keep(refused.record, refused.event);
      return refused.outcome;
    }
    sessionsOfThisGate.push(sessionId);

    // 3 — the demand for the verdict, handed to the assembler of the prompt.
    const prompt = assemble({ gate: deps.gate, demand, nonce, callOrdinal });

    // 4 — `complete` of the harness port, with no tools or the read-only set.
    const tools = toolsOfTheCall(deps.form, deps.readOnlyTools);
    let facts: CompletionCallFacts;
    try {
      facts = await deps.complete({
        role: "critic",
        prompt,
        nonce,
        sessionId,
        form: deps.form,
        tools,
        model: deps.criticModel,
      });
    } catch (error) {
      // §E.1, "Errors": a transport error is scored as MALFORMED.
      const message = error instanceof Error ? error.message : String(error);
      const record: CriticCallRecord = Object.freeze({
        callOrdinal,
        sessionId,
        nonceHash,
        form: deps.form,
        tools,
        proof: proofNotMade(deps.form),
        model: deps.criticModel,
        diversity,
        sameModelWarning,
        verdict: TRANSPORT_ERROR_IS_SCORED_AS,
        usage: null,
        latency: null,
        transportError: message,
      });
      keep(record, eventOf(record));
      return outcomeOf(record);
    }

    // 5 — the proof of the form, checked and recorded for every call.
    const proof = proofOfTheCall({
      form: deps.form,
      facts,
      sessionId,
      sessionIdsOfThePasses: deps.sessionIdsOfThePasses,
      sessionIdIsTakenFromTheCaller: deps.sessionIdIsTakenFromTheCaller === true,
      testedHarnessAdapter: deps.testedHarnessAdapter === true,
      provenance: deps.provenance ?? "configured",
      underParity: deps.underParity === true,
    });

    // 6 — the reply, parsed into a verdict of the closed set. A call whose
    // proof is refused is MALFORMED whatever the reply says (F100-FR-087).
    const verdict = callIsRefused(proof)
      ? VERDICT_WHEN_UNKNOWN
      : verdictOfTheClosedSet(parse(facts.reply, nonce));
    const record: CriticCallRecord = Object.freeze({
      callOrdinal,
      sessionId,
      nonceHash,
      form: deps.form,
      tools,
      proof,
      model: facts.model ?? deps.criticModel,
      diversity,
      sameModelWarning,
      verdict,
      usage: facts.usage ?? null,
      latency: facts.latency ?? null,
      ...(callIsRefused(proof) ? { refusal: "proof-refused" as CallRefusal } : {}),
    });
    keep(record, eventOf(record));
    return outcomeOf(record);
  };

  return Object.freeze({
    call,
    records: () => Object.freeze([...records]),
    events: () => Object.freeze([...events]),
  });
}

/** The result a call record carries where no proof could be made at all. */
function proofNotMade(form: CompletionForm): CriticProofResult {
  return Object.freeze({
    form,
    outcome: "not-made" as const,
    kind: proofRequiredFor(form).kind,
    sessionProofCase: WEAKER_SESSION_PROOF_CASE,
    weakerProof: false,
    facts: Object.freeze({}),
    failure: FAILURE_WHEN_THE_PROOF_IS_MISSING,
    underParity: false,
  });
}

/** The event of one call record, for the primary stream. */
function eventOf(record: CriticCallRecord): CriticCallEvent {
  return Object.freeze({
    name: CRITIC_CALL_EVENT,
    callOrdinal: record.callOrdinal,
    sessionId: record.sessionId,
    nonceHash: record.nonceHash,
    diversity: record.diversity,
    sameModelWarning: record.sameModelWarning,
    blocking: false as const,
    ...(record.sameModelWarning ? { warning: WARNING_NAME } : {}),
    verdict: record.verdict,
    proofOutcome: record.proof.outcome,
  });
}

/**
 * The outcome one call hands back to the strategy. It is built from the record
 * FIELD BY FIELD — never by copying the record — so that neither the nonce nor
 * its hash can reach a strategy (data-model.md, "Outcome of one critic call";
 * research.md D3). `isCriticCallOutcome` of the contracts is the guard, and
 * the engine applies it here before the value leaves the core.
 */
function outcomeOf(record: CriticCallRecord): CriticCallOutcome {
  const outcome: CriticCallOutcome = Object.freeze({
    verdict: record.verdict,
    sessionId: record.sessionId,
    form: record.form,
    proof: record.proof,
    sameModelWarning: record.sameModelWarning,
    usage: record.usage,
    latency: record.latency,
  });
  if (!isCriticCallOutcome(outcome)) {
    throw new CriticCallError(
      `the outcome of call ${String(record.callOrdinal)} is no outcome of a critic call ` +
        `(data-model.md, "Outcome of one critic call")`,
    );
  }
  return outcome;
}

/** An outcome that the call function could not build or hand over. */
export class CriticCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CriticCallError";
  }
}

/** A call refused before it reached the harness port. */
function outcomeOfARefusedCall(input: {
  callOrdinal: number;
  nonceHash: string;
  form: CompletionForm;
  tools: readonly string[];
  model: string | null;
  diversity: DiversityResult;
  sameModelWarning: boolean;
  refusal: CallRefusal;
}): { record: CriticCallRecord; event: CriticCallEvent; outcome: CriticCallOutcome } {
  const record: CriticCallRecord = Object.freeze({
    callOrdinal: input.callOrdinal,
    // No session was taken, so none is recorded as used; the field stays the
    // empty text rather than an id of a pass.
    sessionId: "",
    nonceHash: input.nonceHash,
    form: input.form,
    tools: input.tools,
    proof: proofNotMade(input.form),
    model: input.model,
    diversity: input.diversity,
    sameModelWarning: input.sameModelWarning,
    verdict: VERDICT_WHEN_UNKNOWN,
    usage: null,
    latency: null,
    refusal: input.refusal,
  });
  // The outcome of a refused call carries no session id of its own; the guard
  // of the contracts refuses an empty one, so the refusal is named instead.
  const outcome: CriticCallOutcome = Object.freeze({
    verdict: VERDICT_WHEN_UNKNOWN,
    sessionId: `refused:${input.refusal}`,
    form: input.form,
    proof: record.proof,
    sameModelWarning: input.sameModelWarning,
    usage: null,
    latency: null,
  });
  return { record, event: eventOf(record), outcome };
}

/* ==================================================================== *
 * T010 — the strategy with one critic, and the comparison of the model
 * of a call with the models that produced passes (F149-FR-001; annex E
 * §E.1, "Wave 1 implementations"; `contracts/ep18-seams.md`, "Wave 1:
 * `single`: one call").
 * ==================================================================== */

/**
 * The comparison F149-FR-001 asks for: "Before every critic-class call the
 * model of the call MUST be compared with the models that produced passes in
 * the phase attempt". The result is a member of row 183 of annex X §X.6:
 *
 * | Result | When |
 * |---|---|
 * | `same-model` | the model of the call equals a model that produced a pass |
 * | `unverified` | the model of the call, or a model of a pass, is not known |
 * | `same-provider` | the providers are given and share one, the models differ |
 * | `diverse` | otherwise |
 *
 * Feature 124 owns the diversity test of the run as a whole, including the
 * provider side; this is the comparison of this seam, which is the one the
 * requirement names. A model is compared after the trimming of surrounding
 * space and in lower case, so that two spellings of one model are not read as
 * two models.
 */
export function diversityResultOf(
  criticModel: string | null | undefined,
  modelsThatProducedPasses: readonly (string | null | undefined)[],
  providers?: {
    readonly criticProvider?: string | null;
    readonly providersThatProducedPasses?: readonly (string | null | undefined)[];
  },
): DiversityResult {
  const normalize = (model: string | null | undefined): string | null =>
    typeof model === "string" && model.trim().length > 0 ? model.trim().toLowerCase() : null;

  const critic = normalize(criticModel);
  // A model that is not known cannot be compared: the result is `unverified`,
  // which warns (row 183, unknown value).
  if (critic === null) return "unverified";
  const passes = modelsThatProducedPasses.map(normalize);
  if (passes.some((model) => model === null)) return "unverified";
  if (passes.includes(critic)) return "same-model";

  const criticProvider = normalize(providers?.criticProvider);
  const passProviders = (providers?.providersThatProducedPasses ?? []).map(normalize);
  if (criticProvider !== null && passProviders.includes(criticProvider)) return "same-provider";
  return "diverse";
}

/**
 * F149-FR-001 — the critic-diversity warning is due for the results
 * `same-model` and for `unverified` because the model is not known. It is
 * raised, recorded in the field `sameModelWarning` (the field name of feature
 * 111 is unchanged) and never blocks.
 */
export function theCriticDiversityWarningIsDue(result: DiversityResult): boolean {
  return (DIVERSITY_RESULTS_THAT_WARN as readonly string[]).includes(result);
}

/** F149-FR-001 — the warning never blocks a call and never halts a run. */
export const THE_DIVERSITY_WARNING_BLOCKS = false as const;

/** What a strategy returns from `judge`; the engine builds the record from it. */
export type StrategyVerdict = {
  /** A member of the closed set; anything else is MALFORMED. */
  readonly verdict: Verdict | string;
  /** The criteria the critic found unmet, where it named any. */
  readonly unmetCriteria?: readonly string[];
};

/** The operation `judge` of this seam, as a strategy of this product writes it. */
export type EngineCriticStrategy = {
  judge(input: GateInput, call: EngineCriticCall): Promise<StrategyVerdict>;
};

/** The id of the strategy of Wave 1 (`ep18-seams.md`, "Wave 1"). */
export const SINGLE_CRITIC_STRATEGY_ID = "single" as const;

/** `single` makes exactly one call. */
export const CALLS_OF_THE_SINGLE_STRATEGY = 1 as const;

/**
 * The strategy with one critic. It holds no state outside its input, makes
 * exactly one call through the call function of T009, and returns what that
 * call said. Everything else — the nonce, the session, the tools, the proof,
 * the parse — is the call function's, so this is the whole of the strategy.
 */
export const singleCriticStrategy: EngineCriticStrategy = Object.freeze({
  async judge(input: GateInput, call: EngineCriticCall): Promise<StrategyVerdict> {
    const outcome = await call(demandOfThePhaseGate(input));
    return Object.freeze({
      verdict: outcome.verdict,
      unmetCriteria: Object.freeze([]),
    });
  },
});

/**
 * What `single` asks the critic for. The strategy contributes the demand and
 * nothing else; the assembler of the critic prompt (feature 117) builds the
 * prompt around it from the phase evidence and the grounding snapshot, which
 * the call function hands it.
 */
export function demandOfThePhaseGate(input: GateInput): string {
  return (
    `Judge the phase evidence \`${input.phaseEvidence.logicalName}\` against the criteria of ` +
    `the phase, from the grounding snapshot \`${input.groundingSnapshot.logicalName}\` alone.`
  );
}

/** Register the strategy of Wave 1. The process does this once, at start. */
export function registerSingleCriticStrategy(): RegisteredCriticStrategy {
  return registerCriticStrategy({
    id: SINGLE_CRITIC_STRATEGY_ID,
    pointId: POINT_ID,
    implementationClass: "first-party",
    strategy: singleCriticStrategy,
  });
}

/* ------------------------------------------------------------------ *
 * The engine side of `judge`: the guarantees that hold whatever the
 * strategy does (§E.1, "Guarantees of an implementation" and "Failure of
 * an implementation").
 * ------------------------------------------------------------------ */

/** Everything the engine hands in to judge one phase gate. */
export type JudgeDependencies = CriticCallDependencies & {
  /** The id of the strategy to judge with; `single` in Wave 1. */
  readonly strategyId?: string;
  /** The id of the verdict record; the engine owns record identity (§B.5). */
  readonly verdictId: string;
  /**
   * Whether the verdict record keeps the nonce in clear. The record and the
   * feedback are the two places that may (`PLACES_THAT_MAY_HOLD_THE_NONCE_IN_CLEAR`).
   */
  readonly keepTheNonceInTheRecord?: boolean;
};

/** The hash a verdict record carries where the strategy made no call at all. */
export const NONCE_HASH_WHEN_NO_CALL_WAS_MADE = "" as const;

/** What the engine gets back from one phase gate. */
export type PhaseGateJudgment = {
  /** Exactly one verdict record, always (§E.1, "Guarantees of an implementation"). */
  readonly record: VerdictRecord;
  readonly strategyId: string;
  /** The record of every call, in order: the surface `transcript.critic`. */
  readonly calls: readonly CriticCallRecord[];
  /** Every event raised, in order: the surface `events-primary`. */
  readonly events: readonly CriticCallEvent[];
  /** Why the verdict is MALFORMED where the strategy itself failed. */
  readonly failure?: string;
};

/**
 * T009/T010 — judge one phase gate through the seam.
 *
 * The engine calls this once per phase gate, after the verification gate. It
 * holds the guarantees that no strategy can weaken:
 *
 *  - exactly one verdict record comes back, whatever the strategy did;
 *  - the verdict is never APPROVED when any call of the strategy was
 *    MALFORMED (§E.1, "Guarantees of an implementation");
 *  - a verdict outside the closed set is MALFORMED (row 8 of annex X §X.6);
 *  - a strategy that throws gives MALFORMED, counted by the MALFORMED limit
 *    (§E.1, "Failure of an implementation");
 *  - the strategy receives the call function and the input of the phase gate,
 *    and nothing else: no nonce, no session minter, no harness port.
 */
export async function judgePhaseGate(
  input: GateInput,
  deps: JudgeDependencies,
): Promise<PhaseGateJudgment> {
  const strategyId = deps.strategyId ?? SINGLE_CRITIC_STRATEGY_ID;
  const registered = criticStrategy(strategyId);
  const judge = registered?.strategy.judge;
  const callFunction = createCriticCall(deps);

  let returned: unknown;
  let failure: string | undefined;
  if (typeof judge !== "function") {
    failure =
      `no critic strategy \`${strategyId}\` is registered at the point ${POINT_ID}; ` +
      `the phase gate is MALFORMED (§E.1, "Failure of an implementation")`;
  } else {
    try {
      returned = await (
        judge as (gate: GateInput, call: EngineCriticCall) => Promise<unknown> | unknown
      ).call(registered?.strategy, input, callFunction.call);
    } catch (error) {
      // "A critic strategy that fails gives MALFORMED, counted by the
      // MALFORMED limit" (§E.1).
      failure = error instanceof Error ? error.message : String(error);
    }
  }

  const calls = callFunction.records();
  const verdict = verdictOfTheJudgment(returned, calls, failure !== undefined);
  const lastCall = calls.length > 0 ? calls[calls.length - 1] : undefined;
  const record: VerdictRecord = Object.freeze({
    verdictId: deps.verdictId,
    verdict,
    unmetCriteria: unmetCriteriaOf(returned),
    nonceHash: lastCall?.nonceHash ?? NONCE_HASH_WHEN_NO_CALL_WAS_MADE,
  });

  return Object.freeze({
    record,
    strategyId,
    calls,
    events: callFunction.events(),
    ...(failure === undefined ? {} : { failure }),
  });
}

/**
 * The verdict of one phase gate, from what the strategy returned and from what
 * its calls did. MALFORMED is the safe failure at every step: a strategy that
 * threw, a value that is no verdict record, a verdict outside the closed set,
 * and APPROVED after a MALFORMED call all come out MALFORMED.
 */
export function verdictOfTheJudgment(
  returned: unknown,
  calls: readonly CriticCallRecord[],
  strategyFailed: boolean,
): Verdict {
  if (strategyFailed) return VERDICT_WHEN_UNKNOWN;
  if (typeof returned !== "object" || returned === null) return VERDICT_WHEN_UNKNOWN;
  const verdict = verdictOfTheClosedSet((returned as { verdict?: unknown }).verdict);
  // "A critic strategy ... never approves on a MALFORMED reply of any of its
  // calls" (§E.1). The engine holds the rule, so no strategy can weaken it.
  if (verdict === "APPROVED" && calls.some((call) => call.verdict === "MALFORMED")) {
    return VERDICT_WHEN_UNKNOWN;
  }
  // A strategy that approves without having made a call approves its own
  // reading of the evidence, not the critic's.
  if (verdict === "APPROVED" && calls.length === 0) return VERDICT_WHEN_UNKNOWN;
  return verdict;
}

/** The unmet criteria a strategy named, as a frozen list of text. */
function unmetCriteriaOf(returned: unknown): readonly string[] {
  if (typeof returned !== "object" || returned === null) return Object.freeze([]);
  const named = (returned as { unmetCriteria?: unknown }).unmetCriteria;
  if (!Array.isArray(named)) return Object.freeze([]);
  return Object.freeze(named.filter((value): value is string => typeof value === "string"));
}
