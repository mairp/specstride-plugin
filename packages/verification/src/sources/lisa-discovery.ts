/**
 * DISCOVERY of Lisa's verification package — the entry points of a toolchain
 * for test, build, lint and format — extracted as source (T006,
 * `research.md` D-1; recorded in `../../EXTRACTED.md`).
 *
 * Extracted from `packages/verification/src/discovery.ts` of Lisa at
 * `363e6a3` (283 lines, the whole file), read with
 * `git -C <lisa> show 363e6a3:packages/verification/src/discovery.ts`.
 *
 * Two changes of the extraction, both mechanical:
 *
 * 1. the type-only import comes from `../plan/lisa-plan.ts` instead of
 *    `@lisa/core` — the same shapes, and a type import emits nothing;
 * 2. `process` is imported from `node:process`, where the baseline reaches it
 *    as a global: the same object, and the ECMAScript modules of this
 *    workspace name their built-ins.
 *
 * The constants of the discovery table stay in the code AS EXTRACTED and the
 * module reads no data file yet. `data/discovery.json` and
 * `data/word-lists.json` (T003) carry the same table read from the Specstride
 * baseline at `9cab15d`; the later phase that makes the toolchain list open
 * to further rows (F105-FR-017, `research.md` D-16, Principle VI) moves this
 * module onto that data. `tests/characterization/105/CT-105-2.test.ts` pins
 * the behaviour as extracted and pins that the data file agrees with it, so
 * the move cannot change behaviour silently.
 */
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import type { VerificationCommand, VerificationCommandKind } from "../plan/lisa-plan.ts";
import { contentHash, sha256, stableId } from "../plan/lisa-hash.ts";

export interface ProjectDiscovery {
  workdir: string;
  fingerprint: string;
  frameworks: string[];
  commands: VerificationCommand[];
  assumptions: string[];
  ambiguities: string[];
}

interface PackageJson {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const PROJECT_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "pyproject.toml",
  "pytest.ini",
  "tox.ini",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
] as const;

function requireAbsoluteDirectory(workdir: string): string {
  if (!isAbsolute(workdir)) {
    throw new Error(`verification workdir must be absolute: ${workdir}`);
  }
  const absolute = resolve(workdir);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    throw new Error(`verification workdir does not exist or is not a directory: ${absolute}`);
  }
  return realpathSync(absolute);
}

function findExecutable(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const candidates = (env["PATH"] ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, name));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Continue to the next PATH entry.
    }
  }
  return undefined;
}

function command(
  kind: VerificationCommandKind,
  label: string,
  executable: string,
  args: string[],
  cwd: string,
  timeoutSec: number,
): VerificationCommand {
  return {
    id: stableId("CMD", `${kind}:${executable}:${JSON.stringify(args)}:${cwd}`),
    kind,
    label,
    executable,
    args,
    cwd,
    timeoutSec,
  };
}

function readPackageJson(path: string): PackageJson | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PackageJson;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function nodeDiscovery(
  workdir: string,
  env: NodeJS.ProcessEnv,
  frameworks: Set<string>,
  commands: VerificationCommand[],
  ambiguities: string[],
): void {
  const packagePath = join(workdir, "package.json");
  if (!existsSync(packagePath)) return;
  const pkg = readPackageJson(packagePath);
  if (!pkg) {
    ambiguities.push(`Cannot parse project manifest: ${packagePath}`);
    return;
  }

  frameworks.add("node");
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  if ("vitest" in dependencies) frameworks.add("vitest");
  if ("jest" in dependencies) frameworks.add("jest");
  if ("@playwright/test" in dependencies) frameworks.add("playwright");
  if ("cypress" in dependencies) frameworks.add("cypress");

  const managerName =
    pkg.packageManager?.split("@")[0] ??
    (existsSync(join(workdir, "pnpm-lock.yaml")) ? "pnpm" : "npm");
  const executable = findExecutable(managerName, env);
  if (!executable) {
    ambiguities.push(
      `Project declares ${managerName}, but no absolute executable was found on PATH`,
    );
    return;
  }

  const scripts = pkg.scripts ?? {};
  const definitions: Array<[string, VerificationCommandKind, string, number]> = [
    ["test", "test", "Run project tests", 1_800],
    ["build", "build", "Build the project", 1_800],
    ["lint", "lint", "Run project lint", 900],
    ["format:check", "format", "Check project formatting", 900],
  ];
  for (const [script, kind, label, timeoutSec] of definitions) {
    if (!scripts[script]) continue;
    const args =
      managerName === "pnpm"
        ? ["--dir", workdir, script]
        : managerName === "npm"
          ? ["--prefix", workdir, "run", script]
          : ["--cwd", workdir, script];
    commands.push(command(kind, label, executable, args, workdir, timeoutSec));
  }
}

function pythonDiscovery(
  workdir: string,
  env: NodeJS.ProcessEnv,
  frameworks: Set<string>,
  commands: VerificationCommand[],
  ambiguities: string[],
): void {
  const configured = ["pyproject.toml", "pytest.ini", "tox.ini"].some((name) =>
    existsSync(join(workdir, name)),
  );
  if (!configured) return;
  frameworks.add("python");
  const manifestText = ["pyproject.toml", "pytest.ini", "tox.ini"]
    .filter((name) => existsSync(join(workdir, name)))
    .map((name) => readFileSync(join(workdir, name), "utf8"))
    .join("\n");
  if (!/pytest/i.test(manifestText)) return;
  frameworks.add("pytest");
  const executable = findExecutable("python3", env);
  if (!executable) {
    ambiguities.push("pytest was detected, but no absolute python3 executable was found on PATH");
    return;
  }
  commands.push(
    command("test", "Run pytest", executable, ["-m", "pytest", workdir], workdir, 1_800),
  );
}

function cargoDiscovery(
  workdir: string,
  env: NodeJS.ProcessEnv,
  frameworks: Set<string>,
  commands: VerificationCommand[],
  ambiguities: string[],
): void {
  const manifest = join(workdir, "Cargo.toml");
  if (!existsSync(manifest)) return;
  frameworks.add("rust");
  frameworks.add("cargo-test");
  const executable = findExecutable("cargo", env);
  if (!executable) {
    ambiguities.push("Cargo.toml was detected, but no absolute cargo executable was found on PATH");
    return;
  }
  commands.push(
    command(
      "test",
      "Run Cargo tests",
      executable,
      ["test", "--manifest-path", manifest],
      workdir,
      1_800,
    ),
  );
}

function goDiscovery(
  workdir: string,
  env: NodeJS.ProcessEnv,
  frameworks: Set<string>,
  commands: VerificationCommand[],
  ambiguities: string[],
): void {
  if (!existsSync(join(workdir, "go.mod"))) return;
  frameworks.add("go");
  frameworks.add("go-test");
  const executable = findExecutable("go", env);
  if (!executable) {
    ambiguities.push("go.mod was detected, but no absolute go executable was found on PATH");
    return;
  }
  commands.push(command("test", "Run Go tests", executable, ["test", "./..."], workdir, 1_800));
}

function projectFingerprint(workdir: string): string {
  const entries = PROJECT_FILES.filter((name) => existsSync(join(workdir, name))).map((name) => {
    const absolutePath = join(workdir, name);
    return {
      path: absolutePath,
      sha256: sha256(readFileSync(absolutePath)),
    };
  });
  return contentHash({ workdir, entries });
}

export function discoverProject(
  inputWorkdir: string,
  env: NodeJS.ProcessEnv = process.env,
): ProjectDiscovery {
  const workdir = requireAbsoluteDirectory(inputWorkdir);
  const frameworks = new Set<string>();
  const commands: VerificationCommand[] = [];
  const assumptions: string[] = [];
  const ambiguities: string[] = [];

  nodeDiscovery(workdir, env, frameworks, commands, ambiguities);
  pythonDiscovery(workdir, env, frameworks, commands, ambiguities);
  cargoDiscovery(workdir, env, frameworks, commands, ambiguities);
  goDiscovery(workdir, env, frameworks, commands, ambiguities);

  if (frameworks.size === 0) {
    assumptions.push(
      `No supported automated test framework was detected below ${workdir}; obligations remain operator-verifiable`,
    );
  }
  if (!commands.some((value) => value.kind === "test")) {
    ambiguities.push(
      `No safe automated test command was discovered below ${workdir}; required verification cannot start until one is configured`,
    );
  }

  return {
    workdir,
    fingerprint: projectFingerprint(workdir),
    frameworks: [...frameworks].sort(),
    commands: commands.sort((left, right) => left.id.localeCompare(right.id)),
    assumptions,
    ambiguities,
  };
}
