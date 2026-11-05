/**
 * T064 — the staging writer of the packed package `specstride` (F119-FR-056).
 *
 * It builds, in `dist/pack/`, the exact tree the published package carries:
 *
 * - `bin/specstride` — the executable; it lazily imports the bundle and ends
 *   with the code the front door returns, 70 on an uncaught error;
 * - `dist/cli/specstride.mjs` — the ONE bundled ESM file (built first by
 *   `rollup -c`, the bundler of the plan);
 * - `data/` — the read-only data assets the bundle reads by path (the event
 *   catalogue of `@specstride/observability` at load, the redaction pattern
 *   sets of `@specstride/kernel` and the export/projection tables); the file
 *   layout is the one the bundled modules compute from the package root; the
 *   plan data of `@specstride/harness` and the data of `@specstride/adapter-dsh`
 *   sit there too, because the bundle reads them;
 * - `dist/data/mode-phrases.json` — the phrase table of `@specstride/learning`.
 *
 * The staged manifest pins the version and the licence, names NO dependency,
 * NO development dependency (no tool of the build — rollup and friends stay
 * behind), and defines NO script, so the packed package has no install
 * script for `npm install --ignore-scripts` to skip.
 *
 * The staging is a build artifact: it is regenerated from scratch on every
 * run and nothing in the source tree is touched.
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageDirectory, "..", "..");
const distDirectory = join(packageDirectory, ".build");
const staging = join(distDirectory, "pack");

/** The version and licence the build pins (plan: "Build"; research decision 10). */
const VERSION = "0.1.0";
const LICENSE = "Apache-2.0";

function copyAsset(from, to) {
  const stats = statSync(from);
  if (stats.isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) copyAsset(join(from, entry), join(to, entry));
    return;
  }
  copyFileSync(from, to);
}

// 1. The bundle itself: one ESM file, built by the build (rollup), now.
execFileSync(
  process.execPath,
  [join(repositoryRoot, "node_modules", "rollup", "dist", "bin", "rollup"), "-c", "--silent"],
  {
    cwd: packageDirectory,
    stdio: "inherit",
  },
);

// 2. The staging tree, regenerated from scratch.
rmSync(staging, { recursive: true, force: true });
mkdirSync(join(staging, "bin"), { recursive: true });
mkdirSync(join(staging, "dist", "cli"), { recursive: true });
mkdirSync(join(staging, "dist", "data"), { recursive: true });
mkdirSync(join(staging, "data"), { recursive: true });

// The pack root must not inherit the workspace .gitignore rules (the `dist`
// tree of the staging is the payload, not a build artifact to hide).
writeFileSync(join(staging, ".npmignore"), "");

copyFileSync(
  join(distDirectory, "cli", "specstride.mjs"),
  join(staging, "dist", "cli", "specstride.mjs"),
);
copyAsset(
  join(repositoryRoot, "packages", "learning", "data", "mode-phrases.json"),
  join(staging, "dist", "data", "mode-phrases.json"),
);
copyAsset(join(repositoryRoot, "packages", "observability", "data"), join(staging, "data"));
copyAsset(join(repositoryRoot, "packages", "kernel", "data"), join(staging, "data"));
copyAsset(join(repositoryRoot, "packages", "harness", "data"), join(staging, "data"));
copyAsset(join(repositoryRoot, "packages", "adapter-dsh", "data"), join(staging, "data"));
// The runtime root of a launched pipeline prints the labelled lines of
// feature 100 (§R.2 — the [DIGEST] among them) and reads the supervision and
// stage-kind tables by path: the launch path of the bundle needs them.
copyAsset(join(repositoryRoot, "packages", "pipeline", "data"), join(staging, "data"));

writeFileSync(
  join(staging, "bin", "specstride"),
  [
    "#!/usr/bin/env node",
    "// The executable of the published `specstride` package (F119-FR-056).",
    "// The import stays LAZY and lands on the one bundled ESM file; the exit",
    "// code is the code the front door returns, 70 on an uncaught error.",
    'import("../dist/cli/specstride.mjs")',
    "  .then((module) => module.route(process.argv.slice(2)))",
    "  .then((code) => {",
    "    process.exitCode = code;",
    "  })",
    "  .catch((error) => {",
    "    process.stderr.write(`specstride: ${(error && error.stack) || String(error)}\\n`);",
    "    process.exitCode = 70;",
    "  });",
    "",
  ].join("\n"),
  { mode: 0o755 },
);

// 3. The manifest of the packed package: no tool of the build, no runtime
// dependency, no script at all (F119-FR-056, F119-SC-009).
writeFileSync(
  join(staging, "package.json"),
  `${JSON.stringify(
    {
      name: "specstride",
      version: VERSION,
      description:
        "Specstride: the one specstride command (front door, inspection verbs, engine call).",
      license: LICENSE,
      type: "module",
      engines: { node: ">=22" },
      bin: { specstride: "bin/specstride" },
      files: ["bin/", "dist/", "data/"],
    },
    null,
    2,
  )}\n`,
);

// 4. The tarball, packed from the staging so the manifest above is THE
// manifest of the packed package.
execFileSync(
  process.execPath,
  [
    join(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    "pack",
    "--pack-destination",
    distDirectory,
  ],
  { cwd: staging, stdio: "inherit" },
);

console.log(`packed specstride@${VERSION} from ${staging}`);
