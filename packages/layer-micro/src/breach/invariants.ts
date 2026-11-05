/**
 * T112 — the invariants of the integrity of the phase gate and the breach
 * kinds (F115-FR-039; IR-28), as a *reader* of the event file of the run and
 * of the ledger namespace `micro`. The layer reads; it changes nothing.
 *
 * A breach is one of the closed set of row 141
 * (`@specstride/contracts/data/closed-sets-115.json`):
 *
 * - `approval-without-gate` — an approval without a critic reply that
 *   matches the nonce, made after the pass loop ended and after the full
 *   verification gate executed in the same phase attempt;
 * - `outer-counter-changed` — a counter of F115-FR-027 changed by an inner
 *   event;
 * - `critic-input-excluded-field` — an input of a critic-class call that
 *   holds a field which annex D §D.7 lists as never in the fact block;
 * - `false-pass` — a pass recorded for a check that did not run, ran
 *   tainted, or whose fingerprints differed.
 *
 * An act that the runtime detected and refused is an integrity event (`an
 * `integrity.noted` of the event file) and NOT a breach: `isRefusal` makes
 * that the first rule of every check, so a refused act can never be reported
 * as a breach of the same fact.
 *
 * The invariants are checked on the event file of every run by the doctor
 * and in the build (F115-FR-039); the doctor of feature 112 consumes this
 * through the registration call of the kernel (EP-14).
 *
 * Purity: imports `@specstride/contracts` and the layer only; no `node:fs`,
 * no process.
 */
import closedSetsData from "@specstride/contracts/data/closed-sets-115.json" with { type: "json" };

/** The closed set of row 141, read from the data of this feature. */
export const BREACH_KINDS = (
  closedSetsData.sets.find((s) => s.row === "141")?.members ??
  "approval-without-gate, outer-counter-changed, critic-input-excluded-field, false-pass"
)
  .split(",")
  .map((m) => m.trim()) as readonly BreachKind[];
export type BreachKind =
  "approval-without-gate" | "outer-counter-changed" | "critic-input-excluded-field" | "false-pass";

/** The id of the integrity rule the check of a kind carries out (IR-28). */
export const RULE_ID: Readonly<Record<BreachKind, string>> = Object.freeze({
  "approval-without-gate": "IR-28",
  "outer-counter-changed": "IR-28",
  "critic-input-excluded-field": "IR-28",
  "false-pass": "IR-28",
});

/** The integrity kinds of row 65: a refused act, never a breach. */
export const INTEGRITY_KINDS = ["ledger-invalid", "manifest-mismatch", "pin-mismatch"] as const;

/**
 * The fields annex D §D.7 lists as never in the fact block: the note of a
 * checkpoint and the output of a command, in the forms the layer can meet.
 */
export const FACT_BLOCK_EXCLUDED_FIELDS = [
  "note",
  "output",
  "stdout",
  "stderr",
  "transcript",
] as const;

/** One finding of the invariant check. */
export type BreachFinding = {
  readonly kind: BreachKind;
  readonly ruleId: string;
  /** What was observed, in facts of the event file and the ledger only. */
  readonly detail: string;
};

/** The read-only inputs of the invariant check. */
export type InvariantInput = {
  /**
   * The event file of the run, as the engine holds it: the recorded events,
   * each with its catalogue type and fields.
   */
  readonly events: readonly {
    readonly type: string;
    readonly fields: Readonly<Record<string, unknown>>;
  }[];
  /**
   * The counters of the outer loop as they were at launch and as they stand
   * now (F115-FR-027): the layer may spend none of them.
   */
  readonly outerCounters: {
    readonly atLaunch: Readonly<Record<string, number>>;
    readonly now: Readonly<Record<string, number>>;
  };
  /**
   * The approval of the phase attempt, when one was made: its nonce, the
   * phase attempt it belongs to, and when it was made.
   */
  readonly approval?: {
    readonly nonce: string;
    readonly phase: number;
    readonly attempt: number;
    readonly afterGate: boolean;
    readonly afterPassLoop: boolean;
  };
  /**
   * The inputs handed to critic-class calls (the rows the layer returned at
   * `contributeCriticInput`), each as a bag of fields.
   */
  readonly criticInputs?: readonly {
    readonly phase: number;
    readonly attempt: number;
    readonly fields: Readonly<Record<string, unknown>>;
  }[];
  /**
   * The passes recorded in the phase attempt, with the checks that were run
   * for them (from the event file) and the fingerprints at entry and exit.
   */
  readonly passes?: readonly {
    readonly unitId: string;
    readonly checkId: string;
    readonly result: string;
    readonly fingerprint?: string;
    readonly fingerprintAtEntry?: string;
  }[];
};

/** One event of the file, narrowed for the readers below. */
function fieldsOf(
  events: InvariantInput["events"],
  type: string,
): Readonly<Record<string, unknown>>[] {
  return events.filter((e) => e.type === type).map((e) => e.fields);
}

/**
 * True when the fact the finding concerns was already detected and refused
 * by the runtime: it stands in the event file as an `integrity.noted` with
 * the same kind, which is an integrity event and NOT a breach (F115-FR-039).
 */
export function isRefusal(input: InvariantInput, kind: BreachKind, detail: string): boolean {
  const map: Partial<Record<BreachKind, string>> = {
    "outer-counter-changed": "ledger-invalid",
    "false-pass": "manifest-mismatch",
  };
  const noted = map[kind];
  if (noted === undefined) return false;
  return (
    fieldsOf(input.events, "integrity.noted").some(
      (f) => f["kind"] === noted && String(f["detail"] ?? "").length > 0,
    ) && detail.length > 0
  );
}

/** `outer-counter-changed` — a counter of F115-FR-027 changed by an inner event. */
export function checkOuterCounters(input: InvariantInput): BreachFinding[] {
  const findings: BreachFinding[] = [];
  const inner = fieldsOf(input.events, "check.started");
  if (inner.length === 0) return findings;
  for (const key of Object.keys(input.outerCounters.atLaunch)) {
    const before = input.outerCounters.atLaunch[key];
    const now = input.outerCounters.now[key];
    if (now !== undefined && now !== before) {
      if (!isRefusal(input, "outer-counter-changed", key)) {
        findings.push({
          kind: "outer-counter-changed",
          ruleId: RULE_ID["outer-counter-changed"],
          detail: `outer counter ${key} changed from ${before} to ${now} while ${inner.length} inner event(s) ran`,
        });
      }
    }
  }
  return findings;
}

/** `approval-without-gate` — no critic reply matches the nonce. */
export function checkApproval(input: InvariantInput): BreachFinding[] {
  if (!input.approval) return [];
  const a = input.approval;
  const replies = fieldsOf(input.events, "verdict.recorded");
  const matches = replies.some((f) => f["nonceOk"] === true);
  if (matches) return [];
  if (!a.afterGate || !a.afterPassLoop) return [];
  return [
    {
      kind: "approval-without-gate",
      ruleId: RULE_ID["approval-without-gate"],
      detail: `approval of phase ${a.phase} attempt ${a.attempt} has no critic reply that matches the nonce`,
    },
  ];
}

/** `critic-input-excluded-field` — a field annex D §D.7 never holds. */
export function checkCriticInputs(input: InvariantInput): BreachFinding[] {
  const findings: BreachFinding[] = [];
  for (const row of input.criticInputs ?? []) {
    for (const name of FACT_BLOCK_EXCLUDED_FIELDS) {
      if (name in row.fields) {
        findings.push({
          kind: "critic-input-excluded-field",
          ruleId: RULE_ID["critic-input-excluded-field"],
          detail: `critic input of phase ${row.phase} attempt ${row.attempt} holds the excluded field ${name}`,
        });
      }
    }
  }
  return findings;
}

/** `false-pass` — a pass for a check that did not run, ran tainted, or differs in fingerprints. */
export function checkPasses(input: InvariantInput): BreachFinding[] {
  const findings: BreachFinding[] = [];
  const started = new Set(
    fieldsOf(input.events, "check.started").map((f) => String(f["checkId"] ?? "")),
  );
  for (const pass of input.passes ?? []) {
    if (pass.result !== "pass") continue;
    if (!started.has(pass.checkId)) {
      findings.push({
        kind: "false-pass",
        ruleId: RULE_ID["false-pass"],
        detail: `pass of unit ${pass.unitId} recorded for check ${pass.checkId} that never started`,
      });
      continue;
    }
    const ended = fieldsOf(input.events, "check.ended").find((f) => f["checkId"] === pass.checkId);
    if (ended && ended["condition"] === "tainted") {
      findings.push({
        kind: "false-pass",
        ruleId: RULE_ID["false-pass"],
        detail: `pass of unit ${pass.unitId} recorded for the tainted check ${pass.checkId}`,
      });
      continue;
    }
    if (
      pass.fingerprint !== undefined &&
      pass.fingerprintAtEntry !== undefined &&
      pass.fingerprint !== pass.fingerprintAtEntry
    ) {
      findings.push({
        kind: "false-pass",
        ruleId: RULE_ID["false-pass"],
        detail: `pass of unit ${pass.unitId} recorded under a fingerprint that differs from the one at entry`,
      });
    }
  }
  return findings;
}

/**
 * The invariant check over the event file and the ledger of one run
 * (F115-FR-039). A refusal the runtime already made is never a breach.
 */
export function checkInvariants(input: InvariantInput): readonly BreachFinding[] {
  const findings = [
    ...checkApproval(input),
    ...checkOuterCounters(input),
    ...checkCriticInputs(input),
    ...checkPasses(input),
  ];
  return findings.filter((f) => !isRefusal(input, f.kind, f.detail));
}
