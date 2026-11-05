/**
 * T057 of feature 103 — THE READ-ONLY VIEW OF THE PHASE ATTEMPT that a loop
 * layer is given (F103-FR-024, F103-FR-028; annex D §D.1, "Inputs").
 *
 * A layer reads the phase attempt and writes nothing of it. The view is the
 * whole of what it reads: the phase, the phase attempt, the counters, the
 * check manifest and the fingerprints, and — with parallel units on — the
 * worker id and the group id. With parallel units off BOTH are absent, which
 * is a different thing from present and `undefined`: `OMITTED_WITH_UNITS_OFF`
 * names them and `phaseAttemptView` leaves the keys out altogether, so that
 * `"workerId" in view` is false and a layer cannot read an absent id as a
 * value.
 *
 * ## Read-only is construction, not convention
 *
 * `phaseAttemptView` freezes the record and every record inside it, and
 * `viewIsReadOnly` is the check a test makes of that. Nothing of the view is
 * a handle: a path, a writer, a harness or a counter of the outer loop would
 * each be a way out of the namespace, and `WITHHELD_FROM_EVERY_LAYER` of
 * `@specstride/contracts` is the list of what is kept out by construction
 * (F103-FR-028). `withheldKeysOnTheView` reports any key of a view that names
 * one of them, so the rule is checked and not merely stated.
 *
 * ## A layer holds no state outside its namespace
 *
 * The view carries no mutable structure a layer could park state in, and the
 * ledger namespace a layer writes through the engine is `./directives.ts`.
 * This module offers a layer nothing to write.
 */
import { WITHHELD_FROM_EVERY_LAYER } from "@specstride/contracts/ep/loop-layer";
import type { PhaseAttemptView } from "@specstride/contracts/ep/loop-layer";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F103-FR-024", "F103-FR-028"] as const;

/** What no layer is given, whatever it declares (F103-FR-028). */
export const WITHHELD = WITHHELD_FROM_EVERY_LAYER;

/** F103-FR-024 — the two keys that are ABSENT with parallel units off. */
export const OMITTED_WITH_UNITS_OFF = ["workerId", "groupId"] as const;

/** What the engine knows of a phase attempt when it builds the view. */
export type PhaseAttemptFacts = {
  readonly phase: number;
  readonly attempt: number;
  readonly counters: Readonly<Record<string, number>>;
  readonly checkManifest: readonly { readonly id: string }[];
  readonly fingerprints: Readonly<Record<string, string>>;
  /** Only with parallel units on; absent from the view otherwise. */
  readonly workerId?: string;
  /** Only with parallel units on; absent from the view otherwise. */
  readonly groupId?: string;
};

/**
 * F103-FR-024 — the read-only view of the phase attempt.
 *
 * Every level is frozen, the counters and the fingerprints are copied so that
 * a later change by the engine cannot reach a view a layer already holds, and
 * `workerId` and `groupId` are present only where the caller gave them.
 */
export function phaseAttemptView(facts: PhaseAttemptFacts): PhaseAttemptView {
  const view: Record<string, unknown> = {
    phase: facts.phase,
    attempt: facts.attempt,
    counters: Object.freeze({ ...facts.counters }),
    checkManifest: Object.freeze(facts.checkManifest.map((c) => Object.freeze({ id: c.id }))),
    fingerprints: Object.freeze({ ...facts.fingerprints }),
  };
  // F103-FR-024 — with parallel units off the KEY is absent, not undefined.
  if (facts.workerId !== undefined) view.workerId = facts.workerId;
  if (facts.groupId !== undefined) view.groupId = facts.groupId;
  return Object.freeze(view) as PhaseAttemptView;
}

/**
 * F103-FR-024 — true where the view and every record inside it are frozen, so
 * that a layer that tries to write one changes nothing.
 */
export function viewIsReadOnly(view: PhaseAttemptView): boolean {
  if (!Object.isFrozen(view)) return false;
  if (!Object.isFrozen(view.counters)) return false;
  if (!Object.isFrozen(view.fingerprints)) return false;
  if (!Object.isFrozen(view.checkManifest)) return false;
  return view.checkManifest.every((entry) => Object.isFrozen(entry));
}

/**
 * The words that would give a layer one of the withheld things if a view ever
 * carried a key named after it (F103-FR-028). A key is matched case-blind on
 * the whole key, so `repository`, `writeRoot` or `ledgerWriter` is caught
 * whatever a later feature calls it.
 */
const WITHHELD_KEY_WORDS = [
  "approval",
  "verdict",
  "feedback",
  "hint",
  "recovery",
  "harness",
  "handle",
  "writer",
  "ledger",
  "event",
  "repository",
  "repo",
  "workspace",
  "worktree",
  "writeroot",
  "path",
  "outerloop",
] as const;

/**
 * F103-FR-028 — the keys of a view that name a withheld thing. The list is
 * empty for a view this module built; a test asserts that, so the rule is
 * observed rather than asserted in prose.
 */
export function withheldKeysOnTheView(view: PhaseAttemptView): readonly string[] {
  const keys = Object.keys(view as Readonly<Record<string, unknown>>);
  return Object.freeze(
    keys.filter((key) => {
      const flat = key.toLowerCase();
      return WITHHELD_KEY_WORDS.some((word) => flat.includes(word));
    }),
  );
}
