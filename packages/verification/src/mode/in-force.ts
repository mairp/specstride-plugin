/**
 * T050 — the resolution of the mode in force that the command line calls
 * BEFORE it writes the run snapshot (F105-FR-010).
 *
 * Three facts, and a fourth that is the absence of two writes:
 *
 *  1. In a run whose verification gate does not execute (the mode `plan` or
 *     `off`) the mode in force is in the run snapshot, `run:<runId>:snapshot`,
 *     under the key `verification.mode`, and the loop layer takes its fallback
 *     from there with the reason `gate-not-executing`.
 *  2. THE MODE IN FORCE IS THE MODE AFTER THE CHANGE OF F105-FR-002 — a
 *     scaffold directory given while the mode is `off`. This resolution
 *     applies that change BEFORE the snapshot is written, so the snapshot
 *     holds `plan` and not `off`.
 *  3. The reading of the key for the fallback belongs to the owner of the loop
 *     layer, not to this feature.
 *  4. This feature writes NO field of the run record and switches NO loop
 *     layer on or off. The two facts are `WRITES_THE_RUN_RECORD` and
 *     `SWITCHES_A_LOOP_LAYER`, both `false`, and this module exposes no
 *     function that could do either: it RETURNS the key entry the command line
 *     writes, and writes nothing itself.
 *
 * The run snapshot is written by the command line (feature 100, annex B
 * §B.12), and that is why this module hands back a value instead of writing
 * one. The entry carries the rank of §X.2 the value came from and the key
 * class of §B.12, which is what the snapshot records per key.
 */
import { holdsLogicalName } from "@specstride/contracts/ids/logical-names";
import {
  KEY_CLASS_DEFAULT,
  type KeyClass,
  type RankLayer,
} from "@specstride/contracts/envelope/config";
import type { VerificationMode } from "./closed-sets.ts";
import { resolveVerificationMode, type ModeInput, type ModeResolution } from "./modes.ts";
import {
  resolveVerificationSettings,
  type SettingsInput,
  type SettingsResolution,
} from "./settings.ts";
import { gateExecutes } from "./effects.ts";
import { VERIFICATION_MODE_KEY } from "./switches.ts";

/** The record the key of the mode lives in (annex B §B.12). */
export const SNAPSHOT_LOGICAL_NAME = "run:<runId>:snapshot" as const;

/** The name is one the layout table of §B.5 holds, and not a free string. */
export const SNAPSHOT_NAME_IS_IN_THE_LAYOUT: boolean = holdsLogicalName(SNAPSHOT_LOGICAL_NAME);

/** The key of the snapshot this feature resolves. */
export const SNAPSHOT_KEY = VERIFICATION_MODE_KEY;

/** The reason the loop layer gives for its fallback (F105-FR-010). */
export const FALLBACK_REASON = "gate-not-executing" as const;

/** The owner of the reading of the key for the fallback: the loop layer, 115. */
export const THE_KEY_IS_READ_BY = "the owner of the loop layer" as const;

/** This feature writes no field of the run record (F105-FR-010). */
export const WRITES_THE_RUN_RECORD = false as const;

/** This feature switches no loop layer on or off (F105-FR-010). */
export const SWITCHES_A_LOOP_LAYER = false as const;

/** The change of F105-FR-002 is applied BEFORE the snapshot is written. */
export const THE_CHANGE_OF_F105_FR_002_IS_APPLIED_FIRST = true as const;

/** One entry of `keys` of the run snapshot: the value, its rank and its class. */
export type SnapshotKeyEntry = {
  readonly key: typeof VERIFICATION_MODE_KEY;
  readonly value: VerificationMode;
  /** The layer of §X.2 the value came from. */
  readonly source: RankLayer;
  /** Its rank number, as the snapshot records it. */
  readonly rank: number;
  /** `pinned` or `tunable` (annex B §B.12). */
  readonly class: KeyClass;
};

/** What the command line gets back before it writes the snapshot. */
export type ModeInForce =
  | {
      readonly ok: true;
      /** The mode in force: the mode AFTER the change of F105-FR-002. */
      readonly mode: VerificationMode;
      /** True where that change moved the mode (`off` became `plan`). */
      readonly modeWasUpgraded: boolean;
      /** The mode before the change, which the snapshot does NOT hold. */
      readonly modeBeforeTheChange: VerificationMode;
      /** The entry of `keys` the command line writes into the snapshot. */
      readonly snapshotKey: SnapshotKeyEntry;
      /** True where the verification gate of this run does not execute. */
      readonly gateDoesNotExecute: boolean;
      /** The settings in force, which the same resolution produced. */
      readonly settings: Extract<SettingsResolution, { ok: true }>;
    }
  | (Extract<ModeResolution, { ok: false }> & { readonly ok: false })
  | (Extract<SettingsResolution, { ok: false }> & { readonly ok: false });

/** What the resolution of the mode in force is given. */
export type ModeInForceInput = ModeInput & Omit<SettingsInput, "mode">;

/**
 * The mode in force, for the command line to write into the run snapshot.
 *
 * The order is the whole point: the mode is resolved through the ranks of
 * §X.2, THEN the settings of F105-FR-002 are applied — which is where a
 * scaffold directory given while the mode is `off` makes it `plan` — and only
 * the mode after that change reaches `snapshotKey`.
 */
export function resolveModeInForce(input: ModeInForceInput): ModeInForce {
  const resolved = resolveVerificationMode(input);
  if (!resolved.ok) return Object.freeze({ ...resolved, ok: false as const });
  const settings = resolveVerificationSettings({ ...input, mode: resolved.mode });
  if (!settings.ok) return Object.freeze({ ...settings, ok: false as const });
  return Object.freeze({
    ok: true as const,
    mode: settings.mode,
    modeWasUpgraded: settings.modeWasUpgraded,
    modeBeforeTheChange: resolved.mode,
    snapshotKey: Object.freeze({
      key: VERIFICATION_MODE_KEY,
      value: settings.mode,
      source: resolved.source,
      rank: resolved.rank,
      class: KEY_CLASS_DEFAULT,
    }),
    gateDoesNotExecute: !gateExecutes(settings.mode),
    settings,
  });
}

/**
 * The `keys` fragment of the run snapshot this feature contributes: ONE key.
 * The command line merges it; this feature writes nothing.
 */
export function snapshotKeysFragment(resolution: ModeInForce): Readonly<Record<string, unknown>> {
  if (!resolution.ok) return Object.freeze({});
  const entry = resolution.snapshotKey;
  return Object.freeze({
    [entry.key]: Object.freeze({
      value: entry.value,
      source: entry.rank,
      class: entry.class,
    }),
  });
}

/** The fields of the run record this feature writes: none (F105-FR-010). */
export const RUN_RECORD_FIELDS_WRITTEN: readonly string[] = Object.freeze([]);
