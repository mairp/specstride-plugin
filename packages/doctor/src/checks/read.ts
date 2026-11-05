/**
 * Shared reading helpers of the core checks (feature 112): every probe reads
 * only its injected probe bag — never the real machine (F112-FR-001). Fixture
 * values arrive through the bag's resolved configuration (`config.values`) and
 * the run records (`runs`); a check that would touch a subprocess, the network
 * or file metadata goes through the bag's members, so `--quick` and the tests
 * can replace them.
 */
import type { ProbeBag } from "../registry/types.ts";

/** Read one value of the resolved configuration, with a fallback. */
export function cfg<T>(bag: ProbeBag, key: string, fallback: T): T {
  const value = bag.config.values.get(key);
  return (value === undefined ? fallback : value) as T;
}

/** The records of the runs the doctor may read (annex B §B.5). */
export function runsOf(bag: ProbeBag): readonly Record<string, unknown>[] {
  return bag.runs as readonly Record<string, unknown>[];
}

/** Run the whole probe of a check and return `{ ... }` — never undefined. */
export function observed(state: Record<string, unknown>): Record<string, unknown> {
  return state;
}

/**
 * Every statement about macOS the core checks print carries this marker
 * (F112-FR-011: "Every statement about macOS MUST be marked unverified").
 */
export const MACOS_UNVERIFIED = "macOS unverified" as const;
