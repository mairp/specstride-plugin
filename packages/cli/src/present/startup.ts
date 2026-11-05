/**
 * The engine's foreground start-up: the start-up record, the halt banners and
 * the live-mode rules (F145-FR-018, F145-FR-019, F145-FR-020).
 *
 * Every literal line here is the baseline engine script's at `9cab15d`
 * (items B-0195..B-0201, B-0229, B-0230, B-0261..B-0266, B-0335), with one
 * divergence (DV-006): where the baseline's text names the script file
 * (`specstride`), the first word names the logical component `engine`.
 * Nothing in this module is on the path of control: a caller that never calls
 * it, or a call that throws, changes no run (Principle V).
 */
import { bannerCall } from "./banner.ts";
import type { Writer } from "./banner.ts";
import type { Env, StreamLike } from "./theme.ts";
import { presenterCall } from "./presenter.ts";
import type { Sink } from "./presenter.ts";

/** The logical component named where the baseline names its script file. */
export const ENGINE_COMPONENT = "engine";

/** The fallback title when the banner module is missing (F145-FR-018). */
export const FALLBACK_TITLE = "specstride: from specs to tested code";

/** The grace a background presenter gets after the engine exits (B-0265). */
export const PRESENTER_GRACE_SECONDS = 0.6;

/** The frame the halt banners are drawn with (B-0229, B-0230). */
export const HALT_RULE = "#".repeat(60);

/** The live values `SPECSTRIDE_LIVE` accepts (F145-FR-020). */
export const LIVE_VALUES = ["auto", "true", "false"] as const;
export type LiveSetting = (typeof LIVE_VALUES)[number];

/** One truthy/falsey spelling of the environment, as the baseline reads it. */
function envFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const lowered = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(lowered)) return true;
  if (["0", "false", "no", "off"].includes(lowered)) return false;
  return undefined;
}

/**
 * Resolve the inline live timeline (F145-FR-020, B-0029, B-0030): `--live`
 * forces true, `--no-live` forces false, `SPECSTRIDE_LIVE` (`auto`, `true`,
 * `false`, default `auto`) controls it otherwise, and `auto` resolves true
 * only when standard output is a terminal and the presenter exists.
 */
export function resolveLive(options: {
  readonly live?: "live" | "no-live";
  readonly env?: Env;
  readonly stdoutIsTTY?: boolean;
  readonly presenterExists?: boolean;
}): boolean {
  if (options.live === "live") return true;
  if (options.live === "no-live") return false;
  const raw = (options.env?.SPECSTRIDE_LIVE ?? "auto").toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return options.stdoutIsTTY === true && options.presenterExists !== false;
}

/** The live setting as the environment alone would resolve it, before flags. */
export function liveSettingOf(env: Env = {}): LiveSetting {
  const raw = (env.SPECSTRIDE_LIVE ?? "auto").toLowerCase();
  return (LIVE_VALUES as readonly string[]).includes(raw) ? (raw as LiveSetting) : "auto";
}

/** The inputs of the rail state list (B-0266): one letter per phase, in order. */
export function railStateLetters(options: {
  readonly phases: readonly number[];
  readonly approved: ReadonlySet<number>;
  readonly rejected: ReadonlySet<number>;
  readonly current?: number | null;
}): string {
  const out: string[] = [];
  for (const n of options.phases) {
    if (options.approved.has(n)) out.push("A");
    else if (options.rejected.has(n)) out.push("R");
    else if (options.current === n) out.push("C");
    else out.push("P");
  }
  return out.join(",");
}

/** Everything the start-up record's labelled lines are built from. */
export interface StartupConfig {
  readonly workdir: string;
  readonly specsPath: string;
  readonly phases: readonly number[];
  readonly slug: string;
  readonly stateRel: string;
  readonly proposer: string;
  readonly critic: string;
  readonly maxRejects: number | string;
  readonly maxIter: number | string;
  readonly proposerTimeout: number | string;
  readonly criticTimeout: number | string;
  readonly maxWallMin: number | string;
  readonly gitCommits: string;
  /** The full text after `telemetry: ` (the four receiver states, never `true`). */
  readonly telemetryLine: string;
  readonly verification: string;
  readonly testPlan?: string;
  readonly generateTests?: string;
  readonly resumePhase?: string | null;
  readonly startPhase?: string | null;
  readonly runId: string;
  readonly stopFlagPath: string;
  readonly isoTime: string;
  readonly sandboxNote?: string;
}

/** The first line: `engine orchestrator start <ISO time>` (DV-006, B-0195). */
export function startupFirstLine(cfg: StartupConfig): string {
  return `${ENGINE_COMPONENT} orchestrator start ${cfg.isoTime}`;
}

/**
 * The start-up record (F145-FR-018): the first line and the labelled lines,
 * each after two spaces, byte for byte the baseline's formats.
 */
export function startupRecordLines(cfg: StartupConfig): string[] {
  const verify =
    `  verify   : ${cfg.verification}` +
    (cfg.verification !== "off" && cfg.testPlan ? `  plan: ${cfg.testPlan}` : "") +
    (cfg.generateTests ? `  scaffolds: ${cfg.generateTests}` : "");
  const resume =
    `  resume   : phase ${cfg.resumePhase ?? "<all approved>"}` +
    (cfg.startPhase ? " (--start-phase)" : "");
  const lines = [
    startupFirstLine(cfg),
    `  workdir  : ${cfg.workdir}`,
    `  specs    : ${cfg.specsPath}  (${cfg.phases.length} phases: ${cfg.phases.join(" ")})`,
    `  feature  : ${cfg.slug}   (state: ${cfg.stateRel}/)`,
    `  proposer : ${cfg.proposer}`,
    `  critic   : ${cfg.critic}`,
    `  max-rej  : ${cfg.maxRejects}   max-iter/phase: ${cfg.maxIter}`,
    `  timeouts : proposer ${cfg.proposerTimeout}s  critic ${cfg.criticTimeout}s   wall: ${cfg.maxWallMin}min`,
    `  git      : ${cfg.gitCommits}`,
    `  telemetry: ${cfg.telemetryLine}`,
    verify,
    resume,
    `  run_id   : ${cfg.runId}`,
    `  stop with: touch ${cfg.stopFlagPath}`,
  ];
  if (cfg.sandboxNote) lines.push(`  note     : ${cfg.sandboxNote}`);
  return lines;
}

/**
 * The short live header the terminal gets instead of the full record
 * (F145-FR-018, B-0261): the splash already shows the name and the phases.
 */
export function liveHeaderLines(cfg: {
  readonly slug: string;
  readonly proposer: string;
  readonly critic: string;
  readonly logPath: string;
}): string[] {
  return [
    "",
    `  feature  ${cfg.slug}`,
    `  agents   proposer ${cfg.proposer}, critic ${cfg.critic}`,
    `  log      ${cfg.logPath}`,
    "",
  ];
}

/** The fallback title block when the banner is missing, for stdout and the log. */
export function fallbackTitleLines(): string[] {
  return ["", FALLBACK_TITLE, ""];
}

/**
 * The engine's own banner at start-up (F145-FR-018): the banner sized with the
 * number of phases and the rail states to the terminal when it is a terminal,
 * and a plain copy always appended to the run log. Never fails the run.
 */
export function printStartupBanner(options: {
  readonly phases: number;
  readonly states: string;
  readonly terminal: (Writer & StreamLike) | undefined;
  readonly log: (text: string) => void;
  readonly env?: Env;
}): void {
  try {
    if (options.terminal?.isTTY) {
      const colored = bannerCall(
        { phases: options.phases, states: options.states },
        options.env ?? {},
        options.terminal,
      );
      options.terminal.write(colored.stdout);
    }
    const plain = bannerCall(
      { phases: options.phases, states: options.states, plain: true },
      options.env ?? {},
    );
    options.log(plain.stdout.replace(/\n$/, ""));
  } catch {
    // Never fails the run (Principle V).
  }
}

/** The banner-missing fallback: the plain title to stdout and the run log. */
export function printFallbackTitle(options: {
  readonly terminal: { write(text: string): void };
  readonly log: (text: string) => void;
}): void {
  const block = fallbackTitleLines().join("\n");
  try {
    options.terminal.write(`${block}\n`);
  } catch {
    // best effort
  }
  options.log(block.replace(/\n$/, ""));
}

/** The plain rail appended to the run log (F145-FR-018): no mark, no name. */
export function appendPlainRail(options: {
  readonly phases: number;
  readonly states: string;
  readonly log: (text: string) => void;
  readonly env?: Env;
}): void {
  try {
    const rail = bannerCall(
      { phases: options.phases, states: options.states, railOnly: true, plain: true },
      options.env ?? {},
    );
    if (rail.stdout !== "") options.log(rail.stdout.replace(/\n$/, ""));
  } catch {
    // Never fails the run.
  }
}

/** The three ways to resume a critic that is not answering (B-0229). */
export function haltCriticUnavailableLines(options: {
  readonly critic: string;
  readonly criticTimeout: number | string;
  readonly workdir: string;
  readonly slug: string;
  readonly phase: number;
  readonly attempts: number;
  readonly streak: number;
  readonly malformedLimit: number | string;
  readonly exitCode: number;
}): string[] {
  return [
    HALT_RULE,
    `# HALT — the critic is not answering (exit ${options.exitCode}).`,
    `#   ${options.streak} consecutive attempts on phase ${options.phase} ended in a MALFORMED`,
    `#   verdict: the critic timed out, was unreachable, or returned no verdict`,
    `#   line. No feedback was produced, so every further proposer attempt would`,
    `#   run blind and the phase can never be approved. This is a CRITIC`,
    `#   AVAILABILITY problem, not a code gap — do not edit the spec.`,
    `#   critic backend  : ${options.critic} (timeout ${options.criticTimeout}s)`,
    `#   latest verdicts : specstride verdicts -w ${options.workdir} --feature ${options.slug}`,
    `#   Options:`,
    `#     - raise the critic timeout: SPECSTRIDE_CRITIC_TIMEOUT=900 engine resume -w ${options.workdir}`,
    `#     - point at a reachable critic: engine resume -w ${options.workdir} --critic <backend>`,
    `#     - raise the tolerance:      SPECSTRIDE_CRITIC_MALFORMED_LIMIT=5 engine resume -w ${options.workdir}`,
    HALT_RULE,
  ];
}

/** The oscillation banner (B-0230). */
export function haltOscillatingLines(options: {
  readonly phase: number;
  readonly criterion: string;
  readonly reappears: number;
  readonly attemptHistory: string;
  readonly exitCode: number;
}): string[] {
  return [
    HALT_RULE,
    `# HALT — phase ${options.phase} is OSCILLATING (exit ${options.exitCode}). Not converging.`,
    `#   criterion ${options.criterion} was cleared and re-rejected ${options.reappears} time(s) across attempts.`,
    `#   This is the signature of an EVIDENCE-GROUNDING problem (the critic sees a`,
    `#   different slice of the repo each attempt), NOT accumulating code gaps.`,
    `#   Check the grounding snapshot for ${options.criterion}'s file (lib/critic.py W1/W2 anchored`,
    `#   excerpts) and the proposer's proof slices before treating it as a real gap.`,
    `#   attempt history : ${options.attemptHistory}`,
    HALT_RULE,
  ];
}

/**
 * The hypothesis (B-0335): `TOOLING BLIND SPOT` naming the `paths` of the last
 * `grounding_gap` event when the run's events hold any of any phase, and
 * otherwise `likely an under-specified acceptance criterion`.
 */
export function hypothesisLines(options: {
  readonly eventsText: string | Iterable<string>;
}): string[] {
  const lines: string[] =
    typeof options.eventsText === "string"
      ? options.eventsText.split("\n")
      : Array.from(options.eventsText);
  const gapLines = lines.filter((line) => line.includes('"event":"grounding_gap"'));
  if (gapLines.length > 0) {
    const last = gapLines[gapLines.length - 1];
    const match = /"paths":"([^"]*)"/.exec(last);
    const paths = match === null ? "?" : match[1];
    return [
      `#   HYPOTHESIS: TOOLING BLIND SPOT — the critic could not ground [${paths}]`,
      `#   though it exists on disk. This is NOT an under-specified spec. Fix the`,
      `#   critic's path extractor (lib/critic.py extract_paths / grounding_gap),`,
      `#   then rerun to resume — do not edit SPECS.md.`,
    ];
  }
  return [
    `#   HYPOTHESIS: likely an under-specified acceptance criterion. Arbitrate`,
    `#   (often by editing SPECS.md), then rerun to resume.`,
  ];
}

/** The max-rejects banner: the frame, the halt line, the trail and the hypothesis. */
export function haltMaxRejectsLines(options: {
  readonly phase: number;
  readonly maxRejects: number | string;
  readonly evidencePath: string;
  readonly feedbackPath: string;
  readonly attemptHistory: string;
  readonly eventsText: string | Iterable<string>;
  readonly exitCode: number;
}): string[] {
  return [
    HALT_RULE,
    `# HALT — phase ${options.phase} exceeded MAX_REJECTS (${options.maxRejects}). Human needed.`,
    `#   latest evidence : ${options.evidencePath}`,
    `#   latest feedback : ${options.feedbackPath}`,
    `#   attempt history : ${options.attemptHistory}`,
    `#   rejection trail:`,
    ...hypothesisLines(options),
    HALT_RULE,
  ];
}

/** A log sink that routes the engine's own lines as live mode demands (B-0262). */
export interface EngineStreams {
  /** The engine's own line, routed per live mode. */
  readonly log: (text: string) => void;
  /** Always the terminal. */
  readonly term: (text: string) => void;
}

/**
 * `log` writes to the run log only in live mode (the scrolling presenter owns
 * the terminal), and tees to the terminal and the run log otherwise;
 * `term` always reaches the terminal (B-0262).
 */
export function engineStreams(options: {
  readonly live: boolean;
  readonly terminal: { write(text: string): void };
  readonly appendLog: (text: string) => void;
}): EngineStreams {
  return {
    log: (text: string) => {
      if (options.live) {
        options.appendLog(text);
      } else {
        options.terminal.write(`${text}\n`);
        options.appendLog(text);
      }
    },
    term: (text: string) => options.terminal.write(`${text}\n`),
  };
}

/** The lines one engine `log` call produces, as a pure function (B-0262). */
export function engineLogLinesFor(
  text: string,
  live: boolean,
): { readonly log: string; readonly term: string } {
  return live ? { log: text, term: "" } : { log: text, term: `${text}\n` };
}

/** Raw output routing (F145-FR-020, B-0264): proposer/critic/verification raw. */
export function rawOutputTargets(live: boolean): {
  readonly terminal: boolean;
  readonly log: boolean;
} {
  return live ? { terminal: false, log: true } : { terminal: true, log: true };
}

/** A running background presenter and the only way to end it. */
export interface BackgroundPresenter {
  readonly started: boolean;
  /** Ends the presenter after the 0.6 second grace (B-0265). Resolves when dead. */
  stop(): Promise<void>;
}

/**
 * Start the one background presenter of live mode (F145-FR-020): it renders
 * the run's event timeline with follow, and is ended when the engine exits
 * after a grace of 0.6 seconds. Best effort: a presenter that cannot start
 * changes nothing.
 */
export function startBackgroundPresenter(options: {
  readonly live: boolean;
  readonly events: string;
  readonly sink?: Sink;
  readonly env?: Env;
  readonly presenterExists?: boolean;
  readonly sleep?: (seconds: number) => Promise<void>;
}): BackgroundPresenter {
  const sleep =
    options.sleep ??
    ((seconds: number) => new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000)));
  if (!options.live || options.presenterExists === false) {
    return { started: false, stop: () => Promise.resolve() };
  }
  const controller = new AbortController();
  const done = presenterCall(
    { events: options.events, mode: "timeline", follow: true },
    options.sink ?? { write: () => undefined },
    { env: options.env ?? {}, signal: controller.signal },
  ).catch(() => undefined);
  let stopped = false;
  return {
    started: true,
    stop: () => {
      if (stopped) return done as Promise<void>;
      stopped = true;
      // The grace first, so the follower can narrate the final event it may
      // not have read yet, then the presenter is ended (B-0265).
      return sleep(PRESENTER_GRACE_SECONDS).then(() => {
        controller.abort();
        return done as Promise<void>;
      });
    },
  };
}

/** A one-line summary of the live decision, for the traceability proofs. */
export function liveDecisionSummary(options: {
  readonly live?: "live" | "no-live";
  readonly env?: Env;
  readonly stdoutIsTTY?: boolean;
  readonly presenterExists?: boolean;
}): string {
  const setting = liveSettingOf(options.env ?? {});
  const resolved = resolveLive(options);
  return `SPECSTRIDE_LIVE=${setting} flag=${options.live ?? "none"} tty=${String(options.stdoutIsTTY === true)} presenter=${String(options.presenterExists !== false)} -> ${String(resolved)}`;
}

// Re-exports so one import serves the engine's foreground call.
export { envFlag as envTruthy };
export type { Env, StreamLike, Sink };
