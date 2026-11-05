/**
 * T011 — the metric definitions the summary uses (F106-FR-005): the wait/poll
 * classifier, the repeat detail of a futility kill, the kill classes and the
 * closed order of the outcomes.
 *
 * Ported unchanged from the baseline (`lib/learn.py` at the pinned commit
 * `9cab15d2`, `WAIT_RE`, `SLEEP_RE`, `REPEAT_DETAIL`, `KILL_CLASS`,
 * `BUDGET_REASONS`, `OUTCOMES`, `classify_bash_target`, `parse_repeat_detail`).
 *
 * Purity: no `node:fs`, no process.
 */

/** The wait/poll classifier of the telemetry report, applied to Bash targets. */
const WAIT_RE =
  /(^|[;&|(]\s*|\s)(sleep\s+\d|tail\s+-[fc]|while\s+(pgrep|true)|until\s+grep|pgrep\s+-|ps\s+aux.*grep|watch\s+-n)/;

/** The declared sleeps inside one Bash target; their sum is `sleep_sec_declared`. */
const SLEEP_RE = /(?:^|[;&|(]\s*|\s)sleep\s+(\d+(?:\.\d+)?)/g;

/** ``pass_killed.detail`` is ``re-ran 12x: tail -4`` / ``repeated 13x: …``. */
const REPEAT_RE = /^(?:re-ran|repeated)\s+(\d+)x:\s*(.*)$/s;

/** The class of each kill reason (closed set 280 of feature 100). */
export const KILL_CLASS: Readonly<Record<string, string>> = Object.freeze({
  hard_cap: "budget",
  repeat_stall: "futility",
  progress_stall: "futility",
  idle_timeout: "hang",
});

/** The outcomes of a pass, in the closed order the summary writes (closed set 195). */
export const OUTCOMES = [
  "productive",
  "clean_no_progress",
  "worker_error",
  "budget_kill",
  "open",
] as const;

/** `(is_wait, declared_sleep_seconds)` for one Bash tool target. */
export function classifyBashTarget(target: string): [boolean, number] {
  if (!target) return [false, 0];
  const isWait = WAIT_RE.test(target);
  let secs = 0;
  for (const m of target.matchAll(SLEEP_RE)) secs += Number.parseFloat(m[1]!);
  return [isWait || secs > 0, secs];
}

/** `(repeat_count, repeated_command)` of a futility kill's detail; `(null, null)` when none. */
export function parseRepeatDetail(detail: string): [number | null, string | null] {
  if (!detail) return [null, null];
  const m = REPEAT_RE.exec(detail.trim());
  if (!m) return [null, null];
  return [Number.parseInt(m[1]!, 10), m[2]!.trim()];
}
