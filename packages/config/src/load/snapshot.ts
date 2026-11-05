/**
 * T027 — the snapshot classes and the pins of the launch contract
 * (F110-FR-022, F110-FR-023).
 *
 * F110-FR-022 states four things:
 *
 * 1. The run snapshot holds, for each key, its value, its source rank and its
 *    class, and a secret reference as a reference (annex B §B.12) —
 *    `snapshotKeyRecord`, `snapshotKeys`, `buildRunSnapshot`.
 * 2. On `resume` a key of the class `pinned` ranks below flags and above the
 *    environment, and a key of the class `tunable` below the environment and
 *    above the project file, so that an exported value works on a resume —
 *    `PINNED_RANK_ON_RESUME`, `TUNABLE_RANK_ON_RESUME`, `snapshotRankOf`,
 *    `snapshotOffers`.
 * 3. The classes are those of the catalogue — `snapshotClassOf`, which reads
 *    the column "Class" of §K.1 and nothing else.
 * 4. A key that is not in the snapshot of an older run takes its value from
 *    the ranks below — `keysMissingFromSnapshot`, and `snapshotOffers`, which
 *    offers nothing for such a key.
 *
 * F110-FR-023 states five things:
 *
 * 1. The contract pin applies only to a key marked pinnable — `PINNABLE_KEYS`,
 *    `isPinnable`.
 * 2. And only in a child of the runtime root — the `inRuntimeRootChild` field
 *    of `contractPins`, whose refusal reason is
 *    `not-in-a-child-of-the-runtime-root`.
 * 3. The shell value of a pinned key is removed from the environment of the
 *    child — `childEnvironment`.
 * 4. Under the `parity` profile only `learning.mode` and `output.live` are
 *    honoured as pins — `PINNABLE_KEYS_UNDER_PARITY`.
 * 5. A manual run on the shell is not a run of a launch contract —
 *    `MANUAL_SHELL_RUN_IS_A_RUN_OF_A_LAUNCH_CONTRACT`.
 *
 * The rank numbers and the closed set of classes are feature 100's contract
 * (`@specstride/contracts`); this module never restates them.
 */
import {
  KEY_CLASS_DEFAULT,
  KEY_CLASSES,
  effectiveRank,
  rankOfLayer,
  type KeyClass,
} from "@specstride/contracts/envelope/config";
import SNAPSHOT_SCHEMA from "@specstride/contracts/schemas/run-snapshot.schema.json" with { type: "json" };

import { CATALOGUE_KEYS, matchCatalogueKey } from "../schema/catalogue.ts";
import { PROFILE_NAME } from "../schema/profile.ts";
import { derivedEnvironmentName } from "../schema/spelling.ts";
import { variablesOfKey } from "./alias.ts";
import type { ConfigOffer, MergedValue } from "./merge.ts";
import { isSecretReferenceValue } from "./provenance.ts";

/**
 * The schema id of the run snapshot (annex B §B.12). It is read off the shipped
 * schema of `@specstride/contracts` rather than spelled again here, because
 * feature 100 owns the record; the package exports its `schemas/` folder but
 * not the module of this record, so the id comes from the schema itself.
 */
export const SNAPSHOT_SCHEMA_ID: string = (SNAPSHOT_SCHEMA as { "x-schema-id": string })[
  "x-schema-id"
];

/** The closed set of classes of the run snapshot (annex X §X.6 row 76). */
export const SNAPSHOT_CLASSES: readonly string[] = KEY_CLASSES;

/** A key of the snapshot without a class is read as `pinned` (row 76). */
export const SNAPSHOT_CLASS_DEFAULT: KeyClass = KEY_CLASS_DEFAULT;

/** The code of the column "Class" of §K.1 that each class stands for. */
export const CLASS_OF_SNAPSHOT_CODE = Object.freeze({ p: "pinned", t: "tunable" } as const);

/**
 * F110-FR-022, third sentence — the class of a key is the one the catalogue
 * states. `p` is `pinned`, `t` is `tunable`, and a key the column leaves blank
 * is read as `pinned`, the default of row 76.
 */
export function snapshotClassOf(key: string): KeyClass {
  const code = matchCatalogueKey(key)?.entry.snapshot;
  if (code === "t") return "tunable";
  if (code === "p") return "pinned";
  return SNAPSHOT_CLASS_DEFAULT;
}

/** Every key of the catalogue of one class (F110-FR-022, third sentence). */
export function keysOfClass(cls: KeyClass): readonly string[] {
  return Object.freeze(CATALOGUE_KEYS.filter((key) => snapshotClassOf(key) === cls));
}

/* ------------------------------------------------------------------ *
 * F110-FR-022 — the run snapshot.
 * ------------------------------------------------------------------ */

/** The rank the run snapshot stands at for a pinned key (annex X §X.2). */
export const PINNED_RANK_ON_RESUME: number = rankOfLayer["run-snapshot"];

/**
 * The rank the run snapshot stands at for a tunable key: below the environment
 * (rank 4) and above the project file (rank 5), so that an exported value
 * works on a resume (F110-FR-022, second sentence).
 */
export const TUNABLE_RANK_ON_RESUME = 4.5 as const;

/** The rank of one key's snapshot value, whichever class the catalogue gives it. */
export function snapshotRankOf(key: string, onResume = true): number {
  return (
    effectiveRank("run-snapshot", { class: snapshotClassOf(key), onResume }) ??
    PINNED_RANK_ON_RESUME
  );
}

/** One key of the run snapshot (annex B §B.12, the field `keys`). */
export interface SnapshotKeyRecord {
  /** The resolved value, or the reference where the key holds a secret. */
  readonly value: unknown;
  /** The rank of annex X §X.2 the value came from. */
  readonly source: number;
  /** `pinned` or `tunable`, as the catalogue states it. */
  readonly class: KeyClass;
  /** For a learned value, the id of its decision (F110-FR-024). */
  readonly decisionId?: string | undefined;
  /** True where the value is a secret reference and never a secret value. */
  readonly isSecretReference?: true | undefined;
}

/**
 * F110-FR-022, first sentence — the snapshot record of one resolved key: its
 * value, its source rank and its class. A key of the type secret ref is
 * recorded as the reference it was written as, never resolved.
 */
export function snapshotKeyRecord(merged: MergedValue): SnapshotKeyRecord {
  const isReference = isSecretReferenceValue(merged.key, merged.value);
  return Object.freeze({
    value: merged.value,
    source: merged.rank,
    class: snapshotClassOf(merged.key),
    ...(merged.decisionId === undefined ? {} : { decisionId: merged.decisionId }),
    ...(isReference ? { isSecretReference: true as const } : {}),
  });
}

/** The field `keys` of the run snapshot, for every resolved key. */
export function snapshotKeys(
  values: ReadonlyMap<string, MergedValue>,
): Readonly<Record<string, SnapshotKeyRecord>> {
  const out: Record<string, SnapshotKeyRecord> = {};
  for (const key of [...values.keys()].sort()) {
    out[key] = snapshotKeyRecord(values.get(key) as MergedValue);
  }
  return Object.freeze(out);
}

/** What `buildRunSnapshot` is told beside the resolved configuration. */
export interface SnapshotRequest {
  readonly runId: string;
  /** The time of the first write, as the record carries it. */
  readonly createdAt: string;
  /** The profile in force, or `null` (annex B §B.12). */
  readonly profile?: string | undefined;
  readonly values: ReadonlyMap<string, MergedValue>;
  /** The hashes of `spec`, `plan` and `tasks`, which feature 102 computes. */
  readonly sourceHashes?: Readonly<Record<string, unknown>> | undefined;
}

/** The run snapshot as annex B §B.12 shapes it, for the keys this feature owns. */
export interface RunSnapshotRecord {
  readonly schema: string;
  readonly runId: string;
  readonly createdAt: string;
  readonly profile: string | null;
  readonly keys: Readonly<Record<string, SnapshotKeyRecord>>;
  readonly sourceHashes: Readonly<Record<string, unknown>>;
}

/**
 * F110-FR-022 — the run snapshot of one resolved configuration. Feature 102
 * writes it and feature 100 owns the record; this builds the part that is this
 * feature's: the value, the source rank and the class of every key.
 */
export function buildRunSnapshot(request: SnapshotRequest): RunSnapshotRecord {
  return Object.freeze({
    schema: SNAPSHOT_SCHEMA_ID,
    runId: request.runId,
    createdAt: request.createdAt,
    profile: request.profile ?? null,
    keys: snapshotKeys(request.values),
    sourceHashes: Object.freeze({ ...(request.sourceHashes ?? {}) }),
  });
}

/**
 * F110-FR-022 — the offers of rank 3 from a run snapshot. Each offer carries
 * the layer `run-snapshot`; `mergeKey` then places it at rank 3 for a pinned
 * key and at rank 4.5 for a tunable one, through `effectiveRank` of feature
 * 100. A key the snapshot does not hold is offered nothing, so it takes its
 * value from the ranks below (F110-FR-022, last sentence).
 */
export function snapshotOffers(
  snapshot: Readonly<Record<string, SnapshotKeyRecord | unknown>>,
): readonly ConfigOffer[] {
  const offers: ConfigOffer[] = [];
  for (const [key, record] of Object.entries(snapshot)) {
    const value =
      record !== null && typeof record === "object" && "value" in record
        ? (record as SnapshotKeyRecord).value
        : record;
    const decisionId =
      record !== null && typeof record === "object" && "decisionId" in record
        ? (record as SnapshotKeyRecord).decisionId
        : undefined;
    offers.push(
      Object.freeze({
        key,
        layer: "run-snapshot",
        value,
        place: "the run snapshot",
        ...(decisionId === undefined ? {} : { decisionId }),
      }),
    );
  }
  return Object.freeze(offers);
}

/** The plain `key: value` map `LayerSources.snapshot` takes, from a record. */
export function snapshotValues(
  keys: Readonly<Record<string, SnapshotKeyRecord>>,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, record] of Object.entries(keys)) out[key] = record.value;
  return Object.freeze(out);
}

/**
 * F110-FR-022, last sentence — the keys of a request that the snapshot of an
 * older run does not hold. Each takes its value from the ranks below; nothing
 * is invented for it.
 */
export function keysMissingFromSnapshot(
  snapshot: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): readonly string[] {
  return Object.freeze(keys.filter((key) => !Object.hasOwn(snapshot, key)));
}

/** F110-FR-022, last sentence, as a named fact. */
export const A_KEY_ABSENT_FROM_AN_OLDER_SNAPSHOT_TAKES_THE_RANKS_BELOW = true as const;

/* ------------------------------------------------------------------ *
 * F110-FR-023 — the pins of the launch contract.
 * ------------------------------------------------------------------ */

/** The rank the pins of the launch contract stand at (annex X §X.2, rank 1). */
export const PIN_RANK: number = rankOfLayer["launch-contract-pin"];

/** F110-FR-023, second sentence — the three pinnable keys. */
export const PINNABLE_KEYS: readonly string[] = Object.freeze([
  "learning.mode",
  "learning.through",
  "output.live",
]);

/**
 * F110-FR-023, fourth sentence — under the `parity` profile only two of the
 * three are honoured as pins, as at the baseline (row 38 of annex X §X.7,
 * DV-026).
 */
export const PINNABLE_KEYS_UNDER_PARITY: readonly string[] = Object.freeze([
  "learning.mode",
  "output.live",
]);

/** F110-FR-023, last sentence — a manual run on the shell pins nothing. */
export const MANUAL_SHELL_RUN_IS_A_RUN_OF_A_LAUNCH_CONTRACT = false as const;

/** The pinnable keys under a profile: two under `parity`, three otherwise. */
export function pinnableKeys(profile?: string | undefined): readonly string[] {
  return profile === PROFILE_NAME ? PINNABLE_KEYS_UNDER_PARITY : PINNABLE_KEYS;
}

/** F110-FR-023, first and second sentences — may the contract pin this key? */
export function isPinnable(key: string, profile?: string | undefined): boolean {
  return pinnableKeys(profile).includes(key);
}

/** Why a declared pin was not honoured (F110-FR-023). */
export const PIN_REFUSAL_REASONS = [
  "not-pinnable",
  "not-honoured-under-parity",
  "not-in-a-child-of-the-runtime-root",
] as const;
export type PinRefusalReason = (typeof PIN_REFUSAL_REASONS)[number];

/** One declared pin the contract did not get (F110-FR-023). */
export interface RefusedPin {
  readonly key: string;
  readonly value: unknown;
  readonly reason: PinRefusalReason;
  readonly message: string;
}

/** What the launch contract is told about the run it is pinning. */
export interface PinContext {
  /** The profile in force; under `parity` only two keys are honoured. */
  readonly profile?: string | undefined;
  /**
   * True in a child of the runtime root, which is the only place a pin applies
   * (F110-FR-023, first sentence). A manual run on the shell is not one.
   */
  readonly inRuntimeRootChild: boolean;
}

/** The pins the contract gets, and the declarations it did not get. */
export interface PinOutcome {
  /** The honoured pins, by key: the offers of rank 1. */
  readonly pins: Readonly<Record<string, unknown>>;
  readonly refused: readonly RefusedPin[];
  /** The honoured pins as offers of rank 1. */
  readonly offers: readonly ConfigOffer[];
}

/**
 * F110-FR-023 — the pins a launch contract actually applies.
 *
 * A key that is not pinnable is refused with `not-pinnable`; one that is
 * pinnable but not honoured under the profile in force with
 * `not-honoured-under-parity`; and every declaration outside a child of the
 * runtime root with `not-in-a-child-of-the-runtime-root` — which is what makes
 * a manual run on the shell no run of a launch contract.
 */
export function contractPins(
  declared: Readonly<Record<string, unknown>>,
  context: PinContext,
): PinOutcome {
  const pins: Record<string, unknown> = {};
  const refused: RefusedPin[] = [];
  const offers: ConfigOffer[] = [];
  for (const [key, value] of Object.entries(declared)) {
    if (!context.inRuntimeRootChild) {
      refused.push(
        Object.freeze({
          key,
          value,
          reason: "not-in-a-child-of-the-runtime-root" as const,
          message:
            `the launch contract does not pin \`${key}\`: a pin applies only in a child of ` +
            `the runtime root, and a manual run on the shell is no run of a launch contract`,
        }),
      );
      continue;
    }
    if (!PINNABLE_KEYS.includes(key)) {
      refused.push(
        Object.freeze({
          key,
          value,
          reason: "not-pinnable" as const,
          message:
            `the launch contract does not pin \`${key}\`: the pinnable keys are ` +
            `\`${PINNABLE_KEYS.join("`, `")}\``,
        }),
      );
      continue;
    }
    if (!isPinnable(key, context.profile)) {
      refused.push(
        Object.freeze({
          key,
          value,
          reason: "not-honoured-under-parity" as const,
          message:
            `the launch contract does not pin \`${key}\` under the profile ` +
            `\`${PROFILE_NAME}\`: only \`${PINNABLE_KEYS_UNDER_PARITY.join("` and `")}\` are ` +
            `honoured as pins there, as at the baseline (row 38 of annex X §X.7)`,
        }),
      );
      continue;
    }
    pins[key] = value;
    offers.push(
      Object.freeze({
        key,
        layer: "launch-contract-pin",
        value,
        place: "the launch contract",
      }),
    );
  }
  return Object.freeze({
    pins: Object.freeze(pins),
    refused: Object.freeze(refused),
    offers: Object.freeze(offers),
  });
}

/**
 * Every environment name that carries a key: the as-is names of the alias
 * table of §K.8 and the derived name of §K.2 rule 3. The shell value of a
 * pinned key is removed under each of them.
 */
export function environmentNamesOfKey(key: string): readonly string[] {
  return Object.freeze([...new Set([...variablesOfKey(key), derivedEnvironmentName(key)])]);
}

/** The environment of a child, and the names the pins removed from it. */
export interface ChildEnvironment {
  readonly environment: Readonly<Record<string, string>>;
  /** Every name removed, with the pinned key it carried. */
  readonly removed: readonly { readonly name: string; readonly key: string }[];
}

/**
 * F110-FR-023, third sentence — the shell value of a pinned key is removed
 * from the environment of the child. Every name the key has is removed: the
 * as-is name of §K.8 and the derived name of §K.2 rule 3, so that an exported
 * value cannot reach the child under either spelling.
 */
export function childEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  pins: Readonly<Record<string, unknown>>,
): ChildEnvironment {
  const removed: { name: string; key: string }[] = [];
  const out: Record<string, string> = {};
  const byName = new Map<string, string>();
  for (const key of Object.keys(pins)) {
    for (const name of environmentNamesOfKey(key)) byName.set(name, key);
  }
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    const pinnedKey = byName.get(name);
    if (pinnedKey !== undefined) {
      removed.push({ name, key: pinnedKey });
      continue;
    }
    out[name] = value;
  }
  return Object.freeze({
    environment: Object.freeze(out),
    removed: Object.freeze(removed.map((r) => Object.freeze(r))),
  });
}
