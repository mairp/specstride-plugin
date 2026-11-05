/**
 * T024 of feature 118 — the tool-level repetition check (F118-FR-005;
 * C-058; B-0700, B-0701, B-0702, B-0703).
 *
 * The check counts identical pairs of tool name and target among the tool
 * records of this pass and ends the pass with the kill reason `repeat_stall`
 * only when the pair that reached the limit is also the most recent call.
 * The signature of a target is the tool name plus the length, the first 96
 * and the last 96 characters of the target of the newest tool record; with
 * no tool record yet the key is the command line alone. An empty target
 * never ends a pass. A call of `Edit`, `Write`, `MultiEdit` or
 * `NotebookEdit` is never the offender, but stays in the sequence, so that
 * moving on to editing counts as moving on.
 */

/** The head of a target that enters its signature. */
export const TOOL_TARGET_HEAD_CHARS = 96;

/** The tail of a target that enters its signature. */
export const TOOL_TARGET_TAIL_CHARS = 96;

/** The tools that are never the offender of this check (but stay in the sequence). */
export const NEVER_OFFENDER_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"] as const;

/** True when a call of `toolName` can never be the offender. */
export function isNeverOffender(toolName: string): boolean {
  return (NEVER_OFFENDER_TOOLS as readonly string[]).includes(toolName);
}

/** The signature of the target of a tool record (F118-FR-005). */
export function toolTargetSignature(target: string): string {
  const head = target.slice(0, TOOL_TARGET_HEAD_CHARS);
  const tail = target.length > TOOL_TARGET_HEAD_CHARS ? target.slice(-TOOL_TARGET_TAIL_CHARS) : "";
  return `${target.length}:${head}:${tail}`;
}

/** One tool record of this pass (from the normalized stream, feature 126). */
export interface ToolCall {
  readonly toolName: string;
  readonly target: string;
}

/** One counted key of the tool-level check. */
export interface ToolRepeatCount {
  readonly toolName: string;
  readonly signature: string;
  readonly count: number;
}

/** What the tool-level repetition check decided. */
export interface ToolRepeatKill {
  readonly reason: "repeat_stall";
  readonly check: "tool";
  readonly offender: ToolRepeatCount;
}

/** The inputs of one tool-level repetition check. */
export interface ToolRepeatCheck {
  /** The tool records of THIS pass, in order (only what arrived after it started). */
  readonly calls: readonly ToolCall[];
  /** The command line used while there is no tool record yet. */
  readonly fallbackCommandLine: string;
  /** The repeat limit in force; 0 disables both repetition checks. */
  readonly repeatLimit: number;
}

/**
 * The key of one call: the tool name plus the target signature, or, with no
 * tool record yet, the command line alone.
 */
export function toolRepeatKey(call: ToolCall | undefined, fallbackCommandLine: string): string {
  if (call === undefined) return JSON.stringify(["<no-tool-record>", fallbackCommandLine]);
  return JSON.stringify([call.toolName, toolTargetSignature(call.target)]);
}

/**
 * The tool-level check over the whole sequence of this pass. Returns the
 * kill when the pair that reached the limit is also the most recent call;
 * an empty target never kills; a never-offender tool never kills.
 */
export function toolRepetitionCheck(check: ToolRepeatCheck): ToolRepeatKill | undefined {
  if (check.repeatLimit === 0) return undefined;
  const counts = new Map<string, ToolRepeatCount>();
  let last: ToolCall | undefined;
  for (let index = 0; index < check.calls.length; index += 1) {
    const call = check.calls[index];
    if (call.target === "") continue; // an empty target is never counted
    const key = toolRepeatKey(call, check.fallbackCommandLine);
    const previous = counts.get(key);
    counts.set(key, {
      toolName: call.toolName,
      signature: toolTargetSignature(call.target),
      count: (previous?.count ?? 0) + 1,
    });
    last = index === check.calls.length - 1 ? call : last;
  }
  if (last === undefined) return undefined;
  if (last.target === "") return undefined;
  if (isNeverOffender(last.toolName)) return undefined;
  const key = toolRepeatKey(last, check.fallbackCommandLine);
  const offender = counts.get(key);
  if (offender === undefined || offender.count < check.repeatLimit) return undefined;
  return { reason: "repeat_stall", check: "tool", offender };
}
