/**
 * T008 — the registry of spec-format adapters, with its priority and its
 * detection order (F104-FR-005, F104-FR-006, F104-FR-008, F104-FR-009;
 * EP-03, annex C §C.7).
 *
 * The registry is the one place that decides WHICH grammar reads a file. It
 * holds exactly the three formats of Wave 1 as built-in adapters — Lisa's
 * legacy adapter and its `chat` adapter are not registered (F104-FR-008) —
 * and takes added formats from the test tree or a host, which it asks after
 * the built-in rules and before the fallback (CQ-040, closed 2026-09-30).
 *
 * The order of F104-FR-005, which this module carries out:
 *
 *   1. a valid explicit override, from the flag and then from configuration;
 *   2. a path shaped `openspec/changes/<change>/tasks.md` → `openspec-change`;
 *   3. any other file whose base name is `tasks.md`, in any case → `speckit-tasks`;
 *   4. content with a phase heading, a task line `- [ ] T<digit>` and no
 *      `### Acceptance criteria` heading → `speckit-tasks`;
 *   5. content with a `## <N>. title` heading and a task line `- [ ] N.N` →
 *      `openspec-change`;
 *   6. everything else → `native`.
 *
 * Steps 2 to 5 are the BUILT-IN rules, and they come first: an added format is
 * asked after them and before the fallback `native`, and is chosen at once
 * when it is named explicitly (F104-FR-009). Each step belongs to its
 * adapter's `detect`, which returns whether it claims the path and its
 * `priority`; this module owns the ORDER and the priority bands, not the
 * predicates. The adapters of the three built-in formats land in phase 3
 * (T014 to T016) and register themselves through `register` below.
 *
 * Two further rules of the port, carried out here:
 *
 *  - an adapter that FAILS in `detect` is passed over, and detection goes on
 *    with the next one (F104-FR-009; `FAILURE_PATHS.detect` of EP-03);
 *  - detection runs ONCE per run and the format is passed on; no later reader
 *    sniffs the file again (decision D-8 of `specs/104-spec-input/research.md`,
 *    which cites the baseline's driver at `9cab15d`; F104-FR-007).
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { DetectInput, DetectResult } from "@specstride/contracts/ep/spec-format";
import { keyOfEnvironmentVariable } from "@specstride/contracts/envelope/config-validate";
import { UnknownFormatError, UnreadableSpecError } from "./errors.ts";
import {
  FALLBACK_FORMAT,
  FORMAT_NAMES,
  errorsOfASpecFormatAdapter,
  resolveFormatName,
  specFormats,
  type FormatName,
  type SpecGrammar,
} from "./model.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = [
  "F104-FR-005",
  "F104-FR-006",
  "F104-FR-007",
  "F104-FR-008",
  "F104-FR-009",
] as const;

/** The records of the baseline the detection order is measured against. */
export const BEHAVIOUR_ROWS = Object.freeze([
  "B-0011",
  "B-0012",
  "B-0035",
  "B-0036",
  "B-0060",
  "B-0245",
  "B-0802",
  "B-0848",
  "B-2034",
  "B-2035",
  "B-2036",
  "B-2037",
  "B-2038",
  "B-2039",
]);

/** T017 raises it; this module is where it is thrown (F104-FR-006). */
export { UnknownFormatError };

/* ------------------------------------------------------------------ *
 * The detection order, as data.
 * ------------------------------------------------------------------ */

/** One step of the detection order of F104-FR-005. */
export type DetectionStep = {
  /** 1 to 6, the number the requirement gives the step. */
  readonly step: number;
  /** What the step looks at. */
  readonly kind: "explicit" | "path" | "content" | "added" | "fallback";
  /** The format the step gives, where it gives a fixed one. */
  readonly format?: FormatName;
  /** The rule, in the words of F104-FR-005. */
  readonly rule: string;
};

/**
 * The detection order of F104-FR-005, with the place of an added format
 * (CQ-040) written in as step 5.5: after the built-in path and content rules,
 * before the fallback. The list is the order `detectFormat` walks.
 */
export const DETECTION_ORDER: readonly DetectionStep[] = Object.freeze([
  Object.freeze({
    step: 1,
    kind: "explicit" as const,
    rule: "a valid explicit override, from the flag and then from configuration",
  }),
  Object.freeze({
    step: 2,
    kind: "path" as const,
    format: "openspec-change" as const,
    rule: "a path shaped `openspec/changes/<change>/tasks.md`",
  }),
  Object.freeze({
    step: 3,
    kind: "path" as const,
    format: "speckit-tasks" as const,
    rule: "any other file whose base name is `tasks.md`, in any case",
  }),
  Object.freeze({
    step: 4,
    kind: "content" as const,
    format: "speckit-tasks" as const,
    rule:
      "content with a phase heading (`## Phase N` or `## P<N>`), a task line " +
      "`- [ ] T<digit>` and no `### Acceptance criteria` heading",
  }),
  Object.freeze({
    step: 5,
    kind: "content" as const,
    format: "openspec-change" as const,
    rule: "content with a `## <N>. title` heading and a task line `- [ ] N.N`",
  }),
  Object.freeze({
    step: 5.5,
    kind: "added" as const,
    rule: "an added format, asked after the built-in rules and before the fallback (CQ-040)",
  }),
  Object.freeze({
    step: 6,
    kind: "fallback" as const,
    format: FALLBACK_FORMAT,
    rule: "everything else",
  }),
]);

/** Detection runs once per run and the format is passed on (research D-8). */
export const DETECTION_RUNS_ONCE = true as const;

/** Detection that fails raises no error: the format is `native` (F104-FR-005). */
export const FORMAT_WHEN_DETECTION_FAILS = FALLBACK_FORMAT;

/* ------------------------------------------------------------------ *
 * The priority bands.
 * ------------------------------------------------------------------ */

/**
 * The priority bands of `detect` (F104-FR-009: "Built-in formats MUST win").
 * A larger number wins. The bands and not the single values are the rule, so
 * that an added format can place itself inside its band without reaching over
 * a built-in one.
 *
 * An adapter that returns a priority outside its band is clamped into it by
 * `claimOf`: a host cannot lift an added format over a built-in rule by
 * returning a large number.
 */
export const PRIORITY_BANDS = Object.freeze({
  /** Step 2: the built-in path rule of `openspec-change`. */
  builtInPath: Object.freeze({ floor: 600, ceiling: 699 }),
  /** Step 3: the built-in path rule of `speckit-tasks`. */
  builtInName: Object.freeze({ floor: 500, ceiling: 599 }),
  /** Steps 4 and 5: the built-in content rules. */
  builtInContent: Object.freeze({ floor: 400, ceiling: 499 }),
  /** Step 5.5: an added format. */
  added: Object.freeze({ floor: 100, ceiling: 399 }),
  /** Step 6: the fallback `native`, which claims every path and loses to all. */
  fallback: Object.freeze({ floor: 0, ceiling: 0 }),
});
export type PriorityBandName = keyof typeof PRIORITY_BANDS;

/** The bands from the highest to the lowest: the order detection walks. */
export const PRIORITY_BAND_ORDER: readonly PriorityBandName[] = Object.freeze([
  "builtInPath",
  "builtInName",
  "builtInContent",
  "added",
  "fallback",
]);

/** A priority held inside its band (F104-FR-009: built-in formats win). */
export function priorityInBand(band: PriorityBandName, priority: number): number {
  const { floor, ceiling } = PRIORITY_BANDS[band];
  if (!Number.isFinite(priority)) return floor;
  return Math.min(ceiling, Math.max(floor, Math.trunc(priority)));
}

/* ------------------------------------------------------------------ *
 * The adapter and the registry.
 * ------------------------------------------------------------------ */

/**
 * A registered spec-format adapter. `detect` is the only operation the
 * registry needs; `parse`, `validate`, `tick` and `inputs` are called by the
 * modules of the later phases through the same record.
 */
export type RegisteredAdapter = {
  /** The name of the format, which is what `spec detect` prints. */
  readonly name: string;
  /** Which band the adapter's claim sits in. */
  readonly band: PriorityBandName;
  /** Whether the adapter is one of the three of Wave 1. */
  readonly builtIn: boolean;
  /** The step of F104-FR-005 the adapter carries out, where it is a built-in. */
  readonly step?: number;
  /**
   * The band this ONE input falls in, where the adapter carries more than one
   * step of F104-FR-005. `openspec-change` carries step 2 (a path rule) and
   * step 5 (a content rule), and `speckit-tasks` carries step 3 and step 4; a
   * single static band could not keep step 3 above step 5, which is what makes
   * `specs/x/tasks.md` with OpenSpec-shaped content a `speckit-tasks` file.
   * An adapter with one step leaves it out and keeps `band`.
   */
  bandOf?(input: DetectInput): PriorityBandName;
  /** F104-FR-009: whether the adapter claims a path, and its priority. */
  detect(input: DetectInput): DetectResult;
  /**
   * The GRAMMAR half of the adapter (T024 to T026): everything that reads a
   * phase heading or a task line. `adapters/index.ts` joins it to the
   * detection half above; `validate.ts`, `tick.ts` and `context.ts` reach it
   * through `grammarOf`, so an added format of F104-FR-009 is parsed,
   * validated and ticked with no change to a core file (F104-SC-006).
   *
   * It is OPTIONAL, because the registry itself needs only `detect`: a
   * detection-only registry is what `createDefaultRegistry` builds, and the
   * tests of T008 and T016 measure it.
   */
  readonly grammar?: SpecGrammar | undefined;
};

/** The exit code of every error of row 99 (F104-FR-006, F104-FR-020). */
export const EXIT_OF_AN_UNKNOWN_FORMAT = 3 as const;

/** One claim of an adapter, as the registry collected it. */
export type Claim = {
  readonly name: string;
  readonly band: PriorityBandName;
  readonly priority: number;
  readonly claims: boolean;
};

/**
 * The registry of spec-format adapters (F104-FR-008: the registry holds
 * exactly the three formats of Wave 1, plus whatever a host or the test tree
 * adds). Registration order is kept, because the error of an unknown format
 * lists the names in it (F104-FR-006).
 */
export class SpecFormatRegistry {
  readonly #adapters = new Map<string, RegisteredAdapter>();

  /**
   * Register an adapter. The name must be a member of row 49 of annex X §X.6
   * for a built-in; an added format brings its own name, which row 49 allows
   * because it is an OPEN registry. A name that is already registered is
   * refused, so that two adapters cannot answer to one name.
   */
  register(adapter: RegisteredAdapter): void {
    if (this.#adapters.has(adapter.name)) {
      throw new Error(`the spec format \`${adapter.name}\` is registered twice`);
    }
    if (adapter.builtIn && !specFormats.has(adapter.name)) {
      throw new Error(
        `\`${adapter.name}\` is no member of the closed set "${specFormats.name}" ` +
          `(${specFormats.number}) of annex X §X.6, so it is no built-in format`,
      );
    }
    this.#adapters.set(adapter.name, adapter);
  }

  /** The names of the registry, in REGISTRATION order (F104-FR-006). */
  names(): readonly string[] {
    return Object.freeze([...this.#adapters.keys()]);
  }

  /** The adapters, in registration order. */
  adapters(): readonly RegisteredAdapter[] {
    return Object.freeze([...this.#adapters.values()]);
  }

  /** The adapter of a name, the alias resolved; `undefined` where none is registered. */
  adapterOf(name: string): RegisteredAdapter | undefined {
    const direct = this.#adapters.get(name);
    if (direct !== undefined) return direct;
    const resolved = resolveFormatName(name);
    return resolved === undefined ? undefined : this.#adapters.get(resolved);
  }

  /**
   * Step 1 of F104-FR-005 — an explicit override. The alias `openspec` is
   * accepted and resolves to `openspec-change` (F104-FR-006); an added format
   * is chosen at once when it is named (F104-FR-009).
   *
   * A name that is no registered format and no alias is `unknown-format`: it
   * is NEVER guessed, and the error names the registered formats in
   * registration order, without the alias (F104-FR-006).
   */
  resolveExplicit(value: string): string {
    const adapter = this.adapterOf(value);
    if (adapter === undefined) throw new UnknownFormatError(value, this.names());
    return adapter.name;
  }

  /**
   * The claim of every adapter over one input, in band order. An adapter that
   * THROWS in `detect` is passed over and does not appear among the claims
   * (F104-FR-009).
   */
  claims(input: DetectInput): readonly Claim[] {
    const collected: Claim[] = [];
    for (const band of PRIORITY_BAND_ORDER) {
      for (const adapter of this.#adapters.values()) {
        let effective: PriorityBandName;
        try {
          effective = adapter.bandOf?.(input) ?? adapter.band;
        } catch {
          // A `bandOf` that fails is a failure of `detect`: passed over.
          continue;
        }
        if (effective !== band) continue;
        let result: DetectResult;
        try {
          result = adapter.detect(input);
        } catch {
          // Passed over: a failing `detect` never stops detection.
          continue;
        }
        collected.push(
          Object.freeze({
            name: adapter.name,
            band,
            priority: priorityInBand(band, result.priority),
            claims: result.claims === true,
          }),
        );
      }
    }
    return Object.freeze(collected);
  }

  /**
   * Detection, in the order of F104-FR-005. The highest-priority adapter that
   * claims the input wins; where none does, the format is the fallback
   * `native`, and no error is raised (F104-FR-005).
   *
   * `explicit` is step 1: where it is given it decides, and no adapter is
   * asked at all. Detection is meant to run ONCE per run, and the result to be
   * handed to every later reader (research D-8; F104-FR-007).
   */
  detectFormat(input: DetectInput, explicit?: string | undefined): string {
    if (explicit !== undefined && explicit !== "") return this.resolveExplicit(explicit);
    const claimed = this.claims(input).filter((c) => c.claims);
    if (claimed.length === 0) return FORMAT_WHEN_DETECTION_FAILS;
    let best = claimed[0] as Claim;
    for (const claim of claimed) {
      if (claim.priority > best.priority) best = claim;
    }
    return best.name;
  }
}

/** The error kinds of a spec-format adapter: row 99 of annex X §X.6. */
export const ADAPTER_ERRORS = errorsOfASpecFormatAdapter.members;

/** The three formats a registry of Wave 1 holds, and nothing else. */
export const FORMATS_OF_WAVE_1 = FORMAT_NAMES;

/**
 * Lisa's legacy adapter and its `chat` adapter are NOT registered
 * (F104-FR-008). The names are kept so that a test can prove their absence.
 */
export const ADAPTERS_NOT_REGISTERED = Object.freeze(["legacy", "chat"]);

/** A registry with no adapter: the host registers what it wants. */
export function createRegistry(): SpecFormatRegistry {
  return new SpecFormatRegistry();
}

/* ------------------------------------------------------------------ *
 * T016 — the built-in detection rules, steps 2 to 6 of F104-FR-005.
 * ------------------------------------------------------------------ */

/**
 * The checkbox syntax of EVERY format (B-2021): optional indent, `-`, optional
 * spaces, `[ ]`, `[x]`, `[X]` or `[]`, then the text. The detection rules below
 * are the only grammar this module holds; the full grammars belong to the
 * adapters of phase 4, which replace these `detect` bodies' neighbours and not
 * the rules here.
 */
export const CHECKBOX = "optional indent, `-`, optional spaces, `[ ]`/`[x]`/`[X]`/`[]`, then text";

/** Step 2 — a path shaped `openspec/changes/<change>/tasks.md` (B-2035). */
export const OPENSPEC_CHANGE_TASKS_PATH = /(?:^|\/)openspec\/changes\/[^/]+\/tasks\.md$/;

/** Step 3 — any other file whose base name is `tasks.md`, in any case (B-2036). */
export const TASKS_BASE_NAME = /^tasks\.md$/i;

/** Step 4 — a phase heading: `## Phase <digits>`, case-sensitive (B-2017). */
export const PHASE_HEADING = /^##[ \t]+Phase[ \t]+\d+/m;
/** Step 4 — the priority form of a phase heading, `## P<N>` or `## p<N>` (B-2025). */
export const PRIORITY_HEADING = /^##[ \t]*[Pp]\d+\b/m;
/** Step 4 — a task line `- [ ] T<digit>` (B-2037). */
export const TASK_LINE_WITH_A_T_ID = /^[ \t]*-[ \t]*\[[ xX]?\][ \t]*T\d/m;
/** Step 4 — the heading that disqualifies it, `### Acceptance criteria` (B-2020). */
export const ACCEPTANCE_CRITERIA_HEADING = /^###[ \t]*Acceptance criteria/m;

/** Step 5 — an OpenSpec phase heading `## <N>. title` (B-2031, B-2038). */
export const OPENSPEC_HEADING = /^##[ \t]*\d+[.)]?[ \t]+\S/m;
/** Step 5 — an OpenSpec task line, a checkbox with a dotted id (B-2032). */
export const OPENSPEC_TASK_LINE = /^[ \t]*-[ \t]*\[[ xX]?\][ \t]*\d+(?:\.\d+)+\b/m;

/** Step 2 — does the PATH say `openspec-change`? */
export function pathIsAnOpenspecChange(path: string): boolean {
  return OPENSPEC_CHANGE_TASKS_PATH.test(path.split("\\").join("/"));
}

/** Step 3 — is the base name `tasks.md`, in any case? */
export function baseNameIsTasksMd(path: string): boolean {
  return TASKS_BASE_NAME.test(basename(path.split("\\").join("/")));
}

/** Step 4 — content with a phase heading, a `T` task line and no criteria block. */
export function contentIsSpeckitTasks(head: string): boolean {
  if (ACCEPTANCE_CRITERIA_HEADING.test(head)) return false;
  if (!PHASE_HEADING.test(head) && !PRIORITY_HEADING.test(head)) return false;
  return TASK_LINE_WITH_A_T_ID.test(head);
}

/** Step 5 — content with a `## <N>. title` heading and a dotted task line. */
export function contentIsOpenspecChange(head: string): boolean {
  return OPENSPEC_HEADING.test(head) && OPENSPEC_TASK_LINE.test(head);
}

/** The priority each built-in step claims with, inside its band. */
export const STEP_PRIORITY: Readonly<Record<number, number>> = Object.freeze({
  2: 650,
  3: 550,
  4: 450,
  5: 440,
  6: 0,
});

/**
 * The `openspec-change` adapter's detection half: step 2 (the path rule, band
 * `builtInPath`) and step 5 (the content rule, band `builtInContent`). Its
 * grammar lands in phase 4 (T026); what is here is the detection of T016.
 */
export function openspecChangeDetection(): RegisteredAdapter {
  return Object.freeze({
    name: "openspec-change",
    band: "builtInPath" as const,
    builtIn: true,
    step: 2,
    bandOf: (input: DetectInput) =>
      pathIsAnOpenspecChange(input.path) ? ("builtInPath" as const) : ("builtInContent" as const),
    detect: (input: DetectInput): DetectResult =>
      pathIsAnOpenspecChange(input.path)
        ? { claims: true, priority: STEP_PRIORITY[2] as number }
        : {
            claims: contentIsOpenspecChange(input.head),
            priority: STEP_PRIORITY[5] as number,
          },
  });
}

/**
 * The `speckit-tasks` adapter's detection half: step 3 (the base-name rule,
 * band `builtInName`) and step 4 (the content rule, band `builtInContent`).
 * Step 3 claims a file named `tasks.md` that is NOT under
 * `openspec/changes/<change>/` — step 2 of the OpenSpec adapter sits in a
 * higher band and wins that path anyway, and the requirement's "any OTHER file
 * whose base name is `tasks.md`" is stated here as well, so that the step is
 * true on its own and not only through the ordering.
 */
export function speckitTasksDetection(): RegisteredAdapter {
  const claimsByName = (input: DetectInput): boolean =>
    baseNameIsTasksMd(input.path) && !pathIsAnOpenspecChange(input.path);
  return Object.freeze({
    name: "speckit-tasks",
    band: "builtInName" as const,
    builtIn: true,
    step: 3,
    bandOf: (input: DetectInput) =>
      claimsByName(input) ? ("builtInName" as const) : ("builtInContent" as const),
    detect: (input: DetectInput): DetectResult =>
      claimsByName(input)
        ? { claims: true, priority: STEP_PRIORITY[3] as number }
        : {
            claims: contentIsSpeckitTasks(input.head),
            priority: STEP_PRIORITY[4] as number,
          },
  });
}

/** Step 6 — the fallback `native`, which claims every input and loses to all. */
export function nativeDetection(): RegisteredAdapter {
  return Object.freeze({
    name: "native",
    band: "fallback" as const,
    builtIn: true,
    step: 6,
    detect: (): DetectResult => ({ claims: true, priority: STEP_PRIORITY[6] as number }),
  });
}

/**
 * A registry with the three built-in formats of Wave 1, in the registration
 * order the error of F104-FR-006 lists: `native`, `speckit-tasks`,
 * `openspec-change`. Lisa's `legacy` and `chat` adapters are not among them
 * (F104-FR-008).
 */
export function createDefaultRegistry(): SpecFormatRegistry {
  const registry = new SpecFormatRegistry();
  registry.register(nativeDetection());
  registry.register(speckitTasksDetection());
  registry.register(openspecChangeDetection());
  return registry;
}

/** The default registry of the package, built once: detection runs once (D-8). */
export const defaultRegistry: SpecFormatRegistry = createDefaultRegistry();

/**
 * Detection over a path and its content, in the order of F104-FR-005. This is
 * the entry point `spec detect` prints the answer of.
 */
export function detectFormat(
  path: string,
  content: string,
  explicit?: string | undefined,
  registry: SpecFormatRegistry = defaultRegistry,
): string {
  return registry.detectFormat({ path, head: content }, explicit);
}

/**
 * The text of a spec file. A file that cannot be read is `unreadable-file` of
 * F104-FR-018 — `spec: <operating-system error>` (B-2000) — which is a CALLER
 * error and not a detection failure.
 */
export function readSpecText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (cause) {
    throw new UnreadableSpecError(path, cause);
  }
}

/**
 * Detection over a path alone: the file is read, and a read that FAILS is a
 * failure of DETECTION, which gives `native` and raises nothing
 * (F104-FR-005, B-0245). A caller that needs the read error asks for the text
 * through `readSpecText` instead.
 */
export function detectFormatOfPath(
  path: string,
  explicit?: string | undefined,
  registry: SpecFormatRegistry = defaultRegistry,
): string {
  if (explicit !== undefined && explicit !== "") return registry.resolveExplicit(explicit);
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return FORMAT_WHEN_DETECTION_FAILS;
  }
  return registry.detectFormat({ path, head: content });
}

/* ------------------------------------------------------------------ *
 * T016 — the inputs `spec.format` and `spec.feature` (F104-FR-007).
 * ------------------------------------------------------------------ */

/** The two keys of row 49 of annex X §X.7 this feature owns (F104-FR-007). */
export const FORMAT_KEY = "spec.format" as const;
export const FEATURE_KEY = "spec.feature" as const;

/** The two flags of F104-FR-007 (B-0011, B-0012). */
export const FORMAT_FLAG = "--spec-format" as const;
export const FEATURE_FLAG = "--feature" as const;

/** The as-is variables of annex X §X.8 (B-0035, B-0036, B-0848). */
export const FORMAT_VARIABLE = "SPECSTRIDE_SPEC_FORMAT" as const;
export const FEATURE_VARIABLE = "SPECSTRIDE_FEATURE" as const;

/**
 * The key an as-is variable is an alias of, READ from the alias table of
 * annex X §X.8 that `@specstride/contracts` holds as data. Nothing in this
 * feature writes the pairing out: the table and the module cannot drift, and
 * the resolution of the alias itself belongs to the configuration loader of
 * feature 110, which holds the one YAML parser.
 */
export const KEY_OF_THE_FORMAT_VARIABLE = keyOfEnvironmentVariable(FORMAT_VARIABLE);
export const KEY_OF_THE_FEATURE_VARIABLE = keyOfEnvironmentVariable(FEATURE_VARIABLE);

/** Where a resolved input came from; `unset` is "detect" or "the last active". */
export type InputSource = "flag" | "key" | "unset";

/** One resolved input: its value, or `undefined`, and where it came from. */
export type ResolvedInput = {
  readonly value: string | undefined;
  readonly source: InputSource;
};

/** The flag and the key of one input, as the command line and feature 110 give them. */
export type InputPair = {
  readonly flag?: string | undefined;
  readonly key?: string | undefined;
};

/** A FLAG overrides a KEY (F104-FR-007, B-0011, B-0012, B-0802). */
export function resolveInput(pair: InputPair): ResolvedInput {
  if (pair.flag !== undefined && pair.flag !== "") {
    return Object.freeze({ value: pair.flag, source: "flag" as const });
  }
  if (pair.key !== undefined && pair.key !== "") {
    return Object.freeze({ value: pair.key, source: "key" as const });
  }
  return Object.freeze({ value: undefined, source: "unset" as const });
}

/**
 * B-1996 — the value of the KEY is read TRIMMED and LOWER-CASED, and a value
 * that is only whitespace is UNSET. The FLAG is taken as it is: the baseline
 * restricts `--format` by argparse `choices`, which is an exact match (B-1994),
 * and only the variable behind the key is normalised. The two are therefore
 * separate rules, and `test/detection.test.ts` measures where they differ.
 */
export const KEY_VALUE_IS_TRIMMED_AND_LOWER_CASED = true as const;
export const FLAG_VALUE_IS_TAKEN_AS_IT_IS = true as const;

/** The reading of B-1996, in one place. */
export function formatValueOfTheKey(value: string): string {
  return value.trim().toLowerCase();
}

/** `--spec-format` over `spec.format`; unset means detection runs (B-0848). */
export function resolveFormatInput(pair: InputPair): ResolvedInput {
  const resolved = resolveInput(pair);
  if (resolved.source !== "key" || resolved.value === undefined) return resolved;
  const read = formatValueOfTheKey(resolved.value);
  if (read === "") return Object.freeze({ value: undefined, source: "unset" as const });
  return Object.freeze({ value: read, source: resolved.source });
}

/** `--feature` over `spec.feature`; unset means the slug comes from the location. */
export function resolveFeatureInput(pair: InputPair): ResolvedInput {
  return resolveInput(pair);
}

/**
 * The format of a run, settled ONCE: the explicit input of F104-FR-007 if there
 * is one, else detection over the file. An unknown explicit value raises
 * `UnknownFormatError` and is never guessed (F104-FR-006).
 */
export type SettledFormat = {
  readonly format: string;
  /** `flag`, `key`, or `detected` where no input named one. */
  readonly source: InputSource | "detected";
};

export function settleFormat(
  path: string,
  pair: InputPair,
  registry: SpecFormatRegistry = defaultRegistry,
): SettledFormat {
  const input = resolveFormatInput(pair);
  if (input.value !== undefined) {
    return Object.freeze({
      format: registry.resolveExplicit(input.value),
      source: input.source,
    });
  }
  return Object.freeze({
    format: detectFormatOfPath(path, undefined, registry),
    source: "detected" as const,
  });
}

/**
 * The resolved format is handed to every later reader of the run, so that none
 * reads the file again to detect it (F104-FR-007, B-0060; research D-8). The
 * hand-over itself is the run snapshot of annex B §B.12 (CQ-039), which the
 * engine writes; this flag records the obligation on this side.
 */
export const FORMAT_IS_HANDED_TO_EVERY_LATER_READER = true as const;

/** Under the profile `parity` both keys are unset; the fixture sets its own. */
export const VALUE_UNDER_THE_PARITY_PROFILE = undefined;
