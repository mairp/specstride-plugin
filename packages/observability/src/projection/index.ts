/**
 * T012 — the compatibility projection sink: its files, the ambient fields, the
 * event context and the halt path (F144-FR-001, F144-FR-006, F144-FR-007,
 * F144-FR-008).
 *
 * The projection is a SINK (EP-08, `specstride.event-sink/1`, annex C §C.10).
 * It is handed an event after the primary write and renders it in the old
 * vocabulary through the one table of T011, into FILES OF ITS OWN. It never
 * writes the primary stream: nothing in this module knows the path of
 * `run:<runId>:events`, and the only names it resolves are the two per-start
 * names of the projection and the learning legacy file.
 *
 * It is ON under the `parity` profile and under `compat.legacyEvents`, and OFF
 * otherwise (F144-FR-001). With the projection off nothing is created, so the
 * projected event files do not exist (F144-FR-008).
 *
 * THE HALT PATH (F144-FR-007). Every halt goes through ONE path, `halt`: the
 * halt event's line is written first and the halt rail is then appended to the
 * engine log, carrying the phase of the event in flight. The baseline has two
 * writers of `run_stop` for one stop — the engine, whose line carries `phase`,
 * and the pass loop, whose line carries `iter` — so one stop gives TWO lines
 * and `iter` tells them apart (B-0263, B-0607 to B-0616, B-0140 to B-0154).
 * The engine's is the newer: it carries the larger `seq`.
 *
 * BEST EFFORT (F144-FR-008, F144-FR-011). No path of this module throws into
 * the loop. `receive` catches everything, a failed write is counted and
 * ignored, and where nothing names a destination nothing is written.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";

import { resolve } from "@specstride/contracts/ids/logical-names";
import {
  EVENTS_LEGACY_BARE,
  EVENTS_LEGACY_PER_START,
} from "@specstride/contracts/ids/logical-names-amendments";
import { MAJOR } from "@specstride/contracts/envelope/event";
import type { EventEnvelope } from "@specstride/contracts/envelope/event";
import {
  COMPATIBILITY_PROJECTION_SWITCH,
  COMPATIBILITY_PROJECTION_WRITES_THE_PRIMARY_STREAM,
  POINT_ID as EP08_POINT_ID,
  isNeverProjected,
} from "@specstride/contracts/ep/event-sink";
import { PROFILE_NAME, PROFILE_KEY } from "@specstride/contracts/profile/parity";

import {
  AMBIENT_KEYS,
  asIsTime as bashTime,
  asIsTimestamp as bashTimestamp,
  pairsOfArguments,
  renderBashLine,
  type AsIsPair,
} from "./bash-line/index.ts";
import {
  appendBestEffort,
  asIsTime as pythonTime,
  asIsTimestamp as pythonTimestamp,
  emissionIsOn,
  renderPythonLine,
  type TypedPair,
} from "./python-line/index.ts";
import { asIsTimestamp as learningTimestamp, renderLearningLine } from "./learning-line/index.ts";
import {
  keysOfLine,
  projectionRows,
  selectRow,
  type ProjectionRow,
  type WriterClass,
} from "./table/index.ts";
import { withoutFieldsTheOldVocabularyLacks } from "./table/nothing.ts";
import { asIsNameOf, type ProjectedLine } from "./table/mapping.ts";
import { writesOfEvent, type PipelineContext } from "./pipeline-files/index.ts";

export * from "./table/index.ts";
export * from "./table/nothing.ts";
export * from "./table/mapping.ts";
export * from "./pipeline-files/index.ts";
export { renderBashLine, renderPythonLine, renderLearningLine };

/** The extension point this sink implements. */
export const POINT_ID = EP08_POINT_ID;

/** The label this sink is registered under. */
export const LABEL = "compatibility-projection" as const;

/** F100-FR-105 — the projection never writes the primary stream. */
export const WRITES_THE_PRIMARY_STREAM = COMPATIBILITY_PROJECTION_WRITES_THE_PRIMARY_STREAM;

/** The switch of row 17 of the `parity` profile (F144-FR-001). */
export const SWITCH = COMPATIBILITY_PROJECTION_SWITCH;

/** Row 17 of annex X §X.7, the row this feature owns. */
export const PROFILE_ROW = 17 as const;

/* ------------------------------------------------------------------ *
 * F144-FR-001 — on under `parity` and under the switch, off otherwise.
 * ------------------------------------------------------------------ */

/** What decides whether the projection is on. */
export type ProjectionSwitches = {
  /** The selected profile, from the key `profile`. */
  readonly profile?: string | undefined;
  /** The resolved configuration, which may hold `compat.legacyEvents`. */
  readonly config?: Readonly<Record<string, unknown>> | undefined;
};

/** True where a value of the switch means "on". */
function switchIsOn(value: unknown): boolean {
  return value === true || value === "on" || value === "true";
}

/**
 * F144-FR-001 — the projection is on under the `parity` profile and under
 * `compat.legacyEvents`, and off otherwise. Either is enough: the profile
 * sets the switch to `on`, and a consumer may set it without the profile.
 */
export function projectionIsOn(switches: ProjectionSwitches): boolean {
  if (switches.profile === PROFILE_NAME) return true;
  const config = switches.config ?? {};
  if (config[PROFILE_KEY] === PROFILE_NAME) return true;
  return switchIsOn(config[SWITCH]);
}

/* ------------------------------------------------------------------ *
 * F144-FR-006 — the event context and the ambient fields.
 * ------------------------------------------------------------------ */

/** The event context of a run, as the data model names its fields. */
export type EventContext = {
  /** The as-is run id: the engine start id in the form of F100-FR-046. */
  readonly runId: string;
  /** The name of the working directory; the value of `task` (B-0064). */
  readonly project: string;
  /** The label `prop:<proposer>/crit:<critic>` (B-0062). */
  readonly backendLabel: string;
  /** The feature slug, sanitised (B-0066). */
  readonly featureSlug: string;
  /** The trace id, the same for every launch of a run (B-0066). */
  readonly traceId?: string | undefined;
};

/** B-0062 — the shape of the backend label. */
export function backendLabelOf(proposer: string, critic: string): string {
  return `prop:${proposer}/crit:${critic}`;
}

/** The pattern the backend label keeps (B-0062). */
export const BACKEND_LABEL_FORM = /^prop:[^/]+\/crit:.+$/;

/** B-0064 — `task` is the name of the working directory. */
export function taskOf(workdir: string): string {
  return basename(workdir);
}

/**
 * F144-FR-006, B-0500 — the run id a component generates for itself:
 * `<YYYYmmdd-HHMMSS>-<pid>`, with no separator inside the date and the time
 * but one hyphen between them.
 *
 * The requirement fixes the FORM. The baseline reads the clock of the machine
 * in its own zone (`date +%Y%m%d-%H%M%S`), so `offsetMinutes` says which zone
 * to render in; the default is UTC, and a fixture that compares the digits
 * with the baseline passes the offset of the pinned zone.
 */
export function asIsRunId(at: Date, pid: number, offsetMinutes = 0): string {
  const iso = new Date(at.getTime() + offsetMinutes * 60_000).toISOString();
  const date = iso.slice(0, 10).split("-").join("");
  const time = iso.slice(11, 19).split(":").join("");
  return `${date}-${time}-${String(pid)}`;
}

/** The form the run id of B-0500 keeps. */
export const AS_IS_RUN_ID_FORM = /^\d{8}-\d{6}-\d+$/;

/**
 * F144-FR-006 — the ambient pairs, in the order of B-0362, those the event
 * context holds. A field the context does not hold is not written, as the
 * baseline writes a field only "when their variables are set".
 */
export function ambientPairs(context: EventContext): readonly AsIsPair[] {
  const byKey: Readonly<Record<string, string | undefined>> = Object.freeze({
    run_id: context.runId,
    task: context.project,
    backend: context.backendLabel,
    feature: context.featureSlug,
    trace_id: context.traceId,
  });
  const pairs: AsIsPair[] = [];
  for (const key of AMBIENT_KEYS) {
    const value = byKey[key];
    if (value === undefined || value === null || value === "") continue;
    pairs.push(Object.freeze([key, value]) as AsIsPair);
  }
  return Object.freeze(pairs);
}

/**
 * F144-FR-006 — the seven as-is variable names the processes the runtime
 * starts receive under the `parity` profile, in the order of the requirement.
 */
export const AS_IS_ENVIRONMENT_NAMES = [
  "SPECSTRIDE_EVENTS",
  "SPECSTRIDE_RUN_ID",
  "SPECSTRIDE_TASK",
  "SPECSTRIDE_BACKEND_LABEL",
  "SPECSTRIDE_FEATURE",
  "SPECSTRIDE_TRACE_ID",
  "SPECSTRIDE_MAX_REJECTS",
] as const;
export type AsIsEnvironmentName = (typeof AS_IS_ENVIRONMENT_NAMES)[number];

/**
 * F144-FR-006, DV-065 — the as-is name of the shipper program. It is included
 * under `parity` WITH AN EMPTY VALUE: no shipper program exists, nothing reads
 * the variable, and the transcript compares names only.
 */
export const SHIP_VARIABLE = "SPECSTRIDE_SHIP" as const;
export const SHIP_VALUE = "" as const;
export const SHIP_PROGRAM_EXISTS = false as const;

/** The eight names the transcript of a started process carries under `parity`. */
export const AS_IS_ENVIRONMENT_NAMES_WITH_SHIP = Object.freeze([
  ...AS_IS_ENVIRONMENT_NAMES,
  SHIP_VARIABLE,
]);

/** The three of the eight that the alias table of annex X §X.8 already holds. */
export const NAMES_IN_THE_ALIAS_TABLE = [
  "SPECSTRIDE_BACKEND_LABEL",
  "SPECSTRIDE_FEATURE",
  "SPECSTRIDE_MAX_REJECTS",
] as const;

/** What the environment of a started process needs beyond the context. */
export type EnvironmentExtras = {
  /** The path of the as-is event file: the value of `SPECSTRIDE_EVENTS`. */
  readonly eventsFile: string;
  /** The resolved limit: the value of `SPECSTRIDE_MAX_REJECTS`. */
  readonly maxRejects: number | string;
};

/**
 * F144-FR-006 — the event context under the as-is variable names, with
 * `SPECSTRIDE_SHIP` empty. Every value is text, as an environment is.
 */
export function asIsEnvironment(
  context: EventContext,
  extras: EnvironmentExtras,
): Readonly<Record<string, string>> {
  return Object.freeze({
    SPECSTRIDE_EVENTS: extras.eventsFile,
    SPECSTRIDE_RUN_ID: context.runId,
    SPECSTRIDE_TASK: context.project,
    SPECSTRIDE_BACKEND_LABEL: context.backendLabel,
    SPECSTRIDE_FEATURE: context.featureSlug,
    SPECSTRIDE_TRACE_ID: context.traceId ?? "",
    SPECSTRIDE_MAX_REJECTS: String(extras.maxRejects),
    [SHIP_VARIABLE]: SHIP_VALUE,
  });
}

/* ------------------------------------------------------------------ *
 * F144-FR-008 — the files.
 * ------------------------------------------------------------------ */

/** The logical name of the as-is event file of one engine start. */
export const EVENTS_LEGACY = EVENTS_LEGACY_PER_START;
/** The bare name, which resolves to the file of the newest engine start. */
export const EVENTS_LEGACY_NEWEST = EVENTS_LEGACY_BARE;
/** The logical name of the engine log of one engine start. */
export const ENGINE_LOG_PER_START = "run:<runId>:engine-log:<k>" as const;
/** The logical name of the learning legacy file of a feature. */
export const LEARNING_LEGACY = "feature:<slug>:learning:events-legacy" as const;

/** Where the roots of the machine are, as far as this sink needs them. */
export type ProjectionRoots = {
  /** The control root: `<control>` of the roots table of annex B. */
  readonly control: string;
};

/** What the sink is told about the run and where its files are. */
export type ProjectionLayout = {
  /** The logical run id, which the paths of annex B §B.5 are keyed by. */
  readonly runId: string;
  /** The feature slug, which the paths are keyed by. */
  readonly slug: string;
  /** The ordinal `<k>` of the engine start this sink writes for. */
  readonly engineStart: number;
};

/** Resolve the as-is event file of one engine start (F144-FR-008). */
export function eventsLegacyFile(
  layout: ProjectionLayout,
  roots: ProjectionRoots,
  engineStart: number = layout.engineStart,
): string {
  return resolve(
    EVENTS_LEGACY,
    { "<runId>": layout.runId, "<slug>": layout.slug, "<k>": engineStart },
    { "<control>": roots.control },
  );
}

/** Resolve the engine log of one engine start (F144-FR-008, upstream fix P1). */
export function engineLogFile(
  layout: ProjectionLayout,
  roots: ProjectionRoots,
  engineStart: number = layout.engineStart,
): string {
  return resolve(
    ENGINE_LOG_PER_START,
    { "<runId>": layout.runId, "<slug>": layout.slug, "<k>": engineStart },
    { "<control>": roots.control },
  );
}

/** Resolve the learning legacy file of a feature (F144-FR-008, upstream fix P2). */
export function learningLegacyFile(layout: ProjectionLayout, roots: ProjectionRoots): string {
  return resolve(LEARNING_LEGACY, { "<slug>": layout.slug }, { "<control>": roots.control });
}

/* ------------------------------------------------------------------ *
 * F144-FR-007 — the halt path.
 * ------------------------------------------------------------------ */

/** The two levels a `run_stop` line is written at (B-0263, B-0607). */
export const HALT_LEVELS = ["pass", "engine"] as const;
export type HaltLevel = (typeof HALT_LEVELS)[number];

/** The old name both levels write (B-0263). */
export const HALT_NAME = "run_stop" as const;

/** The field that tells the pass-level line from the engine-level one. */
export const FIELD_THAT_TELLS_THE_LEVELS_APART = "iter" as const;

/** The field the engine-level line carries instead (B-0140 to B-0154). */
export const FIELD_OF_THE_ENGINE_LEVEL = "phase" as const;

/** The type of each level's halt event. */
export const HALT_TYPE_OF_LEVEL: Readonly<Record<HaltLevel, string>> = Object.freeze({
  pass: "pass.halted",
  engine: "run.ended",
});

/** The level a halt event is written at, or null where the type is no halt. */
export function haltLevelOf(
  type: string,
  data: Readonly<Record<string, unknown>> = {},
): HaltLevel | null {
  if (type === HALT_TYPE_OF_LEVEL.pass) return "pass";
  if (type === HALT_TYPE_OF_LEVEL.engine) {
    const stopReason = data.stopReason;
    return stopReason === undefined || stopReason === null ? null : "engine";
  }
  return null;
}

/**
 * The halt rail: a plain rail appended to the engine log at every halt
 * (B-0197, B-0263). THE TEXT OF THE RAIL BELONGS TO THE FEATURE THAT PRINTS
 * IT; what F144-FR-007 fixes is that the rail is appended after the event and
 * carries the phase of the event in flight, so the default here writes that
 * one fact and a caller may replace it.
 */
export type HaltRail = (phase: string | null, level: HaltLevel) => string;

/** The default rail: the phase in flight, or `none` where there is none. */
export const defaultHaltRail: HaltRail = (phase) => `--- ${phase ?? "none"} ---`;

/**
 * B-2465 — the nanoseconds the default clock of this sink gives: the
 * millisecond of the envelope, in nanoseconds. The envelope carries the time
 * to the millisecond (annex X §X.1), so this is every digit the port knows and
 * the rest are zeros, never invented.
 */
export function nanosecondsOfMillisecond(at: Date): number {
  return (at.getTime() % 1000) * 1_000_000;
}

/* ------------------------------------------------------------------ *
 * Filling a field map from the `data` of an event.
 * ------------------------------------------------------------------ */

/** The camelCase field of an as-is snake_case key. */
export function camelOf(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_all, letter: string) => letter.toUpperCase());
}

/**
 * The suffixes the catalogue adds to a field whose as-is key has none: a
 * reference (`evidence` is `evidenceRef`), a slug (`feature` is
 * `featureSlug`), a mode (`verification` is `verificationMode`) and a time
 * (`resume` is `resumeAt`). The ladder is tried in this order, and the
 * snake_case key itself last, so that a `data` written in the old spelling
 * still resolves.
 */
export const FIELD_SUFFIXES = ["", "Ref", "Slug", "Mode", "At", "Path"] as const;

/**
 * The one as-is key whose catalogue field the ladder above cannot reach: the
 * `reason` of a `run_stop` written by the engine is the `stopReason` of
 * `run.ended` (annex E §E.3; B-0140 to B-0154). It is tried LAST, so a type
 * that has a `reason` field of its own still uses that one.
 */
export const KEY_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  reason: Object.freeze(["stopReason"]),
});

/** The value of an as-is key in the `data` of an event, or undefined. */
export function valueOfKey(key: string, data: Readonly<Record<string, unknown>>): unknown {
  const camel = camelOf(key);
  for (const suffix of FIELD_SUFFIXES) {
    const candidate = data[`${camel}${suffix}`];
    if (candidate !== undefined) return candidate;
  }
  for (const alias of KEY_ALIASES[key] ?? []) {
    const candidate = data[alias];
    if (candidate !== undefined) return candidate;
  }
  return data[key];
}

/**
 * The keys one line of a row carries: the plan of its field map, with the
 * clause of the stop reason of the event where the row has clauses. The as-is
 * key of a stop reason is `reason`, which `valueOfKey` reads from `reason` and
 * from `stopReason`, so one call covers the pass-level and the engine-level
 * halt alike.
 */
export function keysOfRow(
  row: ProjectionRow,
  data: Readonly<Record<string, unknown>>,
): readonly string[] {
  const reason = valueOfKey("reason", data);
  return keysOfLine(row.plan, reason === undefined || reason === null ? null : String(reason));
}

/**
 * The pairs of a row, filled from the `data` of the event: the keys of the
 * field map in the order of the cell, each key whose value the event holds,
 * and the four fields of F144-FR-009 filtered out whatever the cell says.
 */
export function pairsOfRow(
  row: ProjectionRow,
  data: Readonly<Record<string, unknown>>,
): readonly TypedPair[] {
  const pairs: TypedPair[] = [];
  const seen = new Set<string>();
  for (const key of keysOfRow(row, data)) {
    if (seen.has(key)) continue;
    seen.add(key);
    const value = valueOfKey(key, data);
    if (value === undefined) continue;
    pairs.push(Object.freeze([key, value]) as TypedPair);
  }
  return withoutFieldsTheOldVocabularyLacks(Object.freeze(pairs));
}

/* ------------------------------------------------------------------ *
 * The sink.
 * ------------------------------------------------------------------ */

/** What one delivery to the sink came to. */
export type Delivery = {
  /** The lines the event was rendered into; empty where it projects to nothing. */
  readonly lines: readonly ProjectedLine[];
  /** The files that were written, by logical name. */
  readonly files: readonly string[];
  /** The reason nothing was written, where nothing was. */
  readonly reason?: string;
};

/** What the sink is given at construction. */
export type ProjectionOptions = {
  readonly context: EventContext;
  readonly layout: ProjectionLayout;
  readonly roots: ProjectionRoots;
  readonly switches: ProjectionSwitches;
  /** Minutes east of UTC, for the `time` field of a line. Default: UTC. */
  readonly offsetMinutes?: number | undefined;
  /**
   * The nanoseconds of a time, or null where the platform gives none
   * (B-2465). The default derives them from the millisecond the envelope
   * carries, so that `ts` and `time` of one line name the same instant; a
   * fixture of the whole-seconds fallback passes `() => null`.
   */
  readonly nanosecondsOf?: ((at: Date) => number | null) | undefined;
  /** Append bytes to a file. Injected so that a test may make it fail. */
  readonly append?: ((file: string, bytes: string) => void) | undefined;
  /** Create a file empty. Injected for the same reason. */
  readonly truncate?: ((file: string) => void) | undefined;
  /** The text of the halt rail. */
  readonly rail?: HaltRail | undefined;
  /** The context the pipeline files are rendered with (F144-FR-010). */
  readonly pipeline?: PipelineContext | undefined;
  /** The rows of the table; the shipped table by default. */
  readonly rows?: readonly ProjectionRow[] | undefined;
};

/** The end of a line of every file of the projection. */
export const LINE_END = "\n" as const;

/**
 * The compatibility projection: a sink of EP-08 that renders each event in the
 * old vocabulary into files of its own.
 */
export class CompatibilityProjection {
  /** The `id` the primary writer registers a sink under. */
  readonly id: string = LABEL;
  /** The `label` EP-08 declares. */
  readonly label: string = LABEL;
  /** The range of event majors this sink accepts (annex C §C.10). */
  readonly acceptsMajors = Object.freeze({ from: MAJOR, to: MAJOR });

  readonly #options: ProjectionOptions;
  readonly #rows: readonly ProjectionRow[];
  readonly #append: (file: string, bytes: string) => void;
  readonly #truncate: (file: string) => void;
  readonly #rail: HaltRail;
  readonly #lines: ProjectedLine[] = [];
  readonly #written: string[] = [];
  #failures = 0;
  #startedEngineStarts: number[] = [];

  constructor(options: ProjectionOptions) {
    this.#options = options;
    this.#rows = options.rows ?? projectionRows;
    this.#append =
      options.append ??
      ((file, bytes) => {
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, bytes);
      });
    this.#truncate =
      options.truncate ??
      ((file) => {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, "");
      });
    this.#rail = options.rail ?? defaultHaltRail;
  }

  /** F144-FR-001 — whether the projection is on at all. */
  get isOn(): boolean {
    return projectionIsOn(this.#options.switches);
  }

  /** The event context the ambient fields are read from. */
  get context(): EventContext {
    return this.#options.context;
  }

  /** The as-is event file of the engine start this sink writes for. */
  get eventsFile(): string {
    return eventsLegacyFile(this.#options.layout, this.#options.roots);
  }

  /** The engine log of the engine start this sink writes for. */
  get engineLog(): string {
    return engineLogFile(this.#options.layout, this.#options.roots);
  }

  /** The learning legacy file of the feature. */
  get learningFile(): string {
    return learningLegacyFile(this.#options.layout, this.#options.roots);
  }

  /** The engine starts whose two files this sink has created. */
  get engineStarts(): readonly number[] {
    return Object.freeze([...this.#startedEngineStarts]);
  }

  /** Every line this sink has rendered, in the order it rendered them. */
  get lines(): readonly ProjectedLine[] {
    return Object.freeze([...this.#lines]);
  }

  /** The files this sink has written, by path, each once. */
  get filesWritten(): readonly string[] {
    return Object.freeze([...new Set(this.#written)]);
  }

  /** How many writes failed and were ignored (F144-FR-008). */
  get failures(): number {
    return this.#failures;
  }

  /**
   * F144-FR-008 — at the start of an engine start, the as-is event file of
   * that start and its engine log are CREATED EMPTY (B-0166). With the
   * projection off nothing is created.
   */
  startEngineStart(engineStart: number = this.#options.layout.engineStart): readonly string[] {
    if (!this.isOn) return Object.freeze([]);
    const files = [
      eventsLegacyFile(this.#options.layout, this.#options.roots, engineStart),
      engineLogFile(this.#options.layout, this.#options.roots, engineStart),
    ];
    for (const file of files) {
      try {
        this.#truncate(file);
        this.#written.push(file);
      } catch {
        this.#failures += 1;
      }
    }
    if (!this.#startedEngineStarts.includes(engineStart)) {
      this.#startedEngineStarts = [...this.#startedEngineStarts, engineStart].sort((a, b) => a - b);
    }
    return Object.freeze(files);
  }

  /**
   * The unknown-value rule of EP-08 (§C.10): a sink IGNORES an event type it
   * does not know and an event whose major is outside the range it accepts.
   * An event type that starts with `x.` belongs to a third party, is never
   * projected and never changes anything (F100-FR-021, F100-FR-199). Ignoring
   * is not failing: nothing is counted and nothing is written.
   *
   * Found by the conformance run of EP-08 on this sink (T019): the table alone
   * ignores an `x.` type only because it is the type of no row, and ignored no
   * out-of-range major at all.
   */
  accepts(event: EventEnvelope): boolean {
    if (isNeverProjected(event.type)) return false;
    return event.v >= this.acceptsMajors.from && event.v <= this.acceptsMajors.to;
  }

  /** The file a line of a writer class goes to (F144-FR-008). */
  destinationOf(writerClass: WriterClass, event: EventEnvelope): string {
    if (writerClass !== "learning") return this.eventsFile;
    // F144-FR-008 — a line of the class `learning` goes to the file of the
    // engine start when the event was recorded THROUGH A CALL OF THE ENGINE,
    // and to the learning legacy file when the command `learn` recorded it.
    // An event of a call of the engine carries the engine start it was made
    // in; the command runs in no engine start and carries none.
    const inAnEngineStart = typeof event.engineStartId === "string" && event.engineStartId !== "";
    return inAnEngineStart ? this.eventsFile : this.learningFile;
  }

  /** The bytes of the line an event renders into, by the shape of its row. */
  #render(row: ProjectionRow, event: EventEnvelope, oldName: string): string {
    const data = (event.data ?? {}) as Readonly<Record<string, unknown>>;
    const at = new Date(event.ts);
    const epochSeconds = at.getTime() / 1000;
    const offsetMinutes = this.#options.offsetMinutes ?? 0;
    const typed = pairsOfRow(row, data);
    if (row.shapeOfRow === "bash") {
      const nanoseconds =
        this.#options.nanosecondsOf === undefined
          ? nanosecondsOfMillisecond(at)
          : this.#options.nanosecondsOf(at);
      const argv = typed.flatMap(([key, value]) => [key, value as string | number | boolean]);
      return renderBashLine({
        event: oldName,
        ts: bashTimestamp(epochSeconds, nanoseconds),
        time: bashTime(at, offsetMinutes),
        ambient: ambientPairs(this.context),
        pairs: pairsOfArguments(argv),
      });
    }
    if (row.shapeOfRow === "learning") {
      return renderLearningLine({
        event: oldName,
        ts: learningTimestamp(epochSeconds),
        pairs: typed,
      });
    }
    return renderPythonLine({
      event: oldName,
      ts: pythonTimestamp(epochSeconds),
      time: pythonTime(at, offsetMinutes),
      pairs: typed,
    });
  }

  /** Append bytes best effort; a failure is counted and ignored. */
  #appendTo(file: string, bytes: string): boolean {
    const emission = appendBestEffort(file, bytes, this.#append);
    if (emission.written) {
      this.#written.push(file);
      return true;
    }
    if (emission.reason !== "no-destination") this.#failures += 1;
    return false;
  }

  /**
   * Render and write one event. This is the body of both `receive` (the sink
   * of the primary writer) and `write` (the operation of EP-08), so the two
   * cannot drift.
   */
  project(event: EventEnvelope): Delivery {
    if (!this.isOn)
      return Object.freeze({ lines: Object.freeze([]), files: Object.freeze([]), reason: "off" });
    if (!this.accepts(event))
      return Object.freeze({
        lines: Object.freeze([]),
        files: Object.freeze([]),
        reason: "ignored",
      });
    const data = (event.data ?? {}) as Readonly<Record<string, unknown>>;
    const pipeline = this.#options.pipeline;
    if (pipeline !== undefined) {
      const writes = writesOfEvent(event.type, data, pipeline);
      if (writes.length > 0) {
        const files: string[] = [];
        for (const write of writes) {
          const file = resolve(
            write.file,
            { "<pipelineId>": pipeline.pipelineId },
            { "<control>": this.#options.roots.control },
          );
          if (this.#appendTo(file, `${write.bytes}${LINE_END}`)) files.push(file);
        }
        return Object.freeze({ lines: Object.freeze([]), files: Object.freeze(files) });
      }
    }
    const row = selectRow(event.type, data, this.#rows);
    if (row === undefined || row.writesNothing || row.writesAPipelineFile) {
      return Object.freeze({
        lines: Object.freeze([]),
        files: Object.freeze([]),
        reason: row === undefined ? "no row" : "nothing",
      });
    }
    const files: string[] = [];
    const lines: ProjectedLine[] = [];
    for (const oldName of row.targets) {
      const bytes = this.#render(row, event, oldName);
      const destination = this.destinationOf(row.classOfRow, event);
      if (!emissionIsOn(destination)) continue;
      if (!this.#appendTo(destination, `${bytes}${LINE_END}`)) continue;
      const line = Object.freeze({
        seq: event.seq,
        writerClass: row.classOfRow,
        event: oldName,
        line: bytes,
      });
      lines.push(line);
      this.#lines.push(line);
      files.push(destination);
    }
    // F144-FR-007 — ONE halt path: the halt event, then the rail.
    const level = haltLevelOf(event.type, data);
    if (level !== null && lines.length > 0) {
      // "the phase of the event in flight": the `phase` of the event where it
      // has one — the engine-level line always does — and the `phaseId` of the
      // envelope otherwise, which is the phase a pass-level halt happened in.
      const phase = data[FIELD_OF_THE_ENGINE_LEVEL] ?? event.phaseId;
      const rail = this.#rail(phase === undefined || phase === null ? null : String(phase), level);
      if (this.#appendTo(this.engineLog, `${rail}${LINE_END}`)) files.push(this.engineLog);
    }
    return Object.freeze({ lines: Object.freeze(lines), files: Object.freeze(files) });
  }

  /**
   * The sink of the primary writer: it is called after the primary line is on
   * disk and it NEVER throws into the loop (F144-FR-011).
   */
  receive(event: EventEnvelope): void {
    try {
      this.project(event);
    } catch {
      this.#failures += 1;
    }
  }

  /* -------------------------------------------------------------- *
   * The operations of EP-08 (annex C §C.10).
   * -------------------------------------------------------------- */

  /** `open`: the files of the engine start are created empty. */
  open(): Promise<void> {
    try {
      this.startEngineStart();
    } catch {
      this.#failures += 1;
    }
    return Promise.resolve();
  }

  /** `write`: one event, in the order of `seq`. */
  write(event: EventEnvelope): Promise<void> {
    this.receive(event);
    return Promise.resolve();
  }

  /** `flush`: every write is an append, so there is nothing held back. */
  flush(): Promise<void> {
    return Promise.resolve();
  }

  /** `close`: the sink holds no handle of its own. */
  close(): Promise<void> {
    return Promise.resolve();
  }

  /** `status`: the delivery status as one line and as a record. */
  status(): {
    readonly line: string;
    readonly record: {
      readonly sinkLabel: string;
      readonly receiverState: string;
      readonly lastDeliveryStatus: string;
      readonly reason: string | null;
    };
  } {
    const state = this.isOn ? "on" : "off";
    const last = this.#failures === 0 ? "accepted" : "failed";
    return Object.freeze({
      line: `sink=${this.label} state=${state} last=${last} failures=${String(this.#failures)}`,
      record: Object.freeze({
        sinkLabel: this.label,
        receiverState: state,
        lastDeliveryStatus: last,
        reason: this.#failures === 0 ? null : "a write of a projection file failed",
      }),
    });
  }

  /** The read access to the table that the sink context of EP-08 declares. */
  asIsNameOf(eventType: string): string | null {
    return asIsNameOf(eventType, this.#rows);
  }
}

/** Build a sink for one engine start (F144-FR-001, F144-FR-008). */
export function createCompatibilityProjection(options: ProjectionOptions): CompatibilityProjection {
  return new CompatibilityProjection(options);
}
