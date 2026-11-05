/**
 * T023 — the steps of the probe ladder (F146-FR-013, F146-FR-015).
 *
 * The ladder has five steps, members of the closed set row 179 of annex
 * X §X.6: `presence`, `version-help`, `credential-presence`, `metadata`
 * and `catalogue`. This module carries the step `version-help`: it runs
 * the version probe and the help probe that the `detect` field of the
 * harness descriptor names, through the bounded runner (F146-FR-014),
 * and it checks the flags the argument lists of the descriptor use
 * against the help text (F146-FR-015).
 *
 * Nothing is guessed: a value the ladder did not read stays null, and a
 * verdict format, a tool-less form, a real quota signal or a real stream
 * form — what no free step can show — is never invented here. Every value
 * the ladder does read carries the step that produced it as its
 * provenance.
 */
import { runProbes, loadProbeLimits, type ProbeLimits, type ProbeSpawn } from "./runner.ts";
import type { CandidateFinding, CapabilityValue, ProbeLadderStep } from "../types.ts";

/** The requirements this module carries. */
export const PROBE_LADDER_REQUIREMENT = "F146-FR-013" as const;
export const FLAG_CHECK_REQUIREMENT = "F146-FR-015" as const;

/** The five steps, in the order of the closed set row 179. */
export const PROBE_LADDER_STEPS: readonly ProbeLadderStep[] = Object.freeze([
  "presence",
  "version-help",
  "credential-presence",
  "metadata",
  "catalogue",
]);

/** What the step `version-help` read. */
export type VersionHelpOutcome = {
  /** The version the probe printed, one trimmed line, or null. */
  readonly version: string | null;
  /** The help text the probe printed, or null. */
  readonly helpText: string | null;
  /** One finding per probe that failed (F146-FR-014). */
  readonly findings: readonly CandidateFinding[];
  /** The steps that produced a value, in the order they produced one. */
  readonly steps: readonly ProbeLadderStep[];
};

/**
 * Run the two probes of the step `version-help`. The argument lists come
 * from the caller, who copies them from the `detect` field of the harness
 * descriptor; the runner bounds both probes and never fails the run.
 */
export async function probeVersionAndHelp(deps: {
  readonly file: string;
  readonly versionArgs?: readonly string[];
  readonly helpArgs?: readonly string[];
  readonly spawn?: ProbeSpawn;
  readonly limits?: ProbeLimits;
}): Promise<VersionHelpOutcome> {
  const limits = deps.limits ?? loadProbeLimits();
  const results = await runProbes(
    [
      {
        id: "version-help:version",
        file: deps.file,
        args: [...(deps.versionArgs ?? ["--version"])],
      },
      {
        id: "version-help:help",
        file: deps.file,
        args: [...(deps.helpArgs ?? ["--help"])],
      },
    ],
    { limits, spawn: deps.spawn },
  );
  const findings: CandidateFinding[] = [];
  const steps: ProbeLadderStep[] = [];
  let version: string | null = null;
  let helpText: string | null = null;
  for (const result of results) {
    if (result.finding !== null) {
      findings.push(result.finding);
      continue;
    }
    steps.push("version-help");
    if (result.id === "version-help:version") {
      version = firstLineOf(result.value ?? "");
    } else {
      helpText = result.value ?? "";
    }
  }
  return { version, helpText, findings, steps };
}

/** The first non-empty trimmed line of the output, or null. */
function firstLineOf(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed;
  }
  return null;
}

/**
 * One flag the argument lists of a role use: a word that starts with `-`.
 * A `{placeholder}` is not a flag; it is replaced at invoke time.
 */
export function flagsOfArgs(args: readonly unknown[]): readonly string[] {
  const flags: string[] = [];
  for (const arg of args) {
    if (typeof arg === "string" && arg.startsWith("-")) flags.push(arg);
  }
  return flags;
}

/**
 * Every flag the argument lists of the descriptor use, per role
 * (F146-FR-015). Roles without an `invoke` entry hold no flag.
 */
export function flagsOfDescriptor(descriptor: {
  readonly invoke?: unknown;
}): Readonly<Record<string, readonly string[]>> {
  const invoke = descriptor.invoke;
  const result: Record<string, readonly string[]> = {};
  if (typeof invoke !== "object" || invoke === null) return result;
  for (const [role, entry] of Object.entries(invoke as Record<string, unknown>)) {
    const args =
      typeof entry === "object" &&
      entry !== null &&
      Array.isArray((entry as { args?: unknown }).args)
        ? ((entry as { args: readonly unknown[] }).args as readonly unknown[])
        : [];
    result[role] = flagsOfArgs(args);
  }
  return result;
}

/**
 * Which flags the help text names (F146-FR-015). A flag is found where
 * the help text holds it as a word of its own; `--model` is not found in
 * `--model-file`. A null help text (the help probe failed) finds nothing,
 * so that every role falls back to not supported with its reason — never
 * to a guess.
 */
export function checkFlagsAgainstHelp(
  helpText: string | null,
  flags: readonly string[],
): { readonly found: readonly string[]; readonly missing: readonly string[] } {
  if (helpText === null) return { found: [], missing: [...flags] };
  const words = new Set(helpText.split(/\s+/));
  const found: string[] = [];
  const missing: string[] = [];
  for (const flag of flags) {
    if (words.has(flag)) found.push(flag);
    else missing.push(flag);
  }
  return { found, missing };
}

/** How one role of a `cli` harness stands after the flag check. */
export type RoleSupport = {
  readonly role: string;
  /** True only where every flag of the role appears in the help text. */
  readonly supported: boolean;
  /** The flags the help text does not name, in descriptor order. */
  readonly missingFlags: readonly string[];
  /** The reason, naming the first missing flag, where one is missing. */
  readonly reason: string | null;
};

/**
 * Check every role of a `cli` harness descriptor against the help text
 * (F146-FR-015). A role whose flags are not all found is recorded as NOT
 * supported, with the missing flag as the reason. No role is ever marked
 * supported on a guess: without a help text none is supported.
 */
export function roleSupportOf(
  descriptor: { readonly invoke?: unknown },
  helpText: string | null,
): readonly RoleSupport[] {
  const flagsByRole = flagsOfDescriptor(descriptor);
  return Object.entries(flagsByRole).map(([role, flags]) => {
    const { missing } = checkFlagsAgainstHelp(helpText, flags);
    const supported = missing.length === 0;
    return {
      role,
      supported,
      missingFlags: missing,
      reason: supported ? null : `missing flag ${missing[0]!} in the help text`,
    };
  });
}

/**
 * One value the ladder read, with its provenance: the source that found
 * it and the step that produced it (F146-FR-013). The ladder calls this
 * only where a step actually read the value; there is no call that
 * invents one.
 */
export function capabilityOf(
  value: string,
  source: CapabilityValue["source"],
  ladderStep: ProbeLadderStep,
): CapabilityValue {
  return { value, source, ladderStep };
}
