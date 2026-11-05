/**
 * Shared helpers of the doctor tests (feature 112): run one check against a
 * fixture configuration through the real runner, so the probes receive an
 * injected probe bag and never the real machine (F112-FR-001).
 */
import { runDoctorChecks, makeProbeBag } from "../src/runner/run.ts";
import type { Check, Finding, ProbeBag } from "../src/registry/types.ts";

/** A bag whose resolved configuration holds the given entries. */
export function bagWith(
  entries: readonly [string, unknown][],
  overrides?: Partial<ProbeBag>,
): ProbeBag {
  return makeProbeBag({
    ...overrides,
    config: { values: new Map(entries) },
  });
}

/** Run one check and return its single finding. */
export async function findingOf(
  check: Check,
  entries: readonly [string, unknown][] = [],
  overrides?: Partial<ProbeBag>,
): Promise<Finding> {
  const result = await runDoctorChecks({ checks: [check], bag: bagWith(entries, overrides) });
  if (result.error !== undefined) throw new Error(result.error.message);
  const findings = result.findings.filter((f) => f.id === check.id);
  if (findings.length !== 1) {
    throw new Error(`expected one finding for ${check.id}, got ${String(findings.length)}`);
  }
  return findings[0] as Finding;
}

/** Run one check and return the severity its rule read. */
export async function severityOf(
  check: Check,
  entries: readonly [string, unknown][] = [],
  overrides?: Partial<ProbeBag>,
): Promise<Finding["severity"]> {
  return (await findingOf(check, entries, overrides)).severity;
}
