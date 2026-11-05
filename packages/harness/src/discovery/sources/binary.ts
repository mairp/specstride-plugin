/**
 * T019 — the source `binary` (F146-FR-002, F146-FR-003): executables that
 * a harness descriptor names.
 *
 * For each harness descriptor of kind `cli`, the reader asks the guarded
 * reader whether the executable the `detect` field names is on the search
 * path. Discovery MUST execute only what a harness descriptor names: the
 * executable of `detect` with the argument lists for version and help, and
 * NOTHING ELSE. The reader therefore never walks the search path for
 * executables that no descriptor names, and every argument list it runs is
 * copied from the `detect` field of the descriptor — never built from
 * input, never a shell.
 *
 * The version probe runs only where the caller asks for it; the passive
 * pass of this slice reads presence only (the probe ladder is F146-FR-013
 * to F146-FR-015).
 */
import { join } from "node:path";
import type { GuardedReader } from "../guarded-reader.ts";
import { makeCandidate } from "../candidate.ts";
import type { Candidate, CandidateFinding } from "../types.ts";
import { loadProbeLimits, runProbes, type ProbeSpawn } from "../probes/runner.ts";
import type { LoadedDescriptor } from "../../descriptor/loader.ts";
import { descriptorHashOf } from "../../verify/verify.ts";

/** The source this reader reads. */
export const BINARY_SOURCE = "binary" as const;

/** One argument list the reader started, for the trace of a test. */
export type StartedProbe = {
  readonly file: string;
  readonly args: readonly string[];
};

/** Fields of a `detect` entry the reader reads. */
type DetectFields = {
  readonly executable?: unknown;
  readonly version?: unknown;
};

/** The reader of the source `binary`. */
export async function readBinarySource(deps: {
  readonly reader: GuardedReader;
  readonly descriptors: readonly LoadedDescriptor[];
  /** Run the version probe of `detect`, where the descriptor states one. */
  readonly runVersionProbes?: boolean;
  /** Another process primitive, for a test; the bounded runner by default. */
  readonly spawn?: ProbeSpawn;
}): Promise<{
  readonly candidates: readonly Candidate[];
  readonly findings: readonly CandidateFinding[];
  /** Every argument list that was started. A descriptor names each file. */
  readonly started: readonly StartedProbe[];
}> {
  const candidates: Candidate[] = [];
  const findings: CandidateFinding[] = [];
  const started: StartedProbe[] = [];
  const probes: {
    readonly descriptor: LoadedDescriptor;
    readonly resolvedPath: string;
    readonly file: string;
    readonly args: readonly string[];
  }[] = [];
  for (const entry of deps.descriptors) {
    const descriptor = entry.descriptor;
    if (descriptor.kind !== "cli") continue;
    const detect = (descriptor.detect ?? {}) as DetectFields;
    if (typeof detect.executable !== "string") continue;
    // The look-up asks only for the name the descriptor gives. The guarded
    // reader names the first directory that holds the executable and
    // starts nothing.
    const presence = deps.reader.executableOnSearchPath(detect.executable);
    if (presence.outcome !== "on-path" || presence.directory === undefined) continue;
    const resolvedPath = join(presence.directory, detect.executable);
    candidates.push(
      makeCandidate({
        id: String(descriptor.id),
        sources: [BINARY_SOURCE],
        origin: descriptor.origin,
        kind: String(descriptor.kind),
        resolvedPath,
        descriptorHash: descriptorHashOf(descriptor),
        termsRef: termsRefOf(descriptor),
      }),
    );
    // The only argument list that may run: the one `detect.version` names.
    const versionArg = versionArgOf(detect.version);
    if (deps.runVersionProbes === true && versionArg !== null) {
      probes.push({ descriptor: entry, resolvedPath, file: resolvedPath, args: [versionArg] });
    }
  }
  if (probes.length > 0) {
    const results = await runProbes(
      probes.map((probe, at) => ({
        id: `${String(probe.descriptor.descriptor?.id)}:version:${at}`,
        file: probe.file,
        args: probe.args,
      })),
      { limits: loadProbeLimits(), spawn: deps.spawn },
    );
    for (let at = 0; at < probes.length; at += 1) {
      const probe = probes[at]!;
      const result = results[at]!;
      started.push({ file: probe.file, args: [...probe.args] });
      const target = candidates.find(
        (candidate) => candidate.id === String(probe.descriptor.descriptor?.id),
      );
      if (target === undefined) continue;
      if (result.value !== null) {
        const version = result.value.trim().split(/\r?\n/)[0] ?? "";
        (target as unknown as { version: string | null }).version = version === "" ? null : version;
      } else if (result.finding !== null) {
        findings.push(result.finding);
        (target as unknown as { findings: CandidateFinding[] }).findings = [
          ...target.findings,
          result.finding,
        ];
      }
    }
  }
  return { candidates, findings, started };
}

/** The version argument list the `detect` field names, or null. */
function versionArgOf(version: unknown): string | null {
  if (version === null || typeof version !== "object") return null;
  const arg = (version as { arg?: unknown }).arg;
  return typeof arg === "string" ? arg : null;
}

/** `provider.termsRef` of a descriptor, or null where it states none. */
export function termsRefOf(descriptor: { readonly provider?: unknown }): string | null {
  if (descriptor.provider === null || typeof descriptor.provider !== "object") return null;
  const termsRef = (descriptor.provider as { termsRef?: unknown }).termsRef;
  return typeof termsRef === "string" ? termsRef : null;
}
