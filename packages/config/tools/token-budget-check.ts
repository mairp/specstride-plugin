#!/usr/bin/env node
/**
 * T018 — the token-budget check of `config show` and `config schema`, for the
 * build (F110-FR-012, F110-FR-025; annex G §G.5 with F100-FR-187).
 *
 * §G.5 says the measure in the build is bytes, at 2.8 bytes per token, and
 * F100-FR-187 says the build must measure bytes and fail on a breach. This is
 * that check: it runs each host-facing form of the two commands, measures the
 * bytes of standard output, and exits 1 when one is over the limit that
 * `src/cli/budget.ts` derives from §G.5. The two `--all` forms carry no §G.5
 * budget — a host skill never asks for them — so they are measured and reported
 * and never fail the build; printing them is what keeps the cost of the full dump
 * from being silently unknown.
 *
 * Usage:
 *   node packages/config/tools/token-budget-check.ts [--json]
 *
 * Exit codes: 0 every host-facing form is inside its budget, 1 a breach.
 */
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  COMMAND_BYTE_BUDGET,
  COMMAND_TOKEN_BUDGET,
  DERIVATION,
  measure,
  reportLine,
  type BudgetMeasurement,
} from "../src/cli/budget.ts";
import { runConfigShow } from "../src/cli/show.ts";
import { runConfigSchema } from "../src/cli/schema.ts";
import { resolveConfiguration } from "../src/load/merge.ts";

/**
 * The configuration the check measures `config show` on: the scenario of
 * `quickstart.md` step 1 without its files — a key set by a flag and by the
 * environment, a telemetry flag of §K.10, and the profile selected — which is
 * what a host skill's call looks like.
 */
export const SUBJECT_CONFIGURATION = Object.freeze({
  argv: Object.freeze([
    "--set",
    "loop.maxIter=3",
    "--telemetry",
    "--loki-url",
    "http://localhost:3100",
  ]),
  environment: Object.freeze({
    SPECSTRIDE_LOOP_MAX_REJECTS: "1",
    SPECSTRIDE_ROLES_PROPOSER_TIMEOUT_SEC: "600",
    SPECSTRIDE_LOOP_YIELD_POLL_SEC: "20",
  }),
});

/** Every measurement the check takes, in the order it prints them. */
export function measurements(): readonly BudgetMeasurement[] {
  const resolved = resolveConfiguration({
    argv: [...SUBJECT_CONFIGURATION.argv],
    environment: { ...SUBJECT_CONFIGURATION.environment },
  });
  const show = (argv: readonly string[]): string => runConfigShow({ resolved, argv }).stdout;
  const schema = (argv: readonly string[]): string => runConfigSchema(argv).stdout;
  return Object.freeze([
    measure("config show", show([])),
    measure("config show --json", show(["--json"])),
    measure("config schema", schema([])),
    measure("config schema --json", schema(["--json"])),
    measure("config schema --key loop.maxIter", schema(["--key", "loop.maxIter"])),
    // No §G.5 budget: measured and reported, never a breach.
    measure("config show --all", show(["--all"]), { hostFacing: false }),
    measure("config schema --all", schema(["--all"]), { hostFacing: false }),
    measure("config schema --all --json", schema(["--all", "--json"]), { hostFacing: false }),
  ]);
}

/** The breaches of a set of measurements (F100-FR-187). */
export function breaches(taken: readonly BudgetMeasurement[]): readonly BudgetMeasurement[] {
  return Object.freeze(taken.filter((m) => !m.withinBudget));
}

function main(argv: readonly string[]): number {
  const taken = measurements();
  const over = breaches(taken);
  if (argv.includes("--json")) {
    process.stdout.write(
      `${JSON.stringify({
        derivation: DERIVATION,
        tokenBudget: COMMAND_TOKEN_BUDGET,
        byteBudget: COMMAND_BYTE_BUDGET,
        measurements: taken,
        breaches: over.length,
      })}\n`,
    );
  } else {
    process.stdout.write(`token budget of the configuration commands: ${DERIVATION}\n`);
    for (const m of taken) process.stdout.write(`  ${reportLine(m)}\n`);
    process.stdout.write(
      over.length === 0
        ? `checked ${taken.length} outputs, 0 over budget\n`
        : `checked ${taken.length} outputs, ${over.length} OVER BUDGET\n`,
    );
  }
  for (const m of over) {
    process.stderr.write(
      `the output of \`${m.subject}\` holds ${m.bytes} bytes; the budget derived from annex G ` +
        `§G.5 is ${m.limit} bytes (F100-FR-187, F110-FR-012)\n`,
    );
  }
  return over.length === 0 ? 0 : 1;
}

// Run only when this file is the entry point: the suite of CT-110-111 imports
// `measurements` and `breaches` and must not run the check on import.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
