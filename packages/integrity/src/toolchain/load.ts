// T062 (F116-FR-013, F116-FR-014) — loading, validation and detection of
// toolchain profiles.
//
// A profile is DATA (`specstride.toolchain/1`, the content of EP-16). The
// product ships profiles (packages/integrity/profiles/, also data); a
// consumer profile is accepted ONLY from user configuration, under the key
// `toolchains.<id>`, whose value is a profile and which is stored under the
// logical name `user:toolchain:<id>`. The key is of the trust class widening
// and has no default, so the same key in project configuration, in the
// environment or as a flag is ignored, with a launch message and a doctor
// warning. A profile that does not validate is refused at load with a finding
// and treated as absent; an unknown field is ignored with a finding.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "@specstride/contracts/records/compile";

/** The schema id of a toolchain profile (EP-16; annex C, §C.14). */
export const TOOLCHAIN_SCHEMA_ID = "specstride.toolchain/1" as const;

/** The configuration key prefix of a consumer profile (F116-FR-014). */
export const TOOLCHAINS_KEY_PREFIX = "toolchains." as const;

/** The trust class of the key `toolchains.<id>` (F116-FR-014). */
export const TOOLCHAINS_TRUST_CLASS = "widening" as const;

/** The environment variable and the flag that are ignored (F116-FR-014). */
export const IGNORED_ENV_KEY = "SPECSTRIDE_TOOLCHAINS" as const;
export const IGNORED_FLAG_KEY = "toolchains" as const;

/** The fields of a profile the product knows (F116-FR-013). */
export const KNOWN_PROFILE_FIELDS = [
  "schema",
  "id",
  "version",
  "detect",
  "classA",
  "testFiles",
  "caches",
  "userConfig",
  "suppressionMarkers",
  "executables",
  "effectiveConfig",
  "workerSeeds",
  "workerEnv",
] as const;

export type KnownProfileField = (typeof KNOWN_PROFILE_FIELDS)[number];

/** A validated profile, with its unknown fields stripped (F116-FR-013). */
export interface ToolchainProfileData {
  schema: typeof TOOLCHAIN_SCHEMA_ID;
  id: string;
  version: string;
  detect: Record<string, unknown>;
  classA: string[];
  testFiles?: string[];
  caches?: { path: string; disableEnv?: Record<string, string> }[];
  userConfig?: string[];
  suppressionMarkers?: string[];
  executables?: string[];
  effectiveConfig?: string[] | null;
  workerSeeds?: string[];
  workerEnv?: Record<string, string>;
  /** An unknown field is ignored with a finding and stripped at load. */
  [unknown: string]: unknown;
}

/** One loaded profile: where it came from and its logical name. */
export interface LoadedProfile {
  readonly source: "shipped" | "user";
  /** Only for a consumer profile (F116-FR-014). */
  readonly logicalName?: string;
  readonly profile: ToolchainProfileData;
}

/** A profile as the run records it: with its version (F116-FR-014). */
export interface UsedProfile {
  readonly id: string;
  readonly version: string;
}

export interface LoadOutcome {
  readonly profiles: readonly LoadedProfile[];
  /** The profiles the run used, each with its version (F116-FR-014). */
  readonly usedProfiles: readonly UsedProfile[];
  /** The launch messages (F116-FR-014). */
  readonly launchMessages: readonly string[];
  /** The findings the doctor shows (F116-FR-013, F116-FR-014). */
  readonly doctorWarnings: readonly string[];
}

/** The logical name of a consumer profile (F116-FR-014). */
export function logicalNameOf(id: string): string {
  return `user:toolchain:${id}`;
}

/** The fields of a value the product does not know (F116-FR-013). */
export function unknownFieldsOf(value: object): string[] {
  return Object.keys(value).filter(
    (key) => !(KNOWN_PROFILE_FIELDS as readonly string[]).includes(key),
  );
}

/**
 * Validate one profile against `specstride.toolchain/1`, strip its unknown
 * fields and say what was found. A profile that does not validate is refused
 * with a finding; a refused profile is treated as absent (F116-FR-013).
 */
export function validateProfile(value: unknown): {
  ok: boolean;
  profile?: ToolchainProfileData;
  unknownFields: string[];
  findings: string[];
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      unknownFields: [],
      findings: ["toolchain profile: the value is not an object; refused at load"],
    };
  }
  const unknown = unknownFieldsOf(value);
  const REQUIRED: readonly string[] = ["schema", "id", "version", "detect", "classA"];
  const missingRequired = REQUIRED.filter((field) => !(field in value));
  const result = validate(TOOLCHAIN_SCHEMA_ID, value);
  if (!result.ok) {
    return {
      ok: false,
      unknownFields: unknown,
      findings: [
        `toolchain profile \`${idOf(value)}\`: refused at load; treated as absent`,
        ...result.errors.map(
          (e: { path: string; message: string }) =>
            `toolchain profile \`${idOf(value)}\`: ${e.path || "/"}: ${e.message}`,
        ),
      ],
    };
  }
  if (missingRequired.length > 0) {
    return {
      ok: false,
      unknownFields: unknown,
      findings: [
        `toolchain profile \`${idOf(value)}\`: refused at load; treated as absent`,
        ...missingRequired.map(
          (field) =>
            `toolchain profile \`${idOf(value)}\`: missing the required field \`${field}\``,
        ),
      ],
    };
  }
  const profile = { ...(value as Record<string, unknown>) } as Record<string, unknown>;
  for (const field of unknown) delete profile[field];
  return {
    ok: true,
    profile: profile as unknown as ToolchainProfileData,
    unknownFields: unknown,
    findings: unknown.map(
      (field) =>
        `toolchain profile \`${idOf(value)}\`: the field \`${field}\` is not known to the product; ignored with a finding`,
    ),
  };
}

function idOf(value: unknown): string {
  const id = (value as { id?: unknown })?.id;
  return typeof id === "string" ? id : "(no id)";
}

/** The directory of the shipped profiles, inside this package. */
export function profilesDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "profiles");
}

/** The shipped profiles, read from disk as data (F116-FR-014). */
export function shippedProfiles(): {
  profiles: LoadedProfile[];
  doctorWarnings: string[];
} {
  const dir = profilesDirectory();
  const profiles: LoadedProfile[] = [];
  const doctorWarnings: string[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    doctorWarnings.push(
      "toolchain profiles: the shipped profiles are unreadable; treated as absent",
    );
    return { profiles, doctorWarnings };
  }
  for (const name of names) {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch (error) {
      doctorWarnings.push(
        `toolchain profile \`${name}\`: refused at load (${(error as Error).message}); treated as absent`,
      );
      continue;
    }
    const outcome = validateProfile(value);
    if (!outcome.ok || !outcome.profile) {
      doctorWarnings.push(...outcome.findings);
      continue;
    }
    doctorWarnings.push(...outcome.findings);
    profiles.push({ source: "shipped", profile: outcome.profile });
  }
  return { profiles, doctorWarnings };
}

export interface LoadOptions {
  /** User configuration: the only source of a consumer profile (F116-FR-014). */
  readonly userConfig?: Readonly<Record<string, unknown>>;
  /** Project configuration: the key here is IGNORED (F116-FR-014). */
  readonly projectConfig?: Readonly<Record<string, unknown>>;
  /** The environment: `SPECSTRIDE_TOOLCHAINS` here is IGNORED (F116-FR-014). */
  readonly env?: Readonly<Record<string, unknown>>;
  /** The flags: `--toolchains` here is IGNORED (F116-FR-014). */
  readonly flags?: Readonly<Record<string, unknown>>;
  /**
   * A test overlay: the fictional toolchain of a conformance or
   * characterization fixture reaches the loader as user configuration would.
   */
  readonly overlay?: Readonly<Record<string, unknown>>;
}

function consumerProfilesOf(
  config: Readonly<Record<string, unknown>>,
): { id: string; value: unknown }[] {
  return Object.keys(config)
    .filter((key) => key.startsWith(TOOLCHAINS_KEY_PREFIX))
    .map((key) => ({ id: key.slice(TOOLCHAINS_KEY_PREFIX.length), value: config[key] }));
}

/**
 * Load the profiles of a run: the shipped profiles, then the consumer
 * profiles of user configuration and of a test overlay. Every other source is
 * ignored, with a launch message and a doctor warning (F116-FR-014).
 */
export function loadToolchainProfiles(options: LoadOptions): LoadOutcome {
  const launchMessages: string[] = [];
  const doctorWarnings: string[] = [];

  const shipped = shippedProfiles();
  doctorWarnings.push(...shipped.doctorWarnings);
  const profiles: LoadedProfile[] = [...shipped.profiles];
  const byId = new Map(profiles.map((p) => [p.profile.id, p] as const));

  // Project configuration, the environment and a flag are ignored
  // (F116-FR-014): the key is widening and is accepted from user
  // configuration only.
  if (options.projectConfig) {
    for (const { id } of consumerProfilesOf(options.projectConfig)) {
      const key = `${TOOLCHAINS_KEY_PREFIX}${id}`;
      launchMessages.push(
        `${key} in project configuration is ignored: the key is of the trust class widening and is accepted from user configuration only`,
      );
      doctorWarnings.push(
        `${key} in project configuration is ignored (widening key, user configuration only)`,
      );
    }
  }
  if (options.env && IGNORED_ENV_KEY in options.env) {
    launchMessages.push(
      `${IGNORED_ENV_KEY} is ignored: toolchain profiles come from user configuration only`,
    );
    doctorWarnings.push(`${IGNORED_ENV_KEY} is ignored (user configuration only)`);
  }
  if (options.flags && IGNORED_FLAG_KEY in options.flags) {
    launchMessages.push(
      `--${IGNORED_FLAG_KEY} is ignored: toolchain profiles come from user configuration only`,
    );
    doctorWarnings.push(`--${IGNORED_FLAG_KEY} is ignored (user configuration only)`);
  }

  for (const source of ["userConfig", "overlay"] as const) {
    const config = options[source];
    if (!config) continue;
    for (const { id, value } of consumerProfilesOf(config)) {
      const outcome = validateProfile(value);
      if (!outcome.ok || !outcome.profile) {
        doctorWarnings.push(...outcome.findings);
        continue;
      }
      doctorWarnings.push(...outcome.findings);
      const loaded: LoadedProfile = {
        source: "user",
        logicalName: logicalNameOf(id),
        profile: outcome.profile,
      };
      const existing = byId.get(id);
      if (existing) profiles[profiles.indexOf(existing)] = loaded;
      else profiles.push(loaded);
      byId.set(id, loaded);
    }
  }

  const usedProfiles: UsedProfile[] = profiles.map((p) => ({
    id: p.profile.id,
    version: p.profile.version,
  }));
  return { profiles, usedProfiles, launchMessages, doctorWarnings };
}

export interface DetectedToolchain {
  readonly id: string;
  /** The profile that detected it, or null: the toolchain has no profile. */
  readonly fromProfile: ToolchainProfileData | null;
}

/**
 * Detection (F116-FR-013): a profile detects its toolchain by the file names
 * of its `detect` field; a toolchain the shipped detection knows and no
 * profile covers is reported with `fromProfile` null (F116-FR-015).
 */
export function detectToolchains(input: {
  files: readonly string[];
  shippedProfiles?: readonly ToolchainProfileData[];
}): DetectedToolchain[] {
  const files = input.files;
  const matchesFile = (name: string): boolean =>
    files.some((file) => file === name || file.endsWith(`/${name}`));
  const out: DetectedToolchain[] = [];
  const seen = new Set<string>();
  for (const profile of input.shippedProfiles ?? []) {
    const names = (profile.detect as { files?: unknown })?.files;
    if (Array.isArray(names) && names.some((n) => typeof n === "string" && matchesFile(n))) {
      out.push({ id: profile.id, fromProfile: profile });
      seen.add(profile.id);
    }
  }
  // The shipped detection of the product, for a toolchain with no profile.
  const BUILTIN_DETECT: Readonly<Record<string, readonly string[]>> = Object.freeze({
    vitest: Object.freeze(["vitest.config.ts", "vitest.config.mts", "vitest.config.js"]),
    pytest: Object.freeze(["pytest.ini", "conftest.py"]),
  });
  for (const [id, names] of Object.entries(BUILTIN_DETECT)) {
    if (!seen.has(id) && names.some(matchesFile)) out.push({ id, fromProfile: null });
  }
  return out;
}
