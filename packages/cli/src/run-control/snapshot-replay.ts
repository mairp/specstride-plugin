/**
 * T044 — the replay of the run snapshot with ranks (F102-FR-027, F102-FR-028,
 * F102-FR-029) and the re-validation of the replayed values against the schema
 * and the trust classes (F102-FR-024, `settings-invalid`).
 *
 * THE RANKS (F102-FR-027; contracts/snapshot-classes.md; annex X §X.2). On
 * resume every key of the snapshot is resolved again through the ladder:
 *
 *   1   the pin of the launch contract  — above EVERY flag and both classes,
 *       for the pinnable keys of a child of the runtime root only;
 *   2   a flag given to `resume`        — above both classes (F102-FR-029,
 *       which is the as-is form of the same rule: the arguments are applied
 *       after the replayed settings, and the last one wins);
 *   3   the snapshot value of a PINNED key  — below the flags, above the
 *       environment: identity stays stable;
 *   4   the environment                     — above the tunable snapshot;
 *   4.5 the snapshot value of a TUNABLE key — below the environment, above
 *       the project configuration: an exported value works on a resume;
 *   5   project configuration.
 *
 * The snapshot itself is NEVER written by the replay: it keeps the value of
 * the launch (F102-FR-027, last sentence). Every key whose resolved value
 * differs from the snapshot is RECORDED with the old value, the new value and
 * the rank that won (`changes`).
 *
 * F102-FR-028 — the settings the baseline replays are replayed; a key whose
 * snapshot value was EMPTY is not replayed at all, so it takes the ranks
 * below. The path of the verification plan stays the plan of the run and the
 * verification commands stay as they were recorded, before they were resolved
 * to a path — the replay resolves no path and rewrites no text.
 *
 * THE RE-VALIDATION (F102-FR-024). Every replayed value is validated against
 * the config schema again (`validateKeyValue`, at the layer that won), and
 * against the trust classes: a key of the class `widening` may take its value
 * from the user file, the environment and flags only (F110-FR-019), so a
 * widening value that the snapshot or the project file would replay is
 * refused. A value that fails either is `settings-invalid`: `resume` exits 3
 * and names the key.
 */
import { PIN_RANK, isPinnable, trustClassOf, validateKeyValue } from "@specstride/config";
import type { SnapshotKeyRecord } from "@specstride/config";

/** The requirement numbers this module carries out. */
export const REQUIREMENTS = ["F102-FR-024", "F102-FR-027", "F102-FR-028", "F102-FR-029"] as const;

/** The ranks of the replay ladder (F102-FR-027; annex X §X.2). */
export const REPLAY_RANKS = Object.freeze({
  launchContractPin: PIN_RANK,
  flag: 2,
  pinnedSnapshot: 3,
  environment: 4,
  tunableSnapshot: 4.5,
  projectConfiguration: 5,
} as const);

/**
 * F102-FR-027 — the pin of the launch contract (rank 1, children of the
 * runtime root only) stays above every flag and both classes.
 */
export const THE_PIN_OF_THE_LAUNCH_CONTRACT_STAYS_ABOVE_EVERY_FLAG = true as const;

/**
 * F102-FR-029 — the arguments given to `resume` are applied AFTER the
 * replayed settings, and the last one wins: the flags stand at rank 2, above
 * both classes. This is the as-is form of the rank rule of F102-FR-027.
 */
export const LAST_FLAG_WINS = true as const;

/** F102-FR-028 — a key that was empty is not replayed; it takes the ranks below. */
export const A_KEY_THAT_WAS_EMPTY_IS_NOT_REPLAYED = true as const;

/** F102-FR-027, last sentence — the snapshot keeps the value of the launch. */
export const THE_SNAPSHOT_KEEPS_THE_VALUE_OF_THE_LAUNCH = true as const;

/** F102-FR-028 — the replay resolves no path and rewrites no recorded text. */
export const THE_REPLAY_RESOLVES_NO_PATH = true as const;

/** The refusal a failed re-validation is (F102-FR-024). */
export const A_FAILED_REPLAY_IS_SETTINGS_INVALID = "settings-invalid" as const;

/** Why one replayed value failed the re-validation (F102-FR-024). */
export type ReplayRefusalReason = "schema" | "trust-class";

/** What the replay was given. */
export interface ReplayInput {
  /** The run snapshot record (or bare `keys` map) of the run. */
  readonly snapshot: Readonly<Record<string, unknown>>;
  /** The flags given to `resume`, applied after the replay (F102-FR-029). */
  readonly flags?: Readonly<Record<string, unknown>> | undefined;
  /** The pins of the launch contract (rank 1; children of the runtime root). */
  readonly contractPins?: Readonly<Record<string, unknown>> | undefined;
  /** The environment of the resume (rank 4). */
  readonly environment?: Readonly<Record<string, unknown>> | undefined;
  /** Project configuration (rank 5), the lowest layer of the ladder. */
  readonly project?: Readonly<Record<string, unknown>> | undefined;
  /** The profile in force (`parity` narrows the pinnable keys). */
  readonly profile?: string | undefined;
  /** True in a child of the runtime root, the only place a pin applies. */
  readonly inRuntimeRootChild?: boolean | undefined;
}

/** One key as the replay resolved it. */
export interface ReplayedKey {
  readonly key: string;
  readonly value: unknown;
  /** The rank that won (annex X §X.2). */
  readonly rank: number;
  /** Where the winning value came from, in words. */
  readonly source: string;
  /** The class of the key: `pinned` or `tunable`; none is `pinned`. */
  readonly class: "pinned" | "tunable";
  /** True where the snapshot held no value for the key (it took the ranks below). */
  readonly missingFromSnapshot: boolean;
}

/** F102-FR-027 — a key whose resolved value differs from the snapshot. */
export interface ChangedValue {
  readonly key: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
  /** The rank of the layer the new value came from. */
  readonly rank: number;
}

/** A replay that passed the re-validation (F102-FR-024). */
export interface ReplaySuccess {
  readonly ok: true;
  /** The resolved value of every key, by key. */
  readonly values: Readonly<Record<string, unknown>>;
  /** Every key, with the rank and the source that won. */
  readonly keys: readonly ReplayedKey[];
  /** F102-FR-027 — every key whose value differs from the snapshot. */
  readonly changes: readonly ChangedValue[];
}

/** A replay that failed the re-validation: `resume` refuses `settings-invalid`. */
export interface ReplayRefused {
  readonly ok: false;
  /** The key that failed; the refusal names it (F102-FR-024). */
  readonly key: string;
  readonly reason: ReplayRefusalReason;
  readonly message: string;
}

export type ReplayResult = ReplaySuccess | ReplayRefused;

const EMPTY_VALUES: readonly unknown[] = [undefined, null, ""];

/** True where a snapshot value counts as empty (F102-FR-028: not replayed). */
function isEmptyValue(value: unknown): boolean {
  return EMPTY_VALUES.includes(value as never);
}

const frozen = <T>(value: T): T => Object.freeze(value) as T;

/**
 * T044 — replay the run snapshot with the ranks of F102-FR-027 and
 * re-validate every replayed value against the schema and the trust classes
 * (F102-FR-024). Pure: it writes nothing, and the snapshot keeps the value of
 * the launch.
 */
export function replayRunSnapshot(input: ReplayInput): ReplayResult {
  const snapshotKeys = ((input.snapshot as { keys?: Readonly<Record<string, unknown>> } | undefined)
    ?.keys ?? input.snapshot) as Readonly<Record<string, unknown>>;
  const flags = input.flags ?? {};
  const contractPins = input.contractPins ?? {};
  const environment = input.environment ?? {};
  const project = input.project ?? {};

  const names = new Set<string>([
    ...Object.keys(snapshotKeys),
    ...Object.keys(flags),
    ...Object.keys(contractPins),
    ...Object.keys(environment),
    ...Object.keys(project),
  ]);

  const values: Record<string, unknown> = {};
  const keys: ReplayedKey[] = [];
  const changes: ChangedValue[] = [];

  for (const key of [...names].sort()) {
    const record = snapshotKeys[key] as SnapshotKeyRecord | undefined;
    const snapshotValue = record === undefined ? undefined : record.value;
    const missingFromSnapshot = record === undefined;
    const cls: "pinned" | "tunable" = record?.class ?? "pinned";

    // F102-FR-028 — a key that was empty is not replayed: it takes the ranks
    // below, so the snapshot offers nothing for it.
    const snapshotOffers = !isEmptyValue(snapshotValue);

    // The ladder of F102-FR-027: pin above every flag; the flags above both
    // classes (F102-FR-029); pinned above the environment; tunable below it.
    let value: unknown = undefined;
    let rank = 0;
    let source = "";
    if (
      Object.hasOwn(contractPins, key) &&
      isPinnable(key, input.profile) &&
      input.inRuntimeRootChild === true
    ) {
      value = contractPins[key];
      rank = REPLAY_RANKS.launchContractPin;
      source = "the launch contract";
    } else if (Object.hasOwn(flags, key)) {
      value = flags[key];
      rank = REPLAY_RANKS.flag;
      source = "a flag";
    } else if (snapshotOffers && cls === "pinned") {
      value = snapshotValue;
      rank = REPLAY_RANKS.pinnedSnapshot;
      source = "the run snapshot";
    } else if (Object.hasOwn(environment, key)) {
      value = environment[key];
      rank = REPLAY_RANKS.environment;
      source = "the environment";
    } else if (snapshotOffers && cls === "tunable") {
      value = snapshotValue;
      rank = REPLAY_RANKS.tunableSnapshot;
      source = "the run snapshot";
    } else if (Object.hasOwn(project, key)) {
      value = project[key];
      rank = REPLAY_RANKS.projectConfiguration;
      source = "project configuration";
    } else {
      // Nothing anywhere offers the key; nothing is invented for it.
      continue;
    }

    // F102-FR-024 — the re-validation against the schema, at the layer that
    // won: flags at `F`, the environment at `E`, everything else at `U`.
    const layer =
      rank === REPLAY_RANKS.flag
        ? "F"
        : rank === REPLAY_RANKS.environment
          ? "E"
          : rank === REPLAY_RANKS.projectConfiguration
            ? "P"
            : "U";
    const verdict = validateKeyValue(key, value, layer, { place: source });
    if (!verdict.ok) {
      return frozen({
        ok: false as const,
        key,
        reason: "schema" as const,
        message: verdict.error.message,
      });
    }

    // F102-FR-024 — the re-validation against the trust classes: a widening
    // key is never set by project configuration, which narrows a run and
    // never widens it (F110-FR-017, F110-FR-019). A value the snapshot
    // replayed stands as it was accepted at the launch, where its own layer
    // was checked; a value project configuration would inject now is
    // refused.
    if (trustClassOf(key) === "widening" && rank === REPLAY_RANKS.projectConfiguration) {
      return frozen({
        ok: false as const,
        key,
        reason: "trust-class" as const,
        message:
          `the key \`${key}\` is of the trust class widening and may take its value from ` +
          `the user file, the environment and flags only, not from ${source}`,
      });
    }

    const resolved = verdict.ok ? verdict.value : value;
    values[key] = resolved;
    keys.push(
      frozen({
        key,
        value: resolved,
        rank,
        source,
        class: cls,
        missingFromSnapshot,
      }),
    );

    // F102-FR-027 — every key whose value differs from the snapshot is
    // recorded with the old value, the new value and the rank.
    const old = snapshotOffers ? snapshotValue : undefined;
    if (!missingFromSnapshot && JSON.stringify(resolved) !== JSON.stringify(old)) {
      changes.push(frozen({ key, oldValue: old, newValue: resolved, rank }));
    }
  }

  return frozen({
    ok: true as const,
    values: frozen(values),
    keys: frozen(keys),
    changes: frozen(changes),
  });
}

/**
 * F102-FR-031 — the replayed argument list the `resuming:` line carries: every
 * resolved key as `--key value`, in the sorted order of the keys, so that the
 * line is the argument list the engine is started with.
 */
export function replayedArgsOf(values: Readonly<Record<string, unknown>>): readonly string[] {
  const args: string[] = [];
  for (const key of Object.keys(values).sort()) {
    args.push(`--${key}`, String(values[key]));
  }
  return frozen(args);
}
