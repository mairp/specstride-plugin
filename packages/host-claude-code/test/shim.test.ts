/**
 * T007 of `specs/113-host-claude-code/tasks.md` — the shim: the RESOLUTION
 * ORDER of F113-FR-018, the `--protocol` check of F113-FR-019 and the ONE
 * refusal line of each.
 *
 * Two things are proved here.
 *
 *  1. The constants the shim INLINES are the ones of annex H §H.1. The shim
 *     runs on the consumer's machine and the plugin layer carries no runtime
 *     dependency, so no module under `src/shim/` may import
 *     `@specstride/contracts` (rule RF-113-01). This test imports both sides
 *     and holds them against each other, which is what the rule file promises:
 *     "a test of T007 holds them against @specstride/contracts/ep/host".
 *  2. The shim itself does what the two requirements say — not only the pure
 *     decisions, but the FILE THAT SHIPS. plan.md builds the plugin directory
 *     ("one package with a build step that writes the plugin directory"), so
 *     the file is not committed: each case below RENDERS it from
 *     `shimScript()` into a temporary tree, makes it executable, and RUNS it
 *     against stub CLIs — with a stub on protocol 2, with a stub on the search
 *     path, with the published package as the only source, and with no CLI at
 *     all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLI_PROTOCOL_VERSION as CONTRACT_PROTOCOL,
  EXECUTABLE_VARIABLE as CONTRACT_VARIABLE,
  INSTALLS_OR_UPDATES_THE_CLI,
  PROTOCOL_MISMATCH_EXIT_CODE as CONTRACT_EXIT_CODE,
  PROTOCOL_MISMATCH_LINE as CONTRACT_LINE,
} from "@specstride/contracts/ep/host";
import {
  CLI_NOT_FOUND_EXIT_CODE,
  CLI_PROTOCOL_VERSION,
  DOCTOR_COMMAND,
  EXECUTABLE_NAME,
  EXECUTABLE_VARIABLE,
  INSTALLS_OR_UPDATES,
  INSTALL_COMMAND,
  PLUGIN_VERSION,
  PROTOCOL_FLAG,
  PROTOCOL_MISMATCH_EXIT_CODE,
  PROTOCOL_MISMATCH_LINE,
  PUBLISHED_PACKAGE,
  RESOLUTION_ORDER,
  SHIM_FILE_NAME,
  SUPPORTED_PROTOCOL_MAX,
  SUPPORTED_PROTOCOL_MIN,
  decide,
  missingCliLine,
  protocolIsSupported,
  publishedPackageRoot,
  readProtocol,
  refusalLine,
  refusesForVersionDifference,
  resolveExecutable,
  searchPathEntries,
  shimScript,
  supportedRange,
  type ShimProbe,
} from "../src/shim/index.ts";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The shim as the build writes it: `shimScript()` into `<root>/plugin/bin/`,
 * executable. Every case below runs THIS file, so what is exercised is the
 * text that ships and not a test's paraphrase of it.
 */
function buildShim(packageRoot: string): string {
  const directory = join(packageRoot, "plugin", "bin");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, SHIM_FILE_NAME);
  writeFileSync(path, shimScript());
  chmodSync(path, 0o755);
  return path;
}

/* -------------------------------------------- the inlined constants hold */

test("T007: every constant the shim inlines is the one of annex H §H.1", () => {
  assert.equal(EXECUTABLE_VARIABLE, CONTRACT_VARIABLE);
  assert.equal(EXECUTABLE_VARIABLE, "SPECSTRIDE_BIN");
  assert.equal(CLI_PROTOCOL_VERSION, CONTRACT_PROTOCOL);
  assert.equal(PROTOCOL_MISMATCH_LINE, CONTRACT_LINE);
  assert.equal(PROTOCOL_MISMATCH_EXIT_CODE, CONTRACT_EXIT_CODE);
  assert.equal(PROTOCOL_MISMATCH_EXIT_CODE, 4, "annex G §G.4: the shim exits 4");
  // The shim supports the protocol the CLI it was published with implements.
  assert.equal(SUPPORTED_PROTOCOL_MIN, CLI_PROTOCOL_VERSION);
  assert.equal(SUPPORTED_PROTOCOL_MAX, CLI_PROTOCOL_VERSION);
  assert.equal(supportedRange(), "1");
  // It installs and updates nothing (F113-FR-018, F100-FR-197, threat T-46).
  assert.equal(INSTALLS_OR_UPDATES, INSTALLS_OR_UPDATES_THE_CLI);
  assert.equal(INSTALLS_OR_UPDATES, false);
  // The install command names the exact package and the exact version, no
  // range (F113-FR-042). Directory policy 2026-11-10: the plugin no longer
  // bundles the CLI, so the version is the CLI's own release (0.1.0), not the
  // package version of the plugin.
  assert.equal(INSTALL_COMMAND, `npm install -g ${PUBLISHED_PACKAGE}@${PLUGIN_VERSION}`);
  assert.equal(PLUGIN_VERSION, "0.1.0");
  assert.equal(/[\^~><*]|\bx\b/.test(INSTALL_COMMAND), false, "no range");
});

test("T007: no module of `src/shim/` imports anything (rule RF-113-01)", () => {
  const module = readFileSync(join(PKG, "src", "shim", "index.ts"), "utf8");
  const importsOf = (text: string): readonly string[] =>
    text
      .split("\n")
      .filter(
        (line) =>
          /^\s*(import|export)\s+[^"']*\sfrom\s/.test(line) || /^\s*import\s*[("']/.test(line),
      )
      .map((line) => /from\s+["']([^"']+)["']|import\s*["']([^"']+)["']/.exec(line))
      .map((found) => found?.[1] ?? found?.[2] ?? "")
      .filter((specifier) => specifier !== "");

  // The MODULE — everything above the text of the shipped script — imports
  // nothing at all.
  const cut = module.indexOf("export function shimScript");
  assert.ok(cut > 0, "the module declares the text of the shipped script");
  assert.deepEqual(
    importsOf(module.slice(0, cut)),
    [],
    "the shim runs on the consumer's machine: the module imports nothing",
  );
  // The shipped SCRIPT imports three modules of Node and no package: the
  // plugin layer carries no runtime dependency (F113-FR-030, F113-FR-031).
  assert.deepEqual(importsOf(shimScript()), ["node:fs", "node:path", "node:child_process"]);
  for (const specifier of importsOf(module)) {
    assert.match(specifier, /^node:/, "nothing under src/shim/ imports a package");
  }
  // The rule file that says so, and its reason.
  const rule = JSON.parse(
    readFileSync(
      resolve(PKG, "../../tools/import-boundary/rules/113-host-claude-code-build-time-only.json"),
      "utf8",
    ),
  ) as { rule: string; from: string[]; forbid: string[] };
  assert.equal(rule.rule, "RF-113-01");
  assert.deepEqual(rule.from, ["packages/host-claude-code/src/shim/**"]);
  assert.equal(rule.forbid.includes("@specstride/contracts"), true);
});

/* ------------------------------------- F113-FR-018, the resolution order */

/** A probe over a declared machine, so the order is observed without a process. */
function probeOf(args: {
  readonly env?: Record<string, string | undefined>;
  readonly executables?: readonly string[];
  readonly shimDirectory?: string;
  readonly publishedBin?: string | null;
}): ShimProbe {
  const executables = new Set(args.executables ?? []);
  return {
    env: args.env ?? {},
    shimDirectory: args.shimDirectory ?? "/opt/node/lib/specstride/plugin/bin",
    isExecutable: (path) => executables.has(path),
    publishedBin: () => args.publishedBin ?? null,
  };
}

test("T007: the three steps of F113-FR-018, in the order of the requirement", () => {
  assert.deepEqual(
    [...RESOLUTION_ORDER],
    ["explicit-variable", "search-path", "published-package"],
  );

  // 1. The explicit variable of the consumer wins, even with the CLI on the path.
  const first = resolveExecutable(
    probeOf({
      env: { SPECSTRIDE_BIN: "/home/me/bin/specstride", PATH: "/usr/bin" },
      executables: ["/home/me/bin/specstride", "/usr/bin/specstride"],
      publishedBin: "/opt/node/lib/specstride/bin/cli.mjs",
    }),
  );
  assert.equal(first.source, "explicit-variable");
  assert.equal(first.path, "/home/me/bin/specstride");
  assert.equal(first.steps.length, 1, "it stops at the first step that finds one");

  // 2. The search path comes second, and only where the variable found nothing.
  const second = resolveExecutable(
    probeOf({
      env: { SPECSTRIDE_BIN: "/home/me/bin/specstride", PATH: "/opt/bin:/usr/bin" },
      executables: ["/usr/bin/specstride"],
      publishedBin: "/opt/node/lib/specstride/bin/cli.mjs",
    }),
  );
  assert.equal(second.source, "search-path");
  assert.equal(second.path, "/usr/bin/specstride");
  assert.deepEqual(
    second.steps.map((s) => [s.source, s.found]),
    [
      ["explicit-variable", false],
      ["search-path", true],
    ],
  );

  // 3. The package the plugin was published with comes last.
  const third = resolveExecutable(
    probeOf({
      env: { PATH: "/usr/bin" },
      executables: ["/opt/node/lib/specstride/bin/cli.mjs"],
      publishedBin: "/opt/node/lib/specstride/bin/cli.mjs",
    }),
  );
  assert.equal(third.source, "published-package");
  assert.equal(third.path, "/opt/node/lib/specstride/bin/cli.mjs");
  assert.deepEqual(
    third.steps.map((s) => s.source),
    [...RESOLUTION_ORDER],
  );
  // The root of that package is two directories above the shim's own.
  assert.equal(
    publishedPackageRoot("/opt/node/lib/specstride/plugin/bin"),
    "/opt/node/lib/specstride",
  );

  // Nothing found: every step was tried and none succeeded.
  const none = resolveExecutable(probeOf({ env: { PATH: "/usr/bin" } }));
  assert.equal(none.path, null);
  assert.equal(none.source, null);
  assert.deepEqual(
    none.steps.map((s) => s.found),
    [false, false, false],
  );

  // An empty entry of the search path is the working directory (POSIX).
  assert.deepEqual(searchPathEntries("/a::/b"), ["/a", ".", "/b"]);
  assert.deepEqual(searchPathEntries(undefined), []);
});

test("T007: a missing CLI is ONE line that reports through the doctor and installs nothing", () => {
  const line = missingCliLine();
  assert.equal(line.includes("\n"), false, "one line");
  assert.match(line, /^\[SPECSTRIDE-REFUSE\] /, "the line grammar of annex G §G.3");
  assert.ok(line.includes(INSTALL_COMMAND), "it prints the install command");
  assert.ok(line.includes(DOCTOR_COMMAND), "it reports through the doctor");
  assert.match(line, /check=host\.cli-found/, "the doctor check of F113-FR-033");

  const decision = decide({ path: null, source: null, steps: [] }, null);
  assert.equal(decision.action, "report-missing");
  assert.deepEqual(decision.lines, [line]);
  assert.equal(decision.lines.length, 1);
  assert.equal(decision.exitCode, CLI_NOT_FOUND_EXIT_CODE);
});

/* ------------------------------- F113-FR-019, `--protocol` and the refusal */

test("T007: `--protocol` is read as one integer and nothing else", () => {
  assert.equal(PROTOCOL_FLAG, "--protocol");
  assert.equal(EXECUTABLE_NAME, "specstride");
  assert.equal(readProtocol("1\n"), 1);
  assert.equal(readProtocol("  2  "), 2);
  // annex G §G.1: the call prints the integer "and nothing else in that call".
  assert.equal(readProtocol("protocol 1"), null);
  assert.equal(readProtocol(""), null);
  assert.equal(readProtocol("1.0"), null);
  assert.equal(protocolIsSupported(1), true);
  assert.equal(protocolIsSupported(0), false);
  assert.equal(protocolIsSupported(2), false);
  assert.equal(protocolIsSupported(null), false);
});

test("T007: a mismatch refuses with ONE line, with the two integers, naming the doctor", () => {
  const line = refusalLine(2);
  assert.equal(line.includes("\n"), false, "ONE line");
  assert.ok(line.startsWith(PROTOCOL_MISMATCH_LINE), "the line of annex H §H.1, verbatim");
  assert.match(line, /found=2/);
  assert.match(line, /supported=1/);
  assert.ok(line.includes(DOCTOR_COMMAND), "it names the doctor");

  const decision = decide({ path: "/usr/bin/specstride", source: "search-path", steps: [] }, 2);
  assert.equal(decision.action, "refuse-protocol");
  assert.equal(decision.lines.length, 1);
  assert.deepEqual(decision.lines, [line]);
  assert.equal(decision.exitCode, PROTOCOL_MISMATCH_EXIT_CODE);
  // Output that is not an integer is a mismatch too, and says so.
  assert.match(refusalLine(null), /found=none/);
});

test("T007: a differing package version alone is NEVER a refusal (F113-FR-019)", () => {
  // spec.md, "Edge cases": the plugin version and the CLI version differ but
  // the protocol matches — the doctor shows the difference; the run is not
  // refused.
  assert.equal(refusesForVersionDifference("0.0.0", "9.9.9", 1), false);
  assert.equal(refusesForVersionDifference("0.0.0", "0.0.0", 2), true, "only the protocol refuses");
  const decision = decide({ path: "/usr/bin/specstride", source: "search-path", steps: [] }, 1);
  assert.equal(decision.action, "run");
  assert.deepEqual(decision.lines, [], "a matching protocol prints nothing");
  assert.equal(decision.exitCode, null, "the CLI's own exit code is the shim's");
});

/* ------------------------------------- the FILE that ships, actually run */

/** A stub CLI that prints one line for `--protocol` and echoes its arguments. */
function stubCli(directory: string, name: string, protocol: string): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(
    path,
    `#!/bin/sh\nif [ "$1" = "--protocol" ]; then printf '${protocol}\\n'; exit 0; fi\n` +
      `printf 'STUB-RAN %s\\n' "$*"\nexit 7\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

function runShim(
  shim: string,
  env: Record<string, string>,
  args: readonly string[] = ["doctor"],
): { status: number | null; stdout: string } {
  const result = spawnSync(process.execPath, [shim, ...args], {
    encoding: "utf8",
    env: { ...env },
  });
  return { status: result.status, stdout: result.stdout };
}

test("T007: the shim is a BUILD OUTPUT, rendered from `src/shim/` and executable", () => {
  // plan.md builds the plugin directory, so the repository holds no shim: a
  // committed copy could drift from the module the tests exercise.
  assert.equal(existsSync(join(PKG, "plugin", "bin", SHIM_FILE_NAME)), false);
  const built = buildShim(mkdtempSync(join(tmpdir(), "shim-built-")));
  assert.equal(readFileSync(built, "utf8"), shimScript());
  assert.match(shimScript(), /^#!\/usr\/bin\/env node\n/);
  accessSync(built, constants.X_OK);
});

test("T007: the shim RUNS the CLI the explicit variable names, and passes the arguments", () => {
  const box = mkdtempSync(join(tmpdir(), "shim-explicit-"));
  const shim = buildShim(box);
  const cli = stubCli(join(box, "home"), "my-specstride", "1");
  const run = runShim(shim, { PATH: "/nonexistent", SPECSTRIDE_BIN: cli }, ["doctor", "--json"]);
  assert.match(run.stdout, /STUB-RAN doctor --json/, "the arguments are passed through");
  assert.equal(run.status, 7, "the CLI's own exit code is the shim's");
});

test("T007: the shim finds the CLI on the search path when the variable names none", () => {
  const box = mkdtempSync(join(tmpdir(), "shim-path-"));
  const shim = buildShim(box);
  stubCli(join(box, "cli"), "specstride", "1");
  const run = runShim(shim, { PATH: `${join(box, "cli")}:/usr/bin` }, ["status"]);
  assert.match(run.stdout, /STUB-RAN status/);
  assert.equal(run.status, 7);
  // An explicit variable that names nothing does not stop the search.
  const also = runShim(shim, {
    PATH: `${join(box, "cli")}:/usr/bin`,
    SPECSTRIDE_BIN: join(box, "absent"),
  });
  assert.match(also.stdout, /STUB-RAN doctor/);
});

test("T007: the shim falls back to the package the plugin was published with", () => {
  // The published package: <root>/package.json names the CLI in `bin`, and the
  // plugin lies at <root>/plugin/, so the shim is <root>/plugin/bin/.
  const root = mkdtempSync(join(tmpdir(), "shim-published-"));
  const cli = stubCli(join(root, "bin"), "cli.mjs", "1");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "specstride", version: "0.0.0", bin: { specstride: "bin/cli.mjs" } }),
  );
  const shim = buildShim(root);
  assert.ok(cli.endsWith("cli.mjs"));
  const run = runShim(shim, { PATH: "/nonexistent" }, ["verify"]);
  assert.match(run.stdout, /STUB-RAN verify/, "the third step of F113-FR-018 found it");
  assert.equal(run.status, 7);
});

test("T007: a stub CLI on protocol 2 — ONE line naming the doctor, exit 4", () => {
  // spec.md, "Independent Test" of user story 3: "Put a stub CLI printing
  // protocol 2 on the search path; the shim prints one line naming the doctor
  // and runs nothing."
  const box = mkdtempSync(join(tmpdir(), "shim-protocol-2-"));
  const shim = buildShim(box);
  stubCli(join(box, "cli"), "specstride", "2");
  const run = runShim(shim, { PATH: `${join(box, "cli")}:/usr/bin` }, ["run"]);
  assert.equal(run.status, 4);
  const lines = run.stdout.split("\n").filter((line) => line !== "");
  assert.equal(lines.length, 1, "ONE line");
  assert.equal(lines[0], refusalLine(2));
  assert.ok(lines[0]?.startsWith(PROTOCOL_MISMATCH_LINE));
  assert.ok(lines[0]?.includes(DOCTOR_COMMAND), "it names the doctor");
  assert.equal(run.stdout.includes("STUB-RAN"), false, "and it runs nothing");
});

test("T007: no CLI at all — ONE line with the install command, and nothing installed", () => {
  const box = mkdtempSync(join(tmpdir(), "shim-absent-"));
  const shim = buildShim(box);
  const run = runShim(shim, { PATH: join(box, "empty") }, ["run"]);
  assert.equal(run.status, CLI_NOT_FOUND_EXIT_CODE);
  const lines = run.stdout.split("\n").filter((line) => line !== "");
  assert.equal(lines.length, 1, "ONE line");
  assert.equal(lines[0], missingCliLine());
  assert.ok(lines[0]?.includes(INSTALL_COMMAND));
  assert.ok(lines[0]?.includes(DOCTOR_COMMAND));
  // It fetched, installed and updated nothing: the shim's own text runs no
  // installer at all.
  assert.equal(/\bnpm\s+(install|i|update|exec)\b/.test(stripStrings(shimScript())), false);
  assert.equal(/\b(npx|curl|wget|fetch)\b/.test(stripStrings(shimScript())), false);
});

/** The script with every string literal removed: what it EXECUTES, not prints. */
function stripStrings(script: string): string {
  return script
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}
