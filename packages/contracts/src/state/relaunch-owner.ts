/**
 * T186 — `relaunch.owner` with its two values and the list of what is never
 * relaunched, as data for feature 123, from the key `relaunchOwner` of
 * `data/process-model.json` (annex F, §F.4; F100-FR-162, F100-FR-163).
 */
import processModel from "../../data/process-model.json" with { type: "json" };

/** The section of annex F that owns the table. */
export const ANNEX_SECTION = "annex F, §F.4" as const;

/** The key of `data/process-model.json` this module reads. */
export const DATA_KEY = "relaunchOwner" as const;

/** The configuration key of §F.4 (F100-FR-162). */
export const KEY = "relaunch.owner" as const;

/** The feature the data is for (§F.4). */
export const CONTENT_OWNER = "123" as const;

/** The two values of `relaunch.owner`, and no other (F100-FR-162). */
export const RELAUNCH_OWNERS = ["root", "supervise"] as const;
export type RelaunchOwner = (typeof RELAUNCH_OWNERS)[number];

/** The default of `relaunch.owner` (F100-FR-162). */
export const DEFAULT: RelaunchOwner = "root";

/** `relaunch.owner` is ordinary configuration (F100-FR-162). */
export const TRUST_CLASS = "ordinary" as const;

type RawRow = { "`relaunch.owner`": string; Behaviour: string; Where: string };

/** One row of the table of §F.4. */
export type RelaunchOwnerRow = {
  readonly owner: RelaunchOwner;
  /** True for the row the table marks as the default. */
  readonly isDefault: boolean;
  readonly behaviour: string;
  readonly where: string;
};

const unbacktick = (cell: string): string => cell.replace(/`/g, "").trim();

/** Load the table of §F.4 from `data/process-model.json` (F100-FR-162). */
export function loadRelaunchOwners(): readonly RelaunchOwnerRow[] {
  return Object.freeze(
    (processModel as { relaunchOwner: RawRow[] }).relaunchOwner.map((row) => {
      const cell = row["`relaunch.owner`"];
      const isDefault = /\(default\)/.test(cell);
      return Object.freeze({
        owner: unbacktick(cell.replace(/\(default\)/, "")) as RelaunchOwner,
        isDefault,
        behaviour: row.Behaviour,
        where: row.Where,
      });
    }),
  );
}

/** The rows of the table of §F.4, in the order of the annex. */
export const relaunchOwnerRows: readonly RelaunchOwnerRow[] = loadRelaunchOwners();

/** The row of a value, or `undefined` for a value the table does not hold. */
export function relaunchOwnerRow(owner: string): RelaunchOwnerRow | undefined {
  return relaunchOwnerRows.find((row) => row.owner === owner);
}

/** True where the value is one of the two of §F.4. */
export function isRelaunchOwner(value: string): value is RelaunchOwner {
  return (RELAUNCH_OWNERS as readonly string[]).includes(value);
}

/** The value under the `parity` profile, and the row of §X.7 that sets it. */
export const UNDER_PARITY: RelaunchOwner = "supervise";
export const PARITY_ROW = 14 as const;

/* ------------------------------------------------------------------ *
 * F100-FR-162 — both classifier tables are pure tables.
 * ------------------------------------------------------------------ */

/** The two relaunch classifier tables of §F.4 (F100-FR-162). */
export const CLASSIFIER_TABLES = ["relaunch-observe", "relaunch-root"] as const;
export type ClassifierTable = (typeof CLASSIFIER_TABLES)[number];

/** Both tables are pure tables evaluated by the table evaluator (F100-FR-162). */
export const EVALUATED_BY = "the table evaluator" as const;
export const TABLES_ARE_PURE = true as const;

/** A relaunch always starts a fresh session (F100-FR-162). */
export const A_RELAUNCH_STARTS_A_FRESH_SESSION = true as const;

/** A relaunch carries counts and ids from the ledger (F100-FR-162). */
export const A_RELAUNCH_CARRIES_FROM_THE_LEDGER = ["counts", "ids"] as const;

/** Which table each value of `relaunch.owner` consults (§F.4). */
export function tableOf(owner: RelaunchOwner): ClassifierTable {
  return owner === "root" ? "relaunch-root" : "relaunch-observe";
}

/* ------------------------------------------------------------------ *
 * F100-FR-163 — what is never relaunched.
 * ------------------------------------------------------------------ */

/** The list of §F.4 that neither classifier table relaunches (F100-FR-163). */
export const NEVER_RELAUNCHED = [
  "a run whose terminal record says `retryable: false`",
  "a run in `blocked-on-human`",
  "a run that was stopped on request",
  "a run while `hold-relaunch` is in force",
] as const;

/** A quota pause gives the classifier nothing to classify (F100-FR-163). */
export const A_QUOTA_PAUSE_GIVES_THE_CLASSIFIER_NOTHING = true as const;

/** The two rows of table 1 that F100-FR-163 names. */
export const ROW_THAT_REFUSES_A_BLOCKED_RUN = "O-33" as const;
export const ROW_THAT_REFUSES_A_STOP_THAT_IS_NOT_RETRYABLE = "O-34" as const;

/** O-33 is active under EVERY profile, the `parity` profile included. */
export const O_33_IS_ACTIVE_UNDER_EVERY_PROFILE = true as const;

/** O-34 is inactive under the `parity` profile (row 132 of §X.7; DV-114). */
export const O_34_IS_INACTIVE_UNDER_PARITY = true as const;
export const PARITY_ROW_OF_O_34 = 132 as const;

/** The state of a run a classifier reads. */
export type RunForClassification = {
  readonly state: string;
  readonly retryable?: boolean | undefined;
  readonly stoppedOnRequest?: boolean | undefined;
  readonly holdRelaunchInForce?: boolean | undefined;
  readonly pausedOnQuota?: boolean | undefined;
};

/** Why a classifier refuses to relaunch a run. */
export type RelaunchRefusal =
  | "blocked-on-human"
  | "not-retryable"
  | "stopped-on-request"
  | "hold-relaunch"
  | "nothing-to-classify";

/**
 * F100-FR-163 — the refusal of a run, or `undefined` where the classifier may
 * relaunch it. Under the `parity` profile the row that refuses a stop that is
 * not retryable (O-34) is inactive; the row that refuses a blocked run (O-33)
 * is active under every profile.
 */
export function refusalOf(
  run: RunForClassification,
  profile: string | undefined = undefined,
): RelaunchRefusal | undefined {
  if (run.state === "blocked-on-human") return "blocked-on-human";
  if (run.pausedOnQuota === true) return "nothing-to-classify";
  if (run.holdRelaunchInForce === true) return "hold-relaunch";
  if (run.stoppedOnRequest === true) return "stopped-on-request";
  if (run.retryable === false && profile !== "parity") return "not-retryable";
  return undefined;
}

/** True where a classifier table may relaunch the run (F100-FR-163). */
export function mayRelaunch(
  run: RunForClassification,
  profile: string | undefined = undefined,
): boolean {
  return refusalOf(run, profile) === undefined;
}
