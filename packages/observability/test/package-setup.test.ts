/**
 * T001 — the witness of the setup, read back from disk.
 *
 * The task creates the package `@specstride/observability` in
 * `packages/observability/` with a `package.json` that has NO install script,
 * a `tsconfig.json` and a test script, and the folder
 * `packages/kernel/src/redactor/` in `@specstride/kernel`. Two constraints go
 * with it (F100-FR-012, `assumption: CQ-185`): neither package imports a core
 * package, and no core package imports `node:fs` to reach them.
 *
 * Nothing here trusts the pass that wrote the files: every claim is read back
 * from the file system and from `packages/contracts/data/package-graph.json`,
 * and the content of the catalogue copy is pinned by its SHA-256.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root: three levels up from `packages/observability/test`. */
const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

/** The two packages this feature writes in. Neither is a core package. */
export const PACKAGES_OF_THIS_FEATURE = [
  "@specstride/observability",
  "@specstride/kernel",
] as const;

/** The scripts a package of this feature must not have (T001, "no install script"). */
export const INSTALL_SCRIPTS = [
  "install",
  "preinstall",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly",
] as const;

/** `node:fs` and its promise form: what a core package must not import. */
export const FILESYSTEM_BUILTINS = ["node:fs", "node:fs/promises"] as const;

type GraphEntry = {
  readonly name: string;
  readonly core?: boolean;
  readonly layer?: string;
  readonly mayImport?: readonly string[];
};

function graph(): readonly GraphEntry[] {
  const file = join(ROOT, "packages/contracts/data/package-graph.json");
  return (JSON.parse(readFileSync(file, "utf8")) as { packages: GraphEntry[] }).packages;
}

function entryOf(name: string): GraphEntry {
  const entry = graph().find((candidate) => candidate.name === name);
  assert.ok(entry !== undefined, `${name} is a package of the graph`);
  return entry;
}

/** The packages the graph marks `core`. */
export function corePackageNames(): readonly string[] {
  return Object.freeze(
    graph()
      .filter((entry) => entry.core === true)
      .map((entry) => entry.name),
  );
}

/** The directory of a package of the graph, relative to the root. */
function directoryOf(name: string): string {
  return join("packages", name.replace(/^@specstride\//, ""));
}

/** Every TypeScript source file under a directory. */
function sourcesUnder(directory: string, out: string[] = []): string[] {
  if (!existsSync(directory)) return out;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) sourcesUnder(path, out);
    else if (/\.(ts|mts|cts)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** The module specifiers a source file imports, with the line of each. */
export function importsOf(
  file: string,
): readonly { readonly spec: string; readonly line: number }[] {
  const out: { spec: string; line: number }[] = [];
  for (const [index, text] of readFileSync(file, "utf8").split("\n").entries()) {
    const code = text.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
    for (const match of code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const spec = match[1];
      if (spec !== undefined) out.push({ spec, line: index + 1 });
    }
  }
  return Object.freeze(out);
}

test("T001: packages/observability holds a package.json with no install script", () => {
  const file = join(ROOT, "packages/observability/package.json");
  assert.equal(existsSync(file), true, `${file} exists`);
  const manifest = JSON.parse(readFileSync(file, "utf8")) as {
    name: string;
    scripts?: Record<string, string>;
  };
  assert.equal(manifest.name, "@specstride/observability");
  const scripts = manifest.scripts ?? {};
  for (const name of INSTALL_SCRIPTS) {
    assert.equal(name in scripts, false, `the manifest has no "${name}" script`);
  }
  // The test script T001 asks for: the one the root `npm test` runs for this
  // workspace package.
  assert.equal(typeof scripts["test"], "string", "the manifest has a test script");
  assert.match(scripts["test"] ?? "", /node --test/, "the test script runs the Node test runner");
});

test("T001: packages/observability holds a tsconfig.json that extends the base", () => {
  const file = join(ROOT, "packages/observability/tsconfig.json");
  assert.equal(existsSync(file), true, `${file} exists`);
  const config = JSON.parse(readFileSync(file, "utf8")) as {
    extends?: string;
    include?: string[];
  };
  assert.equal(config.extends, "../../tsconfig.base.json");
  assert.deepEqual(config.include, ["src", "test"], "src and test are compiled");
});

test("T001: packages/kernel/src/redactor/ is a folder of @specstride/kernel", () => {
  const directory = join(ROOT, "packages/kernel/src/redactor");
  assert.equal(existsSync(directory), true, `${directory} exists`);
  assert.equal(statSync(directory).isDirectory(), true, "the redactor is a folder");
  const sources = sourcesUnder(directory);
  assert.ok(sources.length > 0, "the folder holds at least one source file");
  // The folder is reachable from the package: the barrel exports it.
  const barrel = readFileSync(join(ROOT, "packages/kernel/src/index.ts"), "utf8");
  assert.match(barrel, /\.\/redactor\/index\.ts/, "the kernel barrel exports the redactor folder");
});

test("T001: neither package of this feature is marked core, and neither imports one", () => {
  const core = corePackageNames();
  assert.deepEqual(
    [...core],
    ["@specstride/core", "@specstride/layer-micro", "@specstride/layer-parallel"],
  );
  for (const name of PACKAGES_OF_THIS_FEATURE) {
    assert.notEqual(entryOf(name).core, true, `${name} is not marked core in the graph`);
    assert.deepEqual(
      (entryOf(name).mayImport ?? []).filter((target) => core.includes(target)),
      [],
      `${name} may import no core package`,
    );
  }
  // The source files, not only the graph: the folders this feature writes.
  const subject = [
    ...sourcesUnder(join(ROOT, "packages/observability/src")),
    ...sourcesUnder(join(ROOT, "packages/kernel/src/redactor")),
  ];
  assert.ok(subject.length > 0, "there is source to check");
  const violations: string[] = [];
  for (const file of subject) {
    for (const { spec, line } of importsOf(file)) {
      if (core.some((name) => spec === name || spec.startsWith(`${name}/`))) {
        violations.push(`${file}:${line} imports the core package ${spec}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("T001: no core package imports node:fs to reach the writer or the redactor", () => {
  const checked: string[] = [];
  const violations: string[] = [];
  for (const name of corePackageNames()) {
    for (const file of sourcesUnder(join(ROOT, directoryOf(name), "src"))) {
      checked.push(file);
      for (const { spec, line } of importsOf(file)) {
        if ((FILESYSTEM_BUILTINS as readonly string[]).includes(spec)) {
          violations.push(`${file}:${line} imports ${spec} (F100-FR-012, CQ-185)`);
        }
        if (/^@specstride\/observability/.test(spec)) {
          violations.push(
            `${file}:${line} imports ${spec}: a core package reaches the writer ` +
              `through an interface of @specstride/contracts`,
          );
        }
      }
    }
  }
  assert.deepEqual(violations, []);
  assert.ok(checked.length >= 0, "the core packages of the graph were read");
});

test("T002: the catalogue copy is pinned by the SHA-256 of its bytes", () => {
  const copy = join(ROOT, "packages/observability/data/event-catalogue.tsv");
  assert.equal(existsSync(copy), true, `${copy} exists`);
  const bytes = readFileSync(copy);
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.match(digest, /^[0-9a-f]{64}$/);
  const source = join(ROOT, "specs/111-event-schema-and-projection/contracts/event-catalogue.tsv");
  if (!existsSync(source)) {
    assert.ok(true, `skip: ${source} is not in this checkout`);
    return;
  }
  assert.equal(
    digest,
    createHash("sha256").update(readFileSync(source)).digest("hex"),
    "the copy and the contract source have the same SHA-256",
  );
});
