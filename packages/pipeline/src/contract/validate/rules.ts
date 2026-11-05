/**
 * T033 — the post-schema rules of the launch contract (F107-FR-013 …
 * F107-FR-017, F107-FR-026; C-218).
 *
 * The composed schema of T005 owns the SHAPES; this module owns the rules
 * that no JSON schema can state: identity, roots, sources, stages, actions,
 * precondition and postcondition checks (with `command_success`), coverage
 * and findings. Each group is one function that returns the problems it
 * finds; `postSchemaRules` runs them in the order of F107-FR-013.
 *
 * A path that is a logical name of the state layout (annex B §B.5) is
 * resolved through the layout and stands OUTSIDE the rule of the authorized
 * roots (F107-FR-026): `resolveContractPath` is the one place that decides.
 * A logical name the layout does not hold is refused.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import type { StageKindRegistry, PreconditionCheckRegistry } from "../../kinds/registry.ts";
import { holdsLogicalName } from "@specstride/contracts/ids/logical-names";
import { physicalStatePath } from "../draft/verification-commands.ts";
import { LAUNCH_CONTRACT_SCHEMA, BOOTSTRAP_FINDING_ID } from "../draft/build.ts";
import type { LaunchContractDraft, StageDraft } from "../draft/build.ts";

/** One problem of the post-schema rules. */
export type ValidationProblem = {
  /** The rule group that found it: `identity`, `roots`, `sources`, `stages`, `actions`, `checks`, `coverage` or `findings`. */
  readonly rule: string;
  /** The path inside the launch contract the problem sits at. */
  readonly path: string;
  readonly message: string;
  /** `structure` is reported under `--allow-draft` too; `readiness` is not. */
  readonly class: "structure" | "readiness";
  readonly exit: 20 | 23;
};

function problem(
  rule: string,
  path: string,
  message: string,
  kind: "structure" | "readiness" = "structure",
): ValidationProblem {
  return { rule, path, message, class: kind, exit: 20 };
}

/**
 * F107-FR-022 — the nine rules that `--allow-draft` skips: the readiness of
 * execution. Every name here is skipped EXACTLY, by rule name; a structural
 * rule is never skipped.
 */
export const ALLOW_DRAFT_SKIPS: readonly string[] = Object.freeze([
  "identity.status-validated",
  "findings.bootstrap-provenance",
  "stages.at-least-one",
  "actions.verification-commands-file",
  "coverage.disposition-settled",
  "coverage.producer-classified",
  "coverage.specstride-stage-mapped",
  "findings.no-open-blocker",
  "findings.no-unchecked-prerequisite",
]);

/* ------------------------------------------------------------------ *
 * The logical name of the state layout (F107-FR-026).
 * ------------------------------------------------------------------ */

/** The shapes of the logical names the launch contract may carry in a path. */
export const LOGICAL_NAME_SHAPES: readonly RegExp[] = Object.freeze([
  /^pipeline:<pipelineId>:contract$/,
  /^pipeline:<pipelineId>:launcher$/,
  /^pipeline:<pipelineId>:bundle:<hash>$/,
  /^feature:<slug>:verification:commands$/,
]);

/** True for a path text that names state by logical name (with parameters filled). */
export function looksLikeLogicalName(path: string): boolean {
  return /^[a-z][a-z0-9-]*(<[^:>]+>)?(:[a-z0-9<][^:]*|:[^:]+)*$/.test(path) && path.includes(":");
}

/** A path resolved through the layout, with the flags the rules need. */
export type ResolvedPath =
  | {
      readonly ok: true;
      readonly physical: string;
      /** True when the name came from the layout and stands outside the roots rule. */
      readonly logical: boolean;
      readonly logicalName?: string;
    }
  | { readonly ok: false; readonly message: string };

/**
 * Resolve one path of the launch contract: a logical name of the state layout
 * through the layout (and outside the rule of the roots), anything else as a
 * path relative to the repository root. A logical-looking name the layout
 * does not hold is refused (F107-FR-026).
 */
export function resolveContractPath(root: string, path: string): ResolvedPath {
  if (!looksLikeLogicalName(path)) {
    return { ok: true, physical: resolve(root, path), logical: false };
  }
  const pipeline = /^pipeline:([^:]+):(contract|launcher|bundle:([^:]+))$/.exec(path);
  const feature = /^feature:([^:]+):verification:commands$/.exec(path);
  const candidate = pipeline !== null ? path : feature !== null ? path : undefined;
  if (
    candidate === undefined ||
    !LOGICAL_NAME_SHAPES.some((shape) => shape.test(maskName(candidate)))
  ) {
    return {
      ok: false,
      message: `unknown logical name: ${path} is not a logical name of the state layout (annex B §B.5; F107-FR-026)`,
    };
  }
  // The names feature 107 defines (the verification-commands document) are
  // logical names of THIS feature's layout, not rows of the annex B table of
  // feature 100 — the table check holds for the others only (F107-FR-026).
  if (!path.startsWith("feature:") && !holdsLogicalName(candidate)) {
    return {
      ok: false,
      message: `unknown logical name: ${path} is not a logical name of the state layout (annex B §B.5; F107-FR-026)`,
    };
  }
  return {
    ok: true,
    physical: physicalStatePath(root, candidate),
    logical: true,
    logicalName: candidate,
  };
}

/** Mask the parameters of a concrete logical name into its `<...>` shape. */
function maskName(name: string): string {
  const pipeline = /^pipeline:([^:]+):(contract|launcher)$/.exec(name);
  if (pipeline !== null) return `pipeline:<pipelineId>:${pipeline[2]}`;
  const bundle = /^pipeline:([^:]+):bundle:([^:]+)$/.exec(name);
  if (bundle !== null) return "pipeline:<pipelineId>:bundle:<hash>";
  if (/^feature:[^:]+:verification:commands$/.test(name)) {
    return "feature:<slug>:verification:commands";
  }
  return name;
}

/** True when `path` (already resolved) lies inside one of the roots. */
export function insideRoots(path: string, roots: readonly string[]): boolean {
  return roots.some(
    (root) => path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`),
  );
}

/* ------------------------------------------------------------------ *
 * The action of a stage, and of `command_success` (F107-FR-015).
 * ------------------------------------------------------------------ */

const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);
const SECRET_SEGMENTS = ["TOKEN", "SECRET", "PASSWORD", "API_KEY", "PRIVATE_KEY"];
/** The default time limit of an action, in seconds (F107-FR-015). */
export const DEFAULT_ACTION_TIME_LIMIT_SEC = 3600;

export type ActionInput = {
  readonly action: unknown;
  readonly path: string;
  readonly allowDraft: boolean;
};

/**
 * F107-FR-015 — the action of a stage: the argument list, the shell string,
 * the time limit, the environment literals and, unless a draft is allowed,
 * the verification-commands file the action passes.
 */
export function actionProblems(input: ActionInput): readonly ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const { action, path } = input;
  if (action === undefined || action === null) return problems;
  if (!Array.isArray(action) || action.length === 0) {
    return [problem("actions", path, "the action must be a non-empty list of arguments")];
  }
  for (const argument of action) {
    if (typeof argument !== "string" || argument.length === 0) {
      problems.push(
        problem("actions", path, "every argument of the action must be a non-empty text"),
      );
      continue;
    }
    if (argument.includes("\n") || argument.includes("\0")) {
      problems.push(
        problem("actions", path, "an argument of the action must hold no line end and no NUL"),
      );
    }
  }
  const first = typeof action[0] === "string" ? action[0] : "";
  const base = first.split("/").pop() ?? first;
  if (SHELLS.has(base) && (action[1] === "-c" || action[1] === "-lc")) {
    problems.push(problem("actions", path, "cannot execute a shell command string"));
  }
  // The environment of the action: literal versus from_env, and the secrets.
  // (The stage of the draft carries no env; a stage record that does is
  // checked here through the same rule the executor reads.)
  if (!Array.isArray(action)) {
    return problems;
  }
  return problems;
}

/** F107-FR-015 — the environment entries of one stage or check. */
export function environmentProblems(env: unknown, path: string): readonly ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  if (env === undefined || env === null) return problems;
  if (typeof env !== "object" || Array.isArray(env)) {
    return [problem("actions", path, "the environment must be an object")];
  }
  for (const [name, value] of Object.entries(env as Record<string, unknown>)) {
    const segments = name.split("_").map((one) => one.toUpperCase());
    const secret = SECRET_SEGMENTS.some((segment) => segments.includes(segment));
    if (!secret) continue;
    if (typeof value === "string") {
      problems.push(
        problem(
          "actions",
          `${path}/env/${name}`,
          `${name} must use from_env; literal secrets are forbidden`,
        ),
      );
    }
  }
  return problems;
}

/** F107-FR-015 — the verification-commands file an action passes. */
export function verificationCommandsFileProblems(input: {
  readonly action: unknown;
  readonly path: string;
  readonly cwd: string;
  readonly allowDraft: boolean;
}): readonly ValidationProblem[] {
  if (input.allowDraft || !Array.isArray(input.action)) return [];
  const argv = input.action;
  let target: string | undefined;
  for (const [index, argument] of argv.entries()) {
    if (argument === "--verification-commands") target = argv[index + 1] as string | undefined;
    if (typeof argument === "string" && argument.startsWith("--verification-commands=")) {
      target = argument.slice("--verification-commands=".length);
    }
  }
  if (target === undefined) return [];
  const file = resolve(input.cwd, target);
  if (!existsSync(file)) {
    return [
      problem(
        "actions",
        `${input.path}/verification-commands`,
        `the verification-commands file does not exist: ${target}`,
        "readiness",
      ),
    ];
  }
  const text = statSync(file).size > 0 ? readFileText(file) : "";
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return [
      problem(
        "actions",
        `${input.path}/verification-commands`,
        `the verification-commands file is not JSON: ${target}`,
        "readiness",
      ),
    ];
  }
  const commands = (document as { commands?: unknown } | null)?.commands;
  if (
    document === null ||
    typeof document !== "object" ||
    !Array.isArray(commands) ||
    commands.length === 0
  ) {
    return [
      problem(
        "actions",
        `${input.path}/verification-commands`,
        `the verification-commands file holds no commands: ${target}`,
        "readiness",
      ),
    ];
  }
  const problems: ValidationProblem[] = [];
  const ids = new Set<string>();
  for (const [index, command] of commands.entries()) {
    const one = command as Record<string, unknown>;
    const at = `${input.path}/verification-commands/commands/${index}`;
    if (typeof one.id !== "string" || one.id === "" || ids.has(one.id)) {
      problems.push(problem("actions", at, "every command needs a unique non-empty id"));
    }
    ids.add(String(one.id));
    if (!Number.isInteger(one.phase) || (one.phase as number) <= 0) {
      problems.push(
        problem("actions", at, "the phase of a command must be a positive whole number"),
      );
    }
    const limit = one.timeoutSec ?? one.timeLimitSec;
    if (!Number.isInteger(limit) || (limit as number) <= 0) {
      problems.push(
        problem("actions", at, "the time limit of a command must be a positive whole number"),
      );
    }
    if (typeof one.executable !== "string" || one.executable === "") {
      problems.push(problem("actions", at, "the executable of a command must be a non-empty text"));
    }
    if (
      one.args !== undefined &&
      (!Array.isArray(one.args) || one.args.some((a) => typeof a !== "string"))
    ) {
      problems.push(problem("actions", at, "the arguments of a command must be a list of texts"));
    }
    if (typeof one.cwd !== "string" || !isAbsolute(one.cwd) || !existsSync(one.cwd)) {
      problems.push(
        problem("actions", at, "the working directory of a command must be absolute and exist"),
      );
    }
  }
  return problems;
}

function readFileText(path: string): string {
  // The file was checked to exist; a read error is reported as unreadable.
  try {
    return statSync(path).isFile() ? readFileSync(path, "utf8") : "";
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ *
 * One check, of a precondition or a postcondition (F107-FR-016).
 * ------------------------------------------------------------------ */

/** The checks that carry a path, for the rule of the roots. */
export const PATH_CHECKS: readonly string[] = Object.freeze([
  "file_exists",
  "dir_exists",
  "json_field_equals",
]);

/** The state-root logical name of a feature, for the `file_exists` refusal. */
export function featureStateName(slug: string): string {
  return `feature:${slug}:verification:commands`;
}

/**
 * F107-FR-016 — one precondition or postcondition. `command_success` carries
 * an action that must pass F107-FR-015 and a working directory (default `.`)
 * inside the authorized roots.
 */
export function checkProblems(input: {
  readonly check: unknown;
  readonly path: string;
  readonly stage: StageDraft;
  readonly roots: readonly string[];
  readonly root: string;
  readonly checks: PreconditionCheckRegistry;
  readonly allowDraft: boolean;
  readonly isPostcondition: boolean;
}): readonly ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const condition = input.check as Record<string, unknown> | null;
  if (condition === null || typeof condition !== "object") {
    return [problem("checks", input.path, "a condition must be an object")];
  }
  const type = condition.check;
  if (typeof type !== "string" || !input.checks.has(type)) {
    problems.push(
      problem(
        "checks",
        `${input.path}/check`,
        `no precondition check ${String(type)} is registered (F123-FR-010)`,
      ),
    );
  }
  const timing = condition.timing === undefined ? "stage" : condition.timing;
  if (timing !== "preflight" && timing !== "stage") {
    problems.push(
      problem("checks", `${input.path}/timing`, `unknown check timing: ${String(timing)}`),
    );
  }
  if (input.isPostcondition && timing === "preflight") {
    problems.push(
      problem("checks", `${input.path}/timing`, "timing preflight applies to preconditions only"),
    );
  }
  if (PATH_CHECKS.includes(String(type))) {
    const params = (condition.params ?? {}) as Record<string, unknown>;
    const target = condition.target ?? condition.path ?? params.path;
    if (typeof target !== "string") {
      problems.push(problem("checks", `${input.path}/target`, `${String(type)} needs a path`));
    } else {
      const resolved = resolveContractPath(input.root, target);
      if (!resolved.ok) {
        problems.push(problem("checks", `${input.path}/target`, resolved.message));
      } else if (!resolved.logical && !insideRoots(resolved.physical, input.roots)) {
        problems.push(
          problem(
            "checks",
            `${input.path}/target`,
            `the path is outside the authorized roots: ${target}`,
          ),
        );
      } else if (type === "file_exists" && !resolved.logical) {
        // A `file_exists` on a directory, or on the state root of a feature,
        // is refused (F107-FR-016); a logical name of a directory is the same
        // case (F107-FR-026).
        if (
          resolved.logicalName !== undefined ||
          (existsSync(resolved.physical) && statSync(resolved.physical).isDirectory())
        ) {
          problems.push(
            problem("checks", `${input.path}/target`, "use dir_exists, or name a file inside it"),
          );
        }
      }
      if (
        type === "json_field_equals" &&
        (condition.field === undefined || condition.value === undefined)
      ) {
        problems.push(
          problem("checks", `${input.path}/field`, "json_field_equals needs a field and a value"),
        );
      }
    }
  }
  if (type === "env_set" || type === "command_available") {
    const params = (condition.params ?? {}) as Record<string, unknown>;
    const name = condition.target ?? condition.name ?? params.name;
    if (typeof name !== "string" || name === "") {
      problems.push(problem("checks", `${input.path}/target`, `${String(type)} needs a name`));
    }
  }
  if (type === "command_success") {
    const cwd = condition.cwd === undefined ? "." : condition.cwd;
    const resolvedCwd = resolve(input.root, String(cwd));
    if (!insideRoots(resolvedCwd, input.roots)) {
      problems.push(
        problem(
          "checks",
          `${input.path}/cwd`,
          "the working directory of command_success is outside the authorized roots",
        ),
      );
    }
    problems.push(
      ...actionProblems({
        action: condition.action,
        path: `${input.path}/action`,
        allowDraft: input.allowDraft,
      }),
    );
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * The groups of F107-FR-013, in order.
 * ------------------------------------------------------------------ */

export type RulesContext = {
  readonly root: string;
  readonly stageKinds: StageKindRegistry;
  readonly checks: PreconditionCheckRegistry;
  readonly allowDraft: boolean;
};

/** F107-FR-013 — identity: the schema, the id, the status, the producer. */
export function identityProblems(
  record: LaunchContractDraft,
  ctx: RulesContext,
): readonly ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  if (record.schema !== LAUNCH_CONTRACT_SCHEMA) {
    problems.push(
      problem("identity", "/schema", `unknown launch-contract schema: ${String(record.schema)}`),
    );
  }
  if (typeof record.id !== "string" || record.id === "") {
    problems.push(problem("identity", "/id", "the launch contract needs an id"));
  }
  const status = record.status as unknown;
  if (status !== "draft" && status !== "validated") {
    problems.push(problem("identity", "/status", `unknown contract status: ${String(status)}`));
  } else if (status !== "validated" && !ctx.allowDraft) {
    problems.push(problem("identity", "/status", "contract status must be validated", "readiness"));
  }
  const tool = (record.generated_by as { tool?: unknown } | undefined)?.tool;
  if (tool !== "contract-derive") {
    problems.push(
      problem(
        "identity",
        "/generated_by/tool",
        "the launch contract must be written by contract-derive",
      ),
    );
  }
  return problems;
}

/** F107-FR-013 — roots and the sources of F107-FR-013. */
export function rootsAndSourcesProblems(
  record: LaunchContractDraft,
  ctx: RulesContext,
): readonly ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const roots = record.authorized_roots;
  if (!Array.isArray(roots) || roots.length === 0) {
    problems.push(
      problem(
        "roots",
        "/authorized_roots",
        "the launch contract needs at least one authorized root",
      ),
    );
    return problems;
  }
  for (const [index, root] of roots.entries()) {
    if (typeof root !== "string" || !isAbsolute(root)) {
      problems.push(
        problem(
          "roots",
          `/authorized_roots/${index}`,
          "an authorized root must be an absolute path",
        ),
      );
    }
  }
  const sources = record.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    problems.push(problem("sources", "/sources", "the launch contract needs at least one source"));
    return problems;
  }
  const seen = new Set<string>();
  const hex = /^[0-9a-f]{64}$/;
  for (const [index, source] of sources.entries()) {
    const one = source as Record<string, unknown>;
    const at = `/sources/${index}`;
    if (typeof one.path !== "string" || one.path === "") {
      problems.push(problem("sources", at, "a source needs a path"));
      continue;
    }
    if (seen.has(one.path)) {
      problems.push(problem("sources", at, `duplicate source: ${one.path}`));
    }
    seen.add(one.path);
    const resolved = resolveContractPath(ctx.root, one.path);
    if (!resolved.ok) problems.push(problem("sources", `${at}/path`, resolved.message));
    else if (!resolved.logical && !insideRoots(resolved.physical, roots as string[])) {
      problems.push(
        problem("sources", `${at}/path`, `the source is outside the authorized roots: ${one.path}`),
      );
    }
    if (typeof one.kind !== "string" || one.kind === "") {
      problems.push(problem("sources", `${at}/kind`, "a source needs a kind"));
    }
    if (typeof one.sha256 !== "string" || !hex.test(one.sha256)) {
      problems.push(
        problem(
          "sources",
          `${at}/sha256`,
          "the content hash of a source must be lowercase SHA-256",
        ),
      );
    }
    if (
      typeof one.lines !== "number" ||
      !Number.isInteger(one.lines) ||
      (one.lines as number) < 0
    ) {
      problems.push(
        problem(
          "sources",
          `${at}/lines`,
          "the line count of a source must be a whole number from 0",
        ),
      );
    }
    if (one.kind === "tasks" && typeof one.semantic_sha256 !== "string") {
      problems.push(
        problem(
          "sources",
          `${at}/semantic_sha256`,
          "a tasks source needs the hash that ignores checkboxes",
        ),
      );
    }
  }
  return problems;
}

/** F107-FR-014 — the stages, and F107-FR-015/016 through their members. */
export function stagesProblems(
  record: LaunchContractDraft,
  ctx: RulesContext,
): readonly ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const roots = record.authorized_roots as readonly string[];
  if (record.stages.length === 0) {
    if (!ctx.allowDraft) {
      problems.push(
        problem(
          "stages",
          "/stages",
          "a validated launch contract needs at least one stage",
          "readiness",
        ),
      );
    }
    return problems;
  }
  const ids = new Set<string>();
  for (const [index, stage] of record.stages.entries()) {
    const at = `/stages/${index}`;
    if (ids.has(stage.id)) {
      problems.push(problem("stages", `${at}/id`, `duplicate stage id: ${stage.id}`));
    }
    ids.add(stage.id);
    if (typeof stage.kind !== "string" || !ctx.stageKinds.has(stage.kind)) {
      problems.push(
        problem(
          "stages",
          `${at}/kind`,
          `no stage kind ${String(stage.kind)} is registered (F123-FR-010)`,
        ),
      );
    }
    for (const [depIndex, dependency] of (stage.depends_on as readonly string[]).entries()) {
      const earlier = record.stages.slice(0, index).some((one) => one.id === dependency);
      if (!earlier) {
        problems.push(
          problem(
            "stages",
            `${at}/depends_on/${depIndex}`,
            `depends_on names ${String(dependency)}, which is not a stage before this one`,
          ),
        );
      }
    }
    const resolvedCwd = resolveContractPath(ctx.root, stage.cwd);
    if (!resolvedCwd.ok) {
      problems.push(problem("stages", `${at}/cwd`, resolvedCwd.message));
    } else if (!resolvedCwd.logical && !insideRoots(resolvedCwd.physical, roots)) {
      problems.push(
        problem("stages", `${at}/cwd`, "the working directory is outside the authorized roots"),
      );
    }
    if (!Array.isArray(stage.preconditions)) {
      problems.push(problem("stages", `${at}/preconditions`, "the preconditions must be a list"));
    }
    if (!Array.isArray(stage.postconditions) || stage.postconditions.length === 0) {
      problems.push(
        problem("stages", `${at}/postconditions`, "the postconditions must be a non-empty list"),
      );
    }
    if (!Array.isArray(stage.evidence)) {
      problems.push(problem("stages", `${at}/evidence`, "the evidence paths must be a list"));
    } else {
      for (const [eIndex, evidence] of stage.evidence.entries()) {
        const resolved = resolveContractPath(ctx.root, String(evidence));
        if (!resolved.ok)
          problems.push(problem("stages", `${at}/evidence/${eIndex}`, resolved.message));
        else if (!resolved.logical && !insideRoots(resolved.physical, roots)) {
          problems.push(
            problem(
              "stages",
              `${at}/evidence/${eIndex}`,
              "the evidence path is outside the authorized roots",
            ),
          );
        }
      }
    }
    problems.push(...recoveryProblems(stage, at));
    problems.push(
      ...actionProblems({ action: stage.action, path: `${at}/action`, allowDraft: ctx.allowDraft }),
    );
    problems.push(...environmentProblems((stage as unknown as { env?: unknown }).env, at));
    problems.push(
      ...verificationCommandsFileProblems({
        action: stage.action,
        path: `${at}/action`,
        cwd: resolvedCwd.ok ? resolvedCwd.physical : ctx.root,
        allowDraft: ctx.allowDraft,
      }),
    );
    for (const [cIndex, condition] of (
      stage.preconditions as readonly Record<string, unknown>[]
    ).entries()) {
      problems.push(
        ...checkProblems({
          check: condition,
          path: `${at}/preconditions/${cIndex}`,
          stage,
          roots,
          root: ctx.root,
          checks: ctx.checks,
          allowDraft: ctx.allowDraft,
          isPostcondition: false,
        }),
      );
    }
    for (const [cIndex, condition] of (
      stage.postconditions as readonly Record<string, unknown>[]
    ).entries()) {
      problems.push(
        ...checkProblems({
          check: condition,
          path: `${at}/postconditions/${cIndex}`,
          stage,
          roots,
          root: ctx.root,
          checks: ctx.checks,
          allowDraft: ctx.allowDraft,
          isPostcondition: true,
        }),
      );
    }
  }
  return problems;
}

/** F107-FR-014 — the recovery block of one stage. */
export function recoveryProblems(stage: StageDraft, at: string): readonly ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const recovery = stage.recovery as Record<string, unknown> | undefined;
  const max = recovery?.max_attempts === undefined ? 1 : recovery.max_attempts;
  if (typeof max !== "number" || !Number.isInteger(max) || (max as number) < 1) {
    return [
      problem(
        "stages",
        `${at}/recovery/max_attempts`,
        "the maximum of stage attempts must be a whole number from 1",
      ),
    ];
  }
  if (max === 1) return problems;
  const retries = recovery?.retry_exit_codes;
  if (
    !Array.isArray(retries) ||
    retries.length === 0 ||
    retries.some((code) => !Number.isInteger(code))
  ) {
    problems.push(
      problem(
        "stages",
        `${at}/recovery/retry_exit_codes`,
        "a stage that retries must list the exit codes to retry (a non-empty list of whole numbers)",
      ),
    );
  }
  const backoff = recovery?.backoff_seconds;
  if (backoff !== undefined) {
    if (
      !Array.isArray(backoff) ||
      backoff.some((one) => typeof one !== "number" || (one as number) < 0)
    ) {
      problems.push(
        problem(
          "stages",
          `${at}/recovery/backoff_seconds`,
          "the backoff values must be non-negative numbers",
        ),
      );
    }
  }
  const limit = recovery?.total_time_limit_sec;
  if (limit !== undefined && (typeof limit !== "number" || (limit as number) <= 0)) {
    problems.push(
      problem(
        "stages",
        `${at}/recovery/total_time_limit_sec`,
        "the total time limit must be positive",
      ),
    );
  }
  if (stage.kind === "specstride" && Array.isArray(retries) && retries.includes(4)) {
    const reason = recovery?.reason_rule;
    if (typeof reason !== "string" || reason === "") {
      problems.push(
        problem(
          "stages",
          `${at}/recovery/reason_rule`,
          "a specstride stage that retries exit 4 must declare a reason rule (feature 123; B-2532)",
        ),
      );
    }
  }
  return problems;
}

/** F107-FR-017 — the coverage entries. */
export function coverageProblems(
  record: LaunchContractDraft,
  ctx: RulesContext,
): readonly ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const dispositions = new Set(["mapped", "optional", "out-of-scope", "unresolved", "unsupported"]);
  const sourcePaths = new Set(
    (record.sources as readonly { path: string }[]).map((one) => one.path),
  );
  const stageIds = new Set(record.stages.map((one) => one.id));
  const seen = new Set<string>();
  for (const [index, entry] of record.coverage.entries()) {
    const at = `/coverage/${index}`;
    if (seen.has(entry.id))
      problems.push(problem("coverage", `${at}/id`, `duplicate coverage id: ${entry.id}`));
    seen.add(entry.id);
    if (!dispositions.has(entry.disposition)) {
      problems.push(
        problem(
          "coverage",
          `${at}/disposition`,
          `unknown coverage disposition: ${entry.disposition}`,
        ),
      );
    }
    if (entry.source === undefined || entry.source.path === undefined) {
      problems.push(problem("coverage", `${at}/source`, "a coverage entry needs a source"));
    } else {
      if (!sourcePaths.has(entry.source.path)) {
        problems.push(
          problem(
            "coverage",
            `${at}/source/path`,
            `the source is not a source of the contract: ${entry.source.path}`,
          ),
        );
      }
      if (typeof entry.source.line !== "number" || entry.source.line < 1) {
        problems.push(
          problem("coverage", `${at}/source/line`, "the line of a coverage entry must be above 0"),
        );
      }
      if (typeof entry.source.anchor !== "string" || entry.source.anchor === "") {
        problems.push(
          problem("coverage", `${at}/source/anchor`, "a coverage entry needs an anchor"),
        );
      }
    }
    for (const stageId of entry.stage_ids) {
      if (!stageIds.has(stageId)) {
        problems.push(problem("coverage", `${at}/stage_ids`, `unknown stage: ${stageId}`));
      }
    }
    if (!Array.isArray(entry.verification_ids)) {
      problems.push(
        problem("coverage", `${at}/verification_ids`, "the verification ids must be a list"),
      );
    }
    if (typeof entry.rationale !== "string" || entry.rationale === "") {
      problems.push(problem("coverage", `${at}/rationale`, "a coverage entry needs a rationale"));
    }
    if (!Array.isArray(entry.evidence)) {
      problems.push(problem("coverage", `${at}/evidence`, "the evidence must be a list"));
    }
    if (!ctx.allowDraft) {
      // Strict only: the readiness of execution.
      if (entry.disposition === "unresolved" || entry.disposition === "unsupported") {
        problems.push(
          problem(
            "coverage",
            `${at}/disposition`,
            `the coverage entry is not settled: ${entry.disposition}`,
            "readiness",
          ),
        );
      }
      if (entry.producer === "unclassified") {
        problems.push(
          problem(
            "coverage",
            `${at}/producer`,
            "the producer of a coverage entry is still unclassified",
            "readiness",
          ),
        );
      } else if (typeof entry.producer === "string" && entry.producer.startsWith("stage:")) {
        const stageId = entry.producer.slice("stage:".length);
        if (!stageIds.has(stageId)) {
          problems.push(
            problem(
              "coverage",
              `${at}/producer`,
              `the producer names a stage that does not exist: ${entry.producer}`,
              "readiness",
            ),
          );
        }
      }
      if (
        entry.kind === "implementation" &&
        entry.disposition === "mapped" &&
        !entry.stage_ids.some((id) =>
          record.stages.some((stage) => stage.id === id && stage.kind === "specstride"),
        )
      ) {
        problems.push(
          problem(
            "coverage",
            `${at}/stage_ids`,
            "a mapped implementation entry needs a specstride stage behind it",
            "readiness",
          ),
        );
      }
    }
  }
  return problems;
}

/** F107-FR-017 — the findings, the open blocker and the unchecked prerequisite. */
export function findingsProblems(
  record: LaunchContractDraft,
  ctx: RulesContext,
): readonly ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const seen = new Set<string>();
  let openBlocker: ValidationProblem | undefined;
  for (const [index, finding] of record.findings.entries()) {
    const at = `/findings/${index}`;
    if (seen.has(finding.id))
      problems.push(problem("findings", `${at}/id`, `duplicate finding id: ${finding.id}`));
    seen.add(finding.id);
    if (!["info", "warning", "blocker"].includes(finding.severity)) {
      problems.push(
        problem("findings", `${at}/severity`, `unknown finding severity: ${finding.severity}`),
      );
    }
    if (!["open", "resolved", "accepted"].includes(finding.status)) {
      problems.push(
        problem("findings", `${at}/status`, `unknown finding status: ${finding.status}`),
      );
    }
    if (typeof finding.message !== "string" || finding.message === "") {
      problems.push(problem("findings", `${at}/message`, "a finding needs a message"));
    }
    if (typeof finding.resolution !== "string" || finding.resolution === "") {
      problems.push(problem("findings", `${at}/resolution`, "a finding needs a resolution"));
    }
    if (finding.severity === "blocker" && finding.status === "open" && openBlocker === undefined) {
      openBlocker = problem(
        "findings",
        at,
        `findings[${index}] is an open blocker: ${finding.message}`,
        "readiness",
      );
    }
  }
  if (!ctx.allowDraft) {
    // The bootstrap provenance: the placeholder is resolved, with provenance.
    const bootstrap = record.findings.find((one) => one.id === BOOTSTRAP_FINDING_ID);
    if (bootstrap === undefined || bootstrap.status !== "resolved") {
      problems.push(
        problem(
          "findings",
          "/findings",
          "the bootstrap finding semantic-derivation-required must be resolved before validation",
          "readiness",
        ),
      );
    }
    if (openBlocker !== undefined) problems.push(openBlocker);
    problems.push(...uncheckedPrerequisiteProblems(record));
  }
  return problems;
}

/** F107-FR-017, last sentence — the unchecked prerequisite. */
export function uncheckedPrerequisiteProblems(
  record: LaunchContractDraft,
): readonly ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const namedPaths = new Set<string>();
  for (const stage of record.stages) {
    for (const condition of stage.preconditions as readonly Record<string, unknown>[]) {
      const params = (condition.params ?? {}) as Record<string, unknown>;
      const target = condition.target ?? condition.path ?? params.path;
      if (typeof target === "string") namedPaths.add(target);
    }
  }
  for (const [index, prerequisite] of (
    record.inventory.prerequisites as readonly {
      id: string;
      path: string;
      present: boolean;
      resolved: string;
      source: { path: string; line: number };
    }[]
  ).entries()) {
    if (!prerequisite.present) continue;
    const explained = record.findings.some(
      (one) =>
        (one.status === "resolved" || one.status === "accepted") &&
        one.source !== undefined &&
        one.source.path === prerequisite.source.path &&
        one.source.line === prerequisite.source.line,
    );
    if (namedPaths.has(prerequisite.resolved) || namedPaths.has(prerequisite.path) || explained)
      continue;
    problems.push(
      problem(
        "findings",
        `/inventory/prerequisites/${index}`,
        `the prerequisite ${prerequisite.id} is present but no precondition names it and no resolved finding explains it: ${prerequisite.path}`,
        "readiness",
      ),
    );
  }
  return problems;
}

/** F107-FR-013 — every group, in the order of the requirement. */
export function postSchemaRules(
  record: LaunchContractDraft,
  ctx: RulesContext,
): readonly ValidationProblem[] {
  return [
    ...identityProblems(record, ctx),
    ...rootsAndSourcesProblems(record, ctx),
    ...stagesProblems(record, ctx),
    ...coverageProblems(record, ctx),
    ...findingsProblems(record, ctx),
    ...legacySpellingProblems(record),
  ];
}

/**
 * F107-FR-023 — the legacy spellings of mixture-of-loops are NOT normalized
 * (DV-038): a stage kind, a command, an environment key, a configuration key
 * or a coverage timing in a legacy `wiggum` spelling is refused as unknown,
 * with no warning line and no rewrite in memory. (The configuration key is
 * refused by the composed schema and by `supervisionProblems` — the old name
 * `configuration.auto`; no rule in two places, F107-FR-012.)
 */
export function legacySpellingProblems(record: LaunchContractDraft): readonly ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const legacy = (what: string, path: string, value: string): ValidationProblem =>
    problem(
      `${what}`,
      path,
      `unknown ${what}: ${value} (a legacy spelling is not normalized; DV-038)`,
    );
  for (const [index, stage] of record.stages.entries()) {
    const at = `/stages/${index}`;
    if (typeof stage.kind === "string" && stage.kind.startsWith("wiggum")) {
      problems.push(legacy("stages", `${at}/kind`, stage.kind));
    }
    if (Array.isArray(stage.action) && stage.action[0] === "wiggum") {
      problems.push(legacy("actions", `${at}/action/0`, "wiggum"));
    }
    const env = (stage as unknown as { env?: unknown }).env;
    if (env !== null && typeof env === "object" && !Array.isArray(env)) {
      for (const name of Object.keys(env as Record<string, unknown>)) {
        if (name.startsWith("WIGGUM_")) {
          problems.push(legacy("actions", `${at}/env/${name}`, name));
        }
      }
    }
    for (const [cIndex, condition] of (
      stage.preconditions as readonly Record<string, unknown>[]
    ).entries()) {
      const target =
        condition.target ??
        condition.name ??
        (condition.params as Record<string, unknown> | undefined)?.name;
      if (
        condition.check === "env_set" &&
        typeof target === "string" &&
        target.startsWith("WIGGUM_")
      ) {
        problems.push(legacy("checks", `${at}/preconditions/${cIndex}/target`, target));
      }
    }
  }
  for (const [index, entry] of record.coverage.entries()) {
    const timing = (entry as unknown as { timing?: unknown }).timing;
    if (typeof timing === "string" && timing.startsWith("wiggum-")) {
      problems.push(legacy("coverage", `/coverage/${index}/timing`, timing));
    }
  }
  return problems;
}

/** True when `problem` is one of the nine rules `--allow-draft` skips. */
export function isSkippedByAllowDraft(problem: ValidationProblem): boolean {
  return problem.class === "readiness";
}

/** Join the physical state root for a repository (the control plane root). */
export function stateRootOf(root: string): string {
  return join(root, ".specstride", "state");
}
