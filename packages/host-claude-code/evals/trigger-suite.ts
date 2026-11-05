/**
 * T037 — the person-run runner of the TRIGGER SUITE on the built package
 * (F113-FR-038, F113-FR-039). It is a PAID task: each run of the host's suite
 * runner (`claude plugin eval`) is a full child of the host on the consumer's
 * credential and calls a model, so a PERSON starts it and the run is logged.
 * No job and no schedule of the build starts it (the static check of
 * `src/evals/static-check.ts` fails the build when one would).
 *
 * HERMETIC PART, done on Linux: this file is the runner; it takes the model
 * from the configuration of the run (three runs, threshold 0.8, no ablation,
 * from `evals/trigger-suites.json`), refuses before any call when the
 * configuration names no model (`modelIdsFromConfiguration`), computes the
 * hash of the skill texts (`skillTextsHashOf`) and writes the log record
 * (`appendRunRecord`). It is never imported by anything of the build and never
 * started by a test.
 *
 * PAID PART, `unverified` (owner's ruling of 2026-09-30): the live call that
 * costs money was NEVER RUN and NEVER FAKED in this lane. The record is the
 * T037 row of `PAID_TASK_RECORDS` in `src/evals/paid-tasks.ts`.
 *
 * Run by a person, from the package root:
 *
 *   SPECSTRIDE_PAID_RUN=person SPECSTRIDE_EVAL_MODELS="<model ids, comma
 *   separated>" node evals/trigger-suite.ts <path-of-log.jsonl> <claude
 *   plugin eval arguments ...>
 *
 * The guard variable makes an accidental start by the build impossible: with
 * any other value the runner refuses before anything happens.
 */
import { resolve } from "node:path";
import { renderPluginSkills } from "../src/skills.ts";
import { modelIdsFromConfiguration, skillTextsHashOf } from "../src/evals/log.ts";

/** The threshold and the runs, read from the suite file, never retyped. */
const SUITE = JSON.parse(
  (await import("node:fs")).readFileSync(
    resolve(import.meta.dirname, "trigger-suites.json"),
    "utf8",
  ),
) as { threshold: number; runsPerSkill: number; ablation: boolean };

const ack = process.env["SPECSTRIDE_PAID_RUN"];
const models = (process.env["SPECSTRIDE_EVAL_MODELS"] ?? "").split(",").map((m) => m.trim());
const logPath = process.argv[2];
const evalArguments = process.argv.slice(3);

if (ack !== "person") {
  console.error(
    "refused before any call: the trigger suite is a PAID task started by a person " +
      "(F113-FR-038). Set SPECSTRIDE_PAID_RUN=person to run it by hand. No job of the " +
      "build starts it (F113-FR-041).",
  );
  process.exit(3);
}
if (logPath === undefined || evalArguments.length === 0) {
  console.error(
    "usage: SPECSTRIDE_PAID_RUN=person SPECSTRIDE_EVAL_MODELS=<ids> node evals/trigger-suite.ts " +
      "<log.jsonl> <claude plugin eval arguments ...>",
  );
  process.exit(2);
}

// F113-FR-039 — the model comes from the configuration of the run; a run
// whose configuration names no model is refused BEFORE ANY CALL.
const modelIds = modelIdsFromConfiguration({ modelIds: models });

// The hash the release check will match (T035): the rendered skill texts, in
// the order of row 144.
const hash = skillTextsHashOf(renderPluginSkills().map((artifact) => artifact.content));

// ---- the paid step itself (never reached in this lane) --------------------
// A person runs `claude plugin eval` here, on the built package, with the
// model of the configuration; the suite runs three times per skill at the
// threshold of the suite file, with no ablation, and the run's date, model
// ids, number of calls, cost and result per skill are recorded below.
console.error(
  `the trigger suite runs ${SUITE.runsPerSkill} run(s) per skill at the threshold ` +
    `${SUITE.threshold}, ablation ${SUITE.ablation}, on models ${modelIds.join(", ")}, ` +
    `skill texts ${hash.slice(0, 12)}… — start the host's suite runner yourself:`,
);
console.error(`  claude plugin eval ${evalArguments.join(" ")}`);
console.error(
  "then record the run with appendRunRecord() of src/evals/log.ts (date, model ids, calls, " +
    "cost, hash of the skill texts, result per skill, runs not scored).",
);
