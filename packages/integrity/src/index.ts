// T041 (F116-FR-001, F116-FR-005) — the public surface of
// `@specstride/integrity`: fingerprints and comparisons offered to a loop
// layer as inputs of annex D §D.1 of feature 100, through the engine. This
// feature is the single owner of the protected set and of the fingerprints;
// every other feature obtains them through these contracts.
export * from "./fingerprint/tree.ts";
export * from "./protected/set.ts";
export * from "./protected/entry.ts";
export * from "./protected/compare.ts";
export * from "./protected/protection.ts";
export * from "./protected/authorise.ts";
export * from "./protected/markers.ts";
export * from "./protected/phase-entry.ts";
export * from "./result/freshness.ts";
export * from "./pins/verify.ts";
export * from "./factblock/index.ts";
export * from "./toolchain/load.ts";
export * from "./toolchain/basic.ts";
export * from "./toolchain/doctor-check.ts";
export * from "./protected/listing.ts";
export * from "./events/noted.ts";
export * from "./result/record.ts";

// Feature 115 (T114) — the tripwire record `user:tripwire` behind the port
// `TripwireStore` of T003, written with the atomic write of the kernel.
export * from "./tripwire/record.ts";

import { treeFingerprint } from "./fingerprint/tree.ts";
import { captureAtLaunch, captureAtPhaseEntry } from "./protected/entry.ts";
import { compareAroundCheck, compareAgainstPhaseEntry } from "./protected/compare.ts";
import { comparePhaseEntry } from "./protected/phase-entry.ts";
import { freshnessOf } from "./result/freshness.ts";
import { contributeCriticInput } from "./factblock/index.ts";
import { noteIntegrityEvent } from "./events/noted.ts";

/**
 * The "Inputs" services of annex D §D.1: a loop layer asks the engine for the
 * fingerprints and the comparisons here, never from its own file reading.
 */
export const inputs = {
  treeFingerprint,
  captureAtLaunch,
  captureAtPhaseEntry,
  compareAroundCheck,
  compareAgainstPhaseEntry,
  comparePhaseEntry,
  freshnessOf,
  contributeCriticInput,
  noteIntegrityEvent,
} as const;
