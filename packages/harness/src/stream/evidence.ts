/**
 * T013 — the `evidence_writing` detection of the seam (F126-FR-005).
 *
 * The tap emits `evidence_writing` at most once per pass, and only when an
 * expected evidence path was given. Only a call of the tools `Write`, `Edit`,
 * `MultiEdit`, `NotebookEdit` or `Bash` may trigger it, and only when a path
 * extracted from the call as text, or the display target, resolves to exactly
 * the expected evidence path — given as an absolute path with the user's home
 * expanded and links resolved. Nothing from the stream is executed: a
 * candidate path is only tested for existence and read through `realpath`.
 */
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/** The tools that may trigger the event (F126-FR-005). */
export const EVIDENCE_TOOLS: readonly string[] = Object.freeze([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
]);

/** The record the event carries (F126-FR-005). */
export type EvidenceWritingEvent = {
  readonly tool: string;
  readonly target: string;
  readonly match: "exact-expected-target";
  readonly toolId: string | null;
};

/** Expand a leading `~` and make absolute; no link resolution here yet. */
export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return resolve(homedir(), path.slice(2));
  }
  return resolve(path);
}

/** The expected path as the requirement holds it: absolute, links resolved. */
export function resolveEvidencePath(path: string): string {
  const expanded = expandHome(path);
  try {
    return realpathSync(expanded);
  } catch {
    // A path that does not exist yet (the evidence file is written later):
    // resolve the links of the deepest existing ancestor.
    const parent = resolve(expanded, "..");
    if (parent === expanded || !existsSync(parent)) return expanded;
    try {
      return realpathSync(parent) + expanded.slice(parent.length);
    } catch {
      return expanded;
    }
  }
}

/** Path-like candidates inside one text value: absolute paths only. */
export function pathCandidatesIn(text: string): readonly string[] {
  const matches = text.match(/(?:\/[\w.@+-]+)+/g) ?? [];
  return matches.filter((candidate) => candidate.length > 1);
}

/** Every path a tool call states: the display target, then the text of the call. */
export function candidatesOfCall(
  target: string,
  input: Readonly<Record<string, unknown>>,
): readonly string[] {
  const out: string[] = [];
  if (target.length > 0) out.push(target);
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.length > 0) out.push(...pathCandidatesIn(value));
    else if (value !== null && typeof value === "object") {
      for (const nested of Object.values(value as Record<string, unknown>)) {
        if (typeof nested === "string" && nested.length > 0) out.push(...pathCandidatesIn(nested));
      }
    }
  }
  return out;
}

/**
 * Whether one call writes the expected evidence path, exactly. Nothing is
 * executed; a candidate is only resolved against the filesystem.
 */
export class EvidenceWatcher {
  private fired = false;
  private readonly expectedPath: string | null;
  private readonly resolvedExpected: string | null;

  constructor(expectedPath: string | null) {
    this.expectedPath = expectedPath;
    this.resolvedExpected = expectedPath === null ? null : resolveEvidencePath(expectedPath);
  }

  /** True while the event may still be emitted this pass. */
  get canEmit(): boolean {
    return this.expectedPath !== null && !this.fired;
  }

  /**
   * Test one tool record; the event, or null. Idempotent per pass: the first
   * exact match fires, and nothing fires again (F126-FR-005).
   */
  observe(tool: {
    name: string;
    target: string;
    toolId: string | null;
    input: Readonly<Record<string, unknown>>;
  }): EvidenceWritingEvent | null {
    if (!this.canEmit) return null;
    if (!EVIDENCE_TOOLS.includes(tool.name)) return null;
    for (const candidate of candidatesOfCall(tool.target, tool.input)) {
      if (resolveEvidencePath(candidate) === this.resolvedExpected) {
        this.fired = true;
        return {
          tool: tool.name,
          target: this.resolvedExpected ?? this.expectedPath ?? "",
          match: "exact-expected-target",
          toolId: tool.toolId,
        };
      }
    }
    return null;
  }
}
