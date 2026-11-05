/**
 * The plan sources behind the one interface of EP-07: the registry, the
 * verification-commands document, commands declared literally, and discovery
 * of the entry points of a toolchain (`plan.md`, "Project Structure";
 * F105-FR-015 to F105-FR-017).
 *
 * Phase 1 extracted discovery of Lisa's verification package here as source
 * (T006, `research.md` D-1, recorded in `../../EXTRACTED.md`); phase 4 writes
 * the registry, the verification-commands document, the literal source and
 * discovery ON THE DATA FILE beside it (T091 to T093, T105, T148).
 *
 * The extracted module keeps its own names under `lisaDiscovery`, because its
 * `discoverProject` is the table in CODE and `./discovery.ts` is the same
 * table read from `../../data/discovery.json` — two readings of one behaviour,
 * which CT-105-2 compares.
 */
export * as lisaDiscovery from "./lisa-discovery.ts";
export * from "./finding.ts";
export * from "./registry.ts";
export * from "./discovery.ts";
export * from "./commands-document.ts";
export * from "./literal.ts";
export * from "./scopes.ts";
