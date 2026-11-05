/**
 * T011 — the file loader (F110-FR-003, F110-FR-004).
 *
 * F110-FR-003: a configuration file carries `schema` with the major 1; the user
 * file is the file of the logical name `user:config` and the project file the
 * file of `project:config` (annex B §B.5); the user file honours the variable
 * that names the user configuration directory of the platform; a file with
 * another major is refused; the project file is never searched above the
 * workspace root.
 *
 * F110-FR-004: the install-root `.env` file of the baseline is never read — it
 * is no layer of the table of annex X §X.2 (F100-FR-201) — and the user file
 * takes its role as a machine-wide default that the environment beats, which
 * follows from the ranks: the user file is rank 6 and the environment rank 4.
 *
 * Every path the loader asks for is recorded in `filesRead` and
 * `filesConsidered`, so that a caller — and the test of CT-110-104 — can observe
 * through an independent read path that no `.env` was ever opened.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";

import { rankOfLayer, type RankLayer } from "@specstride/contracts/envelope/config";
import {
  resolve as resolveLogicalName,
  rootPathsOf,
} from "@specstride/contracts/ids/logical-names";
import type { RootEnvironment } from "@specstride/contracts/ids/roots";
import { parse as parseYaml } from "yaml";

import { matchCatalogueKey } from "../schema/catalogue.ts";
import { isIgnoredExtensionKey } from "../schema/spelling.ts";
import { ConfigValueError, UnknownKeyError, type LayerCode } from "../schema/types.ts";
import { validateKeyValue } from "../schema/validate.ts";

/** The schema id a configuration file carries (annex B §B.5). */
export const CONFIG_SCHEMA_ID = "specstride.config/1";

/** The only major of that schema this product reads (F110-FR-003). */
export const CONFIG_SCHEMA_MAJOR = 1;

/** The logical name of the user file (annex B §B.5). */
export const USER_CONFIG_NAME = "user:config";

/** The logical name of the project file (annex B §B.5). */
export const PROJECT_CONFIG_NAME = "project:config";

/**
 * The file at the install root that the baseline read. It is never read
 * (F110-FR-004): it is no layer of the table of annex X §X.2, and the user file
 * takes its role.
 */
export const INSTALL_ROOT_ENV_FILE = ".env";

/** F110-FR-004, first sentence, as a constant a caller can assert on. */
export const INSTALL_ROOT_ENV_FILE_IS_READ = false as const;

/**
 * F110-FR-004, second sentence — the user file is a machine-wide default that
 * the environment beats. True because the environment is rank 4 and the user
 * file rank 6 (annex X §X.2).
 */
export function environmentBeatsUserFile(): boolean {
  return rankOfLayer["environment"] < rankOfLayer["user-configuration"];
}

/** The layer of each configuration file, as the column "Layers" of §K.1 names it. */
export const LAYER_OF_FILE: Readonly<Record<string, LayerCode>> = Object.freeze({
  [USER_CONFIG_NAME]: "U",
  [PROJECT_CONFIG_NAME]: "P",
});

/** The rank layer of each configuration file (annex X §X.2). */
export const RANK_LAYER_OF_FILE: Readonly<Record<string, RankLayer>> = Object.freeze({
  [USER_CONFIG_NAME]: "user-configuration",
  [PROJECT_CONFIG_NAME]: "project-configuration",
});

/**
 * What the loader needs to know about the machine. The three `xdg…` fields are
 * the variables of the platform that name the user directories; `xdgConfigHome`
 * is the one F110-FR-003 names, and the same location is used on macOS, where
 * the statement is `unverified` (no macOS runner; owner ruling of 2026-09-30).
 */
export interface FileEnvironment {
  readonly home: string;
  readonly xdgConfigHome?: string | undefined;
  readonly xdgStateHome?: string | undefined;
  readonly xdgCacheHome?: string | undefined;
  /** The real path of the root of the working tree (`<workspace>`). */
  readonly workspaceRealPath: string;
  /** The identifier of §B.3; only the control root needs it. */
  readonly workspaceId?: string | undefined;
  /** The control root the consumer set, where one is set. */
  readonly controlRootOverride?: string | undefined;
  /** The directory the command was run in; the search for the project file starts here. */
  readonly startDir?: string | undefined;
  /** The root the product itself is installed in, where the caller knows it. */
  readonly installRoot?: string | undefined;
}

const rootEnvironmentOf = (
  env: FileEnvironment,
): RootEnvironment & {
  controlRoot: string;
  workerRoot: string;
} => ({
  home: env.home,
  xdgConfigHome: env.xdgConfigHome,
  xdgStateHome: env.xdgStateHome,
  xdgCacheHome: env.xdgCacheHome,
  workspaceRealPath: env.workspaceRealPath,
  workspaceId: env.workspaceId ?? "",
  controlRootOverride: env.controlRootOverride,
  controlRoot: "",
  workerRoot: "",
});

/**
 * The path of the user file: `<user-config>/config.yaml`, where `<user-config>`
 * is `$XDG_CONFIG_HOME/specstride` and, with the variable unset,
 * `~/.config/specstride` (annex B §B.5 with feature 100's
 * `contracts/sources/physical-paths.json`). The variable that names the user
 * configuration directory of the platform is honoured here (F110-FR-003).
 */
export function userConfigPath(env: FileEnvironment): string {
  return resolveLogicalName(USER_CONFIG_NAME, {}, rootPathsOf(rootEnvironmentOf(env)));
}

/**
 * The path of the project file: `<workspace>/specstride.yaml` — the root of the
 * working tree, outside the workspace part (annex B §B.5).
 */
export function projectConfigPath(env: FileEnvironment): string {
  return resolveLogicalName(PROJECT_CONFIG_NAME, {}, rootPathsOf(rootEnvironmentOf(env)));
}

/** The file name of the project file, as the path template of annex B gives it. */
export function projectConfigFileName(env: FileEnvironment): string {
  const path = projectConfigPath(env);
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The seam through which the loader touches the file system. */
export interface FileIo {
  /** The text of a file, or `undefined` where there is none. */
  readonly readFile: (path: string) => string | undefined;
}

/** The default seam: `node:fs`, with a missing file read as absent. */
export const nodeFileIo: FileIo = Object.freeze({
  readFile: (path: string): string | undefined => {
    try {
      if (!statSync(path).isFile()) return undefined;
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  },
});

/**
 * F110-FR-003, last sentence — the directories the search for the project file
 * may look in: the starting directory and each directory above it up to the
 * workspace root, and never one above that root.
 */
export function projectSearchDirs(env: FileEnvironment): readonly string[] {
  const root = resolvePath(env.workspaceRealPath);
  const start = resolvePath(env.startDir ?? root);
  const dirs: string[] = [];
  let here = start;
  // A starting directory outside the working tree searches the root only.
  if (here !== root && !here.startsWith(`${root}/`)) return Object.freeze([root]);
  for (;;) {
    dirs.push(here);
    if (here === root) break;
    const up = dirname(here);
    if (up === here) break;
    here = up;
  }
  return Object.freeze(dirs);
}

/** A file whose `schema` names a major this product does not read (F110-FR-003). */
export class SchemaMajorError extends Error {
  readonly logicalName: string;
  readonly path: string;
  /** The major the file carries, or `undefined` where it carries no `schema`. */
  readonly found: number | undefined;
  /** The major this product supports. */
  readonly supported = CONFIG_SCHEMA_MAJOR;
  constructor(fields: {
    logicalName: string;
    path: string;
    found: number | undefined;
    why: string;
  }) {
    super(
      `${fields.path}: the file of the logical name \`${fields.logicalName}\` ` +
        `${fields.why}. This product reads the major ${CONFIG_SCHEMA_MAJOR} of ` +
        `\`${CONFIG_SCHEMA_ID}\`` +
        (fields.found === undefined ? "" : `, and the file carries the major ${fields.found}`),
    );
    this.name = "SchemaMajorError";
    this.logicalName = fields.logicalName;
    this.path = fields.path;
    this.found = fields.found;
  }
}

/** A file whose text is not a mapping of keys (F110-FR-003). */
export class ConfigFileError extends Error {
  readonly logicalName: string;
  readonly path: string;
  constructor(fields: { logicalName: string; path: string; why: string }) {
    super(`${fields.path}: the file of the logical name \`${fields.logicalName}\` ${fields.why}`);
    this.name = "ConfigFileError";
    this.logicalName = fields.logicalName;
    this.path = fields.path;
  }
}

/**
 * Read the `schema` field of a parsed file (F110-FR-003).
 *
 * The catalogue types the key `schema` as "whole number, 1" (§K.3) and annex
 * B §B.5 names the content of the file `specstride.config/1`, so both the number
 * `1` and the schema id with its major are read, and both mean the major 1. Any
 * other major, and a file with no `schema` at all, is refused.
 */
export function majorOf(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string") {
    const id = /^(.+)\/(\d+)$/.exec(value.trim());
    if (id !== null) {
      if (id[1] !== CONFIG_SCHEMA_ID.replace(/\/\d+$/, "")) return undefined;
      return Number(id[2]);
    }
    if (/^\d+$/.test(value.trim())) return Number(value.trim());
  }
  return undefined;
}

/** The schemes of a secret reference of §K.7; the registry is open (closed set 44). */
/**
 * T044 — the one version of the npm package `yaml` the loader is pinned to, and
 * its licence (decision D-8 of feature 100: "one YAML parser for the whole
 * product, the npm package `yaml` … The exact version is pinned at the first
 * task of feature 110 that uses it, and the licence is checked then").
 *
 * The pin itself lives in `packages/config/package.json` as an exact version,
 * never a range (F100-FR-027); these constants restate it so that a check can
 * compare the three places it appears — the manifest, `package-lock.json` and
 * the installed package — against one value, and so that the licence of the
 * parser is readable from the product and not only from prose. The record of
 * the pin is `specs/110-config-and-terms/research.md` (decision 7, §T044) and
 * `packages/config/DEPENDENCIES.md`.
 */
export const YAML_PARSER_PIN: {
  readonly package: "yaml";
  readonly version: string;
  readonly licence: "ISC";
} = Object.freeze({ package: "yaml", version: "2.9.1", licence: "ISC" } as const);

/**
 * T044 — the mode of the parser that constructs no code (plan.md, "Primary
 * Dependencies": "used in a mode that constructs no code"; F110-FR-003).
 *
 * `version: "1.2"` selects the YAML 1.2 core schema, which builds strings,
 * numbers, booleans, null, sequences and mappings and nothing else;
 * `customTags: []` registers no tag, so no tag of a document can name a
 * constructor and an unknown tag stays an unresolved scalar; `merge: false`
 * turns off the `<<` merge key of YAML 1.1, so a document cannot graft one
 * mapping onto another; `uniqueKeys: true` refuses a duplicate key instead of
 * letting the later one win silently.
 */
export const YAML_PARSE_OPTIONS: {
  readonly version: "1.2";
  readonly merge: false;
  readonly customTags: readonly never[];
  readonly uniqueKeys: true;
} = Object.freeze({
  version: "1.2",
  merge: false,
  customTags: Object.freeze([]),
  uniqueKeys: true,
} as const);

export const SECRET_REFERENCE = /^[a-z][a-z0-9-]*:/;

/**
 * Parse the text of a configuration file. YAML 1.2 with the core schema: no
 * custom tag and no merge key, so the parser constructs no code (plan.md,
 * "Primary Dependencies"). The mode is `YAML_PARSE_OPTIONS` and nothing else,
 * so T044's check has one place to read it from. JSON is read by the same
 * parser, being a subset of YAML 1.2.
 */
export function parseConfigText(
  text: string,
  where: { logicalName: string; path: string },
): Record<string, unknown> {
  let tree: unknown;
  try {
    tree = parseYaml(text, {
      ...YAML_PARSE_OPTIONS,
      customTags: [...YAML_PARSE_OPTIONS.customTags],
    });
  } catch (error) {
    throw new ConfigFileError({
      ...where,
      why: `is not a YAML 1.2 document: ${(error as Error).message}`,
    });
  }
  if (tree === null || tree === undefined) return {};
  if (typeof tree !== "object" || Array.isArray(tree)) {
    throw new ConfigFileError({ ...where, why: "is not a mapping of configuration keys" });
  }
  return tree as Record<string, unknown>;
}

/**
 * Flatten a parsed file into the dotted paths of §K.1. A nested mapping becomes
 * one key per leaf; a mapping that is itself the value of a key of the type
 * "table" or "list of {…}" stays whole. Keys under `x-` at any depth are not
 * flattened at all: they are free for the consumer and ignored (§K.2 rule 5).
 */
export function flattenTree(tree: Record<string, unknown>): {
  values: Map<string, unknown>;
  ignored: string[];
} {
  const values = new Map<string, unknown>();
  const ignored: string[] = [];
  const walk = (node: Record<string, unknown>, prefix: string): void => {
    for (const [segment, value] of Object.entries(node)) {
      const key = prefix === "" ? segment : `${prefix}.${segment}`;
      if (isIgnoredExtensionKey(key)) {
        ignored.push(key);
        continue;
      }
      const isMapping = typeof value === "object" && value !== null && !Array.isArray(value);
      // A mapping is a branch of the path unless the catalogue holds the key
      // itself, in which case the mapping is the value (a table, a descriptor).
      if (isMapping && matchCatalogueKey(key) === undefined) {
        walk(value as Record<string, unknown>, key);
        continue;
      }
      values.set(key, value);
    }
  };
  walk(tree, "");
  return { values, ignored };
}

/** One configuration file, read and validated. */
export interface LoadedConfigFile {
  readonly logicalName: string;
  readonly path: string;
  /** The layer the file is, as the column "Layers" of §K.1 names it. */
  readonly layer: LayerCode;
  /** The rank layer of annex X §X.2. */
  readonly rankLayer: RankLayer;
  /** The major the file carries. */
  readonly major: number;
  /** Every accepted key of the file, with its value read into the key's type. */
  readonly values: ReadonlyMap<string, unknown>;
  /** The keys under `x-` the file carries, which are ignored (§K.2 rule 5). */
  readonly ignoredKeys: readonly string[];
  /** Every key the file refuses the launch over (F110-FR-001, F110-FR-002). */
  readonly errors: readonly (ConfigValueError | UnknownKeyError)[];
}

/** Read and validate one configuration file, or `undefined` where there is none. */
export function readConfigFile(
  where: { logicalName: string; path: string },
  io: FileIo = nodeFileIo,
): LoadedConfigFile | undefined {
  const text = io.readFile(where.path);
  if (text === undefined) return undefined;
  const tree = parseConfigText(text, where);
  const schemaField = tree["schema"];
  const major = majorOf(schemaField);
  if (schemaField === undefined) {
    throw new SchemaMajorError({ ...where, found: undefined, why: "carries no `schema` field" });
  }
  if (major === undefined) {
    throw new SchemaMajorError({
      ...where,
      found: undefined,
      why: `carries the \`schema\` field \`${String(schemaField)}\`, which names no major`,
    });
  }
  if (major !== CONFIG_SCHEMA_MAJOR) {
    throw new SchemaMajorError({ ...where, found: major, why: "carries another major" });
  }
  const layer = LAYER_OF_FILE[where.logicalName] ?? "U";
  const { values: raw, ignored } = flattenTree(tree);
  raw.delete("schema");
  const values = new Map<string, unknown>();
  const errors: (ConfigValueError | UnknownKeyError)[] = [];
  for (const [key, value] of raw) {
    const match = matchCatalogueKey(key);
    // F110-FR-004, last sentence — a key of the file that holds a secret value
    // in clear is an error, not a value (F110-FR-027). The reference forms of
    // §K.7 all carry a scheme; a value without one is the secret itself, and the
    // message never repeats it.
    if (
      match?.entry.type.kind === "secret-ref" &&
      typeof value === "string" &&
      !SECRET_REFERENCE.test(value)
    ) {
      errors.push(
        new ConfigValueError({
          reason: "inline-secret",
          key,
          value: "(withheld)",
          layer: where.path,
          range: match.entry.cells.typeAndRange,
          message:
            `${where.path}: the key \`${key}\` holds a value in clear. A secret is ` +
            `named by a reference of §K.7 (\`env:\`, \`file:\` or \`keychain:\`), never ` +
            `by its value; the value is not repeated here`,
        }),
      );
      continue;
    }
    const verdict = validateKeyValue(key, value, layer, { place: where.path });
    if (verdict.ok) values.set(key, verdict.value);
    else errors.push(verdict.error);
  }
  return Object.freeze({
    logicalName: where.logicalName,
    path: where.path,
    layer,
    rankLayer: RANK_LAYER_OF_FILE[where.logicalName] ?? "user-configuration",
    major,
    values,
    ignoredKeys: Object.freeze(ignored),
    errors: Object.freeze(errors),
  });
}

/** What the loader found, with every path it looked at. */
export interface ConfigFileLoad {
  readonly user: LoadedConfigFile | undefined;
  readonly project: LoadedConfigFile | undefined;
  /** Every path the loader asked the file system for, in order. */
  readonly filesConsidered: readonly string[];
  /** Every path that held a file and was read. */
  readonly filesRead: readonly string[];
  /** Every key the two files refuse the launch over. */
  readonly errors: readonly (ConfigValueError | UnknownKeyError)[];
}

/**
 * Load the two configuration files (F110-FR-003, F110-FR-004).
 *
 * The user file is looked for at one place only — the file of `user:config`. The
 * project file is looked for at the file name of `project:config` in the
 * starting directory and each directory above it up to the workspace root, and
 * never above that root. The install-root `.env` is not among the paths this
 * function asks for, which `filesConsidered` records.
 */
export function loadConfigFiles(env: FileEnvironment, io: FileIo = nodeFileIo): ConfigFileLoad {
  const considered: string[] = [];
  const read: string[] = [];
  const seen: FileIo = {
    readFile: (path: string): string | undefined => {
      considered.push(path);
      const text = io.readFile(path);
      if (text !== undefined) read.push(path);
      return text;
    },
  };
  const errors: (ConfigValueError | UnknownKeyError)[] = [];

  const user = readConfigFile({ logicalName: USER_CONFIG_NAME, path: userConfigPath(env) }, seen);
  if (user !== undefined) errors.push(...user.errors);

  let project: LoadedConfigFile | undefined;
  const fileName = projectConfigFileName(env);
  for (const dir of projectSearchDirs(env)) {
    const found = readConfigFile(
      { logicalName: PROJECT_CONFIG_NAME, path: join(dir, fileName) },
      seen,
    );
    if (found !== undefined) {
      project = found;
      errors.push(...found.errors);
      break;
    }
  }

  return Object.freeze({
    user,
    project,
    filesConsidered: Object.freeze(considered),
    filesRead: Object.freeze(read),
    errors: Object.freeze(errors),
  });
}

/**
 * F110-FR-004 — true where a path is the install-root `.env` of the baseline.
 * The loader never asks for such a path; a caller may use this to assert it.
 */
export function isInstallRootEnvFile(path: string, installRoot: string | undefined): boolean {
  if (installRoot === undefined) return path.endsWith(`/${INSTALL_ROOT_ENV_FILE}`);
  const base = isAbsolute(installRoot) ? installRoot : resolvePath(installRoot);
  return resolvePath(path) === join(base, INSTALL_ROOT_ENV_FILE);
}
