/**
 * The runtime root of a launched pipeline (F107-FR-032, F122-FR-012,
 * F123-FR-004 … F123-FR-009).
 *
 * The process the launcher becomes: `specstride launch` starts this module
 * detached through the strategy `spawn-detached`, and the launcher reaches it
 * by the environment name `SPECSTRIDE_PIPELINE_ENTRY`. It is a composition
 * root in the shape of `commands/supervise.ts`: no rule of the pipeline, the
 * lock or the lease lives here — every decision stays in the package that
 * owns it, and this module wires the parts in the order the requirements fix:
 *
 *   1. **the place and the bundle** — every physical path comes out of the
 *      layout by logical name (`contract/layout.ts`), never a literal;
 *   2. **the start-up** (`entry/start.ts`) — the arguments, the contract
 *      through a REAL gateway (read from the bundle, validated for warnings,
 *      judged stale, both by `validateInOrder`), the dry run, the refusals;
 *   3. **the workspace lock and the lease** — handshake step 3, `startRun` of
 *      the runtime root, whose refusal for a pipeline is the exit 24 of
 *      EP-13's `CONFLICT_PIPELINE_CODE`;
 *   4. **the supervision record** of this launch (`supervisor/record.ts`),
 *      addressed by the launch id the environment names;
 *   5. **the stage loop** (`executor/stage-loop.ts`) over the stages of the
 *      contract converted to the executor's shape, and ONE final `[DIGEST]`
 *      line — on standard output and in the pipeline log, and nothing after.
 *
 * F100-FR-003 — between the CLI and the runtime root there are only files:
 * this module reaches the runtime package's SOURCES by relative path, exactly
 * the pattern of `commands/supervise.ts`, and never by package name. The
 * reach lives in this module alone.
 */
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";

import {
  resolve as resolveLogicalName,
  rootPathsOf,
} from "@specstride/contracts/ids/logical-names";

import {
  physicalPathOfLogicalName,
  repoRootOfContract,
} from "../../../pipeline/src/contract/layout.ts";
import { CONTRACT_FILE } from "../../../pipeline/src/contract/render/bundle.ts";
import {
  validateInOrder,
  type ValidationOutcome,
} from "../../../pipeline/src/contract/validate/order.ts";
import {
  DEFAULT_CHECKS,
  DEFAULT_STAGE_KINDS,
} from "../../../pipeline/src/contract/default-registries.ts";
import { colourOf, parsePipelineArgs, runStartup } from "../../../pipeline/src/entry/start.ts";
import type { ContractGateway, PipelineArgs } from "../../../pipeline/src/entry/start.ts";
import {
  PreconditionCheckRegistry,
  StageKindRegistry,
  type EvaluationContext,
} from "../../../pipeline/src/kinds/registry.ts";
import { runStageChild } from "../../../pipeline/src/executor/child.ts";
import { buildChildEnvironment, type PinnedKey } from "../../../pipeline/src/executor/child-env.ts";
import { exitCodeForState } from "../../../pipeline/src/executor/exit.ts";
import type { AttemptRunner } from "../../../pipeline/src/executor/retry.ts";
import { runStageLoop } from "../../../pipeline/src/executor/stage-loop.ts";
import type {
  Action,
  ActionEnvironmentEntry,
  Clock,
  Condition,
  ConditionTiming,
  Stage,
} from "../../../pipeline/src/executor/types.ts";
import type { EventPort } from "../../../pipeline/src/executor/events.ts";
import { digestLine, evidenceName } from "../../../pipeline/src/output/lines.ts";
import {
  emptySupervisionRecord,
  writeSupervisionRecord,
} from "../../../pipeline/src/supervisor/record.ts";
// The reach into the runtime package (F100-FR-003, LR-1): its SOURCES by
// relative path, in this module only — `startRun` for the lock and the lease,
// `buildOwnerRecord` for the owner record the lock demands. Both are types
// and builders of feature 122; the CLI never imports them by package name.
import { startTheRoot } from "../../../runtime/src/root/start.ts";
import { buildOwnerRecord } from "../../../runtime/src/lock/owner-record.ts";
import { controlPlaneOf } from "../router/guards.ts";

/** The width, in bytes, of the run token this root mints (F122-FR-024). */
const RUN_TOKEN_BYTES = 32;

/** The labels of a condition's timing, as the executor spells them (§R.3). */
const CONDITION_TIMINGS: readonly ConditionTiming[] = ["preflight", "stage", "postcondition"];

/**
 * The runtime root the launcher becomes. Returns the process's exit code:
 * 0 the stages completed (or the dry run ran); 2 a usage error; 20 an
 * invalid launch contract; 23 stale sources; 24 a lock another run holds;
 * 22 a failed stage.
 */
export async function main(input: {
  readonly bundleLogicalName: string;
  readonly bundleHash: string;
  readonly mode: "run" | "dry-run";
  readonly args: readonly string[];
}): Promise<number> {
  // 1. The place and the bundle. The working directory is the repository
  //    root; the bundle is addressed by its logical name, the contract is
  //    `<bundle>/launch-contract.json`.
  const root = repoRootOfContract();
  const bundlePath = physicalPathOfLogicalName(root, input.bundleLogicalName);
  const contractPath = join(bundlePath, CONTRACT_FILE);
  const record = readJson(contractPath);
  const pipelineId = pipelineIdOf(record);
  const launchId = process.env.SPECSTRIDE_LAUNCH_ID ?? "launch-1";
  const runId = `run-${launchId}`;
  const runDir = physicalPathOfLogicalName(root, `pipeline:${pipelineId}:runs:${launchId}`);
  const statePath = join(runDir, "state.json");
  const logPath = join(runDir, "pipeline.log");

  // 2. The start-up. The launcher's own arguments pass through; the contract
  //    and the run directory are PREPENDED — the launcher passes `--no-color`
  //    and maybe `--implement`/`--smoke`, never the two.
  let parsed: PipelineArgs;
  try {
    parsed = parsePipelineArgs([
      "--contract",
      contractPath,
      "--launch-dir",
      runDir,
      ...(input.mode === "dry-run" ? ["--dry-run"] : []),
      ...input.args,
    ]);
  } catch (error) {
    process.stderr.write(`usage: ${(error as Error).message}\n`);
    return 2;
  }

  const logLine = (line: string): void => {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${line}\n`, "utf8");
  };
  const sink = {
    stdout: (line: string): void => {
      process.stdout.write(`${line}\n`);
    },
    stderr: (line: string): void => {
      process.stderr.write(`${line}\n`);
    },
    log: logLine,
  };
  const eventsPath = join(runDir, "events.jsonl");
  const events: EventPort = {
    write(event): void {
      mkdirSync(dirname(eventsPath), { recursive: true });
      appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
    },
  };

  const checks = new PreconditionCheckRegistry(DEFAULT_CHECKS);
  const kinds = new StageKindRegistry(DEFAULT_STAGE_KINDS, "pipeline-main");
  const checkContext: EvaluationContext = {
    env: process.env,
    cwd: root,
    implement: parsed.implement,
  };
  const startup = await runStartup({
    args: parsed,
    gateway: gatewayOver(record, root),
    sink,
    // The root runs detached behind a runtime log: every labelled line of
    // §R.2 reaches the streams, colour off (the launcher passes --no-color).
    mode: "compatibility",
    stdoutIsTerminal: false,
    env: process.env,
    checks,
    checkContext,
    kinds,
    events,
  });
  if (startup.kind === "dry-run") return startup.exit;
  if (startup.kind === "refused") return startup.exit;

  // 3. The workspace lock and the LEASE OF THE RUN — handshake step 3. The
  //    place is computed exactly as the CLI computes it: `controlPlaneOf`
  //    over the working directory, `SPECSTRIDE_STATE_DIR` where the host set
  //    it; the lock wants the REAL path of the workspace root (F122-FR-019).
  //    `startTheRoot` (not the bare `startRun`) is the one that writes the
  //    lease at `run:<runId>:lease` — the path the launch's handshake step 4
  //    polls — with the launch nonce the environment carries, and the
  //    heartbeat that keeps it fresh. The slug and the run id are the ones
  //    the launch recorded: the pipeline id and `run-<launch id>`.
  const place = {
    controlRoot: controlPlaneOf(process.cwd(), process.env.SPECSTRIDE_STATE_DIR).stateDir,
    workspaceRealPath: realpathSync(root),
  };
  const started = await startTheRoot({
    where: { place, slug: pipelineId, runId },
    launchId,
    launchNonce: process.env.SPECSTRIDE_LAUNCH_NONCE ?? launchId,
    owner: buildOwnerRecord({ launchId, runTokenHash: mintARunTokenHash() }),
  });
  if (!started.started) {
    // §R.2: `[BLOCKED] another launcher owns <pipeline run>`, then the digest
    // with the pipeline's code for a held lock — the exit `startTheRoot`
    // answers for a pipeline (24, EP-13's CONFLICT_PIPELINE_CODE).
    const pipelineRun = evidenceName(pipelineId, runId);
    const blocked = `another launcher owns ${pipelineRun}`;
    const refusal = `${started.refusal}: ${started.detail}`;
    process.stdout.write(`[BLOCKED] ${blocked}\n`);
    process.stderr.write(`[BLOCKED] ${refusal}\n`);
    const digest = digestLine({
      state: "failed",
      exit: started.exit,
      lastStage: null,
      childExit: null,
      evidence: pipelineRun,
    });
    process.stdout.write(`${digest}\n`);
    return started.exit;
  }

  try {
    // 4. The supervision record of this launch, at its logical place under
    //    the control root, addressed by the launch id the environment names.
    //    The writer is atomic and creates no directory of its own.
    const converted = stagesOf(record, root, pipelineId);
    const supervisionPath = supervisionPathOf(place, launchId);
    mkdirSync(dirname(supervisionPath), { recursive: true });
    writeSupervisionRecord(
      supervisionPath,
      emptySupervisionRecord({
        pipeline: pipelineId,
        launchId,
        mode: input.mode,
        launcher: process.env.SPECSTRIDE_LAUNCHER_FILE ?? "",
        argv: [...input.args],
        cwd: process.cwd(),
        runDir,
        statePath,
        launchLog: logPath,
        stageCount: converted.stages.length,
        relaunchOwner: "root",
        firstLaunchedAt: Math.trunc(Date.now() / 1_000),
        pipelineLogOffset: 0,
      }),
    );

    // 5. The stage loop, then the digest. The clock is the host's; the
    //    engine's terminal record does not exist yet, so the reader answers
    //    `null` and no run is classified as retryable.
    const colourOn = colourOf(parsed, process.env, false);
    const result = await runStageLoop({
      pipelineId,
      contract: record,
      stages: converted.stages,
      statePath,
      smoke: parsed.smoke,
      implement: parsed.implement,
      checks,
      checkContext,
      clock: hostClock(),
      runner: stageRunner({
        slugOf: converted.slugOf,
        contract: record,
        colourOn,
        log: logLine,
      }),
      readTerminal: () => null,
      events,
    });
    for (const line of result.lines) {
      const text = `${line.label} ${line.text}`;
      process.stdout.write(`${text}\n`);
      logLine(text);
    }
    const exit = exitCodeForState(result.state.state);
    const digest = digestLine({
      state: result.state.state,
      exit,
      lastStage: result.state.last_stage,
      childExit: null,
      evidence: runDir,
    });
    process.stdout.write(`${digest}\n`);
    logLine(digest);
    return exit;
  } finally {
    // The lock is held for the life of the root: every exit path after the
    // acquire stops the heartbeat FIRST — a beating timer would hold the
    // event loop of the detached root open past its own end — and then
    // releases the lock (F122-FR-012, F122-FR-020, the order of `end.ts`).
    started.heartbeat.stop();
    await started.provider.release?.(started.lease);
  }
}

/* ------------------------------------------------------------------ *
 * The contract of the bundle, as the root reads it.
 * ------------------------------------------------------------------ */

/** Read one JSON file. The caller catches nothing: a bad read is exit 20. */
function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** The pipeline id of the contract, `pipeline` where the record names none. */
function pipelineIdOf(record: Record<string, unknown>): string {
  const id = record["id"];
  return typeof id === "string" && id !== "" ? id : "pipeline";
}

/**
 * The gateway of the start-up: `load` reads the JSON, and the verdicts come
 * from ONE `validateInOrder` per record read, with `allowDraft: true` — the
 * root starts what a launch handed it, and the readiness rules of promotion
 * are not its to re-run. The one schema owns the shape (the entry consults it
 * where the record reader's own words at the joined positions would refuse);
 * the strict RULES of feature 107 refuse the start through the gateway's
 * `invalid` port (F123-FR-004: exit 20, after the staleness verdict), never
 * as warnings — a launched root must not run a contract validation refuses.
 */
function gatewayOver(record: Record<string, unknown>, root: string): ContractGateway {
  let outcome: ValidationOutcome | undefined;
  const verdict = (): ValidationOutcome => {
    outcome ??= validateInOrder(record, {
      root,
      stageKinds: new StageKindRegistry(DEFAULT_STAGE_KINDS, "pipeline-main"),
      checks: new PreconditionCheckRegistry(DEFAULT_CHECKS),
      allowDraft: true,
      noSourceCheck: false,
    });
    return outcome;
  };
  const problemLines = (): string[] => {
    const judged = verdict();
    return judged.exit !== 20
      ? []
      : [
          ...judged.composedErrors.map(
            (error) => `${error.path || "/"}: ${error.message} (${error.keyword})`,
          ),
          ...judged.problems.map((problem) => `${problem.path}: ${problem.message}`),
        ];
  };
  return {
    load: () => record,
    validateWarnings: () => [],
    invalid: problemLines,
    stale: () => {
      const judged = verdict();
      if (judged.exit !== 23) return { stale: false, detail: "" };
      const lines = ["stale contract sources:"];
      for (const source of judged.changed) {
        const wording = source.state === "changed" ? "hash changed" : source.state;
        lines.push(`sources[${source.index}] ${wording}: ${source.path}`);
      }
      return { stale: true, detail: lines.join("\n") };
    },
  };
}

/* ------------------------------------------------------------------ *
 * The stages of the contract, in the executor's shape.
 * ------------------------------------------------------------------ */

/** One stage of the contract as the JSON writes it (§R.1, data model). */
type RawStage = Record<string, unknown>;

/** The feature slugs of the contract, in the order the features stand. */
function featureSlugsOf(record: Record<string, unknown>): readonly string[] {
  const features = record["features"];
  if (!Array.isArray(features)) return [];
  const slugs: string[] = [];
  for (const one of features) {
    const slug = (one as { slug?: unknown })?.["slug"];
    if (typeof slug === "string" && slug !== "") slugs.push(slug);
  }
  return slugs;
}

/** The feature slug of one stage: the contract's features in order, else the id. */
function slugOfStage(
  stage: RawStage,
  index: number,
  slugs: readonly string[],
  pipelineId: string,
): string {
  const byOrder = slugs[index];
  if (byOrder !== undefined) return byOrder;
  const id = stage["id"];
  if (typeof id === "string" && id.startsWith("run-")) return id.slice("run-".length);
  return slugs[0] ?? pipelineId;
}

/** The stages of the contract, each with the feature slug it runs for. */
type StagesOfContract = {
  readonly stages: readonly Stage[];
  /** The feature slug of each stage id (the stage id is `run-<slug>`). */
  readonly slugOf: ReadonlyMap<string, string>;
};

/** Convert every stage of the contract into the executor's `Stage`. */
function stagesOf(
  record: Record<string, unknown>,
  root: string,
  pipelineId: string,
): StagesOfContract {
  const raw = Array.isArray(record["stages"]) ? (record["stages"] as RawStage[]) : [];
  const slugs = featureSlugsOf(record);
  const stages: Stage[] = [];
  const slugOf = new Map<string, string>();
  raw.forEach((stage, index) => {
    const converted = stageOf(stage, index, slugs, root);
    stages.push(converted);
    slugOf.set(converted.id, slugOfStage(stage, index, slugs, pipelineId));
  });
  return { stages, slugOf };
}

/** One stage: the id, the kind, the dependencies, the action and its resume,
 * the conditions with their timing and parameters, and the recovery. */
function stageOf(stage: RawStage, index: number, slugs: readonly string[], root: string): Stage {
  const id = String(stage["id"] ?? `stage-${index + 1}`);
  const kind = String(stage["kind"] ?? "specstride");
  const cwd = resolveAgainstRoot(stage["cwd"], root);
  const action = actionOf(stage["action"], cwd, root);
  const resume = actionOf(stage["resume"] ?? stage["resume_action"], cwd, root);
  const recovery = recoveryOf(stage["recovery"]);
  return {
    id,
    kind,
    dependencies: stringsOf(stage["depends_on"] ?? stage["dependencies"]),
    ...(cwd === undefined ? {} : { cwd }),
    ...(action === undefined ? {} : { action }),
    ...(resume === undefined ? {} : { resumeAction: resume }),
    preconditions: conditionsOf(stage["preconditions"]),
    postconditions: conditionsOf(stage["postconditions"]),
    ...(recovery === undefined ? {} : { recovery }),
    ...(kind === "smoke" ? { smoke: true } : {}),
    evidence: evidenceOf(stage["evidence"]),
  };
}

/** The action: the argument list as the contract writes it, the working
 * directory, the environment entries and the time limit. */
function actionOf(raw: unknown, cwd: string | undefined, root: string): Action | undefined {
  // The contract writes the argument list directly (`action: ["specstride",
  // "run", …]`); a record form that already carries `argv` is taken as it is.
  const argv =
    Array.isArray(raw) && raw.every((one) => typeof one === "string")
      ? [...(raw as string[])]
      : Array.isArray((raw as { argv?: unknown })?.["argv"]) &&
          (raw as { argv: unknown[] })["argv"].every((one) => typeof one === "string")
        ? [...(raw as { argv: string[] })["argv"]]
        : undefined;
  if (argv === undefined) return undefined;
  const record = (raw ?? {}) as Record<string, unknown>;
  const dir = cwd ?? resolveAgainstRoot(record["cwd"], root);
  const limit = record["time_limit_seconds"] ?? record["timeout_seconds"];
  return {
    argv,
    ...(dir === undefined ? {} : { cwd: dir }),
    ...(entriesOf(record["env"]).length === 0 ? {} : { env: entriesOf(record["env"]) }),
    ...(typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? { timeLimitSeconds: limit }
      : {}),
  };
}

/** The environment entries of an action: a literal, or a value taken from a
 * named variable with whether it is required (§G.8). */
function entriesOf(raw: unknown): ActionEnvironmentEntry[] {
  if (raw === undefined || raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return [];
  }
  const out: ActionEnvironmentEntry[] = [];
  for (const [target, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      out.push({ name: target, target, required: true, value });
      continue;
    }
    const fromEnv = (value as { from_env?: unknown })?.["from_env"];
    if (typeof fromEnv === "string" && fromEnv !== "") {
      const required = (value as { required?: unknown })?.["required"] !== false;
      out.push({ name: fromEnv, target, required });
    }
  }
  return out;
}

/** One condition: the check, the timing, and the check's own members as its
 * parameters, `target` mapped to `path` (§G.8). */
function conditionOf(raw: unknown): Condition {
  const record = (raw ?? {}) as Record<string, unknown>;
  const timing = CONDITION_TIMINGS.includes(record["timing"] as ConditionTiming)
    ? (record["timing"] as ConditionTiming)
    : "preflight";
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "check" || key === "timing") continue;
    params[key === "target" ? "path" : key] = value;
  }
  return { check: String(record["check"] ?? ""), timing, params };
}

/** Every condition of one list, in order; a single value is one condition. */
function conditionsOf(raw: unknown): Condition[] {
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list.map(conditionOf);
}

/** The recovery: the attempts, the exit codes to retry, the backoff, the
 * total limit and the reason rule (§G.8, recovery). */
function recoveryOf(raw: unknown): Stage["recovery"] {
  if (raw === undefined || raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const allowed = (record["reason_rule"] as { allowed?: unknown })?.["allowed"];
  return {
    maxAttempts: positiveWholeOf(record["max_attempts"]) ?? 1,
    exitCodes: numbersOf(record["exit_codes"]),
    backoffSeconds: numbersOf(record["backoff_seconds"]),
    ...(positiveWholeOf(record["total_seconds"]) === undefined
      ? {}
      : { totalSeconds: positiveWholeOf(record["total_seconds"]) }),
    ...(Array.isArray(allowed) && allowed.every((one) => typeof one === "string")
      ? { reasonRule: { allowed: [...(allowed as string[])] } }
      : {}),
  };
}

/** The evidence of a stage: the list the contract writes, or null. */
function evidenceOf(raw: unknown): string | null {
  if (Array.isArray(raw)) return raw.map(String).join(" ");
  return raw === undefined || raw === null ? null : String(raw);
}

/** A path resolved against the repository root; absolute already, or absent. */
function resolveAgainstRoot(raw: unknown, root: string): string | undefined {
  if (typeof raw !== "string" || raw === "") return undefined;
  return isAbsolute(raw) ? raw : join(root, raw);
}

/** A list of strings; anything else reads as none. */
function stringsOf(raw: unknown): string[] {
  return Array.isArray(raw) && raw.every((one) => typeof one === "string")
    ? [...(raw as string[])]
    : [];
}

/** A list of whole numbers; anything else reads as none. */
function numbersOf(raw: unknown): number[] {
  return Array.isArray(raw) && raw.every((one) => typeof one === "number" && Number.isFinite(one))
    ? [...(raw as number[])]
    : [];
}

/** A positive whole number, or undefined. */
function positiveWholeOf(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : undefined;
}

/* ------------------------------------------------------------------ *
 * The ports of the run: the clock and the stage runner.
 * ------------------------------------------------------------------ */

/** The clock of the host: the time now, and a sleep that waits it out. */
function hostClock(): Clock {
  return {
    now: (): number => Date.now(),
    sleep: (millis: number): Promise<number> =>
      new Promise((done) => {
        setTimeout(done, millis);
      }).then((): number => Date.now()),
  };
}

/**
 * The runner of one attempt (F123-FR-011): the environment of the child is
 * built by the child-environment builder over the entries of the action, the
 * pinned keys of the launch (the feature slug of the stage among them) and
 * the colour decision; the first argument `specstride` is replaced by the
 * engine the environment names, so a contract stage runs the CLI of this
 * build without naming its path.
 */
/**
 * The environment entries every stage child of this root may take from the
 * pipeline entry's shell (F123-FR-003: a child runs on the entries its action
 * NAMES — nothing else of the entry's environment leaks). The completion
 * writes no `env` of its own, so the root names the minimum a `specstride`
 * stage needs: the search path (node, git, the verification commands), and
 * the proposer and critic the engine inside the stage reaches its harness
 * through — an unattended stage must never fall back to another harness.
 */
const STAGE_ENVIRONMENT_ENTRIES: readonly ActionEnvironmentEntry[] = Object.freeze([
  { name: "PATH", required: true },
  { name: "SPECSTRIDE_PROPOSER", required: false },
  { name: "SPECSTRIDE_CRITIC", required: false },
  { name: "SPECSTRIDE_PROPOSER_TIMEOUT_SEC", required: false },
  { name: "SPECSTRIDE_CRITIC_TIMEOUT_SEC", required: false },
  { name: "SPECSTRIDE_PROPOSER_MAX_ERRORS", required: false },
  { name: "HOME", required: false },
] as const);

function stageRunner(input: {
  readonly slugOf: ReadonlyMap<string, string>;
  readonly contract: Record<string, unknown>;
  readonly colourOn: boolean;
  readonly log: (line: string) => void;
}): AttemptRunner {
  const learning = pinnedLearningKeys(input.contract);
  return async ({ stage, action }) => {
    const argv = [...action.argv];
    const engine = process.env.SPECSTRIDE_ENGINE;
    if (argv[0] === "specstride" && engine !== undefined && engine !== "") argv[0] = engine;
    const pinned: Partial<Record<PinnedKey, string>> = {
      SPECSTRIDE_FEATURE: input.slugOf.get(stage.id) ?? stage.id,
      ...learning,
    };
    const named = new Set((action.env ?? []).map((entry) => entry.name));
    const built = buildChildEnvironment({
      entries: [
        ...(action.env ?? []),
        ...STAGE_ENVIRONMENT_ENTRIES.filter((entry) => !named.has(entry.name)),
      ],
      pinned,
      shell: process.env,
      colourOn: input.colourOn,
      kind: stage.kind,
    });
    if (built.messages.length > 0) {
      for (const message of built.messages) process.stderr.write(`[WARN] ${message}\n`);
      return { code: 127, signal: null, timedOut: false, error: built.messages.join("; ") };
    }
    return runStageChild({
      argv,
      cwd: action.cwd ?? stage.cwd,
      env: built.env,
      kind: stage.kind,
      colourOn: input.colourOn,
      stdoutIsTerminal: false,
      ...(action.timeLimitSeconds === undefined
        ? {}
        : { timeLimitSeconds: action.timeLimitSeconds }),
      hasTerminalTool: false,
      log: input.log,
    });
  };
}

/**
 * The learning keys the contract's configuration pins, and only those: a key
 * the configuration does not carry is not pinned at all, so the value of the
 * shell never reaches a child through it (F123-FR-003).
 */
function pinnedLearningKeys(record: Record<string, unknown>): Partial<Record<PinnedKey, string>> {
  const configuration = record["configuration"] as Record<string, unknown> | undefined;
  const learning = configuration?.["learning"];
  const mode =
    typeof learning === "string"
      ? learning
      : typeof (learning as { mode?: unknown })?.["mode"] === "string"
        ? (learning as { mode: string })["mode"]
        : undefined;
  const live = configuration?.["live_output"];
  const pinned: Partial<Record<PinnedKey, string>> = {};
  if (mode !== undefined && mode !== "") pinned.SPECSTRIDE_LEARNING_MODE = mode;
  if (typeof live === "string" && live !== "") pinned.SPECSTRIDE_LIVE_OUTPUT = live;
  return pinned;
}

/** The supervision record's place, by logical name, under the control root. */
function supervisionPathOf(
  place: { readonly controlRoot: string; readonly workspaceRealPath: string },
  launchId: string,
): string {
  const roots = rootPathsOf({
    home: "",
    workspaceRealPath: place.workspaceRealPath,
    workspaceId: "",
    controlRoot: place.controlRoot,
    workerRoot: "",
  });
  return resolveLogicalName("launch:<launchId>:supervision", { "<launchId>": launchId }, roots);
}

/** A random run token's hash, for the owner record (F122-FR-024: hash only). */
function mintARunTokenHash(): string {
  return createHash("sha256")
    .update(randomBytes(RUN_TOKEN_BYTES).toString("hex"), "utf8")
    .digest("hex");
}
