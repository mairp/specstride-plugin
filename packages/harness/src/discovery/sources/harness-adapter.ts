/**
 * T019 — the source `harness-adapter` (F146-FR-002): tested harness
 * adapters that detect their own harness.
 *
 * A tested adapter ships with the product and knows its own harness by
 * name. Detection asks only what the adapter's `detect` names: the
 * presence of its executable on the search path, or of its variable —
 * through the guarded reader, and nothing else. The state of such a
 * candidate is `tested` (F146-FR-017).
 */
import type { GuardedReader } from "../guarded-reader.ts";
import { makeCandidate, type CandidateSeed } from "../candidate.ts";
import type { Candidate } from "../types.ts";
import type { TestedAdapter } from "../ports.ts";

/** The source this reader reads. */
export const HARNESS_ADAPTER_SOURCE = "harness-adapter" as const;

/** The reader of the source `harness-adapter`. */
export async function readHarnessAdapterSource(deps: {
  readonly reader: GuardedReader;
  readonly adapters: readonly TestedAdapter[];
}): Promise<{ readonly candidates: readonly Candidate[] }> {
  const candidates: Candidate[] = [];
  for (const adapter of deps.adapters) {
    let found = false;
    let credential: Candidate["credential"] = "unprobed";
    if (adapter.detect.executable !== undefined) {
      const presence = deps.reader.executableOnSearchPath(adapter.detect.executable);
      found = presence.outcome === "on-path";
    }
    if (!found && adapter.detect.variables !== undefined) {
      for (const name of adapter.detect.variables) {
        const presence = await deps.reader.isVariableSet(name);
        if (presence.outcome === "present") {
          found = true;
          credential = "yes";
          break;
        }
        if (presence.outcome === "absent") credential = "no";
      }
    }
    if (!found) continue;
    const seed: CandidateSeed = {
      id: adapter.id,
      sources: [HARNESS_ADAPTER_SOURCE],
      state: "tested",
      origin: "adapter",
      kind: adapter.kind,
      credential,
      termsRef: adapter.termsRef ?? null,
    };
    candidates.push(makeCandidate(seed));
  }
  return { candidates };
}
