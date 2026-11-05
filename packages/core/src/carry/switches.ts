/**
 * T081 of feature 103 — THE SWITCHES AND THE `prompt.built` FIELDS THE
 * EXPERIMENTS READ (F103-SC-001).
 *
 * ## What this module is, and what it is NOT
 *
 * It is the one place that states, for each of the four experiments the brief
 * inherits, WHICH switch it moves and WHICH field of `prompt.built` it is
 * measured from. Nothing here runs an experiment, and nothing here calls a
 * model.
 *
 * `specs/103-proposer-pass/tasks.md`, T081: "the experiments are run by the
 * plan of the micro-loop feature and are not run here; any paid run is logged
 * there". `plan.md`, "Out of scope", gives the owner as "115's experiment
 * plan, on the switches of this feature", and the Constitution check of
 * `plan.md` (XII) records that no task of this feature runs a paid probe.
 * `THE_EXPERIMENTS_ARE_RUN_HERE` and `A_PAID_RUN_IS_LOGGED_IN` are those two
 * facts as constants, so a test asserts them.
 *
 * ## The three switches
 *
 * All three already exist as configuration keys of the catalogue of feature
 * 100 (`packages/config/src/schema/catalogue-data.ts`) and all three have a
 * value under the `parity` profile (`packages/contracts/data/parity-profile.json`,
 * rows 9, 10 and 8 of annex X §X.7). What this module adds is the SEAM: one
 * record of the three, the module of this feature that reads each one, and
 * the reader that turns a configuration into the three values the pass loop
 * and the assembler act on. A caller that wants to run the index off does not
 * have to know that the index is read in `../prompt/providers/index.ts` while
 * the continuation is read in `./session-directive.ts`.
 *
 * ## Why `prompt.built` carries the switches
 *
 * An experiment compares two arms of the same pass. The measurement it takes
 * is the `prompt.built` record, and before T081 that record said nothing
 * about which arm produced it: a prompt built with `carry.index` off and one
 * built with it on were distinguishable only by the absence of a block, which
 * is also what a failing provider looks like. `switchesRecord` is what the
 * assembler now puts in the `switches` field of `prompt.built`
 * (`../prompt/assembler.ts`), so each measured record names its own arm.
 *
 * (The field is written here without its full dotted path on purpose: a
 * dotted literal in a namespace of the configuration schema is read as a
 * configuration key by the catalogue check of feature 110, CT-110-109, and
 * this is an event field and not a key.)
 */
import { SWITCH as LEDGER_HANDOFF_SWITCH } from "./ledger-core.ts";
import { SWITCH as CONTINUATION_SWITCH } from "./session-directive.ts";

/** The success criterion this module serves. */
export const REQUIREMENTS = ["F103-SC-001"] as const;

/** T081 — no experiment is run by this feature. */
export const THE_EXPERIMENTS_ARE_RUN_HERE = false as const;

/** T081 — where a paid run of one of them is logged. */
export const A_PAID_RUN_IS_LOGGED_IN = "the experiment plan of the micro-loop feature" as const;

/** The switch that governs the index of verification obligations. */
export const INDEX_SWITCH = "carry.index" as const;

/** The switch that governs a continued session. */
export { CONTINUATION_SWITCH };

/** The switch that governs the ledger records and the handoff. */
export { LEDGER_HANDOFF_SWITCH };

/** The three switches of this feature, in the order T081 names them. */
export const CARRY_SWITCHES = [INDEX_SWITCH, CONTINUATION_SWITCH, LEDGER_HANDOFF_SWITCH] as const;
export type CarrySwitch = (typeof CARRY_SWITCHES)[number];

/** Where each switch is read in the product, so the seam names its own sites. */
export const READ_IN: Readonly<Record<CarrySwitch, string>> = Object.freeze({
  [INDEX_SWITCH]: "packages/core/src/prompt/providers/index.ts",
  [CONTINUATION_SWITCH]: "packages/core/src/carry/session-directive.ts",
  [LEDGER_HANDOFF_SWITCH]: "packages/core/src/carry/ledger-core.ts",
});

/** The row of annex X §X.7 that holds each switch's value under `parity`. */
export const PROFILE_ROW: Readonly<Record<CarrySwitch, number>> = Object.freeze({
  [INDEX_SWITCH]: 9,
  [CONTINUATION_SWITCH]: 10,
  [LEDGER_HANDOFF_SWITCH]: 8,
});

/** All three are OFF under the `parity` profile; the classic loop has none. */
export const VALUE_UNDER_PARITY: Readonly<Record<CarrySwitch, boolean>> = Object.freeze({
  [INDEX_SWITCH]: false,
  [CONTINUATION_SWITCH]: false,
  [LEDGER_HANDOFF_SWITCH]: false,
});

/** The three switches as the product reads them. */
export type CarrySwitches = {
  /** `carry.index` — the index of verification obligations in the prompt. */
  readonly index: boolean;
  /** `carry.continuation` — a pass may continue the session of the one before. */
  readonly continuation: boolean;
  /** `carry.ledger_handoff` — the ledger records and the handoff file. */
  readonly ledgerHandoff: boolean;
};

/** The three switches under the `parity` profile: all off. */
export const UNDER_PARITY: CarrySwitches = Object.freeze({
  index: false,
  continuation: false,
  ledgerHandoff: false,
});

/**
 * Read the three switches out of a configuration. An absent key is read as
 * OFF, which is the value of the `parity` profile and the conservative
 * reading: a switch nobody set never changes the prompt.
 */
export function readCarrySwitches(config: Readonly<Record<string, unknown>>): CarrySwitches {
  const on = (key: CarrySwitch): boolean => config[key] === true || config[key] === "on";
  return Object.freeze({
    index: on(INDEX_SWITCH),
    continuation: on(CONTINUATION_SWITCH),
    ledgerHandoff: on(LEDGER_HANDOFF_SWITCH),
  });
}

/**
 * The three switches in the form the `switches` field of `prompt.built`
 * carries them: keyed
 * by the CONFIGURATION KEY, so a reader of the record needs no table to know
 * which switch a value belongs to.
 */
export function switchesRecord(switches: CarrySwitches): Readonly<Record<CarrySwitch, boolean>> {
  return Object.freeze({
    [INDEX_SWITCH]: switches.index,
    [CONTINUATION_SWITCH]: switches.continuation,
    [LEDGER_HANDOFF_SWITCH]: switches.ledgerHandoff,
  });
}

/* ------------------------------------------------------------------ *
 * The four experiments and what each one reads.
 * ------------------------------------------------------------------ */

/** The experiments the brief inherits; none of them is run by this feature. */
export const EXPERIMENT_IDS = ["X3", "X4", "X9", "X11"] as const;
export type ExperimentId = (typeof EXPERIMENT_IDS)[number];

/** What one experiment moves and what it is measured from. */
export type ExperimentSurface = {
  readonly id: ExperimentId;
  /** What the experiment measures, in one line. */
  readonly measures: string;
  /** The switches it moves; empty where it moves none of this feature's. */
  readonly switches: readonly CarrySwitch[];
  /** The fields of `prompt.built` it reads. */
  readonly promptBuiltFields: readonly string[];
  /** The requirement or criterion of this feature the experiment settles. */
  readonly settles: string;
};

/**
 * T081 — the exposed surface. The field names are the field names of
 * `PromptBuilt` in `../prompt/assembler.ts`; CT of T081 asserts that every
 * one of them is really a field of a record the shipped assembler built, so
 * the table cannot drift away from the record it describes.
 */
export const EXPERIMENTS: Readonly<Record<ExperimentId, ExperimentSurface>> = Object.freeze({
  X3: Object.freeze({
    id: "X3",
    measures:
      "the first-turn tokens per pass with the index of verification obligations on, " +
      "against the baseline of 107.8k, and that no phase goes over the prompt budget",
    switches: Object.freeze([INDEX_SWITCH]),
    promptBuiltFields: Object.freeze([
      "totalTokensEst",
      "totalBytes",
      "budgetBytes",
      "blocks",
      "omitted",
      "switches",
    ]),
    settles: "F103-SC-001",
  }),
  X4: Object.freeze({
    id: "X4",
    measures:
      "the first-turn cache reads of passes with and without the cache-stable start, " +
      "on a tested harness adapter",
    switches: Object.freeze([]),
    promptBuiltFields: Object.freeze([
      "stableStartHash",
      "stableStartBytes",
      "blockSet",
      "blocks",
      "switches",
    ]),
    settles: "F103-FR-036",
  }),
  X9: Object.freeze({
    id: "X9",
    measures: "the cost of a fresh session against a continued one, with the continuation off",
    switches: Object.freeze([CONTINUATION_SWITCH]),
    promptBuiltFields: Object.freeze([
      "totalTokensEst",
      "totalBytes",
      "stableStartHash",
      "switches",
    ]),
    settles: "F103-FR-042",
  }),
  X11: Object.freeze({
    id: "X11",
    measures: "the prompt the index removes, with the index off",
    switches: Object.freeze([INDEX_SWITCH]),
    promptBuiltFields: Object.freeze(["totalTokensEst", "totalBytes", "blocks", "switches"]),
    settles: "F103-FR-037",
  }),
});

/** The fields of `prompt.built` the four experiments need, with no repeats. */
export function promptBuiltFieldsTheExperimentsNeed(): readonly string[] {
  const seen = new Set<string>();
  for (const id of EXPERIMENT_IDS) {
    for (const field of EXPERIMENTS[id].promptBuiltFields) seen.add(field);
  }
  return Object.freeze([...seen].sort());
}

/** The switches of this feature the four experiments move, with no repeats. */
export function switchesTheExperimentsMove(): readonly CarrySwitch[] {
  const seen = new Set<CarrySwitch>();
  for (const id of EXPERIMENT_IDS) {
    for (const key of EXPERIMENTS[id].switches) seen.add(key);
  }
  return Object.freeze([...seen]);
}
