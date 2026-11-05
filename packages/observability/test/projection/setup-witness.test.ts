/**
 * T001 — the witness of the setup of feature 144, read back from disk.
 *
 * The task asks for the folder of the projection,
 * `packages/observability/src/projection/`, in the package
 * `@specstride/observability` (layer L1, owners 111, 128 and 144 in the package
 * graph of feature 100; it may import `@specstride/contracts` and
 * `@specstride/kernel`), and for the package to hold a `package.json` with no
 * install script, a `tsconfig.json` and a test script.
 *
 * Nothing here trusts the pass that wrote the files. Every claim is read back
 * through an independent path: the file system for the folder and the manifest,
 * `packages/contracts/data/package-graph.json` for the layer, the owners and
 * the allowed imports, and a SHA-256 over the sources of the folder as the
 * durable identity of its content.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { PROJECTION_DATA_DIRECTORY, PROJECTION_TABLE_FILE } from "../../src/projection/data.ts";

/** The root of the repository: four levels up from `test/projection`. */
const ROOT = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));

/** The folder of the projection T001 creates. */
const PROJECTION_SOURCE_DIRECTORY = join(ROOT, "packages/observability/src/projection");

/** The scripts a package of this feature must not have ("no install script"). */
const INSTALL_SCRIPTS = [
  "install",
  "preinstall",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly",
] as const;

type GraphEntry = {
  readonly name: string;
  readonly core?: boolean;
  readonly layer?: string;
  readonly owner?: string;
  readonly mayImport?: readonly string[];
};

function graph(): readonly GraphEntry[] {
  const file = join(ROOT, "packages/contracts/data/package-graph.json");
  return (JSON.parse(readFileSync(file, "utf8")) as { packages: GraphEntry[] }).packages;
}

/** Every TypeScript source under a directory, depth first, sorted. */
function sourcesUnder(directory: string, out: string[] = []): string[] {
  if (!existsSync(directory)) return out;
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    if (entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) sourcesUnder(path, out);
    else if (/\.ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** The module specifiers a source file imports, with the line of each. */
function importsOf(file: string): readonly { readonly spec: string; readonly line: number }[] {
  const out: { spec: string; line: number }[] = [];
  for (const [index, text] of readFileSync(file, "utf8").split("\n").entries()) {
    const code = text.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
    for (const match of code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      if (match[1] !== undefined) out.push({ spec: match[1], line: index + 1 });
    }
  }
  return Object.freeze(out);
}

test("T001: packages/observability/src/projection/ is a folder that holds source", () => {
  assert.equal(
    existsSync(PROJECTION_SOURCE_DIRECTORY),
    true,
    `${PROJECTION_SOURCE_DIRECTORY} exists`,
  );
  assert.equal(
    statSync(PROJECTION_SOURCE_DIRECTORY).isDirectory(),
    true,
    "the projection is a folder, not a file",
  );
  const sources = sourcesUnder(PROJECTION_SOURCE_DIRECTORY);
  assert.ok(sources.length > 0, "the folder holds at least one TypeScript source");
  // The durable identity of the folder: a digest over the path and bytes of
  // every source, which could not exist before the folder did.
  const digest = createHash("sha256");
  for (const file of sources) {
    digest.update(relative(ROOT, file).replace(/\\/g, "/"));
    digest.update(readFileSync(file));
  }
  assert.match(digest.digest("hex"), /^[0-9a-f]{64}$/, "the folder has a content digest");
});

test("T001: the folder is reachable from the manifest of the package", () => {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "packages/observability/package.json"), "utf8"),
  ) as { exports?: Record<string, string> };
  const exported = Object.entries(manifest.exports ?? {}).filter(([, target]) =>
    target.startsWith("./src/projection/"),
  );
  assert.ok(exported.length > 0, "the manifest exports at least one module of the projection");
  for (const [, target] of exported) {
    assert.equal(
      existsSync(join(ROOT, "packages/observability", target)),
      true,
      `the export target ${target} is a file`,
    );
  }
});

test("T001: the package holds a package.json with no install script and a test script", () => {
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
  assert.equal(typeof scripts["test"], "string", "the manifest has a test script");
  assert.match(scripts["test"] ?? "", /node --test/, "the test script runs the Node test runner");
  // The glob of the test script collects the folder the checks of this feature
  // live in: the checks are IN THE BUILD, not beside it.
  assert.match(
    scripts["test"] ?? "",
    /test\/\*\*\/\*\.test\./,
    "the test script collects test/projection/ too",
  );
});

test("T001: the package holds a tsconfig.json that extends the base and compiles src and test", () => {
  const file = join(ROOT, "packages/observability/tsconfig.json");
  assert.equal(existsSync(file), true, `${file} exists`);
  const config = JSON.parse(readFileSync(file, "utf8")) as {
    extends?: string;
    include?: string[];
  };
  assert.equal(config.extends, "../../tsconfig.base.json");
  assert.deepEqual(config.include, ["src", "test"], "src and test are compiled");
});

test("T001: the package graph puts @specstride/observability on L1, owners 111, 128 and 144", () => {
  const entry = graph().find((candidate) => candidate.name === "@specstride/observability");
  assert.ok(entry !== undefined, "@specstride/observability is a package of the graph");
  assert.equal(entry.layer, "L1", "the package is on layer L1");
  assert.deepEqual(
    (entry.owner ?? "")
      .split(",")
      .map((owner) => owner.trim())
      .sort(),
    ["111", "128", "144"],
    "the owners of the package are features 111, 128 and 144",
  );
  assert.deepEqual(
    [...(entry.mayImport ?? [])].sort(),
    ["@specstride/contracts", "@specstride/kernel"],
    "the package may import the contracts and the kernel, and nothing else",
  );
  assert.notEqual(entry.core, true, "the package is not core: the projection is an edge");
});

test("T001: the sources of the projection import only what the graph allows", () => {
  const allowed = ["@specstride/contracts", "@specstride/kernel"];
  const sources = sourcesUnder(PROJECTION_SOURCE_DIRECTORY);
  assert.ok(sources.length > 0, "there is source to check");
  const violations: string[] = [];
  for (const file of sources) {
    for (const { spec, line } of importsOf(file)) {
      if (spec.startsWith(".") || spec.startsWith("node:")) continue;
      if (allowed.some((name) => spec === name || spec.startsWith(`${name}/`))) continue;
      violations.push(`${relative(ROOT, file)}:${line} imports ${spec}`);
    }
  }
  assert.deepEqual(violations, [], "no import the package graph forbids");
});

test("T001, T002: the data folder of the projection is this package's own", () => {
  assert.equal(existsSync(PROJECTION_DATA_DIRECTORY), true, `${PROJECTION_DATA_DIRECTORY} exists`);
  assert.equal(
    statSync(PROJECTION_DATA_DIRECTORY).isDirectory(),
    true,
    "the data folder is a folder",
  );
  assert.equal(
    relative(ROOT, PROJECTION_DATA_DIRECTORY).replace(/\\/g, "/"),
    "packages/observability/data/projection",
    "the copy of the table is in packages/observability/data/projection/",
  );
  assert.equal(existsSync(PROJECTION_TABLE_FILE), true, `${PROJECTION_TABLE_FILE} exists`);
});
