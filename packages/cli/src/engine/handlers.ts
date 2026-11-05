/**
 * The verbs the composition root mounts on the front door. Each one hands its
 * arguments to the package that owns it and writes what that package returned;
 * no rule of a verb lives here.
 *
 * `launch` and `wait` are the detached run: the verb wiring of `launch`
 * (commands/launch.ts) resolves the launcher, runs the launch checks and the
 * handshake of feature 122; `wait` is the read model of feature 129 over the
 * control plane the router resolved.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { runArgv } from "../../../spec-formats/src/verb.ts";
import { runVerify } from "../../../verification/src/cli/verify.ts";
import { validateContract } from "../../../pipeline/src/contract/commands/validate.ts";
import {
  renderContract,
  launcherPathUnderState,
} from "../../../pipeline/src/contract/commands/render.ts";
import { derive } from "../../../pipeline/src/contract/commands/derive.ts";
import {
  physicalPathOfLogicalName,
  contractStateName,
} from "../../../pipeline/src/contract/layout.ts";
import { contractId, resolveFeatures } from "../../../pipeline/src/contract/inventory/features.ts";
import { launchCommand } from "../commands/launch.ts";
import { runStop } from "../commands/stop.ts";
import { controlRootOfWorkspace } from "./workspace-control-root.ts";
import { entriesOfTheSupervisionRegistry } from "../run-control/supervision-registry-entries.ts";
import { runWait, digestLineOfThePipeline, type WaitOptions } from "../status/wait.ts";
// The read model of `wait` is a PARAMETER and not a package import (R-129-04):
// the CLI holds no dependency on `@specstride/view`, so the sources are
// reached by relative path — the pattern of `commands/supervise.ts` (LR-1).
import { project, renderLine } from "../../../view/src/index.ts";
import type { RouteIo, RoutedCall } from "../router/route.ts";

/** The exit of a verb this build refuses (annex G: a usage error). */
export const NOT_IN_THIS_BUILD_EXIT = 3 as const;

/** The verb this build does not have, and what to do instead. */
export const NOT_IN_THIS_BUILD: Readonly<Record<string, string>> = Object.freeze({
  reverse: "reverse specification is not in this build",
});

/** Writes what an owner returned and gives its exit code. */
function written(
  io: RouteIo,
  result: { readonly stdout: string; readonly stderr: string },
  exit: number,
): number {
  if (result.stdout !== "") io.out(result.stdout);
  if (result.stderr !== "") io.err(result.stderr);
  return exit;
}

/** `specstride spec`, by the owner of the grammar. */
export function specHandler(extras: readonly string[], workdir: string, io: RouteIo): number {
  const result = runArgv(extras, { launchDirectory: workdir } as never);
  return written(io, result, result.exit);
}

/** `specstride verify`, by the owner of the verification plan. */
export async function verifyHandler(extras: readonly string[], io: RouteIo): Promise<number> {
  const result = await runVerify({ argv: extras });
  return written(io, result, result.exitCode);
}

/**
 * `specstride launch`: the verb wiring of feature 107 over the control plane
 * the router resolved. The wiring owns the launcher resolution, the launch
 * checks of §R.5 and the handshake of feature 122; this handler only writes
 * the lines it prints and passes its exit through.
 */
export async function launchHandler(call: RoutedCall): Promise<number> {
  const result = await launchCommand([...call.extras], {
    print: (line: string): void => {
      call.io.out(`${line}\n`);
    },
    controlRoot: call.controlPlane.stateDir,
    workspaceRealPath: call.workdir,
  });
  return result.exit;
}

/**
 * `specstride stop`: the request into the inbox of the workspace (F102-FR-001,
 * F102-FR-002), `--now` ending the owned processes under the identity check
 * (F102-FR-006, F102-FR-007). The control root here is the one the ENGINE
 * resolves (`workspace-control-root.ts`) — the request has to land in the
 * inbox THIS engine polls, or a live group never honours it (F143-FR-026);
 * the entries `--now` checks are read from the supervision registry the
 * engine itself writes (`<controlRoot>/procs.json`).
 */
export function stopHandler(call: RoutedCall): number {
  const now = call.extras.includes("--now");
  const jobs = call.extras.includes("--jobs");
  const controlRoot = controlRootOfWorkspace(call.workdir);
  const result = runStop({
    controlRoot,
    workspaceRealPath: call.workdir,
    workdir: call.workdir,
    now,
    jobs,
    profile: process.env.SPECSTRIDE_PROFILE,
    ...(now
      ? {
          processes: entriesOfTheSupervisionRegistry(join(controlRoot, "procs.json")),
        }
      : {}),
  });
  for (const line of result.lines) {
    (line.stream === "stdout" ? call.io.out : call.io.err)(`${line.text}\n`);
  }
  return result.exitCode;
}

/**
 * `specstride wait --until-change`: the read model of feature 129 over the
 * control plane the router resolved. The clock is the host's and the wait
 * between polls is the blocking one — the command holds no state between
 * calls and writes nothing.
 */
export function waitHandler(call: RoutedCall): number {
  const run = runWait([...call.extras], {
    project: project as WaitOptions["project"],
    renderLine: renderLine as unknown as WaitOptions["renderLine"],
    place: { controlRoot: call.controlPlane.stateDir, workspaceRealPath: call.workdir },
    now: (): string => new Date().toISOString(),
    clock: (): number => Date.now(),
    write: (text: string): void => {
      call.io.out(text);
    },
    writeError: (text: string): void => {
      call.io.err(text);
    },
  });
  // The skill of the host ends its supervision with the `DIGEST` line the
  // runtime printed (F100-FR-180: a host skill prints it verbatim). The line
  // the run wrote is in the pipeline log of the run the supervision record
  // names; a run that is not over yet, or none at all, prints nothing beyond
  // the status line.
  if (run.exit === 0) {
    const digest = digestLineOfThePipeline({
      controlRoot: call.controlPlane.stateDir,
      workspaceRealPath: call.workdir,
    });
    if (digest !== null) call.io.out(`${digest}\n`);
  }
  return run.exit;
}

/** `specstride contract validate|promote|render`. `derive` keeps its own path. */
export function contractHandler(argv: readonly string[], io: RouteIo): number {
  const [verb, ...rest] = argv;
  const flag = (name: string): boolean => rest.includes(name);
  const valueOf = (name: string): string | undefined => {
    const at = rest.indexOf(name);
    return at < 0 ? undefined : rest[at + 1];
  };
  const taken = new Set([valueOf("--output"), valueOf("--root")]);
  const name = rest.find((arg) => !arg.startsWith("--") && !taken.has(arg));
  if (name === undefined || (verb !== "validate" && verb !== "promote" && verb !== "render")) {
    io.err(
      "usage: specstride contract validate|promote|render <contract> [--output <file>] [--json]\n",
    );
    return 2;
  }
  const root = valueOf("--root") ?? process.cwd();
  // F107-FR-039 — the state argument: a path to the file, or the logical name
  // of the contract (`pipeline:<id>:contract`). A host that derived through
  // the CLI knows the logical name; the layout names the same file.
  const file = CONTRACT_NAME_PATTERN.test(name)
    ? physicalPathOfLogicalName(workingRepositoryRoot(), name)
    : name;
  const common = {
    file,
    json: flag("--json"),
    ...(valueOf("--root") === undefined ? {} : { root }),
  };
  if (verb === "render") {
    const output = valueOf("--output") ?? defaultLauncherOutput(file);
    const result = renderContract({ ...common, output, replaceEdited: flag("--replace-edited") });
    return written(io, result, result.exitCode);
  }
  const result = validateContract({
    ...common,
    promote: verb === "promote",
    allowDraft: flag("--allow-draft"),
  });
  return written(io, result, result.exitCode);
}

/** The logical name of a launch contract, as the state layout writes it. */
const CONTRACT_NAME_PATTERN = /^pipeline:[^:/\\]+:contract$/u;

/**
 * The repository root a `contract` verb works on when the caller names none:
 * the root of the git work tree of the working directory, else the working
 * directory itself. The state-layout walk (`repoRootOfContract`) finds the
 * nearest ancestor that already holds `.specstride` — the right root once
 * the state exists, but `contract derive` is the FIRST command of a
 * repository and must not be captured by a state directory an ancestor
 * happens to carry; the work tree is the boundary the sources live in.
 */
function workingRepositoryRoot(): string {
  const found = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
  });
  const top = found.status === 0 ? found.stdout.trim() : "";
  return top === "" ? process.cwd() : top;
}

/**
 * The launcher `contract render` writes when `--output` names none: the
 * launcher of the state layout (F107-FR-026), under the pipeline's own state
 * directory — the place `launch` looks first, so a host that renders through
 * the CLI needs no path of its own.
 */
function defaultLauncherOutput(contractFile: string): string {
  try {
    const id = (JSON.parse(readFileSync(contractFile, "utf8")) as { id?: string }).id;
    if (typeof id === "string" && id !== "")
      return launcherPathUnderState(workingRepositoryRoot(), id);
  } catch {
    // A contract that cannot be read falls through to the renderer's refusal.
  }
  return join(workingRepositoryRoot(), "launcher");
}

/**
 * `specstride contract derive`: the pipeline's own derive command over the
 * repository of the call (F107-FR-005a). The flags map one to one — `--repo`
 * (the repository root of the working directory by default), `--feature`
 * (repeatable), `--output` (the contract's place under the state of the
 * pipeline by default, addressed by its logical name), `--comment`,
 * `--next-batch`, `--answer <draft> <batchId> <item>=<choice>…`.
 */
export function contractDeriveHandler(argv: readonly string[], io: RouteIo): number {
  const features: string[] = [];
  let repo: string | undefined;
  let output: string | undefined;
  let comment: string | undefined;
  let nextBatch = false;
  let answer:
    | { readonly draft: string; readonly batch: string; readonly choices: readonly string[] }
    | undefined;
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at];
    if (arg === "--next-batch") {
      nextBatch = true;
      continue;
    }
    const valueOf = (name: string): string | undefined => {
      const value = argv[at + 1];
      if (value === undefined || value.startsWith("--")) {
        io.err(`usage: specstride contract derive: ${name} needs a value\n`);
        return undefined;
      }
      at += 1;
      return value;
    };
    if (arg === "--repo") {
      repo = valueOf(arg);
      if (repo === undefined) return 2;
      continue;
    }
    if (arg === "--feature") {
      const feature = valueOf(arg);
      if (feature === undefined) return 2;
      features.push(feature);
      continue;
    }
    if (arg === "--output") {
      output = valueOf(arg);
      if (output === undefined) return 2;
      continue;
    }
    if (arg === "--comment") {
      comment = valueOf(arg);
      if (comment === undefined) return 2;
      continue;
    }
    if (arg === "--answer") {
      // `--answer <draft> <batchId> <item>=<choice>…`: the draft file, the
      // batch it answers, and one `item=choice` per unsettled item.
      const draft = argv[at + 1];
      const batch = argv[at + 2];
      if (draft === undefined || draft.startsWith("--") || batch === undefined) {
        io.err("usage: specstride contract derive: --answer <draft> <batchId> <item>=<choice>…\n");
        return 2;
      }
      at += 2;
      const choices: string[] = [];
      while (argv[at + 1] !== undefined && !argv[at + 1].startsWith("--")) {
        at += 1;
        choices.push(argv[at] as string);
      }
      answer = { draft, batch, choices };
      continue;
    }
    io.err(`usage: specstride contract derive: unknown argument ${arg}\n`);
    return 2;
  }

  const root = repo ?? workingRepositoryRoot();
  const resolution = resolveFeatures(root, features);
  if (!resolution.ok) {
    io.err(`contract-derive: error: ${resolution.message}\n`);
    return 2;
  }
  const pipelineId = contractId(root, resolution.featureDirs);
  // The draft the exchange loads is the file `--output` names (F107-FR-009):
  // `--answer <draft> …` names the same file positionally, so it takes the
  // place of `--output` for that call.
  const draftFile = answer === undefined ? output : answer.draft;
  const picks: { readonly item: string; readonly choice: string }[] = [];
  if (answer !== undefined) {
    for (const one of answer.choices) {
      const split = one.indexOf("=");
      if (split <= 0) {
        io.err(`usage: specstride contract derive: --answer wants <item>=<choice>, got ${one}\n`);
        return 2;
      }
      picks.push({ item: one.slice(0, split), choice: one.slice(split + 1) });
    }
  }
  const result = derive({
    repo: root,
    feature: features,
    output: draftFile ?? physicalPathOfLogicalName(root, contractStateName(pipelineId)),
    ...(comment === undefined ? {} : { comment }),
    ...(nextBatch ? { nextBatch } : {}),
    ...(answer === undefined ? {} : { answer: { batch: answer.batch, picks } }),
  });
  return written(io, result, result.exitCode);
}

/** One finding of the doctor: what was looked at, whether it holds, and the fix. */
type Finding = {
  readonly severity: "ok" | "warn" | "fail";
  readonly check: string;
  readonly fix: string;
};

/**
 * `specstride doctor`: the facts a first run depends on. It writes nothing and
 * reads no secret. 0 no `fail` finding; 2 at least one.
 */
export function doctorHandler(workdir: string, io: RouteIo): number {
  const has = (command: string, argv: readonly string[]): boolean =>
    spawnSync(command, [...argv], { encoding: "utf8", timeout: 10_000 }).status === 0;
  const major = Number(process.versions.node.split(".")[0]);
  const reviewer =
    [process.env.SPECSTRIDE_CRITIC, process.env.SPECSTRIDE_PROPOSER].find((role) =>
      role?.startsWith("dsh:"),
    ) ?? "claude";
  const findings: readonly Finding[] = [
    {
      severity: major >= 22 ? "ok" : "fail",
      check: `node ${process.versions.node}`,
      fix: major >= 22 ? "none" : "install Node 22 or later",
    },
    {
      severity: has("git", ["--version"]) ? "ok" : "fail",
      check: "git on the search path",
      fix: "install git",
    },
    {
      severity: has("git", ["-C", workdir, "rev-parse", "--is-inside-work-tree"]) ? "ok" : "warn",
      check: "the workspace is a git repository",
      fix: "run `git init`: without it the critic sees no change and nothing is committed",
    },
    {
      severity: has("claude", ["--version"]) ? "ok" : "fail",
      check: "claude on the search path",
      fix: "install Claude Code and sign in",
    },
    {
      severity: existsSync(join(workdir, "specs")) ? "ok" : "warn",
      check: "a specs/ directory",
      fix: "write a feature with Spec Kit: a directory under specs/ that holds tasks.md",
    },
    ...(reviewer.startsWith("dsh:")
      ? [
          {
            severity: has("dsh", ["--version"]) ? ("ok" as const) : ("fail" as const),
            check: `dsh on the search path, for ${reviewer}`,
            fix: "install the DeepSeek Harness, or unset SPECSTRIDE_CRITIC and SPECSTRIDE_PROPOSER",
          },
        ]
      : []),
  ];
  for (const { severity, check, fix } of findings) {
    io.out(`${severity} ${check}${severity === "ok" ? "" : ` — ${fix}`}\n`);
  }
  return findings.some((finding) => finding.severity === "fail") ? 2 : 0;
}
