/**
 * T067 — the retrospective (F106-FR-034, F106-FR-035; annex B §B.5, §B.20).
 *
 * After a run, the retrospective is a read-only document, one per launch
 * contract hash, at the logical name `pipeline:<pipelineId>:retrospective:<hash>`
 * (T068, layout data of the `contracts` package). It is produced by the verb
 * `retro` of `supervise`, which takes the pipeline by `--launcher <path>` or by
 * `--run-dir <path>`, exactly one of the two. The handler BUILDS the document
 * and returns it; the command writes the file, as the writer annex B §B.5
 * names, through the atomic write of the kernel, and writes nothing outside
 * the pipeline run. It may suggest `learn --revert`; it never applies or
 * reverts anything, and exits 0 whatever it finds.
 *
 * Per stage of kind `specstride` it locates the feature from the first of the
 * recovery reason record, the first evidence path, or a postcondition path
 * that names a feature directory of the state layout, then runs
 * `learn --summarize` and `learn --evaluate` as child processes through the
 * process primitive of the kernel (F100-FR-234), after probing each with
 * `--help`, with a time limit of 120 seconds and with the learning variables
 * removed from the environment (F106-FR-030). Any failure is `unavailable`
 * with a reason, never fatal. Suggestions come from the evaluation lines that
 * match `[<id>]: regressed`, sorted, each once, printed only as
 * `[MOL-NEXT] suggestion (not run): <argv0> learn -w <workdir> --feature <slug> --revert <id>`.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { atomicWriteJson } from "@specstride/kernel";
import { processPrimitive } from "@specstride/kernel";
import type { ProcessPrimitive } from "@specstride/contracts/ep/kernel-services";
import { STRIPPED_ENVIRONMENT_KEYS } from "./mode.ts";
import type { SelectedLearningMode } from "./selector.ts";
import { ingressCopiedLine } from "./ingress.ts";

/** The schema id of the retrospective (annex B §B.20, owner 106; F106-FR-034). */
export const RETROSPECTIVE_SCHEMA = "specstride.retrospective/1" as const;

/** The time limit of each `learn` child process, in seconds (F106-FR-035). */
export const RETRO_TIMEOUT_SECONDS = 120 as const;

/** The logical name of the retrospective (F106-FR-034; F100-FR-227, T068). */
export function retrospectiveLogicalName(pipelineId: string, hash: string): string {
  return `pipeline:${pipelineId}:retrospective:${hash}`;
}

/** The path of the retrospective inside the pipeline run: `retrospectives/<hash>.json`. */
export function retrospectivePath(runDir: string, contractDigest: string): string {
  return join(runDir, "retrospectives", `${contractDigest}.json`);
}

/** The names of the state directory, current and legacy, of the layout. */
export const STATE_DIRNAME = ".specstride" as const;
export const LEGACY_STATE_DIRNAME = ".wiggum" as const;

/** The artifact directory a launcher keeps its bundles and run state under. */
const ARTIFACT_DIRNAME = ".mixture-of-loops" as const;

/** The name of the launch record inside a run dir. */
export const HARNESS_RUN = "harness-run.json" as const;

/** A feature directory named by a stage: `(?:^|/)(<state>|<legacy>)/features/<slug>`. */
const FEATURE_PATH = new RegExp(
  `(?:^|/)((?:${STATE_DIRNAME}|${LEGACY_STATE_DIRNAME}))/features/([^/]+)`,
);

/** An evaluation line that names a decision id: `[<id>]: regressed` (F106-FR-035). */
const EVALUATED_ID = /\[(learn-[0-9a-f]+|[A-Za-z0-9_.:-]+)\]: regressed\b/;

/** A stage of a launch contract, as far as the retrospective reads it. */
export type RetroStage = {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly cwd?: unknown;
  readonly action?: { readonly argv?: unknown } | undefined;
  readonly evidence?: unknown;
  readonly recovery?: { readonly reason?: unknown } | undefined;
  readonly postconditions?: unknown;
};

/** A launch contract, as far as the retrospective reads it. */
export type RetroContract = {
  readonly id?: unknown;
  readonly repository?: { readonly root?: unknown } | undefined;
  readonly stages?: unknown;
};

/* ── the launch contract hash (the baseline's semantic digest) ──────────── */

/** Canonical JSON: sorted keys, no white space, non-ASCII kept as text. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

/**
 * The launch contract hash a retrospective is filed under: the semantic digest
 * of the baseline — the contract without its inventory, its generator stamp and
 * the repository revision, with the tasks' semantic hash in the place of the
 * byte hash. It binds resume state to execution meaning while ignoring task
 * checkbox progress.
 */
export function semanticContractDigest(contract: RetroContract): string {
  const value: Record<string, unknown> = structuredClone(contract) as Record<string, unknown>;
  delete value["inventory"];
  delete value["generated_by"];
  const repository = value["repository"];
  if (repository !== null && typeof repository === "object") {
    delete (repository as Record<string, unknown>)["revision"];
    delete (repository as Record<string, unknown>)["dirty"];
  }
  const sources = value["sources"];
  if (Array.isArray(sources)) {
    for (const source of sources) {
      if (source !== null && typeof source === "object") {
        const record = source as Record<string, unknown>;
        if (record["kind"] === "tasks" && typeof record["semantic_sha256"] === "string") {
          record["sha256"] = record["semantic_sha256"];
        }
        delete record["semantic_sha256"];
      }
    }
  }
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/* ── path resolution, as the state layout reads ──────────────────────────── */

/** Resolve a stage path against a root; absolute paths win, nothing escapes. */
export function resolveRetroPath(value: string, root: string): string {
  const path = isAbsolute(value) ? value : join(root, value);
  return resolve(path);
}

/**
 * A path into the state directory follows Specstride's own rule: `.specstride/`,
 * unless only the legacy directory exists in that workdir. `workdir` is the
 * repository root the caller resolved already.
 */
export function withStateDirnameRule(path: string, workdir: string): string {
  const parts = path.split("/");
  const first = parts[0] ?? "";
  if (first !== STATE_DIRNAME && first !== LEGACY_STATE_DIRNAME) return resolve(workdir, path);
  const current = join(workdir, STATE_DIRNAME);
  const legacy = join(workdir, LEGACY_STATE_DIRNAME);
  const stateRoot = isDirectory(current) || !isDirectory(legacy) ? current : legacy;
  return join(stateRoot, parts.slice(1).join("/"));
}

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * F106-FR-035 — locate the feature of a `specstride` stage from the first of:
 * the recovery reason record, the first evidence path, or a postcondition path
 * that names a feature directory of the state layout. All three may be absent.
 * Returns `(workdir, featureDir, slug)` or `null`.
 */
export function stageFeatureDir(
  stage: RetroStage,
  root: string,
): { workdir: string; featureDir: string; slug: string } | null {
  const _cwd = resolveRetroPath(typeof stage.cwd === "string" ? stage.cwd : ".", root);
  const candidates: string[] = [];
  const reason = stage.recovery?.reason;
  if (
    reason !== null &&
    typeof reason === "object" &&
    typeof (reason as Record<string, unknown>)["jsonl"] === "string"
  ) {
    candidates.push((reason as Record<string, string>)["jsonl"]);
  }
  const evidence = stage.evidence;
  if (Array.isArray(evidence) && typeof evidence[0] === "string") {
    candidates.push(evidence[0]);
  }
  const postconditions = stage.postconditions;
  if (Array.isArray(postconditions)) {
    for (const check of postconditions) {
      if (
        check !== null &&
        typeof check === "object" &&
        typeof (check as Record<string, unknown>)["path"] === "string"
      ) {
        candidates.push((check as Record<string, string>)["path"]);
      }
    }
  }
  for (const value of candidates) {
    const match = FEATURE_PATH.exec(value);
    if (match === null) continue;
    const featureDir = resolve(
      withStateDirnameRule(value.slice(0, match.index + match[0].length), root),
    );
    return {
      workdir: resolve(featureDir, "..", "..", ".."),
      featureDir,
      slug: match[2],
    };
  }
  return null;
}

/* ── the `learn` child processes, through the process primitive (F100-FR-234) ── */

/** The environment a `learn` child gets: the learning variables removed (F106-FR-030). */
export function retroChildEnvironment(
  env: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const child = { ...env };
  for (const key of STRIPPED_ENVIRONMENT_KEYS) delete child[key];
  return child;
}

/** One finished `learn` child: exit code, captured standard output and error. */
export type LearnChildResult = {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
};

/** The seams the retrospective takes; tests hand fakes, the command the kernel. */
export type RetroPorts = {
  /** The process primitive; defaults to the kernel's own (F100-FR-234). */
  readonly process?: ProcessPrimitive | undefined;
  /** The environment the children inherit; the learning variables are stripped from it. */
  readonly env?: Readonly<Record<string, string>> | undefined;
  /** Where the captured standard output and standard error of a child go. */
  readonly scratchDir?: string | undefined;
};

/**
 * Run one `<argv0> learn -w <workdir> --feature <slug> <extra...>` child through
 * the process primitive of the kernel, with a time limit of 120 seconds
 * (F106-FR-234, F106-FR-035). On timeout the process group is terminated and
 * the result is a timeout, which the caller reports as `unavailable`.
 */
export async function runLearnChild(
  argv0: string,
  workdir: string,
  slug: string,
  extra: readonly string[],
  ports: RetroPorts = {},
): Promise<LearnChildResult> {
  const proc = ports.process ?? processPrimitive;
  const scratch = ports.scratchDir ?? workdir;
  const argv = [argv0, "learn", "-w", workdir, "--feature", slug, ...extra];
  const stdoutFile = join(
    scratch,
    `.retro-learn-${process.pid}-${Math.trunc(Math.random() * 1e9)}.out`,
  );
  const stderrFile = join(
    scratch,
    `.retro-learn-${process.pid}-${Math.trunc(Math.random() * 1e9)}.err`,
  );
  const started = await proc.start({
    argv,
    cwd: workdir,
    env: retroChildEnvironment(ports.env ?? {}),
    stdoutFile,
    stderrFile,
  });
  const limitMs = RETRO_TIMEOUT_SECONDS * 1000;
  const deadline = Date.now() + limitMs;
  let end = await proc.waitForEnd(started.pid);
  let timedOut = false;
  while (end.exitCode === null && end.signal === null && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 20));
    end = await proc.waitForEnd(started.pid);
  }
  if (end.exitCode === null && end.signal === null) {
    timedOut = true;
    try {
      proc.signalGroup(started.pgid, "terminate");
    } catch {
      /* a process that is already gone cannot be signalled; report the timeout */
    }
    end = await proc.waitForEnd(started.pid);
  }
  return {
    exitCode: end.exitCode,
    stdout: readTextLeniently(stdoutFile),
    stderr: readTextLeniently(stderrFile),
    timedOut,
  };
}

function readTextLeniently(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/* ── the document ─────────────────────────────────────────────────────────── */

/** One stage of the retrospective (`data-model.md`, `specstride.retrospective/1`). */
export type RetrospectiveStage = {
  readonly stage: string;
  readonly status: "ok" | "unavailable";
  readonly reason?: string;
  readonly workdir?: string;
  readonly feature_dir?: string;
  readonly feature?: string;
  readonly summary_schema?: unknown;
  readonly totals?: unknown;
  readonly phases?: unknown;
  readonly evaluations?: readonly string[];
  readonly suggestions?: readonly string[];
};

/** The retrospective document (F106-FR-034). */
export type RetrospectiveDocument = {
  readonly schema: typeof RETROSPECTIVE_SCHEMA;
  readonly pipeline: string;
  readonly contract_digest: string;
  readonly generated_at: string;
  readonly stages: readonly RetrospectiveStage[];
};

/** The runner one stage's two `learn` commands are taken through; a seam for the tests. */
export type StageLearnRunner = (
  argv0: string,
  workdir: string,
  slug: string,
  extra: readonly string[],
) => Promise<LearnChildResult>;

/** The default runner: the real child processes through the process primitive. */
export function defaultStageLearnRunner(ports: RetroPorts = {}): StageLearnRunner {
  return (argv0, workdir, slug, extra) => runLearnChild(argv0, workdir, slug, extra, ports);
}

/**
 * F106-FR-035 — what learning says about one stage's feature, read through
 * `learn --summarize` / `learn --evaluate` (both read-only). Any failure,
 * including a Specstride without those flags, is `unavailable`.
 */
export async function stageRetrospective(
  stage: RetroStage,
  root: string,
  runLearn: StageLearnRunner,
): Promise<RetrospectiveStage> {
  const entry: { stage: string; status: "ok" | "unavailable"; reason?: string } = {
    stage: typeof stage.id === "string" ? stage.id : "",
    status: "unavailable",
  };
  const located = stageFeatureDir(stage, root);
  if (located === null) {
    return {
      ...entry,
      reason: "no Specstride feature path in recovery.reason, evidence or postconditions",
    };
  }
  const { workdir, featureDir, slug } = located;
  const withFeature = { ...entry, workdir, feature_dir: featureDir, feature: slug };
  const argv = (stage.action?.argv ?? []) as unknown;
  const argv0 = Array.isArray(argv) && typeof argv[0] === "string" ? argv[0] : "specstride";
  try {
    // The probe: each flag must be offered before it is used (F106-FR-035).
    // As at the baseline, the probe is `<argv0> learn <flag> --help` and a
    // non-zero exit means this Specstride does not offer the flag.
    for (const flag of ["--summarize", "--evaluate"]) {
      const probe = await runLearn(argv0, workdir, slug, [flag, "--help"]);
      if (probe.exitCode !== 0) {
        return {
          ...withFeature,
          reason: `\`${argv0} learn ${flag}\` is not supported by this Specstride`,
        };
      }
    }
    const summary = await runLearn(argv0, workdir, slug, ["--summarize"]);
    if (summary.exitCode !== 0) {
      return { ...withFeature, reason: "`learn --summarize` exited " + String(summary.exitCode) };
    }
    const document = JSON.parse(summary.stdout) as Record<string, unknown>;
    const evaluated = await runLearn(argv0, workdir, slug, ["--evaluate"]);
    if (evaluated.exitCode !== 0) {
      return { ...withFeature, reason: "`learn --evaluate` exited " + String(evaluated.exitCode) };
    }
    const rawLines = evaluated.stdout.split("\n").filter((line) => line.trim() !== "");
    // T087 — every copied line passes the one ingress before it is written
    // into the document (F106-FR-040). A line the ingress refuses is written
    // NOWHERE — not in the document, not in the `[MOL-RETRO]` projection — and
    // the stage says that a line was withheld, without carrying its content.
    const passed: string[] = [];
    let withheld = 0;
    for (const line of rawLines) {
      const redacted = ingressCopiedLine(line);
      if (redacted === null) withheld += 1;
      else passed.push(redacted);
    }
    const lines = passed;
    const suggestions = [
      ...new Set(
        lines.flatMap((line) => {
          const match = EVALUATED_ID.exec(line);
          return match
            ? [`${argv0} learn -w ${workdir} --feature ${slug} --revert ${match[1]}`]
            : [];
        }),
      ),
    ].sort();
    const phases = (document["phases"] ?? {}) as Record<string, unknown>;
    const picked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(phases)) {
      if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>;
        picked[key] = Object.fromEntries(
          [
            "title",
            "attempts_total",
            "attempts_to_approval",
            "cost_usd",
            "work_sec_p50",
            "work_sec_p90",
            "work_sec_samples",
          ]
            .filter((name) => name in record)
            .map((name) => [name, record[name]]),
        );
      }
    }
    return {
      ...withFeature,
      status: "ok",
      summary_schema: document["schema"],
      totals: document["totals"],
      phases: picked,
      evaluations: lines,
      suggestions,
      ...(withheld > 0
        ? { reason: `the ingress withheld ${withheld} evaluation line(s) (F106-FR-040)` }
        : {}),
    };
  } catch (error) {
    return { ...withFeature, reason: `${(error as Error).name}: ${(error as Error).message}` };
  }
}

/** Build the retrospective document: one stage record per `specstride` stage (F106-FR-034). */
export async function retrospectiveDocument(input: {
  readonly contract: RetroContract;
  readonly pipeline: string;
  readonly contractDigest: string;
  readonly generatedAt: string;
  readonly runLearn: StageLearnRunner;
}): Promise<RetrospectiveDocument> {
  const root = resolveRetroPath(
    typeof input.contract.repository?.root === "string" ? input.contract.repository.root : ".",
    ".",
  );
  const stages = (Array.isArray(input.contract.stages) ? input.contract.stages : []).filter(
    (stage): stage is RetroStage =>
      stage !== null && typeof stage === "object" && (stage as RetroStage).kind === "specstride",
  );
  const records: RetrospectiveStage[] = [];
  for (const stage of stages) {
    records.push(await stageRetrospective(stage, root, input.runLearn));
  }
  return {
    schema: RETROSPECTIVE_SCHEMA,
    pipeline: input.pipeline,
    contract_digest: input.contractDigest,
    generated_at: input.generatedAt,
    stages: records,
  };
}

/* ── the lines ───────────────────────────────────────────────────────────── */

/** The `[MOL-RETRO]` lines of a written retrospective (F106-FR-035). */
export function retroLines(document: RetrospectiveDocument, path: string): string[] {
  const lines: string[] = [];
  if (document.stages.length === 0) {
    lines.push(
      `[MOL-RETRO] pipeline=${document.pipeline} status=unavailable reason="no specstride stage" path=${path}`,
    );
  }
  for (const stage of document.stages) {
    const detail = stage.reason ?? `${stage.evaluations?.length ?? 0} evaluation line(s)`;
    lines.push(
      `[MOL-RETRO] pipeline=${document.pipeline} stage=${stage.stage} status=${stage.status} ` +
        `detail=${JSON.stringify(detail)} path=${path}`,
    );
    for (const line of stage.evaluations ?? []) lines.push(`[MOL-RETRO]   ${line}`);
    for (const suggestion of stage.suggestions ?? []) {
      lines.push(`[MOL-NEXT] suggestion (not run): ${suggestion}`);
    }
  }
  return lines;
}

/** The line the command prints when the contract behind the launcher cannot be read (F106-FR-035). */
export const RETRO_UNREADABLE_LINE =
  '[MOL-RETRO] status=unavailable reason="the contract behind the launcher cannot be read"';

/* ── the command ──────────────────────────────────────────────────────────── */

/** The options of the verb `retro` of `supervise`: exactly one of the two (F106-FR-034). */
export type RetroVerbInput = {
  readonly launcher?: string | undefined;
  readonly runDir?: string | undefined;
  /** The clock: `generated_at` (local time with offset, to the second). */
  readonly now?: (() => Date) | undefined;
} & RetroPorts;

/** The result of the verb: the document, the file it wrote (if any), the lines, exit 0. */
export type RetroVerbResult = {
  readonly exit: 0;
  readonly stdout: string;
  readonly stderr: string;
  readonly document: RetrospectiveDocument | null;
  readonly path: string | null;
};

/** The bundle the launcher names: its contract and its run dir. */
export type RetroTarget =
  | {
      readonly contract: RetroContract;
      readonly contractPath: string;
      readonly pipeline: string;
      readonly runDir: string;
      readonly contractDigest: string;
    }
  | { readonly error: string };

/** The bundle directory a rendered launcher execs, read from the launcher text. */
const BUNDLE_DIR_RE = /BUNDLE_DIR="\$SCRIPT_DIR\/([^"]+)"/;

/** Read the target of the verb from a launcher: the bundle's launch contract, and the run dir under the artifact root. */
export function readRetroTargetFromLauncher(launcherPath: string): RetroTarget {
  try {
    const launcher = resolve(launcherPath);
    const text = readFileSync(launcher, "utf8");
    const found = BUNDLE_DIR_RE.exec(text);
    if (found === null) return { error: "the launcher carries no generated bundle reference" };
    const bundleDir = resolve(dirname(launcher), found[1]);
    const contractPath = join(bundleDir, "launch-contract.json");
    const contract = JSON.parse(readFileSync(contractPath, "utf8")) as RetroContract;
    const pipeline = String(contract.id ?? "");
    const artifactRoot =
      basename(dirname(launcher)) === ARTIFACT_DIRNAME
        ? dirname(launcher)
        : join(dirname(launcher), ARTIFACT_DIRNAME);
    const runDir = join(artifactRoot, "runs", pipeline);
    return {
      contract,
      contractPath,
      pipeline,
      runDir,
      contractDigest: semanticContractDigest(contract),
    };
  } catch (error) {
    return { error: `${(error as Error).name}: ${(error as Error).message}` };
  }
}

/** Read the target of the verb from a run dir: the launch record names the run dir and the contract path. */
export function readRetroTargetFromRunDir(runDirPath: string): RetroTarget {
  try {
    const runDir = resolve(runDirPath);
    const record = JSON.parse(readFileSync(join(runDir, HARNESS_RUN), "utf8")) as Record<
      string,
      unknown
    >;
    const pipeline = String(record["pipeline"] ?? "");
    const contractPath =
      typeof record["contract_path"] === "string" ? record["contract_path"] : null;
    if (contractPath === null) return { error: "the launch record names no launch contract" };
    const contract = JSON.parse(readFileSync(resolve(contractPath), "utf8")) as RetroContract;
    const namedRunDir = typeof record["run_dir"] === "string" ? record["run_dir"] : runDir;
    return {
      contract,
      contractPath,
      pipeline,
      runDir: resolve(namedRunDir),
      contractDigest: semanticContractDigest(contract),
    };
  } catch (error) {
    return { error: `${(error as Error).name}: ${(error as Error).message}` };
  }
}

/** Local time with offset, to the second, as at the baseline (`YYYY-MM-DDTHH:MM:SS±ZZZZ`). */
export function retroTimestamp(date: Date): string {
  const pad = (n: number, width = 2): string => String(Math.abs(n)).padStart(width, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const minutes = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.trunc(minutes / 60))}${pad(minutes % 60)}`
  );
}

/**
 * The handler of the verb `retro` of `supervise`. It builds the document
 * (F106-FR-035), writes the file through the atomic write of the kernel as the
 * writer annex B §B.5 names (F106-FR-034), prints the `[MOL-RETRO]` lines and
 * exits 0 whatever it finds. It never applies or reverts anything, and writes
 * nothing outside the pipeline run.
 */
export async function runRetroVerb(input: RetroVerbInput): Promise<RetroVerbResult> {
  const unusable = (stdout: string): RetroVerbResult => ({
    exit: 0,
    stdout,
    stderr: "",
    document: null,
    path: null,
  });
  const given = [input.launcher !== undefined, input.runDir !== undefined].filter(Boolean).length;
  if (given !== 1) {
    return unusable("retro: give exactly one of --launcher <path> and --run-dir <path>\n");
  }
  const target =
    input.launcher !== undefined
      ? readRetroTargetFromLauncher(input.launcher)
      : readRetroTargetFromRunDir(input.runDir!);
  if ("error" in target) return unusable(RETRO_UNREADABLE_LINE + "\n");
  const document = await retrospectiveDocument({
    contract: target.contract,
    pipeline: target.pipeline,
    contractDigest: target.contractDigest,
    generatedAt: retroTimestamp((input.now ?? (() => new Date()))()),
    runLearn: defaultStageLearnRunner(input),
  });
  const path = retrospectivePath(target.runDir, document.contract_digest);
  atomicWriteJson(path, document, { createDirectory: true, mode: 0o600 });
  return {
    exit: 0,
    stdout: retroLines(document, path).join("\n") + "\n",
    stderr: "",
    document,
    path,
  };
}

/** The mode a retrospective may suggest a revert for: never an apply (F106-FR-035). */
export const RETRO_SUGGESTED_MODE: SelectedLearningMode = "suggest";
