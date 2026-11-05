/**
 * T006 — the executor of Lisa's verification package, extracted as source
 * from Lisa at `363e6a3` (`packages/verification/src/executor.ts`, 141
 * lines; `research.md` D-1, ruling 12). Recorded with its licence check in
 * `../../EXTRACTED.md`; characterized by
 * `tests/characterization/148/CT-148-2.test.ts` (CT-148-2).
 *
 * The behaviour is the baseline's, unchanged: `spawnSync` with `shell: false`
 * and a fixed argument list, the time limit of the command in seconds, the
 * environment of the process, the output of each stream cut to
 * `maxOutputBytes` characters with the marker of the baseline, `passed` only
 * on exit code 0 with no spawn error, and the gate verdict `every`
 * (F148-FR-002). What this feature adds — the environment allow-list, the
 * process group, the conditions beside the exit result, the handle-based
 * operations of EP-05 — is built on top of it in phase 3 and does not change
 * this module: a characterization test pins it as extracted.
 *
 * Two differences from the baseline file, both mechanical and neither of
 * behaviour:
 *
 * - the plan types come from `./lisa-plan.ts` (extracted in the same task)
 *   instead of `@lisa/core`, because the check runner imports only
 *   `@specstride/contracts` and `@specstride/kernel` of the product;
 * - `import type` on the type-only import, which
 *   `verbatimModuleSyntax` of `tsconfig.base.json` requires. The baseline
 *   already writes `import type`.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";
import { Buffer } from "node:buffer";
import type { VerificationCommand, VerificationGate, VerificationPlanV1 } from "./lisa-plan.ts";

export interface VerificationCommandEvidence {
  commandId: string;
  executable: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  passed: boolean;
}

export interface VerificationGateEvidence {
  planId: string;
  planHash: string;
  gateId: string;
  phase?: number;
  passed: boolean;
  commands: VerificationCommandEvidence[];
  summary: string;
}

export interface VerificationExecutorOptions {
  maxOutputBytes?: number;
  run?: (command: VerificationCommand) => VerificationCommandEvidence;
}

/**
 * The cap of the baseline: the first `max` CHARACTERS of the stream, and the
 * marker in place of everything beyond it. Nothing past the cap is kept
 * (`research.md` D-9).
 */
export function bounded(value: string | Uint8Array | null | undefined, max: number): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : Buffer.from(value).toString("utf8");
  return text.length <= max ? text : `${text.slice(0, max)}\n… verification output truncated …`;
}

/** One command, run as the baseline runs it. */
export function execute(
  command: VerificationCommand,
  maxOutputBytes: number,
): VerificationCommandEvidence {
  const start = Date.now();
  const result = spawnSync(command.executable, command.args, {
    cwd: command.cwd,
    shell: false,
    encoding: "utf8",
    timeout: command.timeoutSec * 1_000,
    maxBuffer: Math.max(maxOutputBytes * 2, 1_048_576),
    env: process.env,
  });
  const exitCode = result.status;
  return {
    commandId: command.id,
    executable: command.executable,
    args: command.args,
    cwd: command.cwd,
    exitCode,
    signal: result.signal,
    durationMs: Date.now() - start,
    stdout: bounded(result.stdout, maxOutputBytes),
    stderr: bounded(result.stderr ?? result.error?.message, maxOutputBytes),
    passed: exitCode === 0 && result.error === undefined,
  };
}

/** The gate of a phase, or the one gate whose scope is `release`. */
export function gateFor(
  plan: VerificationPlanV1,
  phase: number | "release",
): VerificationGate | undefined {
  return phase === "release"
    ? plan.gates.find((value) => value.scope === "release")
    : plan.gates.find((value) => value.scope === "phase" && value.phase === phase);
}

/** The default cap of the baseline: 64000 characters per stream. */
export const DEFAULT_MAX_OUTPUT_BYTES = 64_000;

/**
 * Run every command of one gate and return the evidence of the gate, as the
 * baseline does.
 */
export function executeVerificationGate(
  plan: VerificationPlanV1,
  phase: number | "release",
  options: VerificationExecutorOptions = {},
): VerificationGateEvidence {
  const gate = gateFor(plan, phase);
  if (!gate) {
    return {
      planId: plan.id,
      planHash: plan.contentHash,
      gateId: phase === "release" ? "missing-release-gate" : `missing-phase-${phase}-gate`,
      ...(typeof phase === "number" ? { phase } : {}),
      passed: false,
      commands: [],
      summary: `No verification gate exists for ${phase === "release" ? "release" : `phase ${phase}`}`,
    };
  }
  const suiteIds = new Set(gate.suiteRefs);
  const commandIds = new Set(
    plan.suites.filter((suite) => suiteIds.has(suite.id)).flatMap((suite) => suite.commandRefs),
  );
  const commands = plan.commands.filter((command) => commandIds.has(command.id));
  if (commands.length === 0) {
    return {
      planId: plan.id,
      planHash: plan.contentHash,
      gateId: gate.id,
      ...(gate.phase !== undefined ? { phase: gate.phase } : {}),
      passed: !gate.required,
      commands: [],
      summary: gate.required
        ? `Required gate ${gate.id} has no safe executable verification commands`
        : `Advisory gate ${gate.id} has no automated commands`,
    };
  }

  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const evidence = commands.map((command) =>
    options.run ? options.run(command) : execute(command, maxOutputBytes),
  );
  const passed = evidence.every((value) => value.passed);
  return {
    planId: plan.id,
    planHash: plan.contentHash,
    gateId: gate.id,
    ...(gate.phase !== undefined ? { phase: gate.phase } : {}),
    passed,
    commands: evidence,
    summary: passed
      ? `Verification gate ${gate.id} passed ${evidence.length} command(s)`
      : `Verification gate ${gate.id} failed: ${evidence
          .filter((value) => !value.passed)
          .map((value) => value.commandId)
          .join(", ")}`,
  };
}
