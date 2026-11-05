/**
 * T011 — the metric summary and the definitions of the metrics (F106-FR-004,
 * F106-FR-005): wait calls, kill classes, outcomes, work seconds and billing.
 *
 * Ported unchanged from the baseline (`lib/learn.py` at the pinned commit
 * `9cab15d2`): the wait/poll classifier of the telemetry report, the kill
 * classes, the closed order of the outcomes, the billing of a pass, the work
 * seconds an attempt was busy for, and the summary document
 * `specstride.learn.summary/7` they roll up into.
 *
 * The summary is a pure function: a list of parsed events in, the summary
 * document out. Shape restriction (`phase_shapes`) narrows a phase's entry to
 * the attempts recorded under that shape; `attempts` and `runs` are never
 * filtered.
 */
import { KILL_CLASS, OUTCOMES, classifyBashTarget, parseRepeatDetail } from "./metrics-support.ts";
import { percentile, round1 } from "./stats.ts";
import { attributeRunIds, readEvents, type ReadEvent } from "./events-reader.ts";

/** The schema id of the summary document (annex B §B.20). */
export const LEARN_SUMMARY_SCHEMA = "specstride.learn.summary/7" as const;

/** The outcome of a pass, in the closed order the summary writes (closed set 195). */
export { OUTCOMES };

/** The class of each kill reason (closed set 280); an unknown reason is class `unknown`. */
export { KILL_CLASS };

/** True for a kill reason of the class `budget` (a hard-cap kill). */
export function isBudgetKillReason(reason: string): boolean {
  return KILL_CLASS[reason] === "budget";
}

export { classifyBashTarget, parseRepeatDetail, percentile };

// ── the streaming pass ───────────────────────────────────────────────────────

/** One pass of one attempt, as the events stream builds it and the summary writes it. */
export type PassRecord = {
  readonly iter: number;
  readonly outcome: string;
  readonly kill_reason: string | null;
  readonly kill_class: string | null;
  readonly elapsed_sec: number | null;
  readonly cost_usd: number | null;
  /** `null` while the pass is still open: neither billed nor unbilled yet. */
  readonly billed: boolean | null;
  readonly tool_calls: number;
  readonly wait_calls: number;
  readonly sleep_sec_declared: number;
  readonly dominant_repeat: string | null;
  readonly dominant_repeat_n: number | null;
  readonly dominant_repeat_share: number | null;
  readonly job_duration_sec: number | null;
};

class Pass {
  end: number | null = null;
  toolCalls = 0;
  waitCalls = 0;
  sleepSec = 0;
  killReason: string | null = null;
  killElapsed: number | null = null;
  killDetail: string | null = null;
  result: Record<string, unknown> | null = null;
  evidence = false;
  jobDuration: number | null = null;

  iter: number;
  start: number | null;

  constructor(iter: number, start: number | null) {
    this.iter = iter;
    this.start = start;
  }

  get outcome(): string {
    if (this.killReason !== null) {
      return isBudgetKillReason(this.killReason) ? "budget_kill" : "worker_error";
    }
    if (this.result === null) return "open";
    if (asBool(this.result["is_error"])) return "worker_error";
    return this.evidence ? "productive" : "clean_no_progress";
  }

  get elapsed(): number | null {
    if (this.killElapsed !== null) return this.killElapsed;
    if (
      this.result !== null &&
      this.result["duration_ms"] !== undefined &&
      this.result["duration_ms"] !== null
    ) {
      return round1(asFloat(this.result["duration_ms"])! / 1000);
    }
    if (this.start !== null && this.end !== null) return round1(this.end - this.start);
    return null;
  }

  toRecord(): PassRecord {
    const cost = this.result ? asFloat(this.result["cost_usd"]) : null;
    const [n, cmd] = parseRepeatDetail(this.killDetail ?? "");
    const outcome = this.outcome;
    return {
      iter: this.iter,
      outcome,
      kill_reason: this.killReason,
      kill_class: this.killReason ? (KILL_CLASS[this.killReason] ?? "unknown") : null,
      elapsed_sec: this.elapsed,
      cost_usd: cost,
      billed: outcome === "open" ? null : cost !== null,
      tool_calls: this.toolCalls,
      wait_calls: this.waitCalls,
      sleep_sec_declared: round1(this.sleepSec),
      dominant_repeat: cmd,
      dominant_repeat_n: n,
      dominant_repeat_share: n !== null && this.toolCalls ? round3(n / this.toolCalls) : null,
      job_duration_sec: this.jobDuration !== null ? round1(this.jobDuration) : null,
    };
  }
}

/** The sample unit of the learning loop: a billed pass not killed for futility. */
export function isSample(pass: PassRecord): boolean {
  return pass.billed === true && pass.kill_class !== "futility";
}

type AttemptRecord = {
  run: string;
  phase: number;
  attempt: number;
  title: string;
  shape: string | null;
  verdict: string | null;
  verdict_reason: string | null;
  verification: string | null;
  verification_rc: number | null;
  started: number | null;
  ended: number | null;
  wall_sec: number | null;
  passes: number;
  proposer_elapsed_sec: number;
  cost_usd: number;
  billed_passes: number;
  unbilled_passes: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  tool_calls: number;
  wait_calls: number;
  work_calls: number;
  wait_call_share: number | null;
  sleep_sec_declared: number;
  work_sec_estimate: number | null;
  kills_by_reason: Record<string, number>;
  outcomes: Record<string, number>;
  evidence_written: number;
  grounding_gap_paths: number;
  critic_sec: number | null;
  gate_duration_ms: number | null;
  gate_live_share: number | null;
  diagnostician_case: string | null;
  critic_prompt_bytes: number | null;
  passes_detail: PassRecord[];
};

class Attempt {
  end: number | null = null;
  passes = new Map<number, Pass>();
  verdict: string | null = null;
  verdictReason: string | null = null;
  verification: string | null = null;
  verificationRc: number | null = null;
  evidenceWritten = 0;
  groundingPaths: string[] = [];
  criticStart: number | null = null;
  criticSec: number | null = null;
  gateDurationMs: number | null = null;
  gateLiveShare: number | null = null;
  diagnosticianCase: string | null = null;
  criticPromptBytes: number | null = null;

  run: string;
  phase: number;
  attempt: number;
  start: number | null;
  title: string;
  shape: string | null;

  constructor(
    run: string,
    phase: number,
    attempt: number,
    start: number | null,
    title: string,
    shape: string | null,
  ) {
    this.run = run;
    this.phase = phase;
    this.attempt = attempt;
    this.start = start;
    this.title = title;
    this.shape = shape;
  }

  toRecord(): AttemptRecord {
    const passes = [...this.passes.values()].map((p) => p.toRecord());
    const tool = sum(passes.map((p) => p.tool_calls));
    const wait = sum(passes.map((p) => p.wait_calls));
    const sleep = round1(sum(passes.map((p) => p.sleep_sec_declared)));
    const elapsed = passes.map((p) => p.elapsed_sec).filter((v): v is number => v !== null);
    const cost = round4(sum(passes.map((p) => p.cost_usd ?? 0)));
    const results = [...this.passes.values()].map((p) => p.result).filter((r) => r !== null);
    const kills = counter(passes.map((p) => p.kill_reason).filter((r): r is string => r !== null));
    const outcomes = counter(passes.map((p) => p.outcome));
    return {
      run: this.run,
      phase: this.phase,
      attempt: this.attempt,
      title: this.title,
      shape: this.shape,
      verdict: this.verdict,
      verdict_reason: this.verdictReason,
      verification: this.verification,
      verification_rc: this.verificationRc,
      started: this.start,
      ended: this.end,
      wall_sec: this.start !== null && this.end !== null ? round1(this.end - this.start) : null,
      passes: passes.length,
      proposer_elapsed_sec: round1(sum(elapsed)),
      cost_usd: cost,
      billed_passes: passes.filter((p) => p.billed === true).length,
      unbilled_passes: passes.filter((p) => p.billed === false).length,
      cache_creation_tokens: sum(results.map((r) => asInt(r!["cache_creation_tokens"]) ?? 0)),
      cache_read_tokens: sum(results.map((r) => asInt(r!["cache_read_tokens"]) ?? 0)),
      output_tokens: sum(results.map((r) => asInt(r!["output_tokens"]) ?? 0)),
      tool_calls: tool,
      wait_calls: wait,
      work_calls: tool - wait,
      wait_call_share: tool ? round3(wait / tool) : null,
      sleep_sec_declared: sleep,
      // declared sleeps can exceed the pass (backgrounded/timed-out waits): floor at 0
      work_sec_estimate: elapsed.length ? round1(Math.max(0, sum(elapsed) - sleep)) : null,
      kills_by_reason: kills,
      outcomes: Object.fromEntries(
        OUTCOMES.filter((o) => outcomes[o] !== undefined).map((o) => [o, outcomes[o]!]),
      ),
      evidence_written: this.evidenceWritten,
      grounding_gap_paths: this.groundingPaths.length,
      critic_sec: this.criticSec,
      gate_duration_ms: this.gateDurationMs,
      gate_live_share: this.gateLiveShare,
      diagnostician_case: this.diagnosticianCase,
      critic_prompt_bytes: this.criticPromptBytes,
      passes_detail: passes,
    };
  }
}

class Run {
  feature: unknown = null;
  backend: unknown = null;
  resumeFrom: number | null = null;
  started: number | null = null;
  lastTs: number | null = null;
  stopped: number | null = null;
  stopReason: unknown = null;
  stopPhase: number | null = null;
  curPhase: number | null = null;
  curTitle = "";
  curShape: string | null = null;
  curAttempt: number | null = null;
  curPass: Pass | null = null;
  attempts = new Map<string, Attempt>();
  caps = new Map<number, Record<string, unknown>>();
  tampered = false;

  runId: string;

  constructor(runId: string) {
    this.runId = runId;
  }

  current(): Attempt | null {
    if (this.curPhase === null || this.curAttempt === null) return null;
    const key = `${this.runId}\u0000${this.curPhase}\u0000${this.curAttempt}`;
    let a = this.attempts.get(key);
    if (!a) {
      a = new Attempt(
        this.runId,
        this.curPhase,
        this.curAttempt,
        this.lastTs,
        this.curTitle,
        this.curShape,
      );
      this.attempts.set(key, a);
    }
    return a;
  }

  attemptAt(phase: number, attempt: number): Attempt | null {
    const key = `${this.runId}\u0000${phase}\u0000${attempt}`;
    let a = this.attempts.get(key);
    if (!a) {
      const current = phase === this.curPhase;
      a = new Attempt(
        this.runId,
        phase,
        attempt,
        this.lastTs,
        current ? this.curTitle : "",
        current ? this.curShape : null,
      );
      this.attempts.set(key, a);
    }
    return a;
  }
}

// ── the summariser ───────────────────────────────────────────────────────────

/** Options of `summarize`. */
export type SummarizeOptions = {
  /** Restricts a phase's entry to the attempts recorded under that phase's shape. */
  readonly phaseShapes?: Readonly<Record<number, string>>;
  /** The figure `countLiveInvocations` measured; informational, never a label input. */
  readonly runLogLiveInvocations?: number;
};

/**
 * The pure summariser (F106-FR-004): the parsed events of past runs in, the
 * summary document `specstride.learn.summary/7` out. Events without a run id
 * must have been attributed (`attributeRunIds`) before they come in here.
 */
export function summarize(
  events: readonly ReadEvent[],
  options: SummarizeOptions = {},
): Record<string, unknown> {
  const attributed = attributeRunIds(events as ReadEvent[]);
  const runs = new Map<string, Run>();
  for (const ev of attributed) {
    const name = ev["event"] as string | undefined;
    const ts = asFloat(ev["ts"]);
    const rid = String(ev["run_id"] ?? "");
    if (!rid) continue;
    let run = runs.get(rid);
    if (!run) {
      run = new Run(rid);
      runs.set(rid, run);
    }
    if (ts !== null) run.lastTs = ts;
    const phase = asInt(ev["phase"]);
    const attempt = asInt(ev["attempt"]);

    switch (name) {
      case "run_start":
        run.started = ts;
        run.feature = ev["feature"] ?? null;
        run.backend = ev["backend"] ?? null;
        run.resumeFrom = asInt(ev["resume"]);
        break;
      case "phase_start":
        run.curPhase = phase;
        run.curTitle = typeof ev["title"] === "string" ? ev["title"] : "";
        run.curAttempt = null;
        run.curPass = null;
        run.curShape = typeof ev["shape"] === "string" && ev["shape"] !== "" ? ev["shape"] : null;
        break;
      case "proposer_start": {
        if (phase !== null) run.curPhase = phase;
        run.curAttempt = attempt;
        run.curPass = null;
        const a = run.current();
        if (a && ts !== null && a.start === null) (a as { start: number | null }).start = ts;
        break;
      }
      case "iter_start": {
        const a = run.current();
        if (!a) break;
        const it = asInt(ev["iter"]) ?? a.passes.size + 1;
        let pass = a.passes.get(it);
        if (!pass) {
          pass = new Pass(it, ts);
          a.passes.set(it, pass);
        }
        run.curPass = pass;
        break;
      }
      case "agent_tool": {
        const p = run.curPass;
        if (p) {
          p.toolCalls += 1;
          if (ev["tool"] === "Bash") {
            const [isWait, secs] = classifyBashTarget(
              typeof ev["target"] === "string" ? ev["target"] : "",
            );
            if (isWait) p.waitCalls += 1;
            p.sleepSec += secs;
          }
        }
        break;
      }
      case "agent_result": {
        const p = run.curPass;
        if (p) {
          p.result = ev;
          p.end = ts;
        }
        break;
      }
      case "yield_resume": {
        const p = run.curPass;
        if (p) {
          const dur = asFloat(ev["waited_sec"]);
          if (dur !== null) p.jobDuration = dur;
        }
        break;
      }
      case "pass_killed": {
        const p = run.curPass;
        if (p) {
          p.killReason = typeof ev["reason"] === "string" ? ev["reason"] : null;
          p.killElapsed = asFloat(ev["elapsed_sec"]);
          p.killDetail = typeof ev["detail"] === "string" ? ev["detail"] : null;
        }
        break;
      }
      case "evidence_written": {
        const a = run.current();
        if (a) {
          a.evidenceWritten += 1;
          const p = run.curPass;
          if (p) p.evidence = true;
          const path = ev["path"];
          if (typeof path === "string") a.groundingPaths.push(path);
        }
        break;
      }
      case "critic_start": {
        const a = run.current();
        if (a) {
          a.criticStart = ts;
          a.diagnosticianCase =
            typeof ev["diagnostician_case"] === "string" ? ev["diagnostician_case"] : null;
        }
        break;
      }
      case "critic_end": {
        const a = run.current();
        if (a && a.criticStart !== null && ts !== null) a.criticSec = round1(ts - a.criticStart);
        break;
      }
      case "verdict": {
        const a =
          attempt !== null && phase !== null ? run.attemptAt(phase, attempt) : run.current();
        if (a) {
          a.verdict = typeof ev["verdict"] === "string" ? ev["verdict"] : null;
          a.verdictReason = typeof ev["reason"] === "string" ? ev["reason"] : null;
          if (ts !== null) a.end = ts;
        }
        break;
      }
      case "verification": {
        const a = run.current();
        if (a) {
          a.verification = typeof ev["path"] === "string" ? ev["path"] : null;
          a.verificationRc = asInt(ev["rc"]);
        }
        break;
      }
      case "proposer_cap": {
        if (phase !== null && !run.caps.has(phase)) run.caps.set(phase, { ...ev });
        break;
      }
      case "events_changed": {
        // the orchestrator saw bytes that predated a pass rewritten during it:
        // this run is excluded from every evaluation (05-evaluate-design.md §4)
        run.tampered = true;
        break;
      }
      case "run_stop":
        run.stopped = ts;
        run.stopReason = ev["reason"] ?? null;
        run.stopPhase = phase;
        break;
      default:
        break;
    }
  }
  return render(runs, options);
}

function render(runs: Map<string, Run>, options: SummarizeOptions): Record<string, unknown> {
  const attemptsOut: AttemptRecord[] = [];
  const runsOut: Record<string, unknown>[] = [];
  const capsByPhase = new Map<number, Record<string, unknown>[]>();
  for (const run of runs.values()) {
    const atts = [...run.attempts.values()].map((a) => a.toRecord());
    attemptsOut.push(...atts);
    const cost = round4(sum(atts.map((a) => a.cost_usd)));
    const approved = [
      ...new Set(atts.filter((a) => a.verdict === "APPROVED").map((a) => a.phase)),
    ].sort((x, y) => x - y);
    const nonApproved = round4(
      sum(atts.filter((a) => a.verdict !== "APPROVED").map((a) => a.cost_usd)),
    );
    const kills: Record<string, number> = {};
    const outcomes: Record<string, number> = {};
    for (const a of atts) {
      for (const [reason, n] of Object.entries(a.kills_by_reason)) {
        kills[reason] = (kills[reason] ?? 0) + n;
      }
      for (const [o, n] of Object.entries(a.outcomes)) {
        outcomes[o] = (outcomes[o] ?? 0) + n;
      }
    }
    const tool = sum(atts.map((a) => a.tool_calls));
    const wait = sum(atts.map((a) => a.wait_calls));
    const end = run.stopped ?? run.lastTs;
    runsOut.push({
      feature: run.feature,
      backend: run.backend,
      started: run.started,
      stopped: run.stopped,
      stop_reason: run.stopReason,
      stop_phase: run.stopPhase,
      resume_from: run.resumeFrom,
      wall_sec: run.started !== null && end !== null ? round1(end - run.started) : null,
      cost_usd: cost,
      passes: sum(atts.map((a) => a.passes)),
      billed_passes: sum(atts.map((a) => a.billed_passes)),
      unbilled_passes: sum(atts.map((a) => a.unbilled_passes)),
      kills_by_reason: kills,
      outcomes,
      attempts: atts.length,
      approved_phases: approved,
      cost_per_approved_phase: approved.length ? round4(cost / approved.length) : null,
      non_approved_cost_usd: nonApproved,
      non_approved_cost_share: cost ? round3(nonApproved / cost) : null,
      tampered: run.tampered,
      run: run.runId,
      tool_calls: tool,
      wait_calls: wait,
      work_calls: tool - wait,
      wait_call_share: tool ? round3(wait / tool) : null,
    });
    for (const [phase, cap] of run.caps) {
      const list = capsByPhase.get(phase) ?? [];
      list.push({ ...cap, run: run.runId });
      capsByPhase.set(phase, list);
    }
  }

  const totals = {
    runs: runsOut.length,
    attempts: attemptsOut.length,
    passes: sum(attemptsOut.map((a) => a.passes)),
    cost_usd: round4(sum(attemptsOut.map((a) => a.cost_usd))),
    unbilled_passes: sum(attemptsOut.map((a) => a.unbilled_passes)),
    kills_by_reason: totalByReason(attemptsOut),
    outcomes: totalOutcomes(attemptsOut),
    approved_phases: [
      ...new Set(attemptsOut.filter((a) => a.verdict === "APPROVED").map((a) => a.phase)),
    ].sort((x, y) => x - y),
    cost_per_approved_phase: (() => {
      const cost = round4(sum(attemptsOut.map((a) => a.cost_usd)));
      const approved = attemptsOut.filter((a) => a.verdict === "APPROVED");
      return approved.length ? round4(cost / approved.length) : null;
    })(),
    non_approved_cost_share: (() => {
      const cost = round4(sum(attemptsOut.map((a) => a.cost_usd)));
      const nonApproved = sum(
        attemptsOut.filter((a) => a.verdict !== "APPROVED").map((a) => a.cost_usd),
      );
      return cost ? round3(nonApproved / cost) : null;
    })(),
    wait_call_share: (() => {
      const tool = sum(attemptsOut.map((a) => a.tool_calls));
      const wait = sum(attemptsOut.map((a) => a.wait_calls));
      return tool ? round3(wait / tool) : null;
    })(),
    sleep_sec_declared: round1(sum(attemptsOut.map((a) => a.sleep_sec_declared))),
    ...(options.runLogLiveInvocations !== undefined
      ? { proposer_live_invocations: options.runLogLiveInvocations }
      : {}),
  };

  const _runsSeen = new Set(runsOut.map((r) => (r as { run: string }).run));
  const phases = phaseRecords(attemptsOut, capsByPhase, options.phaseShapes);

  return {
    schema: LEARN_SUMMARY_SCHEMA,
    runs: runsOut,
    attempts: attemptsOut,
    phases,
    totals,
    inputs: {
      events: 0,
      verification_dir: null,
      verdicts_dir: null,
      run_log_live_invocations: options.runLogLiveInvocations ?? null,
    },
  };
}

/**
 * The per-phase figures (the baseline's `_phases`): keyed by the phase number
 * as text; the futility-killed attempts excluded from the work samples; the
 * attempts of another shape left out and counted; a phase with no attempt
 * under the requested shape omitted.
 */
function phaseRecords(
  attemptsOut: readonly AttemptRecord[],
  capsByPhase: ReadonlyMap<number, Record<string, unknown>[]>,
  phaseShapes?: Readonly<Record<number, string>>,
): Record<string, Record<string, unknown>> {
  const byPhase = new Map<number, AttemptRecord[]>();
  for (const a of attemptsOut) {
    const list = byPhase.get(a.phase) ?? [];
    list.push(a);
    byPhase.set(a.phase, list);
  }
  const out: Record<string, Record<string, unknown>> = {};
  for (const ph of [...byPhase.keys()].sort((x, y) => x - y)) {
    let atts = byPhase.get(ph)!;
    const shape = phaseShapes?.[ph];
    let otherShape = 0;
    if (shape !== undefined) {
      const kept = atts.filter((a) => a.shape === shape);
      otherShape = atts.length - kept.length;
      if (!kept.length) continue; // a phase with no attempt under the shape is omitted
      atts = kept;
    }
    const approvedIdx = atts.findIndex((a) => a.verdict === "APPROVED");
    const runsSeen: string[] = [];
    for (const a of atts) {
      if (!runsSeen.includes(a.run)) runsSeen.push(a.run);
    }
    const firstAttempts = atts.filter((a) => a.attempt === 1);
    // an attempt with any futility kill is no work sample (F106-FR-005)
    const work = atts
      .map((a) => a.work_sec_estimate)
      .filter(
        (v, i): v is number =>
          v !== null &&
          atts[i] !== undefined &&
          !Object.keys(atts[i]!.kills_by_reason).some((k) => KILL_CLASS[k] === "futility"),
      );
    const kills: Record<string, number> = {};
    for (const a of atts) {
      for (const [reason, n] of Object.entries(a.kills_by_reason)) {
        kills[reason] = (kills[reason] ?? 0) + n;
      }
    }
    // per-pass wait/work and yield-job evidence, the same futility exclusion at pass granularity
    const passRows = atts.flatMap((a) => a.passes_detail);
    const nonFutilePasses = passRows.filter((p) => p.kill_class !== "futility");
    const waitShares = nonFutilePasses
      .filter((p) => p.tool_calls > 0)
      .map((p) => p.wait_calls / p.tool_calls);
    const hardCapWithWait = passRows.filter(
      (p) => p.kill_reason !== null && isBudgetKillReason(p.kill_reason) && p.wait_calls > 0,
    ).length;
    const jobDurations = nonFutilePasses
      .map((p) => p.job_duration_sec)
      .filter((v): v is number => v !== null);
    out[String(ph)] = {
      title: atts.find((a) => a.title)?.title ?? "",
      // the shape these figures were restricted to (null: unrestricted), and how
      // many attempts of the phase number were left out for another shape
      shape: shape ?? null,
      other_shape_attempts: otherShape,
      runs_seen: runsSeen,
      attempts_total: atts.length,
      attempts_to_approval: approvedIdx >= 0 ? approvedIdx + 1 : null,
      approved_in_run: approvedIdx >= 0 ? atts[approvedIdx]!.run : null,
      attempt_number_reset: new Set(firstAttempts.map((a) => a.run)).size > 1,
      cost_usd: round4(sum(atts.map((a) => a.cost_usd))),
      work_sec_p50: percentile(work, 0.5),
      work_sec_p90: percentile(work, 0.9),
      // the sample count behind the percentiles — exactly the denominator advise/apply check
      work_sec_samples: work.length,
      kills_by_reason: kills,
      job_duration_p50: percentile(jobDurations, 0.5),
      job_duration_samples: jobDurations.length,
      wait_share_p50: percentile(waitShares, 0.5),
      wait_share_samples: waitShares.length,
      hard_cap_kills_with_wait: hardCapWithWait,
      // the primaries, per phase episode (one run's window on this phase)
      episodes: episodesOf(atts),
      // the sample unit: every billed, non-futility pass, tagged with its run
      pass_samples: atts.flatMap((a) =>
        a.passes_detail
          .filter((p) => isSample(p))
          .map((p) => ({ run: a.run, cost_usd: p.cost_usd, elapsed_sec: p.elapsed_sec })),
      ),
      // what each run actually ran this phase under (proposer_cap, per run)
      caps: (capsByPhase.get(ph) ?? []).filter((c) => runsSeen.includes(c["run"] as string)),
      diagnostician_cases: counter(
        atts.map((a) => a.diagnostician_case).filter((c): c is string => c !== null),
      ),
    };
  }
  return out;
}

/** One entry per run that touched the phase: that run's window on it (the baseline's `_episodes`). */
function episodesOf(atts: readonly AttemptRecord[]): Record<string, unknown>[] {
  const byRun = new Map<string, AttemptRecord[]>();
  for (const a of atts) {
    const list = byRun.get(a.run) ?? [];
    list.push(a);
    byRun.set(a.run, list);
  }
  const out: Record<string, unknown>[] = [];
  for (const [run, group] of byRun) {
    const starts = group.map((a) => a.started).filter((v): v is number => v !== null);
    const ends = group.map((a) => a.ended).filter((v): v is number => v !== null);
    out.push({
      run,
      cost_usd: round4(sum(group.map((a) => a.cost_usd))),
      wall_sec:
        starts.length && ends.length ? round1(Math.max(...ends) - Math.min(...starts)) : null,
      passes: sum(group.map((a) => a.passes_detail.filter((p) => isSample(p)).length)),
      approved: group.some((a) => a.verdict === "APPROVED"),
    });
  }
  return out;
}

function totalByReason(attempts: readonly AttemptRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of attempts) {
    for (const [reason, n] of Object.entries(a.kills_by_reason)) {
      out[reason] = (out[reason] ?? 0) + n;
    }
  }
  return out;
}

function totalOutcomes(attempts: readonly AttemptRecord[]): Record<string, number> {
  const merged = counter(
    attempts.flatMap((a) => Object.entries(a.outcomes).flatMap(([o, n]) => Array(n).fill(o))),
  );
  return Object.fromEntries(
    OUTCOMES.filter((o) => merged[o] !== undefined).map((o) => [o, merged[o]!]),
  );
}

/** Read the events of the given paths and summarize them in one call. */
export function summarizeFromPaths(
  paths: readonly string[],
  options: SummarizeOptions = {},
): Record<string, unknown> {
  return summarize(readEvents(paths), options);
}

// ── small numeric helpers ────────────────────────────────────────────────────

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function counter(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function asFloat(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes"].includes(String(value).toLowerCase());
}
