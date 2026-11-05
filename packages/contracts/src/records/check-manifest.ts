/**
 * T180 — the type and the validator of the check manifest from
 * `schemas/check-manifest.schema.json` (annex D, §D.8; F100-FR-137).
 *
 * Schema id `specstride.manifest/1`, logical name `phase:<N>:manifest`. The
 * engine writes it at launch from the verification plan; the engine, the check
 * runner, the router (decision point `tools`), the fact block and the doctor
 * read it. Content owner 105.
 */
import type { CheckManifest as Generated } from "./generated/check-manifest.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.manifest/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "phase:<N>:manifest" as const;

/** The section of annex D that owns the field list. */
export const ANNEX_SECTION = "annex D, §D.8" as const;

/** The content owner of §D.8. */
export const CONTENT_OWNER = "105" as const;

/** The readers of the manifest (§D.8). */
export const READERS = [
  "Engine",
  "check runner",
  "router (decision point `tools`)",
  "fact block",
  "doctor",
] as const;

/** The check manifest of one phase (annex D, §D.8). */
export type CheckManifest = Generated;

/** One entry of the manifest (§D.8, `entries[]`). */
export type ManifestEntry = CheckManifest["entries"][number];

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of §D.8 is
 * required (F100-FR-048, F100-FR-049).
 */
export function readCheckManifest(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): CheckManifest {
  return readRecord<CheckManifest>(logicalName, value);
}

/** `readCheckManifest` that returns a result instead of throwing. */
export function tryReadCheckManifest(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: CheckManifest } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<CheckManifest>(logicalName, value);
}

/** True when the value validates against `specstride.manifest/1`. */
export function isCheckManifest(value: unknown): value is CheckManifest {
  return validate<CheckManifest>(SCHEMA_ID, value).ok;
}

/* ------------------------------------------------------------------ *
 * F100-FR-137 — one manifest per phase, derived at launch, verified
 * before every check.
 * ------------------------------------------------------------------ */

/** One check manifest per phase (F100-FR-137). */
export const ONE_PER_PHASE = true as const;

/**
 * F100-FR-137 — the manifest is written when the loop strategy is not
 * `classic`, or when one of the switches of rows 6, 7, 31 and 33 of annex X
 * §X.7 is on, and never under the `parity` profile.
 */
export const WRITTEN_WHEN_A_SWITCH_OF_THESE_ROWS_IS_ON = [6, 7, 31, 33] as const;
export const STRATEGY_THAT_WRITES_NO_MANIFEST = "classic" as const;

export function manifestIsWritten(input: {
  readonly strategy: string;
  readonly switchesOn?: readonly number[] | undefined;
  readonly profile?: string | undefined;
}): boolean {
  if (input.profile === "parity") return false;
  if (input.strategy !== STRATEGY_THAT_WRITES_NO_MANIFEST) return true;
  const on = input.switchesOn ?? [];
  return WRITTEN_WHEN_A_SWITCH_OF_THESE_ROWS_IS_ON.some((row) => on.includes(row));
}

/** F100-FR-137 — the one source of the derivation, and nothing else. */
export const DERIVED_AT = "launch" as const;
export const DERIVED_FROM = "the sources the verification gate uses, and nothing else" as const;

/** F100-FR-137 — stored in the control plane with its hash. */
export const STORED_IN = "the control plane" as const;
export const STORED_WITH_ITS_HASH = true as const;

/** F100-FR-137 — the hash is verified before every check. */
export const HASH_VERIFIED_BEFORE_EVERY_CHECK = true as const;

/** F100-FR-137 — the manifest holds deterministic commands only. */
export const DETERMINISTIC_COMMANDS_ONLY = true as const;

/**
 * F100-FR-137 — the router MAY order and exclude among the entries; nothing
 * MAY add an entry after launch.
 */
export const ROUTER_MAY = ["order", "exclude"] as const;
export const AN_ENTRY_MAY_BE_ADDED_AFTER_LAUNCH = false as const;

/**
 * §D.8 — the writer sets `inner` true for every entry: the inner check set is
 * the manifest, and only the runtime takes a command out of it during a phase
 * attempt, with a reason (F105-FR-020; F115-FR-013).
 */
export const INNER_IS_TRUE_FOR_EVERY_ENTRY = true as const;
export const ONLY_THE_RUNTIME_EXCLUDES = true as const;

/** `argv` is required for the kind `command` (§D.8). */
export const KIND_THAT_REQUIRES_ARGV = "command" as const;
export function argvIsRequired(kind: string): boolean {
  return kind === KIND_THAT_REQUIRES_ARGV;
}

/** An entry without declared reads and writes is run serially (§D.8). */
export const UNDECLARED_MEANS_SERIAL = true as const;

/** The rows of §X.7 under which no manifest file exists. */
export const PARITY_ROWS = [1, 6, 7, 31, 33] as const;
