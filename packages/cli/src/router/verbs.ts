/**
 * T003 — the verb table of the front door, as data (F119-FR-001, F119-FR-013;
 * annex G §G.1 of feature 100).
 *
 * The table IS the routing data: the front door reads the first argument,
 * looks it up here and hands the call to the feature that owns the verb. It
 * implements none of the behaviour beyond the checks the spec states (the
 * `reverse --mode` refusal of F119-FR-001 and the state check of
 * F119-FR-009, both later tasks); what each verb does is the contract of
 * annex G §G.4.
 *
 * Closed-set rule (F119-FR-001): the twelve verbs of the baseline — `run`,
 * `status`, `watch`, `tail`, `events`, `verdicts`, `feedback`, `phases`,
 * `stop`, `resume`, `learn`, `reverse` — plus `start` as an alias of `run`,
 * plus `--protocol`. `spec` and `verify` are public verbs of their owners
 * (F119-FR-013). The pass loop, the critic, the banner, the presenter and the
 * theme are NOT in this table: they are internal calls with result records,
 * never public commands.
 */

/** One row of the verb table (annex G §G.1, the Command column). */
export type VerbRow = {
  /** The spelling the host writes as the first argument. */
  readonly verb: string;
  /** What the verb does, in the words of the annex row. */
  readonly what: string;
  /** The feature that owns the behaviour (the Owner column of §G.1). */
  readonly owner: string;
  /** True when the verb reads and writes nothing (F119-FR-001). */
  readonly readOnly: boolean;
  /**
   * The inspection verbs of this feature (F119-FR-030, F119-FR-033). The
   * front door itself prints their lines; `watch` is a card, not a record.
   */
  readonly inspect: boolean;
  /** The exit codes of the row of the command in annex G §G.4. */
  readonly exitCodes: readonly number[];
};

const RUN_FLAGS =
  "Runs the engine in the foreground (start mode `standalone`); with `--detach` it makes a run " +
  "request of kind `engine`. Continues an unfinished run; takes `--new-run` and `--reset-counts`.";

/** The verb table of the front door (annex G §G.1). */
export const VERBS: readonly VerbRow[] = Object.freeze([
  {
    verb: "--protocol",
    what: "Prints the protocol integer (F100-FR-170).",
    owner: "100",
    readOnly: true,
    inspect: false,
    exitCodes: [0],
  },
  {
    verb: "run",
    what: RUN_FLAGS,
    owner: "101; detaching: 122; continuation: 102; telemetry flags: 128",
    readOnly: false,
    inspect: false,
    exitCodes: [0, 1, 2, 3],
  },
  {
    verb: "start",
    what: "Alias of `run` (F119-FR-001).",
    owner: "101",
    readOnly: false,
    inspect: false,
    exitCodes: [0, 1, 2, 3],
  },
  {
    verb: "launch",
    what: "Runs the launch checks, writes the launch record, starts the runtime root, waits for the handshake.",
    owner: "107; the handshake: 122",
    readOnly: false,
    inspect: false,
    exitCodes: [0, 1, 2, 3],
  },
  {
    verb: "resume",
    what: "Continues a run from the records on disk.",
    owner: "102",
    readOnly: false,
    inspect: false,
    exitCodes: [0, 1, 2, 3],
  },
  {
    verb: "stop",
    what: "Writes the stop request. `--now` ends owned processes.",
    owner: "102",
    readOnly: false,
    inspect: false,
    exitCodes: [0, 1],
  },
  {
    verb: "status",
    what: "Prints the state of the run from the read model; compatibility output: this feature.",
    owner: "129; compatibility output: 119",
    readOnly: true,
    inspect: false,
    exitCodes: [0, 1],
  },
  {
    verb: "wait",
    what: "With `--until-change`: prints nothing while nothing changes; prints and takes the cursor.",
    owner: "129",
    readOnly: true,
    inspect: false,
    exitCodes: [0, 1],
  },
  {
    verb: "tail",
    what: "Inspection command, byte-capped.",
    owner: "119",
    readOnly: true,
    inspect: true,
    exitCodes: [0, 1],
  },
  {
    verb: "events",
    what: "Inspection command, byte-capped.",
    owner: "119",
    readOnly: true,
    inspect: true,
    exitCodes: [0, 1],
  },
  {
    verb: "verdicts",
    what: "Inspection command, byte-capped.",
    owner: "119",
    readOnly: true,
    inspect: true,
    exitCodes: [0, 1],
  },
  {
    verb: "feedback",
    what: "Inspection command, byte-capped.",
    owner: "119",
    readOnly: true,
    inspect: true,
    exitCodes: [0, 1],
  },
  {
    verb: "phases",
    what: "Inspection command, byte-capped.",
    owner: "119",
    readOnly: true,
    inspect: true,
    exitCodes: [0, 1, 3],
  },
  {
    verb: "watch",
    what: "Inspection command; a Wave 1 card, the follower is Wave 2.",
    owner: "119",
    readOnly: true,
    inspect: true,
    exitCodes: [0, 1],
  },
  {
    verb: "learn",
    what: "Learning: show, advise, apply, revert, evaluate.",
    owner: "106",
    readOnly: false,
    inspect: false,
    exitCodes: [0, 1, 2, 3],
  },
  {
    verb: "spec",
    what: "The spec module as a public command (F119-FR-013).",
    owner: "104",
    readOnly: true,
    inspect: false,
    exitCodes: [0, 1, 2, 3],
  },
  {
    verb: "verify",
    what: "The verification plan and the verification gate as a public command (F119-FR-013).",
    owner: "105",
    readOnly: true,
    inspect: false,
    exitCodes: [0, 3, 10, 11],
  },
  {
    verb: "reverse",
    what: "Reverse specification: `reverse plan`, `reverse lint`, `reverse guard`, `reverse inventory`.",
    owner: "108; lint and inventory: 140",
    readOnly: false,
    inspect: false,
    exitCodes: [0, 1, 2, 3],
  },
]);

/** The twelve verbs of the Specstride baseline (F119-FR-001). */
export const BASELINE_VERBS: readonly string[] = Object.freeze([
  "run",
  "status",
  "watch",
  "tail",
  "events",
  "verdicts",
  "feedback",
  "phases",
  "stop",
  "resume",
  "learn",
  "reverse",
]);

/** The alias the front door folds onto another verb (F119-FR-001). */
export const VERB_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  start: "run",
});

/**
 * The public verbs a feature owns and routes through the front door
 * (F119-FR-013): `spec`, `verify` and `learn`. The pass loop, the critic, the
 * banner, the presenter and the theme are never here.
 */
export const PUBLIC_VERBS: readonly string[] = Object.freeze(["spec", "verify", "learn"]);

/** The row of a verb, or `undefined` when the front door does not know it. */
export function verbRowOf(name: string): VerbRow | undefined {
  const canonical = VERB_ALIASES[name] ?? name;
  return VERBS.find((row) => row.verb === canonical);
}

/** True when the first argument names a verb of the table (aliases folded). */
export function isKnownVerb(name: string): boolean {
  return verbRowOf(name) !== undefined;
}
