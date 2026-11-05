/**
 * T019 — the source `host` (F146-FR-002, F146-FR-005): agents and tool
 * servers that a host registers.
 *
 * The reader reads NAMES AND TYPES ONLY, and never values of the
 * environment, of headers or of arguments: the port it calls answers
 * entries of the shape `{ name, type }`, and the reader keeps exactly
 * those two fields — any other field a port put on an entry is dropped
 * here, so no value can travel into a candidate.
 *
 * Such an entry is INFORMATIONAL: it appears in the list as information
 * for the doctor and is never a candidate for a role.
 */
import { makeCandidate } from "../candidate.ts";
import type { Candidate } from "../types.ts";
import type { HostEntryReader } from "../ports.ts";

/** The source this reader reads. */
export const HOST_SOURCE = "host" as const;

/** The reader of the source `host`. */
export async function readHostSource(deps: {
  readonly hostEntries: HostEntryReader;
}): Promise<{ readonly candidates: readonly Candidate[] }> {
  const entries = await deps.hostEntries();
  const candidates: Candidate[] = [];
  for (const entry of entries) {
    // Names and types only: exactly the two fields the rule allows are
    // copied; everything else the entry carried is dropped (F146-FR-005).
    const name = typeof entry.name === "string" ? entry.name : null;
    const type = typeof entry.type === "string" ? entry.type : null;
    if (name === null || type === null) continue;
    candidates.push(
      makeCandidate({
        id: `host:${name}`,
        sources: [HOST_SOURCE],
        state: "detected",
        origin: "detected",
        kind: type,
        informational: true,
      }),
    );
  }
  return { candidates };
}
