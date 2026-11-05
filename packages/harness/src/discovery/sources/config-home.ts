/**
 * T019 — the source `config-home` (F146-FR-002, F146-FR-004): known
 * configuration homes.
 *
 * For each harness descriptor that names a configuration home, the reader
 * asks the guarded reader whether that DIRECTORY exists. It opens no file
 * inside it (the guarded reader has no operation that could), and a
 * positive answer is never enough alone: it only supports a candidate
 * another source found, and never creates one.
 */
import type { GuardedReader } from "../guarded-reader.ts";
import type { LoadedDescriptor } from "../../descriptor/loader.ts";

/** The source this reader reads. */
export const CONFIG_HOME_SOURCE = "config-home" as const;

/** One answered question of existence. */
export type ConfigHomeSupport = {
  readonly id: string;
  readonly path: string;
  readonly outcome: "exists" | "absent" | "refused";
  /** The deny-list entry, where the question was refused. */
  readonly refusedBy?: string;
};

/** The reader of the source `config-home`. */
export function readConfigHomeSource(deps: {
  readonly reader: GuardedReader;
  readonly descriptors: readonly LoadedDescriptor[];
}): { readonly supports: readonly ConfigHomeSupport[] } {
  const supports: ConfigHomeSupport[] = [];
  for (const entry of deps.descriptors) {
    const descriptor = entry.descriptor;
    const id = descriptor.id;
    if (typeof id !== "string") continue;
    const configHome = (descriptor.detect as { configHome?: unknown } | undefined)?.configHome;
    if (typeof configHome !== "string") continue;
    const existence = deps.reader.directoryExists(configHome);
    supports.push({
      id,
      path: configHome,
      outcome: existence.outcome,
      refusedBy: existence.refusedBy,
    });
  }
  return { supports };
}

/**
 * True where the source `config-home` supports a candidate: the directory
 * the descriptor named exists. Supporting never creates a candidate and
 * never ranks one; it only joins the list of sources that found the id.
 */
export function supportsCandidate(support: ConfigHomeSupport): boolean {
  return support.outcome === "exists";
}
