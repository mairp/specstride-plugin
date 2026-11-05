/**
 * T017 — per-phase inheritance, the declared default and the learned place
 * (F110-FR-015).
 *
 * F110-FR-015 fixes four things:
 *
 * 1. A per-phase key of §K.4 refines the role key of the same name, and a
 *    per-phase key that no rank sets takes the value of the role key, whichever
 *    rank set that.
 * 2. The value that the verification-commands document declares for a phase is
 *    the **default** of the per-phase timeout key — rank 8, not a rank of its
 *    own.
 * 3. A learned value for a per-phase key or for `loop.yield.pollSec` applies
 *    only when `learning.mode` resolves to `apply`, and only for the knobs that
 *    feature 106 allows.
 * 4. So the order of the pass ceiling is, as at the baseline: an explicit
 *    per-phase setting, the learned value, the value declared by the document,
 *    the role key. For the poll interval it is: an explicit setting, the learned
 *    value, the default. The source of a learned value carries the id of its
 *    decision.
 *
 * The two knobs and the mode are feature 106's: F106-FR-001 locks the allowlist
 * to `proposer_timeout` and `yield_poll_interval`, and F106-FR-010 places a
 * learned pass ceiling at rank 7. This module names them and never widens them.
 */
import { rankOfLayer, type RankLayer } from "@specstride/contracts/envelope/config";

import { CATALOGUE, catalogueEntry, matchCatalogueKey } from "../schema/catalogue.ts";
import type { KeyEntry } from "../schema/types.ts";
import { mergeKey, type ConfigOffer, type MergedValue } from "./merge.ts";

/** The prefix of every per-phase key of §K.4. */
export const PER_PHASE_PREFIX = "phases.";

/** The template keys of §K.4, as the catalogue spells them. */
export const PER_PHASE_KEYS: readonly string[] = Object.freeze(
  CATALOGUE.filter((e) => e.key.startsWith(PER_PHASE_PREFIX)).map((e) => e.key),
);

/** The rank a learned value stands at: rank 7 (annex X §X.2; F106-FR-010). */
export const LEARNED_RANK: number = rankOfLayer["learned-value"];

/** The rank the declared value and every other default stand at: rank 8. */
export const DEFAULT_RANK: number = rankOfLayer["default"];

/**
 * F106-FR-001 — the two knobs learning may ever change. The set is locked:
 * feature 106 refuses a knob outside it, and this module reads no other.
 */
export const LEARNABLE_KNOBS = ["proposer_timeout", "yield_poll_interval"] as const;
export type LearnableKnob = (typeof LEARNABLE_KNOBS)[number];

/** The key of the catalogue each knob of F106-FR-001 adjusts. */
export const KEY_OF_KNOB: Readonly<Record<LearnableKnob, string>> = Object.freeze({
  proposer_timeout: "phases.<N>.proposer.timeoutSec",
  yield_poll_interval: "loop.yield.pollSec",
});

/** The one mode under which a learned value applies (F110-FR-015, F106-FR-010). */
export const LEARNING_MODE_THAT_APPLIES = "apply" as const;

/**
 * F110-FR-015, third sentence — a learned value applies only when
 * `learning.mode` resolves to `apply`, and only for a knob of the allowlist.
 */
export function learnedApplies(learningMode: string | undefined, knob: string): boolean {
  if (learningMode !== LEARNING_MODE_THAT_APPLIES) return false;
  return (LEARNABLE_KNOBS as readonly string[]).includes(knob);
}

/**
 * The phase number of a per-phase key, or `undefined` where the key is not one.
 * `<N>` is the phase number as the spec-format adapter gives it, as text (§K.4).
 */
export function phaseOf(key: string): string | undefined {
  const m = /^phases\.([^.]+)\./.exec(key);
  return m === null ? undefined : (m[1] as string);
}

/** The per-phase key of a phase and a tail: `phases.3.proposer.timeoutSec`. */
export function phaseKeyOf(phase: string, tail: string): string {
  return `${PER_PHASE_PREFIX}${phase}.${tail}`;
}

/**
 * F110-FR-015, first sentence — the role key a per-phase key refines: the key of
 * the same name without the phase.
 *
 * `phases.<N>.proposer.timeoutSec` refines `roles.proposer.timeoutSec`;
 * `phases.<N>.budget.*` refines "the key without the phase" (§K.4), which is the
 * key of the same last segment under `budget.run`, else under
 * `budget.role.<role>`.
 */
export function roleKeyOfPhaseKey(phaseKey: string): string | undefined {
  const budget = /^phases\.[^.]+\.budget\.(.+)$/.exec(phaseKey);
  if (budget !== null) {
    const tail = budget[1] as string;
    if (catalogueEntry(`budget.run.${tail}`) !== undefined) return `budget.run.${tail}`;
    if (catalogueEntry(`budget.role.<role>.${tail}`) !== undefined) {
      return `budget.role.<role>.${tail}`;
    }
    return undefined;
  }
  const m = /^phases\.[^.]+\.(.+)$/.exec(phaseKey);
  if (m === null) return undefined;
  const candidate = `roles.${m[1] as string}`;
  return catalogueEntry(candidate) === undefined ? undefined : candidate;
}

/** Every per-phase key of §K.4, with the role key it refines (F110-FR-015). */
export function perPhaseInheritance(): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const key of PER_PHASE_KEYS) {
    const role = roleKeyOfPhaseKey(key.replace("<N>", "1"));
    if (role !== undefined) out.set(key, role);
  }
  return out;
}

/** Which step of the order of F110-FR-015 gave the value. */
export const PASS_CEILING_ORDER = [
  "an explicit per-phase setting",
  "the learned value",
  "the value declared by the verification-commands document",
  "the role key",
] as const;
export type PassCeilingStep = (typeof PASS_CEILING_ORDER)[number];

/** Which step of the order of F110-FR-015 gave the poll interval. */
export const POLL_INTERVAL_ORDER = [
  "an explicit setting",
  "the learned value",
  "the default",
] as const;
export type PollIntervalStep = (typeof POLL_INTERVAL_ORDER)[number];

/** The value of one per-phase key, with the step of the order that gave it. */
export interface PhaseResolution {
  /** The per-phase key, with `<N>` bound to the phase. */
  readonly key: string;
  readonly phase: string | undefined;
  readonly value: unknown;
  /** The rank layer the value came from. */
  readonly source: RankLayer;
  readonly rank: number;
  readonly place?: string | undefined;
  /** The id of the decision, for a learned value (F110-FR-015, last sentence). */
  readonly decisionId?: string | undefined;
  /** The role key the value was inherited from, where it was (F110-FR-015). */
  readonly inheritedFrom?: string | undefined;
  /** The step of the order of the requirement that gave the value. */
  readonly step: PassCeilingStep | PollIntervalStep | "the role key";
}

/** A value the verification-commands document declares for one phase (§K.4). */
export interface DeclaredByDocument {
  readonly value: unknown;
  /** Where the document says it, for the provenance record. */
  readonly place?: string | undefined;
}

/** A learned value with the id of the decision that recorded it. */
export interface LearnedForPhase {
  readonly value: unknown;
  readonly decisionId: string;
  /** The knob of F106-FR-001 the decision adjusted. */
  readonly knob: LearnableKnob;
}

/** What the caller knows when it resolves one per-phase key. */
export interface PhaseRequest {
  /** The per-phase key with `<N>` bound: `phases.3.proposer.timeoutSec`. */
  readonly key: string;
  /** Every offer of every rank, for the per-phase key and for the role key. */
  readonly offers: readonly ConfigOffer[];
  /** The value the verification-commands document declares for the phase. */
  readonly declared?: DeclaredByDocument | undefined;
  /** The learned value of the knob for this phase. */
  readonly learned?: LearnedForPhase | undefined;
  /** The resolved `learning.mode`. */
  readonly learningMode?: string | undefined;
  readonly onResume?: boolean | undefined;
}

/** The offers of one key, with no offer of the rank of the default. */
const explicitOffers = (offers: readonly ConfigOffer[], key: string): readonly ConfigOffer[] =>
  offers.filter((o) => o.key === key && o.layer !== "default" && o.layer !== "learned-value");

const fromMerged = (
  key: string,
  merged: MergedValue,
  step: PhaseResolution["step"],
  extra: { inheritedFrom?: string } = {},
): PhaseResolution =>
  Object.freeze({
    key,
    phase: phaseOf(key),
    value: merged.value,
    source: merged.source,
    rank: merged.rank,
    ...(merged.place === undefined ? {} : { place: merged.place }),
    ...(merged.decisionId === undefined ? {} : { decisionId: merged.decisionId }),
    ...(extra.inheritedFrom === undefined ? {} : { inheritedFrom: extra.inheritedFrom }),
    step,
  });

/**
 * F110-FR-015, first and second sentence — resolve a per-phase key that is not a
 * learnable knob: an explicit setting of the per-phase key at any rank wins, and
 * with none the value of the role key applies, whichever rank set that.
 */
export function resolvePhaseKey(request: PhaseRequest): PhaseResolution | undefined {
  const { key, offers } = request;
  const options = { onResume: request.onResume };
  const own = mergeKey(key, explicitOffers(offers, key), options);
  if (own !== undefined) return fromMerged(key, own, "an explicit per-phase setting");
  const roleKey = roleKeyOfPhaseKey(key);
  if (roleKey === undefined) return undefined;
  const role = mergeKey(roleKey, offers, options);
  if (role === undefined) return undefined;
  return fromMerged(key, role, "the role key", { inheritedFrom: roleKey });
}

/**
 * F110-FR-015, fourth sentence — the order of the pass ceiling, as at the
 * baseline: an explicit per-phase setting, the learned value, the value declared
 * by the verification-commands document, the role key.
 *
 * The declared value stands at the rank of the default (rank 8), which is what
 * puts it under the learned value of rank 7 and over nothing else; the role key
 * is the last resort, and keeps the rank that set it.
 */
export function resolvePassCeiling(request: PhaseRequest): PhaseResolution | undefined {
  const { key, offers } = request;
  const options = { onResume: request.onResume };

  const own = mergeKey(key, explicitOffers(offers, key), options);
  if (own !== undefined) return fromMerged(key, own, "an explicit per-phase setting");

  const learned = request.learned;
  if (learned !== undefined && learnedApplies(request.learningMode, learned.knob)) {
    return Object.freeze({
      key,
      phase: phaseOf(key),
      value: learned.value,
      source: "learned-value" as RankLayer,
      rank: LEARNED_RANK,
      place: `the decision \`${learned.decisionId}\``,
      decisionId: learned.decisionId,
      step: "the learned value",
    });
  }

  if (request.declared !== undefined) {
    return Object.freeze({
      key,
      phase: phaseOf(key),
      value: request.declared.value,
      source: "default" as RankLayer,
      rank: DEFAULT_RANK,
      place: request.declared.place ?? "the verification-commands document",
      step: "the value declared by the verification-commands document",
    });
  }

  const roleKey = roleKeyOfPhaseKey(key);
  if (roleKey === undefined) return undefined;
  const role = mergeKey(roleKey, offers, options);
  if (role === undefined) return undefined;
  return fromMerged(key, role, "the role key", { inheritedFrom: roleKey });
}

/** The key whose learned value is the poll interval (F106-FR-001). */
export const POLL_INTERVAL_KEY: string = KEY_OF_KNOB.yield_poll_interval;

/**
 * F110-FR-015, fourth sentence, second half — the order of the poll interval: an
 * explicit setting, the learned value, the default.
 */
export function resolvePollInterval(request: {
  readonly offers: readonly ConfigOffer[];
  readonly learned?: LearnedForPhase | undefined;
  readonly learningMode?: string | undefined;
  readonly onResume?: boolean | undefined;
}): PhaseResolution | undefined {
  const key = POLL_INTERVAL_KEY;
  const options = { onResume: request.onResume };
  const own = mergeKey(key, explicitOffers(request.offers, key), options);
  if (own !== undefined) return fromMerged(key, own, "an explicit setting");

  const learned = request.learned;
  if (learned !== undefined && learnedApplies(request.learningMode, learned.knob)) {
    return Object.freeze({
      key,
      phase: undefined,
      value: learned.value,
      source: "learned-value" as RankLayer,
      rank: LEARNED_RANK,
      place: `the decision \`${learned.decisionId}\``,
      decisionId: learned.decisionId,
      step: "the learned value",
    });
  }

  const merged = mergeKey(key, request.offers, options);
  if (merged !== undefined) return fromMerged(key, merged, "the default");
  const entry = catalogueEntry(key);
  if (entry === undefined || entry.default.kind === "deferred") return undefined;
  return Object.freeze({
    key,
    phase: undefined,
    value: entry.default.value,
    source: "default" as RankLayer,
    rank: DEFAULT_RANK,
    place: "the built-in default of the catalogue",
    step: "the default",
  });
}

/** The catalogue entry of a per-phase key, with `<N>` bound or not. */
export function phaseEntryOf(key: string): KeyEntry | undefined {
  return matchCatalogueKey(key)?.entry;
}
