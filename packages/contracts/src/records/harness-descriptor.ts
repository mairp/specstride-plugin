/**
 * T160 — the type and the validator of the harness descriptor, version 1,
 * from `schemas/harness-descriptor.schema.json` (annex C, §C.2; F100-FR-084,
 * F100-FR-085, F100-FR-086).
 *
 * Schema id `specstride.harness/1:descriptor`, logical names
 * `user:harness:<id>` and `package:harness:<id>`. The descriptor carries no
 * field `schema`: its version is the whole number `descriptorVersion`, so it is
 * validated by schema id and not through a logical name, and a version outside
 * the accepted range is refused with a doctor finding (F100-FR-084).
 *
 * The schema is closed: an unknown top-level key refuses the descriptor and a
 * key under `x-` is ignored (`additionalProperties: false` with the pattern
 * `^x-`).
 */
import harnessTables from "../../data/harness-tables.json" with { type: "json" };
import type { HarnessDescriptor as Generated } from "./generated/harness-descriptor.ts";
import { validate, type SchemaError } from "./compile.ts";
import { schemaMap } from "./schema-map.ts";
import {
  CONTAINMENT_LEVELS,
  isContainmentCeiling,
  type ContainmentLevel,
} from "../enums/containment.ts";

/** The schema id the descriptor is validated against (F100-FR-048). */
export const SCHEMA_ID = "specstride.harness/1:descriptor" as const;

/** The section of annex C that owns the field list. */
export const ANNEX_SECTION = "annex C, §C.2" as const;

/** The logical names a descriptor is read from (annex B, §B.5). */
export const LOGICAL_NAMES = ["user:harness:<id>", "package:harness:<id>"] as const;

/** F100-FR-084 — the version of the descriptor schema this package accepts. */
export const DESCRIPTOR_VERSION = 1 as const;
export const ACCEPTED_DESCRIPTOR_VERSIONS: readonly number[] = Object.freeze([DESCRIPTOR_VERSION]);

export type HarnessDescriptor = Generated;

/* ------------------------------------------------------------------ *
 * The rules of §C.2 as data.
 * ------------------------------------------------------------------ */

/**
 * F100-FR-084 — the placeholders of an argument list are a closed set (row 32
 * of annex X §X.6; the key `placeholders` of `data/harness-tables.json`).
 */
export const PLACEHOLDERS: readonly string[] = Object.freeze([
  ...(harnessTables as { placeholders: string[] }).placeholders,
]);

/** F100-FR-085 — the four states a harness is in. */
export const HARNESS_STATES = ["tested", "locally-verified", "declared", "detected"] as const;
export type HarnessState = (typeof HARNESS_STATES)[number];

/** F100-FR-085 — the one state that is verified; every other is unverified. */
export const VERIFIED_STATE: HarnessState = "tested";

/** F100-FR-085 — what holds of a harness that is not `tested`. */
export const UNVERIFIED_FACTS = Object.freeze({
  hasNoVersionPin: true as const,
  capabilitiesAreDeclaredOrProbed: true as const,
  authTiers: Object.freeze([1, 2]),
  doctorShowsItAsUnverified: true as const,
});

/** F100-FR-085 — a harness that is not `tested` is unverified. */
export function isUnverified(state: string): boolean {
  return state !== VERIFIED_STATE;
}

/**
 * F100-FR-085 — a descriptor is accepted from these four sources only. The
 * values are the `origin` the loader sets (the enum of the schema).
 */
export const ACCEPTED_SOURCES = ["adapter", "bundled", "user", "detected"] as const;
export type DescriptorOrigin = (typeof ACCEPTED_SOURCES)[number];

/** The words of §C.2 for the four sources a descriptor may come from. */
export const ACCEPTED_SOURCE_LABELS = Object.freeze({
  adapter: "the harness adapter of the product",
  bundled: "the product's bundled data",
  user: "user configuration, the environment and flags",
  detected: "detection, free of charge",
});

/** True for an origin the loader may set. */
export function isAcceptedSource(origin: unknown): origin is DescriptorOrigin {
  return typeof origin === "string" && (ACCEPTED_SOURCES as readonly string[]).includes(origin);
}

/** F100-FR-084 — the auth tiers a descriptor may offer; 3 is never valid. */
export const AUTH_TIERS = [1, 2] as const;
export const AUTH_TIER_NEVER_VALID = 3 as const;

/** True for a list of auth tiers §C.2 admits. */
export function authTiersAreValid(tiers: unknown): boolean {
  return (
    Array.isArray(tiers) &&
    tiers.length > 0 &&
    tiers.every((t) => (AUTH_TIERS as readonly number[]).includes(t as number))
  );
}

/** The auth schemes of §C.2, for an endpoint kind. */
export const AUTH_SCHEMES = ["bearer", "x-api-key", "none"] as const;

/** The kinds of §C.2 that are endpoint kinds: `endpoint` and `auth.scheme` apply. */
export const ENDPOINT_KINDS = ["openai-chat", "anthropic-messages"] as const;
export const CLI_KIND = "cli" as const;

/** The cost classes of §C.2. */
export const COST_CLASSES = ["subscription", "metered", "local", "unknown"] as const;

/** The containment levels a ceiling may name (§C.15). */
export { CONTAINMENT_LEVELS };
export type { ContainmentLevel };

/* ------------------------------------------------------------------ *
 * F100-FR-084 — data only: an argument list is a list, never shell text.
 * ------------------------------------------------------------------ */

/** True when the value is an argument list as data: a list of text. */
export function isArgumentList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((a) => typeof a === "string");
}

/** The placeholders an argument list uses that the closed set does not hold. */
export function unknownPlaceholdersOf(argumentList: readonly string[]): readonly string[] {
  const out = new Set<string>();
  for (const argument of argumentList) {
    for (const match of argument.matchAll(/\{[^}]*\}/g)) {
      const found = match[0];
      const known =
        PLACEHOLDERS.includes(found) ||
        (/^\{file:.+\}$/.test(found) && PLACEHOLDERS.includes("{file:<name>}"));
      if (!known) out.add(found);
    }
  }
  return Object.freeze([...out]);
}

/* ------------------------------------------------------------------ *
 * F100-FR-086 — where a secret may go, and which endpoint is refused.
 * ------------------------------------------------------------------ */

/** F100-FR-086 — a secret goes only to the host it was declared for. */
export function secretMayBeSentTo(declaredHost: string, host: string): boolean {
  return declaredHost !== "" && declaredHost.toLowerCase() === host.toLowerCase();
}

/** The loopback hosts: the one exception to the refusal of a plain endpoint. */
export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"] as const;

/** True for the loopback address (F100-FR-086). */
export function isLoopback(host: string): boolean {
  return (LOOPBACK_HOSTS as readonly string[]).includes(host.toLowerCase());
}

/**
 * F100-FR-086 — a plain, unencrypted endpoint is refused unless it is the
 * loopback address. The refusal names the address.
 */
export function endpointIsRefused(base: string): { refused: boolean; reason?: string } {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return { refused: true, reason: `the base address "${base}" is not an address` };
  }
  if (url.protocol === "https:") return { refused: false };
  if (url.protocol === "http:" && isLoopback(url.hostname)) return { refused: false };
  return {
    refused: true,
    reason:
      `the base address "${base}" is plain and unencrypted and is not the loopback ` +
      `address (F100-FR-086)`,
  };
}

/** F100-FR-086 — redirects are refused. */
export const REDIRECTS_ARE_REFUSED = true as const;

/**
 * F100-FR-086 — a free read-only request to a model list may carry the
 * credential; the value is never stored and never logged.
 */
export const MODEL_LIST_REQUEST_MAY_CARRY_THE_CREDENTIAL = true as const;
export const CREDENTIAL_IS_NEVER_STORED_OR_LOGGED = true as const;

/* ------------------------------------------------------------------ *
 * The validator.
 * ------------------------------------------------------------------ */

/**
 * The fields of §C.2 whose cell "Required" reads `Yes`. The generated schema
 * requires the ten top-level ones; the five whose required cell sits on a
 * nested field (`provider.id`, `auth.tiers`, `stream.format`,
 * `isolation.envAllow`, `containment.ceiling`) are required by the annex, so
 * the validator requires their parent too.
 */
export const REQUIRED_BY_THE_ANNEX = [
  "descriptorVersion",
  "id",
  "kind",
  "provider",
  "detect",
  "auth",
  "models",
  "roles",
  "stream",
  "continuation",
  "failures",
  "cost",
  "isolation",
  "containment",
  "memory",
] as const;

/** Why a descriptor was refused. */
export type DescriptorRefusal =
  "not-a-record" | "descriptor-version" | "unknown-top-level-key" | "missing-field" | "invalid";

/** One finding of the doctor, as annex G §G.7 shapes it. */
export type DoctorFinding = {
  readonly id: string;
  readonly severity: "fail";
  readonly lb: boolean;
  readonly message: string;
  readonly fix: string;
  readonly evidence: string;
};

/** A descriptor that §C.2 refuses. */
export class DescriptorRefusedError extends Error {
  readonly reason: DescriptorRefusal;
  readonly errors: readonly SchemaError[];
  /** F100-FR-084 — a version outside the accepted range carries a doctor finding. */
  readonly doctorFinding: DoctorFinding | undefined;

  constructor(init: {
    reason: DescriptorRefusal;
    message: string;
    errors?: readonly SchemaError[];
    doctorFinding?: DoctorFinding;
  }) {
    super(init.message);
    this.name = "DescriptorRefusedError";
    this.reason = init.reason;
    this.errors = Object.freeze([...(init.errors ?? [])]);
    this.doctorFinding = init.doctorFinding;
  }
}

/** The doctor finding of a descriptor whose version is outside the range. */
export function descriptorVersionFinding(found: unknown): DoctorFinding {
  return Object.freeze({
    id: "harness.descriptor.version" as const,
    severity: "fail" as const,
    lb: true as const,
    message:
      `the descriptor of a harness names \`descriptorVersion\` ${JSON.stringify(found)}; ` +
      `this product accepts ${ACCEPTED_DESCRIPTOR_VERSIONS.join(" or ")} (F100-FR-084)`,
    fix: `write a descriptor of version ${DESCRIPTOR_VERSION}, or upgrade the product`,
    evidence: `descriptorVersion=${JSON.stringify(found)}`,
  });
}

/** True when the version is one the product accepts (F100-FR-084). */
export function descriptorVersionIsAccepted(version: unknown): boolean {
  return typeof version === "number" && ACCEPTED_DESCRIPTOR_VERSIONS.includes(version);
}

/** The top-level keys the schema of §C.2 holds. */
export const KNOWN_TOP_LEVEL_KEYS: readonly string[] = Object.freeze(
  Object.keys(
    (schemaMap[SCHEMA_ID] as { properties?: Record<string, unknown> } | undefined)?.properties ??
      {},
  ),
);

/** F100-FR-084 — a key under `x-` is ignored. */
export function isExtensionKey(key: string): boolean {
  return key.startsWith("x-");
}

/** The top-level keys of a value that the schema does not hold and that are not `x-`. */
export function unknownTopLevelKeysOf(value: object): readonly string[] {
  return Object.freeze(
    Object.keys(value).filter((k) => !isExtensionKey(k) && !KNOWN_TOP_LEVEL_KEYS.includes(k)),
  );
}

/**
 * Read a harness descriptor (annex C, §C.2).
 *
 * `descriptorVersion` outside the accepted range is refused with a doctor
 * finding; an unknown top-level key refuses the descriptor and a key under
 * `x-` is ignored; every field the annex marks required is required
 * (F100-FR-084).
 */
export function readHarnessDescriptor(value: unknown): HarnessDescriptor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DescriptorRefusedError({
      reason: "not-a-record",
      message: "refused the harness descriptor: it is no record (annex C, §C.2)",
    });
  }
  const found = (value as { descriptorVersion?: unknown }).descriptorVersion;
  if (!descriptorVersionIsAccepted(found)) {
    const finding = descriptorVersionFinding(found);
    throw new DescriptorRefusedError({
      reason: "descriptor-version",
      message: finding.message,
      doctorFinding: finding,
    });
  }
  const unknown = unknownTopLevelKeysOf(value);
  if (unknown.length > 0) {
    throw new DescriptorRefusedError({
      reason: "unknown-top-level-key",
      message:
        `refused the harness descriptor: the top-level key ${unknown.map((k) => `"${k}"`).join(", ")} ` +
        `is not a field of annex C §C.2; a key under \`x-\` is ignored (F100-FR-084)`,
    });
  }
  const missing = REQUIRED_BY_THE_ANNEX.filter(
    (field) => (value as Record<string, unknown>)[field] === undefined,
  );
  if (missing.length > 0) {
    throw new DescriptorRefusedError({
      reason: "missing-field",
      message:
        `refused the harness descriptor: annex C §C.2 requires the field ` +
        `${missing.map((f) => `\`${f}\``).join(", ")} (F100-FR-084)`,
    });
  }
  const result = validate<HarnessDescriptor>(SCHEMA_ID, value);
  if (!result.ok) {
    throw new DescriptorRefusedError({
      reason: "invalid",
      message:
        `refused the harness descriptor: ` +
        result.errors.map((e) => `${e.path}: ${e.message}`).join("; "),
      errors: result.errors,
    });
  }
  return result.record;
}

/** `readHarnessDescriptor` that returns a result instead of throwing. */
export function tryReadHarnessDescriptor(
  value: unknown,
): { ok: true; record: HarnessDescriptor } | { ok: false; error: DescriptorRefusedError } {
  try {
    return { ok: true, record: readHarnessDescriptor(value) };
  } catch (err) {
    if (err instanceof DescriptorRefusedError) return { ok: false, error: err };
    throw err;
  }
}

/** True when the value validates against the schema of §C.2. */
export function isHarnessDescriptor(value: unknown): value is HarnessDescriptor {
  return validate<HarnessDescriptor>(SCHEMA_ID, value).ok;
}

/**
 * The ceiling as the cell of §C.2 has it: "Member of §C.15, with provenance".
 * The schema types the field as text, so the value names the level and, in
 * brackets, where the value comes from: `C2 (declared)`.
 */
export type ParsedCeiling = {
  readonly level: ContainmentLevel;
  readonly provenance: string;
};

/** Parse `containment.ceiling`; undefined when it names no level, or no provenance. */
export function parseCeiling(value: unknown): ParsedCeiling | undefined {
  if (typeof value === "object" && value !== null && isContainmentCeiling(value)) {
    const record = value as { level: ContainmentLevel; provenance: string };
    return Object.freeze({ level: record.level, provenance: record.provenance });
  }
  if (typeof value !== "string") return undefined;
  const match = /^\s*(C[0-3])\s*\(([^)]+)\)\s*$/.exec(value);
  if (match === null) return undefined;
  const level = match[1] as ContainmentLevel;
  if (!(CONTAINMENT_LEVELS as readonly string[]).includes(level)) return undefined;
  return Object.freeze({ level, provenance: String(match[2]).trim() });
}

/**
 * True when the ceiling of the descriptor names a level of §C.15 WITH its
 * provenance (F100-FR-111). A bare level is a level without provenance, which
 * is no ceiling.
 */
export function ceilingIsDeclared(descriptor: HarnessDescriptor): boolean {
  const ceiling = (descriptor as { containment?: { ceiling?: unknown } }).containment?.ceiling;
  return parseCeiling(ceiling) !== undefined;
}

export type { SchemaError };
