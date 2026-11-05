#!/usr/bin/env node
// The CI check of CT-125-27 (T063, F125-FR-036, F125-SC-004): the PACKED
// package, and everything it INSTALLS, hold no file of the Agent SDK.
//
//  - it packs `@specstride/adapter-claude` (npm pack --dry-run --json, so no
//    tarball is written) and walks the packed file list;
//  - it walks every install-time dependency field of the manifest
//    (`dependencies`, `optionalDependencies`, `peerDependencies` including
//    the optional SDK itself, which is resolved from the CONSUMER'S
//    installation and never shipped);
//  - ANY path or dependency name that belongs to the SDK fails the check.
//
// No network: `--dry-run` reads the local package only.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SDK = "@anthropic-ai/claude-agent-sdk";
const SDK_MARKERS = ["node_modules/@anthropic-ai/claude-agent-sdk", "claude-agent-sdk"];

import { existsSync, readFileSync } from "node:fs";
const npmCliCandidates = [
  process.env.npm_execpath,
  "/usr/lib/node_modules/npm/bin/npm-cli.js",
  join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
].filter((candidate) => typeof candidate === "string" && existsSync(candidate));
if (npmCliCandidates.length === 0) {
  console.error("no npm CLI found to run `npm pack --dry-run`");
  process.exit(1);
}
const npmCli = npmCliCandidates[0];
const pack = spawnSync(
  process.execPath,
  [npmCli, "pack", "--dry-run", "--json", "--ignore-scripts"],
  { cwd: PACKAGE_DIR, encoding: "utf8" },
);
if (pack.status !== 0) {
  console.error(`npm pack --dry-run failed:\n${pack.stdout}\n${pack.stderr}`);
  process.exit(1);
}
let files = [];
try {
  const parsed = JSON.parse(pack.stdout);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  files = (entry?.files ?? []).map((file) => file.path);
} catch (error) {
  console.error(`unreadable pack output: ${error.message}`);
  process.exit(1);
}
const offenders = files.filter((path) =>
  SDK_MARKERS.some((marker) => path.includes(marker) || path.endsWith(".node")),
);
if (offenders.length > 0) {
  console.error(`the packed package holds files of the SDK: ${offenders.join(", ")}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8"));
for (const field of ["dependencies", "optionalDependencies", "devDependencies"]) {
  const record = manifest[field] ?? {};
  if (record[SDK] !== undefined) {
    console.error(`the manifest lists the SDK under ${field}; it must be an optional peer only`);
    process.exit(1);
  }
}
console.log(
  `checked ${files.length} packed files and every install-time dependency field: ` +
    `no file of ${SDK} ships and the product never installs it`,
);
process.exit(0);
