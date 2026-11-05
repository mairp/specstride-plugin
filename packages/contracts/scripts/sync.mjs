#!/usr/bin/env node
/**
 * T008 — copy the machine-readable form of the annexes into the package.
 *
 * Copies `specs/100-specstride/contracts/schemas/` into
 * `packages/contracts/schemas/` and `specs/100-specstride/contracts/data/`
 * into `packages/contracts/data/`.
 *
 * T299 — after the two clean copies it DELIVERS the data and schema files of
 * the other features: the `contracts/deliver.json` of every feature directory
 * under `specs/`, sorted by directory name, feature 100 skipped. The file holds
 * the keys `data` and `schemas`, each a map from the target name in the package
 * to a path relative to that feature's `contracts/`. Each entry is copied and verified byte for
 * byte, and the count of delivered files stands in the final line. The sync
 * fails with exit 1 when a target already exists (a file of feature 100, or a
 * file another feature delivered), when two features name the same target, or
 * when a source is missing. The sync is the one writer of the package
 * directories (`contracts/README.md`, "How the files are made").
 *
 * The files are generated from the annexes by the generator of the workspace
 * (`contracts/README.md`, "How the files are made"). This script refuses to
 * copy when the generator check fails (`npm run contracts:check`, which is
 * `node tools/contracts-gen/src/main.ts --check`, F100-FR-038): a file that
 * differs from the annexes is never placed in the package.
 *
 * Since T207 the check is the TypeScript tool of the workspace, not the retired
 * Python script of the specification: Python 3 is no requirement of development
 * (Principle VI; ruling 18; CQ-186). T293 proved the two generators write
 * byte-identical files (`tools/contracts-gen/test/byte-identical.test.ts`).
 *
 * Usage: node scripts/sync.mjs   (from anywhere; paths resolve from this file)
 * Exit codes: 0 copied and verified, 1 the generator check failed or the copy
 * could not be verified, 2 environment error (a missing source, or the
 * generator of the workspace is absent).
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const PKG_DIR = resolve(dirname(dirname(fileURLToPath(import.meta.url)))); // packages/contracts
const ROOT = resolve(dirname(dirname(PKG_DIR))); // repository root
const SPEC_DIR = join(ROOT, "specs/100-specstride/contracts");
const SPECS_DIR = join(ROOT, "specs");
/** The feature whose `contracts/` IS the two clean copies; it delivers nothing. */
const OWN_FEATURE = "100-specstride";

function fail(message, code = 1) {
  process.stderr.write(`sync: ${message}\n`);
  process.exit(code);
}

/**
 * The generator check, run by the TypeScript tool of the workspace since T207
 * (`tools/contracts-gen/src/main.ts --check`). Needs Node only: no Python 3,
 * and therefore no interpreter of a second language on any runner of the build.
 * Exits this process on failure. Returns the path of the tool it ran, relative
 * to the root, for the line the caller prints.
 */
export function runGeneratorCheck() {
  const tool = join(ROOT, "tools/contracts-gen/src/main.ts");
  if (!existsSync(tool)) {
    fail(`the generator of the workspace is missing: ${tool} (T207)`, 2);
  }
  const result = spawnSync(process.execPath, [tool, "--check"], { cwd: ROOT, encoding: "utf8" });
  if (result.error) {
    fail(`the generator of the workspace could not be run: ${result.error.message}`, 2);
  }
  process.stdout.write(result.stdout ?? "");
  if (result.stderr) process.stdout.write(result.stderr);
  if (result.status !== 0) {
    fail(
      `the generator check failed (exit ${result.status}); ` +
        "the annexes and the files differ, and nothing is copied (F100-FR-038)",
    );
  }
  return relative(ROOT, tool);
}

/** Every file of a directory tree, relative to it, sorted. */
function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = entry.name;
    if (entry.isDirectory()) out.push(...listFiles(join(dir, rel)).map((f) => `${rel}/${f}`));
    else out.push(rel);
  }
  return out.sort();
}

/** Clean-copy src into dst and verify every file byte for byte. */
function syncDir(src, dst) {
  if (!existsSync(src) || !statSync(src).isDirectory())
    fail(`source directory is missing: ${src}`, 2);
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
  const files = listFiles(src);
  for (const rel of files) {
    const from = readFileSync(join(src, rel));
    const to = readFileSync(join(dst, rel));
    if (!from.equals(to))
      fail(`the copy of ${relative(ROOT, join(dst, rel))} differs from the source`);
  }
  if (listFiles(dst).join("\n") !== files.join("\n"))
    fail(`the copy of ${relative(ROOT, dst)} holds a different file set`);
  return files.length;
}

/* ------------------------------------------------------------------ *
 * T299 — the files of other features (plan.md, "Files of other features in
 * the `contracts` package"; `contracts/README.md`, "How the files are made").
 * ------------------------------------------------------------------ */

/** The two keys of a `deliver.json`, and the package directory each targets. */
const DELIVERY_KEYS = Object.freeze({ data: "data", schemas: "schemas" });

/**
 * Every feature that carries a `contracts/deliver.json`, sorted by directory
 * name, feature 100 skipped. Its own `contracts/` is the two clean copies.
 */
export function featuresThatDeliver(specsDir = SPECS_DIR) {
  if (!existsSync(specsDir)) return [];
  return readdirSync(specsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== OWN_FEATURE)
    .map((entry) => entry.name)
    .sort()
    .filter((name) => existsSync(join(specsDir, name, "contracts/deliver.json")));
}

/** Read and check the shape of one `deliver.json`. */
function readDeliveryFile(feature, specsDir) {
  const file = join(specsDir, feature, "contracts/deliver.json");
  const shown = relative(ROOT, file);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    fail(`${shown} cannot be read as JSON (${String(err)})`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail(`${shown} holds one JSON object`);
  }
  const entries = [];
  for (const key of Object.keys(DELIVERY_KEYS)) {
    const map = parsed[key];
    if (map === undefined) continue; // a feature may deliver only one of the two
    if (typeof map !== "object" || map === null || Array.isArray(map)) {
      fail(`${shown}: the key \`${key}\` is a map from the target name to a path`);
    }
    for (const target of Object.keys(map).sort()) {
      const source = map[target];
      if (typeof source !== "string" || source.trim() === "") {
        fail(`${shown}: the target \`${target}\` names no source path`);
      }
      if (target.includes("/") || target.includes("..")) {
        fail(`${shown}: the target \`${target}\` is a file name of the package, not a path`);
      }
      entries.push({
        feature,
        key,
        target,
        source,
        sourceFile: join(specsDir, feature, "contracts", source),
        deliverFile: shown,
      });
    }
  }
  return entries;
}

/**
 * Deliver the data and schema files of every other feature into the package.
 * Fails with exit 1 when a target already exists, when two features name the
 * same target, or when a source is missing; verifies each delivered file byte
 * for byte. Returns the count of delivered files.
 */
export function deliverOtherFeatures(specsDir = SPECS_DIR, pkgDir = PKG_DIR) {
  const claimedBy = new Map(); // "<key>/<target>" -> the feature that claimed it
  let delivered = 0;
  for (const feature of featuresThatDeliver(specsDir)) {
    for (const entry of readDeliveryFile(feature, specsDir)) {
      const slot = `${entry.key}/${entry.target}`;
      const dst = join(pkgDir, entry.key, entry.target);

      // Two features naming the same target.
      const owner = claimedBy.get(slot);
      if (owner !== undefined) {
        fail(
          `${entry.deliverFile}: the target ${entry.key}/${entry.target} was already ` +
            `delivered by feature ${owner}; two features must not name the same target`,
        );
      }
      // A target that already exists: a file of feature 100's clean copy.
      if (existsSync(dst)) {
        fail(
          `${entry.deliverFile}: the target ${entry.key}/${entry.target} already exists in ` +
            `${relative(ROOT, pkgDir)}; a delivered file must not overwrite a file of the package`,
        );
      }
      // A missing source.
      if (!existsSync(entry.sourceFile)) {
        fail(
          `${entry.deliverFile}: the source ${entry.source} of the target ` +
            `${entry.key}/${entry.target} is missing (${relative(ROOT, entry.sourceFile)})`,
        );
      }
      cpSync(entry.sourceFile, dst);
      // Verified byte for byte, as the two clean copies are.
      const from = readFileSync(entry.sourceFile);
      const to = readFileSync(dst);
      if (!from.equals(to)) {
        fail(`the delivered copy of ${relative(ROOT, dst)} differs from the source`);
      }
      claimedBy.set(slot, feature);
      delivered++;
      process.stdout.write(
        `sync: delivered ${entry.key}/${entry.target} from ${feature} (${entry.source})\n`,
      );
    }
  }
  return delivered;
}

function main() {
  const tool = runGeneratorCheck();
  process.stdout.write(`sync: generator check passed (${tool})\n`);
  const schemas = syncDir(join(SPEC_DIR, "schemas"), join(PKG_DIR, "schemas"));
  const data = syncDir(join(SPEC_DIR, "data"), join(PKG_DIR, "data"));
  process.stdout.write(
    `sync: ${schemas} schema files -> ${relative(ROOT, join(PKG_DIR, "schemas"))}/, ` +
      `${data} data files -> ${relative(ROOT, join(PKG_DIR, "data"))}/ (verified byte for byte)\n`,
  );
  // T299 — the files of other features, after the two clean copies.
  const delivered = deliverOtherFeatures();
  process.stdout.write(
    `sync: ${delivered} file(s) delivered from other features (verified byte for byte)\n`,
  );
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("sync.mjs")) main();
