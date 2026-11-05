/**
 * T040 — the six launch checks of §R.5 and the launch decision
 * (F123-FR-021).
 *
 * The six checks run in a fixed order. The first failure decides; the later
 * checks are reported `not-evaluated` and are not run. Each failure names its
 * refusal reason from the 11 of the closed set "Launch-check refusals"
 * (feature 100, annex X §X.6, row 13) and a detail. The decision is `refuse`
 * for every failure except `already-running`, where it is `attach`; the
 * decision is `launch` when all six pass. The check `run-directory-free`
 * reads the workspace lock through the lock provider of EP-13; a held lock
 * gives the decision `attach` (F123-FR-022).
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { contentHash } from "@specstride/kernel";
import { launchCheckRefusals } from "@specstride/contracts";

/** A name of one of the six checks of §R.5. */
export type LaunchCheckName =
  | "launcher-intact"
  | "contract-validated"
  | "authorized-root"
  | "launcher-syntax"
  | "launcher-dry-run"
  | "run-directory-free";

/** A decision of a launch: `launch` when all six pass, else the failing check decides. */
export type LaunchDecision = "launch" | "refuse" | "attach";

/** One row of the fixed table of §R.5. */
export type LaunchCheckSpec = {
  readonly order: 1 | 2 | 3 | 4 | 5 | 6;
  readonly name: LaunchCheckName;
  readonly reasons: readonly string[];
  readonly decision: Exclude<LaunchDecision, "launch">;
};

/** The six launch checks of §R.5, in order. */
export const LAUNCH_CHECKS: readonly LaunchCheckSpec[] = Object.freeze([
  Object.freeze({
    order: 1 as const,
    name: "launcher-intact" as const,
    reasons: ["launcher-not-found", "launcher-edited"] as const,
    decision: "refuse" as const,
  }),
  Object.freeze({
    order: 2 as const,
    name: "contract-validated" as const,
    reasons: [
      "learning-decisions-changed",
      "stale-sources",
      "open-blocker",
      "draft-contract",
      "invalid-contract",
    ] as const,
    decision: "refuse" as const,
  }),
  Object.freeze({
    order: 3 as const,
    name: "authorized-root" as const,
    reasons: ["unauthorized-root"] as const,
    decision: "refuse" as const,
  }),
  Object.freeze({
    order: 4 as const,
    name: "launcher-syntax" as const,
    reasons: ["launcher-syntax-error"] as const,
    decision: "refuse" as const,
  }),
  Object.freeze({
    order: 5 as const,
    name: "launcher-dry-run" as const,
    reasons: ["dry-run-failed"] as const,
    decision: "refuse" as const,
  }),
  Object.freeze({
    order: 6 as const,
    name: "run-directory-free" as const,
    reasons: ["already-running"] as const,
    decision: "attach" as const,
  }),
]);

/** The 11 refusal reasons of §R.5, in the fixed order of the table. */
export const LAUNCH_CHECK_REFUSALS: readonly string[] = Object.freeze(
  LAUNCH_CHECKS.flatMap((check) => [...check.reasons]),
);

/** The decision of a refusal reason: `already-running` attaches, everything else refuses. */
export function decisionOfRefusal(reason: string): Exclude<LaunchDecision, "launch"> {
  return reason === "already-running" ? "attach" : "refuse";
}

/** True when the reason is one of the 11 of the closed set of row 13. */
export function isLaunchCheckRefusal(reason: string): boolean {
  return launchCheckRefusals.has(reason);
}

/** The inputs the checks read; every port is injected, so every rule has a fake test. */
export type LaunchCheckContext = {
  /** The launcher the launch would start. */
  readonly launcherPath: string;
  /** The recorded hash of the launch bundle at the last launch (absent before one). */
  readonly recordedLauncherHash?: string;
  /** The result of validating the launch contract. */
  readonly contractValidation: {
    readonly status: string;
    readonly errorText?: string;
    readonly learningDecisionsChanged?: boolean;
    readonly staleSources?: boolean;
  };
  /** The repository root of the run, and the roots that may host one. */
  readonly repoRoot: string;
  readonly authorizedRoots: readonly string[];
  /** Syntax probe; the default runs `node --check`. */
  readonly syntaxProbe?: (path: string) => { ok: true } | { ok: false; message: string };
  /** The dry run; the default runs the launcher with `--dry-run --no-color`. */
  readonly dryRun?: (
    path: string,
    flags: readonly string[],
  ) => { exitCode: number; output: string } | { timedOut: true };
  /** The flags of the launch, passed through to the dry run. */
  readonly flags: { readonly implement?: boolean; readonly smoke?: boolean };
  /** The workspace lock, through the lock provider of EP-13. */
  readonly lockHeld: boolean;
};

/** One outcome of one check, as §R.8 `[MOL-GATE]` prints it. */
export type LaunchCheckOutcome = {
  readonly order: number;
  readonly name: LaunchCheckName;
  readonly status: "pass" | "fail" | "not-evaluated";
  readonly reason?: string;
  readonly detail?: string;
};

/** The launch decision: the outcomes and, when refused or attached, why. */
export type LaunchChecksResult = {
  readonly decision: LaunchDecision;
  readonly reason?: string;
  readonly detail?: string;
  readonly checks: readonly LaunchCheckOutcome[];
};

const DETAIL_CAP = 400 as const;

function cap(value: string): string {
  return value.length > DETAIL_CAP ? value.slice(0, DETAIL_CAP) : value;
}

/**
 * The default syntax probe: the launcher parsed as the module it is. The
 * launcher of F107-FR-030 is node's own runtime with an interpreter line and
 * `import` statements, and the state layout writes it with NO extension —
 * `node --check <file>` would parse it as CommonJS and refuse every
 * generated launcher. The probe reads the file and hands its bytes to
 * `node --input-type=module --check`, which parses exactly the module form
 * the launcher uses.
 */
function defaultSyntaxProbe(path: string): { ok: true } | { ok: false; message: string } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    return { ok: false, message: String(cause) };
  }
  const run = spawnSync(process.execPath, ["--input-type=module", "--check"], {
    input: text,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (run.status === 0) return { ok: true };
  const message = run.stderr.toString();
  return {
    ok: false,
    message: message === "" ? `node --check exited ${String(run.status)}` : message,
  };
}

/** The default dry run: the launcher with `--dry-run --no-color` and the flags of the launch. */
function defaultDryRun(
  path: string,
  flags: readonly string[],
): { exitCode: number; output: string } | { timedOut: true } {
  const run = spawnSync(process.execPath, [path, "--dry-run", "--no-color", ...flags], {
    cwd: dirname(path),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  const err = run.error as NodeJS.ErrnoException | undefined;
  if (err?.code === "ETIMEDOUT") return { timedOut: true };
  const output = `${run.stdout.toString()}${run.stderr.toString()}`;
  return { exitCode: run.status ?? 1, output };
}

/** Check 1 — `launcher-intact`: the file exists and still matches its recorded hash. */
export function checkLauncherIntact(ctx: LaunchCheckContext): LaunchCheckOutcome {
  if (!existsSync(ctx.launcherPath)) {
    return {
      order: 1,
      name: "launcher-intact",
      status: "fail",
      reason: "launcher-not-found",
      detail: cap(ctx.launcherPath),
    };
  }
  const actual = contentHash(readFileSync(ctx.launcherPath, "utf8"));
  if (ctx.recordedLauncherHash !== undefined && actual !== ctx.recordedLauncherHash) {
    return {
      order: 1,
      name: "launcher-intact",
      status: "fail",
      reason: "launcher-edited",
      detail: `recorded=${ctx.recordedLauncherHash} actual=${actual}`,
    };
  }
  return { order: 1, name: "launcher-intact", status: "pass" };
}

/** Check 2 — `contract-validated`: the launch contract validates, with no changed decisions. */
export function checkContractValidated(ctx: LaunchCheckContext): LaunchCheckOutcome {
  if (ctx.contractValidation.learningDecisionsChanged) {
    return {
      order: 2,
      name: "contract-validated",
      status: "fail",
      reason: "learning-decisions-changed",
    };
  }
  if (ctx.contractValidation.staleSources) {
    return { order: 2, name: "contract-validated", status: "fail", reason: "stale-sources" };
  }
  const text = ctx.contractValidation.errorText ?? "";
  if (/open blocking finding/i.test(text)) {
    return {
      order: 2,
      name: "contract-validated",
      status: "fail",
      reason: "open-blocker",
      detail: cap(text),
    };
  }
  if (ctx.contractValidation.status !== "validated") {
    return {
      order: 2,
      name: "contract-validated",
      status: "fail",
      reason: "draft-contract",
      detail: cap(text),
    };
  }
  if (text !== "") {
    return {
      order: 2,
      name: "contract-validated",
      status: "fail",
      reason: "invalid-contract",
      detail: cap(text),
    };
  }
  return { order: 2, name: "contract-validated", status: "pass" };
}

/** Check 3 — `authorized-root`: the repository root is inside the authorized roots. */
export function checkAuthorizedRoot(ctx: LaunchCheckContext): LaunchCheckOutcome {
  if (!ctx.authorizedRoots.includes(ctx.repoRoot)) {
    return {
      order: 3,
      name: "authorized-root",
      status: "fail",
      reason: "unauthorized-root",
      detail: cap(ctx.repoRoot),
    };
  }
  return { order: 3, name: "authorized-root", status: "pass" };
}

/** Check 4 — `launcher-syntax`: the launcher parses. */
export function checkLauncherSyntax(ctx: LaunchCheckContext): LaunchCheckOutcome {
  const probe = ctx.syntaxProbe ?? defaultSyntaxProbe;
  const result = probe(ctx.launcherPath);
  if (!result.ok) {
    return {
      order: 4,
      name: "launcher-syntax",
      status: "fail",
      reason: "launcher-syntax-error",
      detail: cap(result.message),
    };
  }
  return { order: 4, name: "launcher-syntax", status: "pass" };
}

/** Check 5 — `launcher-dry-run`: the launcher dry run exits 0 within 300 seconds. */
export function checkLauncherDryRun(ctx: LaunchCheckContext): LaunchCheckOutcome {
  const dryRun = ctx.dryRun ?? defaultDryRun;
  const flags = [
    ...(ctx.flags.implement ? ["--implement"] : []),
    ...(ctx.flags.smoke ? ["--smoke"] : []),
  ];
  const result = dryRun(ctx.launcherPath, flags);
  if ("timedOut" in result || result.exitCode !== 0) {
    const detail = "timedOut" in result ? "the dry run exceeded 300 seconds" : result.output;
    return {
      order: 5,
      name: "launcher-dry-run",
      status: "fail",
      reason: "dry-run-failed",
      detail: cap(detail),
    };
  }
  return { order: 5, name: "launcher-dry-run", status: "pass" };
}

/** Check 6 — `run-directory-free`: the workspace lock is free (a held lock attaches). */
export function checkRunDirectoryFree(ctx: LaunchCheckContext): LaunchCheckOutcome {
  if (ctx.lockHeld) {
    return {
      order: 6,
      name: "run-directory-free",
      status: "fail",
      reason: "already-running",
    };
  }
  return { order: 6, name: "run-directory-free", status: "pass" };
}

const PROBES: readonly ((ctx: LaunchCheckContext) => LaunchCheckOutcome)[] = Object.freeze([
  checkLauncherIntact,
  checkContractValidated,
  checkAuthorizedRoot,
  checkLauncherSyntax,
  checkLauncherDryRun,
  checkRunDirectoryFree,
]);

/**
 * Run the six launch checks in order and decide (F123-FR-021). The first
 * failure decides; the later checks are reported `not-evaluated` and are not
 * run. Pure with respect to the injected context.
 */
export function runLaunchChecks(ctx: LaunchCheckContext): LaunchChecksResult {
  const checks: LaunchCheckOutcome[] = [];
  for (const probe of PROBES) {
    const outcome = probe(ctx);
    checks.push(outcome);
    if (outcome.status === "fail") {
      for (let order = outcome.order + 1; order <= 6; order += 1) {
        const spec = LAUNCH_CHECKS[order - 1];
        checks.push({ order, name: spec.name, status: "not-evaluated" });
      }
      return {
        decision: decisionOfRefusal(outcome.reason as string),
        reason: outcome.reason,
        detail: outcome.detail,
        checks,
      };
    }
  }
  return { decision: "launch", checks };
}

/** The sha-256 of a launcher file, the form the launch record holds. */
export function launcherHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
