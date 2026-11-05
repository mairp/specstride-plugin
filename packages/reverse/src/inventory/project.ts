/**
 * T026 of feature 140 — the MANIFEST READERS, the FRAMEWORKS and the SPEC KIT
 * FACTS of the source (F140-FR-022, F140-FR-024).
 *
 * Every fact here is read off a file of the source; nothing is inferred and
 * nothing is judged (constitution, principle XIII). The readers are the
 * baseline's at `9cab15d`, pattern for pattern, because the summary a
 * proposer reads and the plan's own output quote them.
 *
 * Three rules hold across all of them:
 *
 *  * **No TOML reader is bundled** (F140-FR-022). Node ships none, and
 *    `@specstride/reverse` is layer L6 and may import contracts, kernel and
 *    spec-formats and nothing else, so `pyproject.toml` and `Cargo.toml`
 *    yield NO PARSED FACTS — their record is the manifest and its kind, plus
 *    the `pytest` framework, which `_pyproject_facts` read off the raw TEXT
 *    and not off the parse. This is the as-is behaviour of the baseline on an
 *    interpreter without `tomllib`, which the requirement names.
 *  * **An empty value is dropped** from a manifest record: null, the empty
 *    string, the empty list and the empty map all go, so a reader of the
 *    document never has to tell "absent" from "empty".
 *  * **The whitespace classes are the baseline's `\s`**, not `[ \t]`. Python's
 *    `\s` matches a line end, and the readers below run `re.M` over a whole
 *    file, so `name:` on one line and its value on the next IS a match at the
 *    baseline. Narrowing the class would silently read a different fact.
 *  * **Frameworks come only from manifest DEPENDENCY NAMES**, through the
 *    fixed table below, and are reported sorted. A framework is never guessed
 *    from a file name or an import.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { FileEntry } from "./entries.ts";
import { baseNameOf } from "./entries.ts";
import type { JsonValue } from "./serialize.ts";
import { sortByCodePoint } from "./serialize.ts";

/* ------------------------------------------------------------------------- *
 * Reading a file of the source
 * ------------------------------------------------------------------------- */

/** The characters a manifest is read through (the baseline's 2 MiB). */
export const MANIFEST_READ_LIMIT = 2 * 1024 * 1024;

/** The characters an entry-point scan reads of a source file (256 KiB). */
export const ENTRY_POINT_READ_LIMIT = 256 * 1024;

/**
 * The text of a file, decoded as UTF-8 with an undecodable byte REPLACED and
 * never raised, cut to `limit` CHARACTERS — Python's
 * `open(..., errors="replace").read(limit)`, which counts characters and not
 * UTF-16 units. `undefined` where the file cannot be read.
 */
export function readText(path: string, limit = MANIFEST_READ_LIMIT): string | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  if (text.length <= limit) return text;
  const characters = Array.from(text);
  return characters.length <= limit ? text : characters.slice(0, limit).join("");
}

/** The parsed JSON of a file, or `undefined` where it is absent or invalid. */
export function readJson(path: string): unknown {
  const text = readText(path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The parsed TOML of a file — always `undefined`. No TOML reader is bundled
 * (F140-FR-022), so this is the one reader that answers nothing, and the two
 * TOML manifests lose their parsed facts. It is a named function and not a
 * missing call so that the day a reader arrives there is one place to change.
 */
export function readToml(_path: string): undefined {
  return undefined;
}

/** A record of unique non-empty names, sorted by code point. */
export function sortedNames(values: Iterable<unknown>): readonly string[] {
  const kept = new Set<string>();
  for (const value of values) {
    if (value === undefined || value === null || value === "" || value === false || value === 0) {
      continue;
    }
    kept.add(String(value));
  }
  return sortByCodePoint(kept);
}

/* ------------------------------------------------------------------------- *
 * The frameworks table (F140-FR-022)
 * ------------------------------------------------------------------------- */

/** Dependency name (lower-cased) to framework label; the fixed table. */
export const FRAMEWORK_HINTS: Readonly<Record<string, string>> = Object.freeze({
  react: "react",
  next: "next.js",
  vue: "vue",
  svelte: "svelte",
  express: "express",
  fastify: "fastify",
  koa: "koa",
  hono: "hono",
  "@nestjs/core": "nestjs",
  vitest: "vitest",
  jest: "jest",
  mocha: "mocha",
  typescript: "typescript",
  fastapi: "fastapi",
  flask: "flask",
  django: "django",
  pytest: "pytest",
  click: "click",
  typer: "typer",
  pydantic: "pydantic",
  sqlalchemy: "sqlalchemy",
  aiohttp: "aiohttp",
  tokio: "tokio",
  "actix-web": "actix-web",
  axum: "axum",
  clap: "clap",
  serde: "serde",
  "github.com/gin-gonic/gin": "gin",
  "github.com/spf13/cobra": "cobra",
  "github.com/labstack/echo": "echo",
});

/** The frameworks of a set of dependency names, sorted (F140-FR-022). */
export function frameworksOf(dependencies: Iterable<string>): readonly string[] {
  const found = new Set<string>();
  for (const dependency of dependencies) {
    const label = FRAMEWORK_HINTS[dependency];
    if (label !== undefined) found.add(label);
  }
  return sortByCodePoint(found);
}

/** The name a dependency specifier starts with, lower-cased. */
export function dependencyName(specifier: string): string {
  const cut = specifier.split(/[<>=!~[; ]/, 1)[0] as string;
  return cut.toLowerCase();
}

/* ------------------------------------------------------------------------- *
 * One manifest
 * ------------------------------------------------------------------------- */

/** The facts of one manifest, before the empty values are dropped. */
export type ManifestFacts = Record<string, JsonValue>;

/** What one reader produced: its facts and the dependency names it saw. */
export type ManifestReading = {
  readonly facts: ManifestFacts;
  readonly dependencies: ReadonlySet<string>;
};

/** Drop every key whose value is null, empty text, an empty list or map. */
export function withoutEmptyValues(facts: ManifestFacts): ManifestFacts {
  const kept: ManifestFacts = {};
  for (const [key, value] of Object.entries(facts)) {
    if (value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
      continue;
    }
    kept[key] = value;
  }
  return kept;
}

/** An object with sorted keys and string values, as the baseline wrote them. */
function sortedStringMap(source: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of sortByCodePoint(Object.keys(source))) out[key] = String(source[key]);
  return out;
}

/** `package.json` (F140-FR-022). An unparseable file records `unparseable`. */
export function packageJsonFacts(relative: string, data: unknown): ManifestReading {
  const facts: ManifestFacts = { manifest: relative, kind: "package.json" };
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    facts["error"] = "unparseable";
    return { facts, dependencies: new Set() };
  }
  const record = data as Record<string, unknown>;
  facts["name"] = typeof record["name"] === "string" ? record["name"] : null;
  const bin = record["bin"];
  if (typeof bin === "string") {
    facts["bin"] = { [typeof record["name"] === "string" ? record["name"] : ""]: bin };
  } else if (bin !== null && typeof bin === "object" && !Array.isArray(bin)) {
    facts["bin"] = sortedStringMap(bin as Record<string, unknown>);
  }
  const targets: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") targets.push(value);
    else if (Array.isArray(value)) for (const item of value) collect(item);
    else if (value !== null && typeof value === "object") {
      for (const key of sortByCodePoint(Object.keys(value as Record<string, unknown>))) {
        collect((value as Record<string, unknown>)[key]);
      }
    }
  };
  collect(record["exports"]);
  for (const key of ["main", "module", "types"] as const) {
    if (typeof record[key] === "string") targets.push(record[key] as string);
  }
  if (targets.length > 0) facts["exports"] = sortByCodePoint(new Set(targets));
  const scripts = record["scripts"];
  if (scripts !== null && typeof scripts === "object" && !Array.isArray(scripts)) {
    facts["scripts"] = sortedStringMap(scripts as Record<string, unknown>);
  }
  let workspaces = record["workspaces"];
  if (workspaces !== null && typeof workspaces === "object" && !Array.isArray(workspaces)) {
    workspaces = (workspaces as Record<string, unknown>)["packages"];
  }
  if (Array.isArray(workspaces)) facts["workspaces"] = workspaces.map((one) => String(one));
  const dependencies = new Set<string>();
  for (const key of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const group = record[key];
    if (group !== null && typeof group === "object" && !Array.isArray(group)) {
      for (const name of Object.keys(group as Record<string, unknown>)) {
        dependencies.add(name.toLowerCase());
      }
    }
  }
  return { facts, dependencies };
}

/**
 * `pyproject.toml` (F140-FR-022). Without a TOML reader the parse is
 * `undefined`, so the record is the manifest and its kind — and `pytest`
 * still counts as a framework, because the baseline read that off the raw TEXT
 * ("any mention of `pytest` counts as that framework").
 */
export function pyprojectFacts(
  relative: string,
  data: unknown,
  text: string | undefined,
): ManifestReading {
  const facts: ManifestFacts = { manifest: relative, kind: "pyproject.toml" };
  const dependencies = new Set<string>();
  if (data !== null && data !== undefined && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const project = (record["project"] ?? {}) as Record<string, unknown>;
    const poetry = (((record["tool"] ?? {}) as Record<string, unknown>)["poetry"] ?? {}) as Record<
      string,
      unknown
    >;
    const name = project["name"] ?? poetry["name"] ?? null;
    facts["name"] = typeof name === "string" ? name : null;
    const scripts: Record<string, unknown> = {
      ...((project["scripts"] ?? {}) as Record<string, unknown>),
      ...((poetry["scripts"] ?? {}) as Record<string, unknown>),
    };
    if (Object.keys(scripts).length > 0) facts["scripts"] = sortedStringMap(scripts);
    for (const dependency of (project["dependencies"] ?? []) as unknown[]) {
      dependencies.add(dependencyName(String(dependency)));
    }
    for (const group of Object.values(
      (project["optional-dependencies"] ?? {}) as Record<string, unknown>,
    )) {
      for (const dependency of (group ?? []) as unknown[]) {
        dependencies.add(dependencyName(String(dependency)));
      }
    }
    for (const key of ["dependencies", "dev-dependencies"] as const) {
      for (const name of Object.keys((poetry[key] ?? {}) as Record<string, unknown>)) {
        dependencies.add(name.toLowerCase());
      }
    }
    const build = ((record["build-system"] ?? {}) as Record<string, unknown>)["build-backend"];
    if (build !== undefined && build !== null && build !== "")
      facts["build_backend"] = String(build);
  }
  if (text !== undefined && text !== "" && text.toLowerCase().includes("pytest")) {
    dependencies.add("pytest");
  }
  return { facts, dependencies };
}

/* ------------------------------------------------------------------------- *
 * `setup.cfg` — Python's `configparser`, the subset the reader needs
 * ------------------------------------------------------------------------- */

/** The sections of an INI file: section, then lower-cased key, then value. */
export type IniDocument = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** An INI file this reader refuses. */
export class IniError extends Error {}

/**
 * Python's `configparser.ConfigParser(interpolation=None).read_string`, in the
 * subset `setup.cfg` needs: `[section]` headers, `key = value` and
 * `key: value`, a full-line `#` or `;` comment, and CONTINUATION lines — a
 * line indented further than its key extends the value with a line end
 * before it, which is how `install_requires` and `console_scripts` carry a
 * list. Keys are lower-cased, as `optionxform` does. A value before any
 * section header is a `MissingSectionHeaderError`.
 */
export function parseIni(text: string): IniDocument {
  const document: Record<string, Record<string, string>> = {};
  let section: Record<string, string> | undefined;
  let key: string | undefined;
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if (raw.trim() === "") {
      // A blank line ends nothing in `configparser`; it becomes part of a
      // continued value only when the value continues after it, which the
      // readers below never depend on, so it is dropped.
      continue;
    }
    if (/^[#;]/.test(raw)) continue;
    const header = /^\[(.*)\]\s*$/.exec(raw.trim());
    if (header !== null) {
      const name = header[1] as string;
      document[name] = document[name] ?? {};
      section = document[name];
      key = undefined;
      continue;
    }
    const indented = /^[ \t]/.test(raw);
    if (indented && section !== undefined && key !== undefined) {
      section[key] = `${section[key] as string}\n${raw.trim()}`;
      continue;
    }
    const pair = /^([^=:]+?)\s*[=:]\s*(.*)$/.exec(raw);
    if (pair === null) continue;
    if (section === undefined) throw new IniError("File contains no section headers");
    key = (pair[1] as string).trim().toLowerCase();
    section[key] = pair[2] as string;
  }
  const frozen: Record<string, Readonly<Record<string, string>>> = {};
  for (const [name, values] of Object.entries(document)) frozen[name] = Object.freeze(values);
  return Object.freeze(frozen);
}

/** `setup.cfg` (F140-FR-022): metadata name, console scripts, requirements. */
export function setupCfgFacts(relative: string, text: string | undefined): ManifestReading {
  const facts: ManifestFacts = { manifest: relative, kind: "setup.cfg" };
  let ini: IniDocument;
  try {
    ini = parseIni(text ?? "");
  } catch {
    facts["error"] = "unparseable";
    return { facts, dependencies: new Set() };
  }
  const name = ini["metadata"]?.["name"];
  if (name !== undefined) facts["name"] = name;
  const console_scripts = ini["options.entry_points"]?.["console_scripts"];
  if (console_scripts !== undefined) {
    const scripts: Record<string, string> = {};
    for (const line of console_scripts.split("\n")) {
      if (!line.includes("=")) continue;
      const cut = line.indexOf("=");
      scripts[line.slice(0, cut).trim()] = line.slice(cut + 1).trim();
    }
    facts["scripts"] = sortedStringMap(scripts);
  }
  const dependencies = new Set<string>();
  const install_requires = ini["options"]?.["install_requires"];
  if (install_requires !== undefined) {
    for (const line of install_requires.split("\n")) {
      if (line.trim() === "") continue;
      dependencies.add(dependencyName(line.trim()));
    }
  }
  return { facts, dependencies };
}

/* ------------------------------------------------------------------------- *
 * The text-read manifests (F140-FR-022)
 * ------------------------------------------------------------------------- */

/** `go.mod`: the module, the go version and the required module paths. */
export function goModFacts(relative: string, text: string | undefined): ManifestReading {
  const body = text ?? "";
  const facts: ManifestFacts = { manifest: relative, kind: "go.mod" };
  const module = /^module\s+(\S+)/m.exec(body);
  const version = /^go\s+(\S+)/m.exec(body);
  if (module !== null) facts["name"] = module[1] as string;
  if (version !== null) facts["go"] = version[1] as string;
  const dependencies = new Set<string>();
  const required = /^[ \t]*(?:require\s+)?([a-z0-9.-]+\.[a-z]+\/\S+)\s+v/gm;
  for (const hit of body.matchAll(required)) dependencies.add((hit[1] as string).toLowerCase());
  return { facts, dependencies };
}

/**
 * `Cargo.toml` (F140-FR-022). Without a TOML reader this is the manifest and
 * its kind alone: the package name, the `[[bin]]` names, the workspace members
 * and the dependencies all come off the parse the runtime cannot make.
 */
export function cargoFacts(relative: string, data: unknown): ManifestReading {
  const facts: ManifestFacts = { manifest: relative, kind: "Cargo.toml" };
  const dependencies = new Set<string>();
  if (data !== null && data !== undefined && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const name = ((record["package"] ?? {}) as Record<string, unknown>)["name"] ?? null;
    facts["name"] = typeof name === "string" ? name : null;
    const bins = ((record["bin"] ?? []) as unknown[])
      .filter((one) => one !== null && typeof one === "object" && !Array.isArray(one))
      .map((one) => (one as Record<string, unknown>)["name"]);
    if (bins.length > 0) {
      const named: Record<string, string> = {};
      for (const one of sortedNames(bins)) named[one] = "";
      facts["bin"] = named;
    }
    const members = ((record["workspace"] ?? {}) as Record<string, unknown>)["members"];
    if (Array.isArray(members)) facts["workspaces"] = members.map((one) => String(one));
    for (const key of ["dependencies", "dev-dependencies"] as const) {
      for (const dependency of Object.keys((record[key] ?? {}) as Record<string, unknown>)) {
        dependencies.add(dependency.toLowerCase());
      }
    }
  }
  return { facts, dependencies };
}

/** `pom.xml`, `build.gradle`, `build.gradle.kts`: the first `<artifactId>`. */
export function jvmFacts(relative: string, text: string | undefined): ManifestReading {
  const facts: ManifestFacts = { manifest: relative, kind: baseNameOf(relative) };
  const artifact = /<artifactId>([^<]+)<\/artifactId>/.exec(text ?? "");
  if (artifact !== null) facts["name"] = artifact[1] as string;
  return { facts, dependencies: new Set() };
}

/** A Dockerfile: `FROM`, `ENTRYPOINT`, `CMD` and `EXPOSE` (F140-FR-022). */
export function dockerfileFacts(relative: string, text: string | undefined): ManifestReading {
  const facts: ManifestFacts = { manifest: relative, kind: "Dockerfile" };
  for (const key of ["FROM", "ENTRYPOINT", "CMD", "EXPOSE"] as const) {
    const pattern = new RegExp(String.raw`^\s*${key}\s+(.+?)\s*$`, "gim");
    const values = [...(text ?? "").matchAll(pattern)].map((hit) => hit[1] as string);
    if (values.length > 0) facts[key.toLowerCase()] = values;
  }
  return { facts, dependencies: new Set() };
}

/** A compose file: the sorted service names (F140-FR-022). */
export function composeFacts(relative: string, text: string | undefined): ManifestReading {
  const facts: ManifestFacts = { manifest: relative, kind: "compose" };
  const services: string[] = [];
  let inServices = false;
  for (const line of (text ?? "").split(/\r\n|\n|\r/)) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (/^\S/.test(line)) {
      inServices = false;
      continue;
    }
    const hit = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line);
    if (hit !== null) services.push(hit[1] as string);
  }
  facts["services"] = sortByCodePoint(services) as string[];
  return { facts, dependencies: new Set() };
}

/** A makefile: the sorted unique targets (F140-FR-022). */
export function makefileFacts(relative: string, text: string | undefined): ManifestReading {
  const targets = [...(text ?? "").matchAll(/^([A-Za-z0-9][A-Za-z0-9_./-]*)\s*:(?!=)/gm)].map(
    (hit) => hit[1] as string,
  );
  return {
    facts: { manifest: relative, kind: "Makefile", targets: sortedNames(targets) as string[] },
    dependencies: new Set(),
  };
}

/** A GitHub workflow: its name and its job ids, in file order (F140-FR-022). */
export function workflowFacts(relative: string, text: string | undefined): ManifestReading {
  const facts: ManifestFacts = { manifest: relative, kind: "workflow" };
  const name = /^name:\s*(.+?)\s*$/m.exec(text ?? "");
  if (name !== null) facts["name"] = (name[1] as string).replace(/^['"]+|['"]+$/g, "");
  const jobs: string[] = [];
  let inJobs = false;
  for (const line of (text ?? "").split(/\r\n|\n|\r/)) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^\S/.test(line)) break;
    const hit = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (hit !== null) jobs.push(hit[1] as string);
  }
  facts["jobs"] = jobs;
  return { facts, dependencies: new Set() };
}

/** The `packages:` globs of a root `pnpm-workspace.yaml` (F140-FR-022). */
export function pnpmWorkspaceGlobs(text: string | undefined): readonly string[] {
  const globs: string[] = [];
  let inPackages = false;
  for (const line of (text ?? "").split(/\r\n|\n|\r/)) {
    if (/^packages:[ \t]*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const hit = /^\s*-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/.exec(line);
    if (hit !== null) {
      globs.push((hit[1] as string).trim());
      continue;
    }
    if (/^\S/.test(line)) inPackages = false;
  }
  return Object.freeze(globs);
}

/* ------------------------------------------------------------------------- *
 * Every manifest of a source
 * ------------------------------------------------------------------------- */

/** One manifest of the source: what was read, and from where. */
export type ReadManifest = {
  /** The source-relative path of the manifest. */
  readonly relative: string;
  /** The facts BEFORE the empty values are dropped; entry points read these. */
  readonly facts: ManifestFacts;
  /** The record the document carries, with the empty values dropped. */
  readonly record: ManifestFacts;
  /** The dependency names the manifest declared, lower-cased. */
  readonly dependencies: ReadonlySet<string>;
};

/** Every manifest of a source, and the workspace globs its roots declared. */
export type ManifestSweep = {
  readonly manifests: readonly ReadManifest[];
  /** The `workspaces` of the ROOT `package.json` and of `pnpm-workspace.yaml`. */
  readonly jsWorkspaceGlobs: readonly string[];
  /** The `workspace.members` of the ROOT `Cargo.toml`. */
  readonly cargoMembers: readonly string[];
  /** Every dependency name of every manifest, lower-cased. */
  readonly dependencies: ReadonlySet<string>;
};

/** Which reader a file name selects, or `undefined` for a non-manifest. */
export function readerFor(relative: string): string | undefined {
  const name = baseNameOf(relative);
  if (name === "package.json") return "package.json";
  if (name === "pyproject.toml") return "pyproject.toml";
  if (name === "setup.cfg") return "setup.cfg";
  if (name === "go.mod") return "go.mod";
  if (name === "Cargo.toml") return "Cargo.toml";
  if (name === "pom.xml" || name === "build.gradle" || name === "build.gradle.kts") return "jvm";
  if (name === "Dockerfile" || name.startsWith("Dockerfile.") || name === "Containerfile") {
    return "Dockerfile";
  }
  if (/^(docker-)?compose[^/]*\.ya?ml$/.test(name)) return "compose";
  if (name === "Makefile" || name === "GNUmakefile") return "Makefile";
  if (
    relative.startsWith(".github/workflows/") &&
    (name.endsWith(".yml") || name.endsWith(".yaml"))
  ) {
    return "workflow";
  }
  if (relative === "pnpm-workspace.yaml") return "pnpm-workspace";
  return undefined;
}

/**
 * Read every manifest of the walked files, in code-point order of their paths
 * (F140-FR-022). A LINK is never read as a manifest: the baseline skipped
 * `entry.get("symlink")`, so a `package.json` that is a link contributes no
 * fact and no dependency.
 */
export function readManifests(src: string, files: readonly FileEntry[]): ManifestSweep {
  const byPath = new Map<string, FileEntry>(files.map((entry) => [entry.path, entry]));
  const manifests: ReadManifest[] = [];
  const jsWorkspaceGlobs: string[] = [];
  const cargoMembers: string[] = [];
  const dependencies = new Set<string>();
  for (const relative of sortByCodePoint(byPath.keys())) {
    const entry = byPath.get(relative) as FileEntry;
    if (entry.symlink === true) continue;
    const reader = readerFor(relative);
    if (reader === undefined) continue;
    const full = join(src, relative);
    let reading: ManifestReading;
    switch (reader) {
      case "package.json": {
        reading = packageJsonFacts(relative, readJson(full));
        const workspaces = reading.facts["workspaces"];
        if (relative === "package.json" && Array.isArray(workspaces)) {
          jsWorkspaceGlobs.push(...workspaces.map((one) => String(one)));
        }
        break;
      }
      case "pyproject.toml":
        reading = pyprojectFacts(relative, readToml(full), readText(full));
        break;
      case "setup.cfg":
        reading = setupCfgFacts(relative, readText(full));
        break;
      case "go.mod":
        reading = goModFacts(relative, readText(full));
        break;
      case "Cargo.toml": {
        reading = cargoFacts(relative, readToml(full));
        const members = reading.facts["workspaces"];
        if (relative === "Cargo.toml" && Array.isArray(members)) {
          cargoMembers.push(...members.map((one) => String(one)));
        }
        break;
      }
      case "jvm":
        reading = jvmFacts(relative, readText(full));
        break;
      case "Dockerfile":
        reading = dockerfileFacts(relative, readText(full));
        break;
      case "compose":
        reading = composeFacts(relative, readText(full));
        break;
      case "Makefile":
        reading = makefileFacts(relative, readText(full));
        break;
      case "workflow":
        reading = workflowFacts(relative, readText(full));
        break;
      default: {
        const globs = pnpmWorkspaceGlobs(readText(full));
        jsWorkspaceGlobs.push(...globs);
        reading = {
          facts: { manifest: relative, kind: "pnpm-workspace", workspaces: [...globs] },
          dependencies: new Set(),
        };
        break;
      }
    }
    for (const dependency of reading.dependencies) dependencies.add(dependency);
    manifests.push(
      Object.freeze({
        relative,
        facts: reading.facts,
        record: withoutEmptyValues(reading.facts),
        dependencies: reading.dependencies,
      }),
    );
  }
  return Object.freeze({
    manifests: Object.freeze(manifests),
    jsWorkspaceGlobs: Object.freeze(jsWorkspaceGlobs),
    cargoMembers: Object.freeze(cargoMembers),
    dependencies,
  });
}

/* ------------------------------------------------------------------------- *
 * `languages` (F140-FR-023)
 * ------------------------------------------------------------------------- */

/**
 * The count of files per language, sorted by language name, WITHOUT `unknown`
 * and `symlink` (F140-FR-023).
 */
export function languagesOf(files: readonly FileEntry[]): Readonly<Record<string, number>> {
  const counted = new Map<string, number>();
  for (const entry of files) {
    if (entry.language === "unknown" || entry.language === "symlink") continue;
    counted.set(entry.language, (counted.get(entry.language) ?? 0) + 1);
  }
  const out: Record<string, number> = {};
  for (const language of sortByCodePoint(counted.keys())) {
    out[language] = counted.get(language) as number;
  }
  return Object.freeze(out);
}

/* ------------------------------------------------------------------------- *
 * The Spec Kit facts (F140-FR-024)
 * ------------------------------------------------------------------------- */

/** Whether a path is a directory, following links as `os.path.isdir` does. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Whether a path is a regular file, following links as `os.path.isfile` does. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** What the source's existing Spec Kit state is (F140-FR-024). */
export type SpecifyFacts = {
  readonly present: boolean;
  readonly constitution: boolean;
  readonly templates: readonly string[];
  readonly feature_json: JsonValue | null;
  readonly spec_numbers: readonly number[];
};

/**
 * The existing spec numbers of the source: the leading number of THREE OR
 * MORE digits of every DIRECTORY under `specs/` named `<digits>-...`, as an
 * integer, sorted. A file is ignored (F140-FR-024).
 */
export function existingSpecNumbers(src: string): readonly number[] {
  const specs = join(src, "specs");
  if (!isDirectory(specs)) return Object.freeze([]);
  const numbers = new Set<number>();
  let names: readonly string[];
  try {
    names = readdirSync(specs);
  } catch {
    return Object.freeze([]);
  }
  for (const name of names) {
    const hit = /^(\d{3,})-/.exec(name);
    if (hit === null) continue;
    if (!isDirectory(join(specs, name))) continue;
    numbers.add(Number.parseInt(hit[1] as string, 10));
  }
  return Object.freeze([...numbers].sort((a, b) => a - b));
}

/**
 * The Spec Kit facts of the source, read from the FILE SYSTEM DIRECTLY and
 * not from the walk (F140-FR-024) — `specs/` is often git-ignored, so the walk
 * would not see it.
 */
export function specifyFacts(src: string): SpecifyFacts {
  const root = join(src, ".specify");
  const templates = join(root, "templates");
  let names: readonly string[] = [];
  if (isDirectory(templates)) {
    try {
      names = readdirSync(templates);
    } catch {
      names = [];
    }
  }
  const feature = readJson(join(root, "feature.json"));
  return Object.freeze({
    present: isDirectory(root),
    constitution: isFile(join(root, "memory", "constitution.md")),
    templates: sortByCodePoint(names.filter((name) => name.endsWith(".md"))),
    feature_json:
      feature !== null &&
      feature !== undefined &&
      typeof feature === "object" &&
      !Array.isArray(feature)
        ? (feature as JsonValue)
        : null,
    spec_numbers: existingSpecNumbers(src),
  });
}
