/**
 * T021 — the precedence of the sources for one harness id (F146-FR-011).
 *
 * Where two sources describe the same harness id, the order is: the entry
 * the consumer declared, then the tested harness adapter, then the bundled
 * harness descriptor, then the value that the probe ladder detected. The
 * merged candidate records, for every value, the source it came from: the
 * values of the winner are kept, and the sources of every candidate that
 * described the id are recorded on the merged candidate, in the order of
 * the precedence.
 */
import type { Candidate, SourceOfDiscovery } from "./types.ts";

/** The requirement this module carries. */
export const PRECEDENCE_REQUIREMENT = "F146-FR-011" as const;

/**
 * The rank of a source in the precedence: 0 the entry the consumer
 * declared, 1 the tested harness adapter, 2 a source that read a bundled
 * harness descriptor, 3 the value the probe ladder detected.
 */
export function rankOfSource(source: SourceOfDiscovery): 0 | 1 | 2 | 3 {
  switch (source) {
    case "declared":
      return 0;
    case "harness-adapter":
      return 1;
    case "binary":
    case "config-home":
    case "endpoint":
    case "gateway":
      return 2;
    case "host":
      return 3;
    default: {
      // The closed set has no eighth member; the reader of an unknown
      // value refuses (F146-FR-002), so this cannot be reached with a
      // member of row 178.
      const never: never = source;
      return never;
    }
  }
}

/** The rank of a candidate: the best (lowest) rank of its sources. */
export function rankOfCandidate(candidate: Candidate): 0 | 1 | 2 | 3 {
  return candidate.sources.reduce(
    (best, source) => Math.min(best, rankOfSource(source)) as 0 | 1 | 2 | 3,
    3 as 0 | 1 | 2 | 3,
  );
}

/** A candidate that lost the precedence for its id, with the reason. */
export type PrecedenceLoser = {
  readonly id: string;
  readonly sources: readonly SourceOfDiscovery[];
  /** The sources of the winner, which outranked this candidate. */
  readonly outrankedBy: readonly SourceOfDiscovery[];
};

/**
 * Merge the candidates by id. For each id the winner is the candidate of
 * the lowest rank; the merged candidate carries the values of the winner,
 * and its `sources` are the union of the sources of every candidate of
 * that id, in the order of the precedence.
 */
export function applyPrecedence(candidates: readonly Candidate[]): {
  readonly candidates: readonly Candidate[];
  readonly losers: readonly PrecedenceLoser[];
} {
  const byId = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const held = byId.get(candidate.id);
    if (held === undefined) byId.set(candidate.id, [candidate]);
    else held.push(candidate);
  }
  const merged: Candidate[] = [];
  const losers: PrecedenceLoser[] = [];
  for (const [id, group] of byId) {
    const ordered = [...group].sort((a, b) => rankOfCandidate(a) - rankOfCandidate(b));
    const winner = ordered[0]!;
    const losing = ordered.slice(1);
    const sources = [
      ...new Map(
        ordered.flatMap((candidate) => candidate.sources).map((source) => [source, source]),
      ).values(),
    ].sort((a, b) => rankOfSource(a) - rankOfSource(b));
    const findings = ordered.flatMap((candidate) => [...candidate.findings]);
    merged.push({
      ...winner,
      sources,
      findings,
    });
    for (const candidate of losing) {
      losers.push({
        id,
        sources: [...candidate.sources],
        outrankedBy: [...winner.sources],
      });
    }
  }
  return { candidates: merged, losers };
}
