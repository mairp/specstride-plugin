/**
 * T010 — the arguments and the start-up order of the pipeline entry
 * (F123-FR-001, F123-FR-004).
 *
 * The arguments of §R.1 and no others; `--dry-run` takes precedence over
 * `--implement` and `--smoke`; `--contract` and `--launch-dir` are required.
 * An unknown argument, or a bad value of `--color`, ends with exit 2.
 *
 * At start, in this order: read the arguments; load the launch contract and
 * validate it against the sources; print each validation warning as
 * `[WARN]`; refuse with exit 23 when the sources are stale or the bound
 * learning decisions changed (`[STALE]`, then the digest, both on standard
 * error); refuse with exit 20 when the launch contract is invalid
 * (`[INVALID]`, then the digest, both on standard error); handle a dry run;
 * take the lock. On both refusals nothing is written to the pipeline log and
 * no event is written.
 */
import { readFileSync, existsSync } from "node:fs";
import { launchContract } from "@specstride/contracts";
import {
  parseColourMode,
  decideColour,
  type ColourMode,
  type LineSink,
  type OutputMode,
  emitLine,
} from "../output/lines.ts";
import { EXIT_CODES } from "../executor/exit.ts";
import { planDryRun, type DryRunLine, type ParallelPlanInput } from "./dry-run.ts";
import type {
  PreconditionCheckRegistry,
  EvaluationContext,
  StageKindRegistry,
} from "../kinds/registry.ts";
import { unknownRegistryEntries } from "../kinds/registry.ts";
import { declareStageGraph } from "../executor/graph.ts";
import { validateLaunchContract } from "../contract/validate/compose.ts";
import type { Stage } from "../executor/types.ts";
import type { EventPort } from "../executor/events.ts";
import { nullEventPort, emitLaunchChecked } from "../executor/events.ts";

/** The accepted arguments of §R.1, and no others. */
export const ACCEPTED_FLAGS = [
  "--contract",
  "--launch-dir",
  "--implement",
  "--dry-run",
  "--smoke",
  "--color",
  "--no-color",
] as const;

/** The parsed arguments of one launch. */
export type PipelineArgs = {
  contract: string;
  launchDir: string;
  implement: boolean;
  dryRun: boolean;
  smoke: boolean;
  color?: ColourMode;
  noColor: boolean;
};

/** A usage error of §R.1: an unknown flag or a bad value of `--color`; exit 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** Parse the arguments of §R.1 (F123-FR-001). Pure. */
export function parsePipelineArgs(argv: readonly string[]): PipelineArgs {
  const args: PipelineArgs = {
    contract: "",
    launchDir: "",
    implement: false,
    dryRun: false,
    smoke: false,
    noColor: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = (next: string | undefined, name: string): string => {
      if (next === undefined) throw new UsageError(`${name} needs a value`);
      return next;
    };
    switch (flag) {
      case "--contract":
        args.contract = value(argv[++index], flag);
        break;
      case "--launch-dir":
        args.launchDir = value(argv[++index], flag);
        break;
      case "--implement":
        args.implement = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--smoke":
        args.smoke = true;
        break;
      case "--color":
        try {
          args.color = parseColourMode(value(argv[++index], flag));
        } catch (error) {
          // A bad value of --color is a usage error, exit 2 (F123-FR-001).
          throw new UsageError((error as Error).message);
        }
        break;
      case "--no-color":
        args.noColor = true;
        break;
      default:
        throw new UsageError(`unknown argument: ${flag}`);
    }
  }
  if (args.contract.length === 0) throw new UsageError("--contract is required");
  if (args.launchDir.length === 0) throw new UsageError("--launch-dir is required");
  return args;
}

/** How the launch contract and its verdict on staleness reach the entry. */
export type ContractGateway = {
  /** The raw JSON of the contract file, parsed. */
  load(path: string): Record<string, unknown>;
  /** The warnings of validation, printed as `[WARN]`, once each. */
  validateWarnings?(contract: Record<string, unknown>): string[];
  /** True when the sources are stale or the bound learning decisions changed. */
  stale(contract: Record<string, unknown>): { stale: boolean; detail: string };
  /**
   * The invalid-contract refusal of the caller's validation (F123-FR-004:
   * exit 20, after the staleness verdict): one line per problem, and empty
   * when the contract is valid. The rules of the launch contract beyond the
   * one schema (the strict validation of feature 107, source hashes against
   * the repository) are the caller's to run — the entry never re-reads the
   * sources itself.
   */
  invalid?(contract: Record<string, unknown>): string[];
};

/** The default gateway: the launch-contract record reader of feature 100. */
export const recordContractGateway: ContractGateway = {
  load(path: string): Record<string, unknown> {
    if (!existsSync(path)) throw new Error(`cannot read the launch contract: ${path}`);
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  },
  validateWarnings(): string[] {
    return [];
  },
  stale(): { stale: boolean; detail: string } {
    // The verdict on staleness is feature 100, annex C §C.7; the wiring of the
    // runtime root (feature 122) supplies it. Without it, nothing is stale.
    return { stale: false, detail: "" };
  },
};

/** The outcome of a start-up that went past the refusals. */
export type StartupOutcome =
  | { kind: "dry-run"; exit: number; lines: DryRunLine[] }
  | { kind: "locked"; exit: number }
  | { kind: "refused"; exit: number };

/** The hues of the fixed lines of §R.2. */
const HUE: Record<string, "green" | "yellow" | "red" | "cyan" | "dim" | "none" | "magenta"> = {
  "[WARN]": "none",
  "[STALE]": "none",
  "[INVALID]": "none",
};

function print(
  sink: LineSink,
  mode: OutputMode,
  colourOn: boolean,
  label: string,
  text: string,
  stream: "stdout" | "stderr",
): void {
  // `[WARN]`, `[STALE]` and `[INVALID]` are never coloured and, for the
  // warnings, never logged; the refusals write nothing to the pipeline log.
  const neverLogged = label === "[WARN]" || label === "[STALE]" || label === "[INVALID]";
  emitLine({
    label,
    text,
    hue: (HUE[label] ?? "none") as never,
    stream,
    mode,
    colourOn,
    sink: neverLogged ? { ...sink, log(): void {} } : sink,
  });
}

/** Print a refusal line: on the refusal paths nothing reaches the pipeline log. */
function printRefusal(sink: LineSink, mode: OutputMode, label: string, text: string): void {
  print({ ...sink, log(): void {} }, mode, false, label, text, "stderr");
}

/**
 * The start-up order (F123-FR-004). Everything is injected: the contract
 * gateway, the sink, the mode, the colour inputs, the checks, the event port.
 * A dry run and the two start-up refusals write no event.
 */
export async function runStartup(input: {
  args: PipelineArgs;
  gateway: ContractGateway;
  sink: LineSink;
  mode: OutputMode;
  stdoutIsTerminal: boolean;
  env: Readonly<Record<string, string | undefined>>;
  checks: PreconditionCheckRegistry;
  checkContext: EvaluationContext;
  /**
   * The registry of stage kinds (EP-19). When the caller supplies it, every
   * stage kind and every precondition check the contract names must be
   * registered; an unknown name makes the launch contract invalid (exit 20,
   * F123-FR-010) before the plan or the executor can reach it.
   */
  kinds?: StageKindRegistry;
  events?: EventPort;
  /**
   * The parallel-units option of F123-FR-006, read by the composition root:
   * the value of `loop.parallel.units`, the profile in force and the stored
   * plan of the run, if the engine stored one. The dry run prints the plan
   * only with the option on and never under the `parity` profile.
   */
  parallel?: ParallelPlanInput;
}): Promise<StartupOutcome> {
  const events = input.events ?? nullEventPort();

  // 1. Load the launch contract and validate it against the sources.
  let raw: Record<string, unknown>;
  try {
    raw = input.gateway.load(input.args.contract);
  } catch (error) {
    // A contract that cannot be read or that the record reader refuses is an
    // invalid contract (exit 20), the second refusal of the order.
    printRefusal(input.sink, input.mode, "[INVALID]", String((error as Error).message));
    printRefusal(
      input.sink,
      input.mode,
      "[DIGEST]",
      "state=failed exit=20 last-stage=none evidence=none",
    );
    return { kind: "refused", exit: EXIT_CODES.invalidContract };
  }
  const read = launchContract.tryReadLaunchContract(raw);
  // F107-FR-012 — ONE schema is the validator: the record schema of feature
  // 100 joined, at the six positions feature 107 owns (a source, the
  // inventory, the configuration, a coverage entry, a finding, a stage), with
  // the item schemas that own those positions. The record reader carries the
  // record-level rules (the schema id, the unknown top-level key) and its own
  // PLACEHOLDER words at the joined positions; where those words refuse a
  // shape the one schema accepts (reason `invalid`), the one schema decides.
  // An identity refusal (no schema field, an unknown schema, another major)
  // always stands, and a refusal both readers agree on stands.
  const composed = read.ok ? undefined : validateLaunchContract(raw);
  const identityRefused = !read.ok && read.error.reason !== "invalid";
  const oneSchemaRefused = !read.ok && composed !== undefined && !composed.ok;
  const invalidAtStart = !read.ok
    ? identityRefused
      ? read.error.message
      : oneSchemaRefused && composed !== undefined
        ? composed.errors
            .map((error) => `${error.path || "/"}: ${error.message} (${error.keyword})`)
            .join("; ")
        : undefined
    : undefined;
  const warnings = input.gateway.validateWarnings?.(raw) ?? [];
  for (const warning of warnings) {
    print(input.sink, input.mode, false, "[WARN]", warning, "stderr");
  }
  if (invalidAtStart !== undefined) {
    printRefusal(input.sink, input.mode, "[INVALID]", invalidAtStart);
    printRefusal(
      input.sink,
      input.mode,
      "[DIGEST]",
      "state=failed exit=20 last-stage=none evidence=none",
    );
    return { kind: "refused", exit: EXIT_CODES.invalidContract };
  }

  // 2. Stale then invalid: the stale refusal comes first (F123-FR-004).
  const verdict = input.gateway.stale(raw);
  if (verdict.stale) {
    printRefusal(input.sink, input.mode, "[STALE]", verdict.detail);
    printRefusal(
      input.sink,
      input.mode,
      "[DIGEST]",
      "state=failed exit=23 last-stage=none evidence=none",
    );
    return { kind: "refused", exit: EXIT_CODES.staleSources };
  }

  // 3. The invalid-contract refusal of the caller's validation (exit 20),
  //    after the staleness verdict — the strict rules of feature 107 and the
  //    source check are the caller's gateway, never re-read here.
  const invalid = input.gateway.invalid?.(raw) ?? [];
  if (invalid.length > 0) {
    printRefusal(input.sink, input.mode, "[INVALID]", invalid.join("; "));
    printRefusal(
      input.sink,
      input.mode,
      "[DIGEST]",
      "state=failed exit=20 last-stage=none evidence=none",
    );
    return { kind: "refused", exit: EXIT_CODES.invalidContract };
  }

  // 4. The registries of EP-19: an unknown kind or check is an invalid
  // launch contract (exit 20), before the plan and before the executor.
  if (input.kinds !== undefined) {
    const stages: Stage[] = Array.isArray(raw["stages"]) ? (raw["stages"] as Stage[]) : [];
    const unknown = unknownRegistryEntries({
      stages,
      kinds: input.kinds,
      checks: input.checks,
    });
    if (unknown.length > 0) {
      printRefusal(input.sink, input.mode, "[INVALID]", unknown[0]);
      printRefusal(
        input.sink,
        input.mode,
        "[DIGEST]",
        "state=failed exit=20 last-stage=none evidence=none",
      );
      return { kind: "refused", exit: EXIT_CODES.invalidContract };
    }
  }

  // 5. A dry run: the plan of §R.2, nothing executed, nothing written.
  if (input.args.dryRun) {
    const contract = (read.ok ? read.record : raw) as { id?: string };
    const plan = await planDryRun({
      contractId: String(raw["id"] ?? contract.id ?? "(no id)"),
      stages: Array.isArray(raw["stages"]) ? (raw["stages"] as Stage[]) : [],
      implement: input.args.implement,
      smoke: input.args.smoke,
      checks: input.checks,
      context: input.checkContext,
      shell: input.env,
      parallel: input.parallel,
    });
    for (const line of plan.lines) {
      print(input.sink, input.mode, false, line.label, line.text, "stdout");
    }
    return { kind: "dry-run", exit: EXIT_CODES.ok, lines: plan.lines };
  }

  // 6. The launch checks the root verifies itself, then the lock; the caller
  // continues into the executor. A dry run and the refusals above reach
  // no `launch.checked`: nothing before this point writes an event.
  emitLaunchChecked(events, { check: "launch-contract", result: "pass" }, nowSeconds());
  emitLaunchChecked(
    events,
    { check: "launcher", result: launcherPresent(input.env) ? "pass" : "fail" },
    nowSeconds(),
  );
  return { kind: "locked", exit: EXIT_CODES.lockHeld };
}

/** The time the start-up events carry, in seconds. */
function nowSeconds(): number {
  return Date.now() / 1_000;
}

/** Whether the launcher the stages call is pinned in the environment. */
function launcherPresent(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env["ENGINE"] ?? env["SPECSTRIDE_ENGINE"];
  return value !== undefined && value.length > 0;
}

/** The colour decision of the entry, from its parsed arguments (F123-FR-002). */
export function colourOf(
  args: PipelineArgs,
  env: Readonly<Record<string, string | undefined>>,
  stdoutIsTerminal: boolean,
): boolean {
  return decideColour({ noColor: args.noColor, color: args.color, env, stdoutIsTerminal });
}

/** The stage graph of the contract: serial, groups of one stage. */
export function graphOf(stages: readonly Stage[]): ReturnType<typeof declareStageGraph> {
  return declareStageGraph(stages);
}
