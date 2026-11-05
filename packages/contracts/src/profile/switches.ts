/**
 * T258 — the registration of a switch by a package (annex X, §X.7;
 * F100-FR-212).
 *
 * A package that owns a switch of §X.7 registers it at load. The registry is
 * read-only after launch. A registration whose owner differs from the owner
 * of its row in `data/parity-profile.json` is refused: a feature does not
 * change a row of another feature.
 */
import { profileRows, rowOfKey, type ProfileRow } from "./parity.ts";

/** What a package gives when it registers a switch (F100-FR-212). */
export type SwitchRegistration = {
  /** The configuration key of the switch. */
  readonly key: string;
  /** The feature that owns it, as the row of §X.7 writes it. */
  readonly owner: string;
  /** The default of the switch. */
  readonly default: unknown;
  /** The value under the `parity` profile. */
  readonly parity: unknown;
  /** The rows of the divergence register the switch answers to. */
  readonly registerRows?: readonly string[] | undefined;
};

/** A registered switch, with the row of §X.7 it belongs to. */
export type RegisteredSwitch = SwitchRegistration & {
  /** The row of the profile, where the profile holds one. */
  readonly row: ProfileRow | undefined;
};

/** A registration the rules of §X.7 refuse. */
export class SwitchRegistrationError extends Error {
  readonly key: string;
  readonly reason: "no-row" | "wrong-owner" | "after-launch" | "twice";
  constructor(key: string, reason: SwitchRegistrationError["reason"], message: string) {
    super(message);
    this.name = "SwitchRegistrationError";
    this.key = key;
    this.reason = reason;
  }
}

const REGISTRY = new Map<string, RegisteredSwitch>();
let sealed = false;

/** The registry is read-only after launch (F100-FR-212). */
export function sealSwitches(): void {
  sealed = true;
}

/** For a test that needs a fresh registry; never called by a run. */
export function resetSwitchesForTest(): void {
  REGISTRY.clear();
  sealed = false;
}

/** True when the registry is read-only. */
export function switchesAreSealed(): boolean {
  return sealed;
}

/**
 * Register a switch (F100-FR-212). The owner must be the owner of the row of
 * `data/parity-profile.json` that holds the key: a feature does not change a
 * row of another feature.
 */
export function registerSwitch(registration: SwitchRegistration): RegisteredSwitch {
  if (sealed) {
    throw new SwitchRegistrationError(
      registration.key,
      "after-launch",
      `the switch \`${registration.key}\` cannot be registered after launch: the ` +
        `registry of switches is read-only from then on (F100-FR-212)`,
    );
  }
  const seen = REGISTRY.get(registration.key);
  if (seen !== undefined) {
    throw new SwitchRegistrationError(
      registration.key,
      "twice",
      `the switch \`${registration.key}\` is registered twice (F100-FR-212)`,
    );
  }
  const row = rowOfKey(registration.key);
  if (row !== undefined && row.owner !== registration.owner) {
    throw new SwitchRegistrationError(
      registration.key,
      "wrong-owner",
      `the switch \`${registration.key}\` is registered by feature ` +
        `${registration.owner}; row ${row.number} of annex X §X.7 names ` +
        `${row.owner} as its owner. A feature does not change a row of another ` +
        `feature (F100-FR-212)`,
    );
  }
  const entry: RegisteredSwitch = Object.freeze({ ...registration, row });
  REGISTRY.set(registration.key, entry);
  return entry;
}

/** Every switch a package registered (F100-FR-212). */
export function registeredSwitches(): readonly RegisteredSwitch[] {
  return Object.freeze([...REGISTRY.values()]);
}

/** The registration of a key, or `undefined`. */
export function registeredSwitch(key: string): RegisteredSwitch | undefined {
  return REGISTRY.get(key);
}

/**
 * F100-FR-211 — a switch without a row of the profile fails the build. The
 * static test of T259 reports these.
 */
export function switchesWithoutARow(): readonly string[] {
  return Object.freeze(
    registeredSwitches()
      .filter((s) => s.row === undefined)
      .map((s) => s.key),
  );
}

/** Every configuration key the profile holds a row for. */
export const PROFILE_KEYS: readonly string[] = Object.freeze(
  profileRows.flatMap((r) => [...r.keys]),
);
