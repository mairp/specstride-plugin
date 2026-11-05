/**
 * T071 — the STATIC test of the import rules of the parallel engine
 * services (rules PU-06 and PU-07; research.md D-5).
 *
 * What this test observes, by reading the source files and starting no
 * process and touching no file:
 *
 *  1 NO FILE OF `packages/core/src/parallel` STARTS A PROCESS: none of
 *    them imports `node:child_process` (or its older spellings), none of
 *    them imports `node:worker_threads`, and none of them names a call
 *    that would start or signal one (`spawn`, `spawnSync`, `exec`,
 *    `execFile`, `fork`, `kill`);
 *  2 NO FILE OF `packages/core/src/parallel` IMPORTS `node:fs` OR
 *    `node:fs/promises` (or `node:fs` in any of its forms): the core
 *    modules are pure and take ports (phase 3, decision 1);
 *  3 THE TREE STORE IS REACHED ONLY THROUGH ITS INTERFACE (F100-FR-234;
 *    research.md D-5): no file of `packages/core/src/parallel` imports
 *    `@specstride/tree-store` or reaches into `packages/tree-store` by a
 *    relative path; the one import of the store the core names is
 *    `@specstride/contracts/ep/tree-store`, the interface of the
 *    contracts package.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The root of the repository, computed from this file's own URL. */
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

/** The directory the first two rules are about. */
const CORE_PARALLEL = join(REPO_ROOT, "packages", "core", "src", "parallel");

/** Every `.ts` file under `directory`, recursively, as absolute paths. */
function typescriptFilesUnder(directory: string): readonly string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts")) out.push(full);
    }
  };
  walk(directory);
  return out;
}

/** The static `import`/`export ... from` and dynamic `import(...)` specifiers of a file. */
function importedSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = [];
  const froms = source.matchAll(/(?:^|\n)\s*(?:import|export)[^\n]*?from\s*["']([^"']+)["']/g);
  for (const m of froms) specifiers.push(m[1] as string);
  const sideEffects = source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g);
  for (const m of sideEffects) specifiers.push(m[1] as string);
  const dynamics = source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g);
  for (const m of dynamics) specifiers.push(m[1] as string);
  const requires = source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g);
  for (const m of requires) specifiers.push(m[1] as string);
  return specifiers;
}

/** True where the specifier names the module `node:` name, whatever the spelling. */
function importsModule(specifiers: readonly string[], ...names: readonly string[]): boolean {
  return specifiers.some((s) =>
    names.some(
      (n) => s === n || s === `node:${n}` || s.startsWith(`${n}/`) || s.startsWith(`node:${n}/`),
    ),
  );
}

/** The process modules, in every spelling the code base could use. */
const PROCESS_MODULES = ["child_process", "worker_threads"] as const;

/** The file-system modules, in every spelling the code base could use. */
const FS_MODULES = ["fs", "fs/promises"] as const;

/** The call names that start or signal a process, as whole words. */
const PROCESS_CALLS =
  /\b(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork|kill|killSync)\s*\(/;

test("T071 no file of packages/core/src/parallel imports node:fs, node:fs/promises or a process module", () => {
  const files = typescriptFilesUnder(CORE_PARALLEL);
  assert.ok(files.length > 0, "the directory of the parallel engine services is not empty");
  const violations: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const specifiers = importedSpecifiers(source);
    const rel = relative(REPO_ROOT, file).split(sep).join("/");
    if (importsModule(specifiers, ...FS_MODULES)) {
      violations.push(`${rel}: imports ${FS_MODULES.join(" or ")}`);
    }
    if (importsModule(specifiers, ...PROCESS_MODULES)) {
      violations.push(`${rel}: imports ${PROCESS_MODULES.join(" or ")}`);
    }
    if (/\bprocess\s*\.\s*(kill|chdir|dlopen)\s*\(/.test(source)) {
      violations.push(`${rel}: calls process.kill/chdir/dlopen`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `the core's parallel modules must stay pure:\n${violations.join("\n")}`,
  );
});

test("T071 no file of packages/core/src/parallel starts a process, by call name either", () => {
  const violations: string[] = [];
  for (const file of typescriptFilesUnder(CORE_PARALLEL)) {
    const source = readFileSync(file, "utf8");
    const rel = relative(REPO_ROOT, file).split(sep).join("/");
    const call = PROCESS_CALLS.exec(source);
    if (call !== null) violations.push(`${rel}: names the call \`${call[1] ?? ""}(\``);
  }
  assert.deepEqual(
    violations,
    [],
    `the core may not start a process (research.md D-5, architecture section 6):\n${violations.join("\n")}`,
  );
});

test("T071 the core reaches the tree store only through its interface", () => {
  const violations: string[] = [];
  let interfaceImports = 0;
  for (const file of typescriptFilesUnder(CORE_PARALLEL)) {
    const source = readFileSync(file, "utf8");
    const rel = relative(REPO_ROOT, file).split(sep).join("/");
    for (const specifier of importedSpecifiers(source)) {
      if (specifier === "@specstride/contracts/ep/tree-store") {
        interfaceImports += 1;
        continue;
      }
      if (specifier.startsWith("@specstride/tree-store")) {
        violations.push(`${rel}: imports the implementation ${specifier}`);
      }
      if (specifier.startsWith(".")) {
        // A relative path may not leave the parallel directory towards the edge.
        const resolved = relative(REPO_ROOT, join(file, "..", specifier))
          .split(sep)
          .join("/");
        if (resolved.startsWith("packages/tree-store")) {
          violations.push(`${rel}: reaches the edge package by the path ${specifier}`);
        }
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `the tree store is reached only through its interface (F100-FR-234):\n${violations.join("\n")}`,
  );
  assert.ok(
    interfaceImports > 0,
    "the core names the interface @specstride/contracts/ep/tree-store, which is the only door",
  );
});

test("T071 the interface is the one the contracts package states, not a local copy", () => {
  // The core must receive the store through `@specstride/contracts`; the
  // contracts module must exist and export the point id of the store.
  const interfaceModule = join(REPO_ROOT, "packages", "contracts", "src", "ep", "tree-store.ts");
  assert.ok(
    statSync(interfaceModule).isFile(),
    "packages/contracts/src/ep/tree-store.ts is the interface of the store",
  );
  const source = readFileSync(interfaceModule, "utf8");
  assert.match(source, /specstride\.tree-store\/1/, "the point id of the store service");
});
