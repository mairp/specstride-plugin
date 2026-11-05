/**
 * T026 — the command `learn` (F106-FR-022 to F106-FR-025): the input
 * selection, the options, and the handler the front door routes the command
 * to (annex G §G.1).
 *
 * User Story 1 implements the two read-only modes: `--show` (the default:
 * the advice, then the read-only report of the last evaluations) and
 * `--summarize` (the summary as JSON on standard output). Neither writes
 * anything except when an output is asked for. The remaining modes of the
 * contract (`--apply`, `--revert`, `--off`, `--evaluate`) are the later user
 * stories; this build's dispatch accepts the six spellings of F106-FR-022 in
 * its message text and runs the two implemented ones, so a caller of a later
 * mode gets the same refusal shape as a caller of a mistyped one, with exit 1.
 *
 * The mode is the first argument that the front door does not take as one of
 * its own options (annex G §G.1: the working directory, the spec, the
 * feature); those are stripped by the front door and handed to the handler
 * through the ports. The defaults of the knobs are the values the aliases
 * `SPECSTRIDE_PROPOSER_TIMEOUT` (1800) and `SPECSTRIDE_YIELD_POLL` (30) stand
 * for (F106-FR-024, annex X §X.8).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  ADJUSTABLE_KNOBS,
  allowlistRefusalMessage,
  isAdjustableKnob,
  type AdjustableKnob,
} from "./knobs.ts";
import { effectiveValue, entryShape, unshapedNotice } from "./decision-log.ts";
import { activeDecisions, evaluateDecision, lastEvaluation } from "./evaluate.ts";
import { readDecisionEntries, readEventsFile, type ReadEvent } from "./events-reader.ts";
import { summarize } from "./metrics.ts";
import {
  cannotFindDecisionLogLine,
  cannotReadShapesLine,
  applyRequiresPhaseLine,
  digestLine,
  evaluationLine,
  eventsOrSummaryRequiredLine,
  noActiveDecisionsLine,
  noEventsFoundLine,
  notEvaluatedLine,
  revertUsageLine,
  runIdFormLine,
  unknownOptionLine,
} from "./lines.ts";
import { advise } from "./suggest.ts";
import { appendEntry } from "./decision-log.ts";
import {
  applyRefusalReason,
  observedShapeOf,
  planApply,
  utcSeconds,
  type ApplyPlan,
} from "./apply.ts";
import { planRevert } from "./revert.ts";
import { OFF_NOTE_LINE, planOff } from "./off.ts";
import { isRunIdText } from "./mode.ts";
import { eventTimestamp, learningPaths, withLearningLockSync } from "./stream.ts";

/** A fresh decision run id: `learn-` and twelve hexadecimal characters. */
export function newLearnRunId(): string {
  return `learn-${randomBytes(6).toString("hex")}`;
}

/** The word of the command. */
export const LEARN_VERB = "learn" as const;

/** The six modes of F106-FR-022, in the order the unknown-option message lists them. */
export const LEARN_MODES = [
  "--show",
  "--apply",
  "--revert",
  "--off",
  "--summarize",
  "--evaluate",
] as const;

export type LearnMode = (typeof LEARN_MODES)[number];

/** The modes this build runs; `--evaluate` arrives with its user story. */
const IMPLEMENTED_MODES: readonly LearnMode[] = [
  "--show",
  "--summarize",
  "--apply",
  "--revert",
  "--off",
  "--evaluate",
];

/** The options with a value, spelled as at the baseline (F106-FR-024). */
export const LEARN_FLAGS_WITH_VALUE = [
  "--events",
  "--summary",
  "--out",
  "--specs",
  "--spec-format",
  "--phase-shape",
  "--verification-dir",
  "--verdicts-dir",
  "--run-log",
  "--live-regex",
  "--feature-dir",
  "--applied-file",
  "--events-file",
  "--knob",
  "--phase",
  "--default",
  "--run-id",
] as const;

/** The boolean options. */
export const LEARN_BOOLEAN_FLAGS = [
  "--pretty",
  "--force",
  "--dry-run",
  "--report",
  "--json",
] as const;

/** Every option the verb itself takes. */
export const LEARN_FLAGS: readonly string[] = [...LEARN_FLAGS_WITH_VALUE, ...LEARN_BOOLEAN_FLAGS];

/** The flags the FRONT DOOR takes before the mode (annex G §G.1); the verb never sees them. */
export const FRONT_DOOR_FLAGS = ["-w", "--workspace", "--feature", "--workdir", "--specs"] as const;

/** The default of `SPECSTRIDE_PROPOSER_TIMEOUT` (annex X §X.8). */
export const DEFAULT_PROPOSER_TIMEOUT_SEC = 1800 as const;
/** The default of `SPECSTRIDE_YIELD_POLL` (annex X §X.8). */
export const DEFAULT_YIELD_POLL_SEC = 30 as const;
/** The default of `--live-regex` (F106-FR-024). */
export const DEFAULT_LIVE_REGEX = "runners/live" as const;

/** What the handler returns: the two streams and the exit code. */
export type LearnResult = {
  readonly exit: number;
  readonly stdout: string;
  readonly stderr: string;
};

/** The context the front door hands the handler, and the seams the tests use. */
export type LearnPorts = {
  /** The working directory the front door resolved (`-w`/`--workspace`). */
  readonly workspace?: string | undefined;
  /** The feature name the front door resolved (`--feature`), else `SPECSTRIDE_FEATURE`. */
  readonly feature?: string | undefined;
  /** The environment, handed in; the alias defaults are read from it. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The phase shapes of the spec, resolved by the caller when it owns the spec reader. */
  readonly phaseShapesOf?: (specsPath: string) => Record<number, string>;
};

/** The parsed argument list. */
type ParsedArgs = {
  readonly mode: LearnMode;
  readonly revertTarget: string | null;
  readonly values: Readonly<Record<string, string>>;
  readonly flags: ReadonlySet<string>;
};

/** Parse the argument list the way F106-FR-022 and F106-FR-024 read. */
export function parseLearnArgs(
  argv: readonly string[],
): ParsedArgs | { readonly error: string; readonly exit: 1 } {
  let mode: LearnMode | null = null;
  let revertTarget: string | null = null;
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }
    if ((LEARN_MODES as readonly string[]).includes(arg) && mode === null) {
      mode = arg as LearnMode;
      continue;
    }
    if ((LEARN_FLAGS_WITH_VALUE as readonly string[]).includes(arg)) {
      const value = argv[++i];
      if (value === undefined) {
        return { error: unknownOptionLine(arg), exit: 1 };
      }
      values[arg] = value;
      continue;
    }
    if ((LEARN_BOOLEAN_FLAGS as readonly string[]).includes(arg)) {
      flags.add(arg);
      continue;
    }
    // The first flag that is neither a mode nor an option of the verb is not
    // a mode this build knows (F106-FR-022).
    return { error: unknownOptionLine(arg), exit: 1 };
  }
  if (mode === "--revert") {
    revertTarget = rest.shift() ?? null;
    if (revertTarget === null || revertTarget.startsWith("-")) {
      return { error: revertUsageLine(), exit: 1 };
    }
  }
  return { mode: mode ?? "--show", revertTarget, values, flags };
}

/**
 * The event streams of the given paths, in order: an events file itself, a
 * run directory, a directory of run directories (`findEventFiles` of
 * `events-reader.ts`), plus the legacy state streams the layout table names
 * (`run:<id>:events-legacy#…`), which `learn` reads too (F106-FR-004).
 */
export function discoverEventStreams(paths: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    if (statSync(p).isFile()) {
      out.push(p);
      continue;
    }
    walk(p, out, 0);
  }
  const seen = new Set<string>();
  return out.filter((f) => (seen.has(f) ? false : (seen.add(f), true)));
}

function walk(dir: string, out: string[], depth: number): void {
  if (depth > 4) return;
  let names: string[] = [];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const name of names) {
    const full = `${dir}/${name}`;
    let isFile = false;
    try {
      isFile = statSync(full).isFile();
    } catch {
      continue;
    }
    if (isFile) {
      if (name === "events.jsonl" || name.includes("events-legacy")) out.push(full);
      continue;
    }
    walk(full, out, depth + 1);
  }
}

/** The default inputs of the verb, in order (F106-FR-024). */
export function defaultInputPaths(workspace: string | undefined): string[] {
  if (!workspace) return [];
  const candidates = [
    `${workspace}/.specstride/runs`,
    `${workspace}/state`,
    `${workspace}/.specstride`,
  ];
  return candidates.filter((p) => existsSync(p));
}

/** Read the events of the selected streams, leniently. */
function readAllStreams(paths: readonly string[]): ReadEvent[] {
  const out: ReadEvent[] = [];
  for (const file of discoverEventStreams(paths)) out.push(...readEventsFile(file));
  return out;
}

/** The phase shapes the spec gives, with the notice of F106-FR-024 on failure. */
function phaseShapes(
  specsPath: string | undefined,
  explicit: Readonly<Record<string, string>>,
  ports: LearnPorts,
): { shapes: Record<number, string>; notice: string | null } {
  const shapes: Record<number, string> = {};
  for (const [k, v] of Object.entries(explicit)) {
    const n = Number(k);
    if (Number.isInteger(n)) shapes[n] = v;
  }
  if (specsPath === undefined) return { shapes, notice: null };
  try {
    // The spec READER is handed in by the caller (the front door owns the
    // canonical reader of feature 104; learning itself may import only the
    // contracts and kernel packages, LR-1 of annex A §A.2). Without a reader
    // the advice runs unrestricted (the notice of F106-FR-024 is the
    // caller's to raise).
    if (ports.phaseShapesOf) Object.assign(shapes, ports.phaseShapesOf(specsPath));
  } catch (error) {
    return { shapes, notice: cannotReadShapesLine(specsPath, messageOf(error)) };
  }
  return { shapes, notice: null };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run the command `learn` on the arguments that follow its word. */
export function runLearn(argv: readonly string[], ports: LearnPorts = {}): LearnResult {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const parsed = parseLearnArgs(argv);
  if ("error" in parsed) {
    stderr.push(parsed.error);
    return { exit: parsed.exit, stdout: "", stderr: stderr.join("\n") + "\n" };
  }
  if (!IMPLEMENTED_MODES.includes(parsed.mode)) {
    stderr.push(unknownOptionLine(parsed.mode));
    return { exit: 1, stdout: "", stderr: stderr.join("\n") + "\n" };
  }

  const env = ports.env ?? {};
  const defaultTimeout =
    positiveInt(env["SPECSTRIDE_PROPOSER_TIMEOUT"]) ?? DEFAULT_PROPOSER_TIMEOUT_SEC;
  const defaultPoll = positiveInt(env["SPECSTRIDE_YIELD_POLL"]) ?? DEFAULT_YIELD_POLL_SEC;
  const featureName = ports.feature ?? env["SPECSTRIDE_FEATURE"];
  const appliedFileOf = (): string | undefined =>
    parsed.values["--applied-file"] ?? defaultDecisionLog(ports.workspace, featureName);
  const featureDirOf = (): string | undefined => {
    if (!ports.workspace || !featureName) return undefined;
    return `${ports.workspace}/.specstride/features/${featureName}`;
  };
  const decisionEntriesOf = (): Record<string, unknown>[] =>
    readDecisionEntriesLeniently(parsed.values["--applied-file"], ports.workspace, featureName);

  // ── `--revert <run id>` (F106-FR-016): no telemetry input is needed ────────
  if (parsed.mode === "--revert") {
    const appliedFile = appliedFileOf();
    const featureDir = featureDirOf();
    if (appliedFile === undefined || featureDir === undefined) {
      stderr.push(cannotFindDecisionLogLine());
      return { exit: 2, stdout: "", stderr: stderr.join("\n") + "\n" };
    }
    const entries = decisionEntriesOf();
    const revertRunId = parsed.values["--run-id"] ?? newLearnRunId();
    const plan = planRevert({
      entries,
      runId: parsed.revertTarget!,
      revertRunId,
      appliedAt: utcSeconds(),
    });
    if (plan.refused) {
      stderr.push(`learn: ${plan.message}`);
      return { exit: plan.exit, stdout: "", stderr: stderr.join("\n") + "\n" };
    }
    withLearningLockSync(featureDir, () => {
      appendEntry(appliedFile, plan.entry);
      appendFileSync(learningPaths(featureDir).events, plan.eventLine, "utf8");
    });
    stdout.push(plan.line);
    return { exit: 0, stdout: stdout.join("\n") + "\n", stderr: "" };
  }

  // ── `--off` (F106-FR-017): revert every key whose latest decision is an apply ──
  if (parsed.mode === "--off") {
    const appliedFile = appliedFileOf();
    const featureDir = featureDirOf();
    if (appliedFile === undefined || featureDir === undefined) {
      // No decision log can be found: exit 2 (F106-FR-017).
      stderr.push(cannotFindDecisionLogLine());
      return { exit: 2, stdout: "", stderr: stderr.join("\n") + "\n" };
    }
    const entries = decisionEntriesOf();
    const runId = parsed.values["--run-id"] ?? newLearnRunId();
    const plan = planOff({ entries, runId, appliedAt: utcSeconds() });
    withLearningLockSync(featureDir, () => {
      for (const revert of plan.reverts) {
        if (revert.refused) continue;
        appendEntry(appliedFile, revert.entry);
        appendFileSync(learningPaths(featureDir).events, revert.eventLine, "utf8");
      }
    });
    stdout.push(...plan.lines, OFF_NOTE_LINE);
    return { exit: 0, stdout: stdout.join("\n") + "\n", stderr: "" };
  }

  // ── the inputs (F106-FR-024): a summary wins over events ──────────────────
  const specsFlag =
    parsed.values["--specs"] ??
    (ports.workspace && existsSync(`${ports.workspace}/SPECS.md`)
      ? `${ports.workspace}/SPECS.md`
      : undefined);
  let shapesResolved: { shapes: Record<number, string>; notice: string | null } | null = null;
  const summaryFlag = parsed.values["--summary"];
  const eventFlags = parsed.values["--events"] !== undefined ? [parsed.values["--events"]!] : [];
  let document: Record<string, unknown> | null = null;
  let events: ReadEvent[] = [];

  if (summaryFlag !== undefined) {
    try {
      document = JSON.parse(readFileSync(summaryFlag, "utf8")) as Record<string, unknown>;
    } catch (error) {
      stderr.push(`learn: cannot read summary ${summaryFlag}: ${messageOf(error)}`);
      return { exit: 2, stdout: "", stderr: stderr.join("\n") + "\n" };
    }
  } else {
    const bases = eventFlags.length ? eventFlags : defaultInputPaths(ports.workspace);
    if (!eventFlags.length && !bases.length) {
      stderr.push(eventsOrSummaryRequiredLine());
      return { exit: 2, stdout: "", stderr: stderr.join("\n") + "\n" };
    }
    events = readAllStreams(bases);
    const found = discoverEventStreams(bases);
    if (!found.length) {
      stderr.push(noEventsFoundLine(bases));
      return { exit: 2, stdout: "", stderr: stderr.join("\n") + "\n" };
    }
    // The shapes are resolved BEFORE the summary, so the phase figures are
    // keyed on the shapes the spec has now (F106-FR-024): an attempt of
    // another shape is left out of the figures, and a phase with no attempt
    // under the shape is a phase with no telemetry.
    const shapesEarly = phaseShapes(
      specsFlag,
      parsePhaseShapeFlag(parsed.values["--phase-shape"]),
      ports,
    );
    if (shapesEarly.notice) stderr.push(shapesEarly.notice);
    shapesResolved = shapesEarly;
    document = summarize(events, {
      ...(Object.keys(shapesEarly.shapes).length ? { phaseShapes: shapesEarly.shapes } : {}),
    });
  }
  const summary = document ?? {};

  // ── the phase shapes (F106-FR-024): resolved above, with the events ───────
  if (shapesResolved === null) {
    shapesResolved = phaseShapes(
      specsFlag,
      parsePhaseShapeFlag(parsed.values["--phase-shape"]),
      ports,
    );
    if (shapesResolved.notice) stderr.push(shapesResolved.notice);
  }
  const shapes = Object.keys(shapesResolved.shapes).length ? shapesResolved.shapes : undefined;

  // ── the decision log, for the current values and the report ───────────────
  const decisionEntries = readDecisionEntriesLeniently(
    parsed.values["--applied-file"],
    ports.workspace,
    ports.feature ?? env["SPECSTRIDE_FEATURE"],
  );
  const through = env["SPECSTRIDE_LEARNING_THROUGH"] ?? null;
  const currentOf = (knob: AdjustableKnob, phase: number): number => {
    const shape = shapes?.[phase] ?? null;
    const replayed = effectiveValue(decisionEntries, knob, phase, shape, through);
    if (replayed !== null) return replayed;
    return knob === "proposer_timeout" ? defaultTimeout : defaultPoll;
  };

  // ── `--apply` (F106-FR-014, F106-FR-015): one knob, one phase ─────────────
  if (parsed.mode === "--apply") {
    const knobOption = parsed.values["--knob"] ?? "proposer_timeout";
    if (!isAdjustableKnob(knobOption)) {
      stderr.push(allowlistRefusalMessage(knobOption));
      return { exit: 2, stdout: "", stderr: stderr.join("\n") + "\n" };
    }
    const knob: AdjustableKnob = knobOption;
    const phaseArg = parsed.values["--phase"];
    const phaseN = phaseArg !== undefined ? Number(phaseArg) : NaN;
    if (phaseArg === undefined || !Number.isInteger(phaseN) || phaseN < 1) {
      stderr.push(applyRequiresPhaseLine());
      return { exit: 2, stdout: "", stderr: stderr.join("\n") + "\n" };
    }
    const phase = phaseN;
    const runId = parsed.values["--run-id"] ?? newLearnRunId();
    if (!isRunIdText(runId)) {
      stderr.push(runIdFormLine());
      return { exit: 2, stdout: "", stderr: stderr.join("\n") + "\n" };
    }
    const appliedFile = appliedFileOf();
    const featureDir = featureDirOf();
    if (appliedFile === undefined || featureDir === undefined) {
      stderr.push(cannotFindDecisionLogLine());
      return { exit: 2, stdout: "", stderr: stderr.join("\n") + "\n" };
    }
    const eventsFile = learningPaths(featureDir).events;
    mkdirSync(learningPaths(featureDir).dir, { recursive: true });
    let plannedLine: string | null = null;
    // The lock is held from the deciding read to the append (F106-FR-038).
    const refusal = withLearningLockSync(featureDir, (): string | null => {
      const rows = advise(
        summary,
        { currentOf, defaultTimeout, defaultPoll },
        { knobs: [knob], phases: [phase], onlyPhase: phase },
      ).rows;
      const row = rows.find((r) => r.knob === knob && r.phase === phase) ?? null;
      const reason = row === null ? `no telemetry for phase ${phase}` : applyRefusalReason(row!);
      if (reason !== null) return `3\u0000${reason}`;
      // The decision is keyed under the shape the spec gives, else the shape
      // the phase's own phase_start events carry (F106-FR-019).
      const shape = shapes?.[phase] ?? observedShapeOf(events, phase);
      const plan = planApply({
        row: row!,
        runId,
        shape,
        doc: summary,
        events,
        entries: decisionEntries,
        summary,
        force: parsed.flags.has("--force"),
        appliedFile,
        appliedAt: utcSeconds(),
        ts: eventTimestamp(),
      });
      if (plan.refused) return `${plan.exit ?? 3}\u0000${plan.reason}`;
      const applyPlan = plan as ApplyPlan;
      appendEntry(appliedFile, applyPlan.entry);
      appendFileSync(eventsFile, applyPlan.eventLine, "utf8");
      plannedLine = applyPlan.line;
      return null;
    });
    if (refusal !== null) {
      const [codeText, ...rest] = refusal.split("\u0000");
      stderr.push(`learn: refusing to apply — ${rest.join("\u0000")}`);
      return { exit: Number(codeText), stdout: "", stderr: stderr.join("\n") + "\n" };
    }
    stdout.push(plannedLine!);
    return { exit: 0, stdout: stdout.join("\n") + "\n", stderr: "" };
  }

  // ── `--evaluate` (F106-FR-022, F106-FR-023): always a dry run ─────────────
  // The evaluate mode writes nothing (the learn-verb contract): the recording
  // and the automatic revert happen at module level (guardrails.ts), and
  // `apply` is the only mode that can refuse with exit 4.
  if (parsed.mode === "--evaluate") {
    const appliedFile = appliedFileOf();
    const featureDir = featureDirOf();
    if (appliedFile === undefined || featureDir === undefined) {
      stderr.push(cannotFindDecisionLogLine());
      return { exit: 2, stdout: "", stderr: stderr.join("\n") + "\n" };
    }
    const phaseArg = parsed.values["--phase"];
    const phaseFilter =
      phaseArg !== undefined && Number.isInteger(Number(phaseArg)) && Number(phaseArg) >= 1
        ? Number(phaseArg)
        : null;
    const decisions = activeDecisions(decisionEntries, phaseFilter);
    if (parsed.flags.has("--report")) {
      if (!decisions.length) {
        stdout.push(noActiveDecisionsLine());
      }
      for (const d of decisions) {
        const last = lastEvaluation(decisionEntries, String(d["run_id"]));
        stdout.push(
          last !== null
            ? evaluationLine(last)
            : notEvaluatedLine({
                phase: Number(d["phase"]),
                knob: String(d["knob"]),
                previous: Number(d["previous"]),
                value: Number(d["value"]),
                runId: String(d["run_id"]),
              }),
        );
      }
      return { exit: 0, stdout: stdout.join("\n") + "\n", stderr: "" };
    }
    for (const d of decisions) {
      const ph = Number(d["phase"]);
      const shape = shapes?.[ph] ?? entryShape(d);
      const result = evaluateDecision(summary, d, shape ?? null);
      stdout.push(evaluationLine(result));
    }
    return { exit: 0, stdout: stdout.join("\n") + "\n", stderr: "" };
  }

  if (parsed.mode === "--summarize") {
    const out = parsed.values["--out"];
    const text = JSON.stringify(summary, null, parsed.flags.has("--pretty") ? 2 : undefined) + "\n";
    if (out !== undefined) {
      writeFileSync(out, text, "utf8");
      const totals = (summary["totals"] ?? {}) as Record<string, unknown>;
      const kills = (totals["kills_by_reason"] ?? {}) as Record<string, number>;
      stdout.push(
        digestLine({
          runs: numberOf(totals["runs"]),
          attempts: numberOf(totals["attempts"]),
          passes: numberOf(totals["passes"]),
          cost: numberOf(totals["cost_usd"]) ?? 0,
          kills,
          out,
        }),
      );
    } else {
      stdout.push(text.trimEnd());
    }
    return {
      exit: 0,
      stdout: stdout.join("\n") + "\n",
      stderr: stderr.join("\n") + (stderr.length ? "\n" : ""),
    };
  }

  // ── `--show`: the advice, then the report (F106-FR-023) ───────────────────
  const phaseOption = parsed.values["--phase"];
  const knobOption = parsed.values["--knob"];
  if (knobOption !== undefined && !isAdjustableKnob(knobOption)) {
    stderr.push(allowlistRefusalMessage(knobOption));
    return { exit: 2, stdout: "", stderr: stderr.join("\n") + "\n" };
  }
  const knobs: AdjustableKnob[] | undefined =
    knobOption !== undefined ? [knobOption as AdjustableKnob] : undefined;
  const onlyPhase = phaseOption !== undefined ? Number(phaseOption) : undefined;
  const advice = advise(
    summary,
    { currentOf, defaultTimeout, defaultPoll },
    {
      knobs,
      ...(onlyPhase !== undefined && Number.isInteger(onlyPhase)
        ? { phases: [onlyPhase], onlyPhase }
        : {}),
    },
  );
  stdout.push(...advice.lines);
  // No telemetry anywhere (F106-FR-025): the line goes to standard error.
  if (advice.exitCode === 1 && advice.stderrLine) stderr.push(advice.stderrLine);

  // A shape was asked for and decisions predate it: the notice (F106-FR-011).
  if (shapes) {
    for (const knob of knobs ?? [...ADJUSTABLE_KNOBS]) {
      for (const phase of Object.keys(summary["phases"] ?? {}).map(Number)) {
        const notice = unshapedNotice(decisionEntries, knob, phase, shapes[phase] ?? null);
        if (notice) stderr.push(notice);
      }
    }
  }

  const out = parsed.values["--out"];
  if (out !== undefined) {
    // An output was asked for: the rows as indented JSON, nothing else written.
    writeFileSync(out, `${JSON.stringify(advice.rows, null, 2)}\n`, "utf8");
  }

  // The report of the last evaluations, read-only; its failure is ignored.
  try {
    stdout.push(...reportLines(decisionEntries));
  } catch {
    /* the report never fails the command (F106-FR-023) */
  }

  return {
    exit: advice.exitCode,
    stdout: stdout.join("\n") + (stdout.length ? "\n" : ""),
    stderr: stderr.join("\n") + (stderr.length ? "\n" : ""),
  };
}

/** The read-only report of the last evaluations (F106-FR-023). */
export function reportLines(entries: readonly Record<string, unknown>[]): string[] {
  const decisions = entries.filter((e) => typeof e["knob"] === "string");
  if (!decisions.length) return [noActiveDecisionsLine()];
  const lastByKey = new Map<string, Record<string, unknown>>();
  const order: string[] = [];
  for (const entry of entries) {
    if (entry["action"] !== "evaluate") continue;
    const key = `${String(entry["knob"])}\u0000${String(entry["phase"])}`;
    if (!lastByKey.has(key)) order.push(key);
    lastByKey.set(key, entry);
  }
  if (!order.length) return [noActiveDecisionsLine()];
  return order.map((key) => evaluationLine(lastByKey.get(key)!));
}

function readDecisionEntriesLeniently(
  appliedFile: string | undefined,
  workspace: string | undefined,
  feature: string | undefined,
): Record<string, unknown>[] {
  const path = appliedFile ?? defaultDecisionLog(workspace, feature);
  if (path === undefined || !existsSync(path)) return [];
  try {
    return readDecisionEntries(path);
  } catch {
    return [];
  }
}

/** The decision log of the feature, derived from the workspace (F106-FR-024). */
export function defaultDecisionLog(
  workspace: string | undefined,
  feature: string | undefined,
): string | undefined {
  if (!workspace || !feature) return undefined;
  return `${workspace}/.specstride/features/${feature}/learning/applied.json`;
}

function parsePhaseShapeFlag(value: string | undefined): Record<string, string> {
  if (!value) return {};
  const out: Record<string, string> = {};
  for (const part of value.split(",")) {
    const at = part.indexOf("=");
    if (at > 0) out[part.slice(0, at).trim()!] = part.slice(at + 1).trim();
  }
  return out;
}

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
