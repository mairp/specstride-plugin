/**
 * T028 — the containment level of a command of the verification gate
 * (F148-FR-006; row 25 of annex X §X.7; annex C §C.15).
 *
 * F148-FR-006: *"A command of the verification gate MUST run at the
 * containment level of the proposer or stricter, with no write access to the
 * control plane where the level allows it."*
 *
 * Three things, each of them code here:
 *
 *  1. **The level as `start` receives it.** `StartInput` of EP-05 carries
 *     `containment` (feature 100, annex C §C.8), so the level is an INPUT of
 *     the start and is never chosen by this feature. `effectiveContainment`
 *     reads it from what `start` received, and `startCommand` of
 *     `kind-command.ts` records the level the command ran at.
 *  2. **The proposer's or stricter.** `containmentOfAGateCommand` raises a
 *     level weaker than the proposer's to the proposer's, and
 *     `refuseAWeakerContainment` refuses one for a caller that wants the
 *     refusal instead. The strength order is feature 100's
 *     (`strengthOf`/`strongestOf` of annex C §C.15), not a second one here.
 *  3. **No write access to the control plane where the level allows it.** The
 *     value of `protection` per level is SL-6 of feature 100
 *     (`protectionFor`); C0 and C1 protect the control plane by location and
 *     by detection, and C2 and above deny the write when the harness adapter
 *     confirmed that its sandbox does.
 *
 * Row 25 belongs to feature 109 and is READ here, never registered
 * (F100-FR-212; `READ_FROM_THEIR_OWNERS` of `../registry/switches.ts`). Its
 * cell under `parity` is "As at the baseline: none", and a level that names no
 * member of the set is read as C0 by the unknown-value rule of row 26 of annex
 * X §X.6 — which is what `containmentUnderParity` returns.
 */
import {
  CONTAINMENT_LEVELS,
  LEVEL_WHEN_UNKNOWN,
  protectionFor,
  readContainmentLevel,
  strengthOf,
  strongestOf,
  type ContainmentLevel,
  type Protection,
} from "@specstride/contracts/enums/containment";
import { profileRow } from "@specstride/contracts/profile/parity";
import { foreignRow } from "../registry/switches.ts";

/** The row of annex X §X.7 that carries the level, and the feature that owns it. */
export const CONTAINMENT_ROW = 25 as const;

/** The key of row 25, read from the row this feature declares as foreign. */
export const CONTAINMENT_KEY: string = foreignRow("sandbox.level")?.key ?? "sandbox.level";

/** The feature that owns row 25 and registers it (F100-FR-212). */
export const CONTAINMENT_ROW_OWNER: string = foreignRow(CONTAINMENT_KEY)?.owner ?? "109";

/** The four levels of annex C §C.15, lowest first, read from feature 100. */
export { CONTAINMENT_LEVELS };
export type { ContainmentLevel, Protection };

/**
 * The cell of row 25 under the `parity` profile, read from the annex: "As at
 * the baseline: none".
 */
export const CONTAINMENT_CELL_UNDER_PARITY: string = profileRow(CONTAINMENT_ROW)?.parity ?? "";

/** The word the cell of row 25 uses for no containment at all. */
export const NO_CONTAINMENT = "none" as const;

/**
 * Row 25 under `parity` — the baseline contained nothing, and a level that
 * names no member of the set is read as C0 (the unknown-value rule of row 26
 * of annex X §X.6). The cell is asserted to say so, so that this value cannot
 * drift from the annex.
 */
export function containmentUnderParity(): ContainmentLevel {
  const cell = CONTAINMENT_CELL_UNDER_PARITY.toLowerCase();
  if (!cell.includes(NO_CONTAINMENT)) {
    throw new ContainmentOfAGateCommandError(
      `row ${String(CONTAINMENT_ROW)} of annex X §X.7 says "${CONTAINMENT_CELL_UNDER_PARITY}" ` +
        `under \`parity\`; the check runner reads that cell as no containment ` +
        `(F148-FR-006)`,
    );
  }
  return LEVEL_WHEN_UNKNOWN;
}

/** Raised where the containment of a gate command cannot be established. */
export class ContainmentOfAGateCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContainmentOfAGateCommandError";
  }
}

/* ------------------------------------------------------------------ *
 * The proposer's level, or stricter.
 * ------------------------------------------------------------------ */

/** F148-FR-006 — the rule, as data a test can read. */
export const AT_THE_LEVEL_OF_THE_PROPOSER_OR_STRICTER = true as const;

/**
 * F148-FR-006 — the level a command of the verification gate runs at: the
 * level of the proposer, or the requested level where that one is STRICTER.
 * A requested level weaker than the proposer's is raised to the proposer's; it
 * never lowers it.
 */
export function containmentOfAGateCommand(
  proposer: string,
  requested?: string | undefined,
): ContainmentLevel {
  const floor = readContainmentLevel(proposer);
  if (requested === undefined) return floor;
  return strongestOf([floor, requested]);
}

/** True where the level is the proposer's or stricter (F148-FR-006). */
export function isAtLeastAsStrictAsTheProposer(level: string, proposer: string): boolean {
  return strengthOf(level) >= strengthOf(proposer);
}

/** Raised where a caller asks for a gate command weaker than the proposer. */
export class ContainmentTooWeakError extends ContainmentOfAGateCommandError {
  readonly level: ContainmentLevel;
  readonly proposer: ContainmentLevel;
  constructor(level: string, proposer: string) {
    const got = readContainmentLevel(level);
    const floor = readContainmentLevel(proposer);
    super(
      `a command of the verification gate runs at the containment level of the proposer or ` +
        `stricter (F148-FR-006, row ${String(CONTAINMENT_ROW)}); \`${got}\` is weaker than ` +
        `the proposer's \`${floor}\``,
    );
    this.name = "ContainmentTooWeakError";
    this.level = got;
    this.proposer = floor;
  }
}

/** F148-FR-006 — refuse a gate command at a level weaker than the proposer's. */
export function refuseAWeakerContainment(level: string, proposer: string): void {
  if (!isAtLeastAsStrictAsTheProposer(level, proposer)) {
    throw new ContainmentTooWeakError(level, proposer);
  }
}

/**
 * What `start` received, as far as containment goes. Both fields are optional
 * because a check outside the verification gate is not bound by the rule, and
 * a level this feature was never given must not be invented.
 */
export type ContainmentOfAStart = {
  /** The level `start` received (`StartInput.containment` of EP-05). */
  readonly containment?: string | undefined;
  /** The level of the proposer, which a gate command may not go below. */
  readonly proposerContainment?: string | undefined;
};

/**
 * F148-FR-006 — the level a command actually runs at, from what `start`
 * received: the proposer's or stricter where the proposer's level is known,
 * and otherwise the level `start` received, read through the unknown-value
 * rule of row 26.
 */
export function effectiveContainment(start: ContainmentOfAStart): ContainmentLevel {
  if (start.proposerContainment === undefined) return readContainmentLevel(start.containment);
  return containmentOfAGateCommand(start.proposerContainment, start.containment);
}

/* ------------------------------------------------------------------ *
 * The control plane.
 * ------------------------------------------------------------------ */

/** The levels at which the operating system can deny the write (SL-6, §C.15). */
export const LEVELS_THAT_CAN_DENY_A_CONTROL_PLANE_WRITE: readonly ContainmentLevel[] =
  Object.freeze(CONTAINMENT_LEVELS.filter((level) => strengthOf(level) >= strengthOf("C2")));

/** What a level says about write access to the control plane. */
export type ControlPlaneAccess = {
  readonly level: ContainmentLevel;
  /** True only where the level allows the denial and the adapter confirmed it. */
  readonly writeDenied: boolean;
  /** `prevent` or `detect`, per SL-6 of feature 100. */
  readonly protection: Protection;
  readonly reason: string;
};

/**
 * F148-FR-006 — "with no write access to the control plane where the level
 * allows it". At C0 and C1 the level does not allow it: the control plane is
 * protected by its location and by detection, and the run says
 * `protection=detect` (SL-6). At C2 and above the write is denied where the
 * harness adapter confirmed that its sandbox denies it.
 */
export function controlPlaneAccess(
  level: string,
  sandboxDeniesControlPlaneWrites = false,
): ControlPlaneAccess {
  const read = readContainmentLevel(level);
  const allows = (LEVELS_THAT_CAN_DENY_A_CONTROL_PLANE_WRITE as readonly string[]).includes(read);
  const protection = protectionFor(read, sandboxDeniesControlPlaneWrites);
  return Object.freeze({
    level: read,
    writeDenied: allows && sandboxDeniesControlPlaneWrites,
    protection,
    reason: allows
      ? sandboxDeniesControlPlaneWrites
        ? `the level \`${read}\` allows the denial and the harness adapter confirmed it`
        : `the level \`${read}\` allows the denial but no harness adapter confirmed it, so the ` +
          `run says \`protection=detect\` (SL-6)`
      : `the level \`${read}\` does not allow the operating system to deny the write; the ` +
        `control plane is protected by its location and by detection (SL-6)`,
  });
}
