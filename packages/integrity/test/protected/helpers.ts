// Shared helpers of the characterization tests CT-116-1 to CT-116-141 (feature 116, phase 3).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ToolchainProfile } from "../../src/protected/set.ts";

/** A throwaway git working tree with the given files committed. */
export function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "integrity-116-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  run(root, ["init", "-q"]);
  run(root, ["config", "user.email", "t@example.invalid"]);
  run(root, ["config", "user.name", "t"]);
  run(root, ["add", "-A"]);
  run(root, ["commit", "-q", "--allow-empty", "-m", "base"]);
  return root;
}

export function git(root: string, args: string[]): string {
  return run(root, args);
}

function run(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

export function writeFile(root: string, rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

export const stubProfile: ToolchainProfile = {
  schema: "specstride.toolchain/1",
  id: "stub",
  version: "1",
  detect: {},
  classA: ["toolchain/**", "config/*.json"],
  testFiles: ["test/**"],
  caches: [{ path: ".stubcache", disableEnv: { STUB_DISABLE_CACHE: "1" } }],
  userConfig: ["stubrc"],
  suppressionMarkers: ["skip"],
  executables: [],
  effectiveConfig: null,
  workerSeeds: [],
  workerEnv: {},
};
