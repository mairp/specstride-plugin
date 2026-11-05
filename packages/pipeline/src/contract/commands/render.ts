/**
 * T040 — the `contract render` command (F107-FR-027, F107-FR-028;
 * C-219, C-220, C-221).
 *
 * The order of the render:
 *  1. the launch contract is validated STRICTLY (no `--allow-draft`), with
 *     the staleness verdict — exit 20 invalid, exit 23 stale, before anything
 *     is written;
 *  2. the promotion stamp is verified against the file ON DISK (checked
 *     BEFORE any normalization): a `validated` contract whose stamp does not
 *     match, or a `draft` contract, is refused with the stamp line — exit 20;
 *  3. the existing launcher is judged (F107-FR-028): edited or not generated
 *     is refused unless `--replace-edited` — exit 20;
 *  4. the launch bundle is published (F107-FR-029) — `bundle <path>`;
 *  5. the launcher is written (F107-FR-030) — `rendered <path>`.
 *
 * Exit codes: 0 rendered; 2 (unused here, kept for the flag refusals);
 * 20 invalid or refused; 23 stale.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PreconditionCheckRegistry, StageKindRegistry } from "../../kinds/registry.ts";

import { DEFAULT_CHECKS, DEFAULT_STAGE_KINDS } from "../default-registries.ts";
import { physicalStatePath } from "../draft/verification-commands.ts";
import { bundleStateName, contractStateName } from "../layout.ts";
import {
  publishBundle,
  contractHashOf,
  bundleInconsistencies,
  type PublishedBundle,
} from "../render/bundle.ts";
import {
  launcherText,
  writeLauncher,
  editedLauncherRefusal,
  launcherStateName,
} from "../render/launcher.ts";
import { readContractFromDisk, stampMatches } from "../promote/promote.ts";
import { validateInOrder, type ValidationOptions } from "../validate/order.ts";
import {
  JSON_SCHEMA_FIELD,
  NOT_PROMOTED_CLASS,
  UNREADABLE_CLASS,
  classifiedErrors,
  type ClassifiedComposedError,
  type ErrorClass,
} from "../validate/classes.ts";
import type { LearningBindingRulesPort } from "../ports.ts";

/** The arguments of one `contract render` call. */
export type RenderArgs = {
  readonly file: string;
  readonly output: string;
  readonly replaceEdited?: boolean;
  readonly root?: string;
  readonly mode?: "run" | "dry-run";
  /** The `--json` form: the errors name their class (F107-FR-040). */
  readonly json?: boolean;
};

/** The result of one `contract render` call. */
export type RenderResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly bundle?: PublishedBundle;
};

/** F107-FR-027 — one call of `contract render`. */
export function renderContract(
  input: RenderArgs,
  learning?: LearningBindingRulesPort,
): RenderResult {
  const root = input.root ?? process.cwd();
  // F107-FR-040 — every refusal of the `--json` form names its error class.
  const refuse = (line: string, klass: ErrorClass = "structure"): RenderResult => {
    if (input.json !== true)
      return { exitCode: 20, stdout: "", stderr: `contract-render: ${line}\n` };
    return {
      exitCode: 20,
      stdout: `${JSON.stringify({
        schema: JSON_SCHEMA_FIELD.render,
        ok: false,
        exit: 20,
        errors: [{ rule: "render", path: "", message: line, class: klass }],
      })}\n`,
      stderr: "",
    };
  };
  const reading = readContractFromDisk(input.file);
  if (!reading.ok) {
    return refuse(
      `cannot render launcher: cannot read contract: ${reading.message}`,
      UNREADABLE_CLASS,
    );
  }
  const record = reading.record;

  // 2. The stamp, checked BEFORE any normalization, against the file on disk.
  if (record.status !== "validated" || !stampMatches(record)) {
    return refuse(
      "cannot render launcher: status validated was not written by contract-validate --promote, " +
        "or the contract changed after it was: run contract-validate --promote again",
      NOT_PROMOTED_CLASS,
    );
  }

  // 1. Strict validation, staleness included, before anything is written.
  const options: ValidationOptions = {
    root,
    stageKinds: new StageKindRegistry(DEFAULT_STAGE_KINDS, "contract render"),
    checks: new PreconditionCheckRegistry(DEFAULT_CHECKS),
    allowDraft: false,
    noSourceCheck: false,
    ...(learning !== undefined ? { learning } : {}),
  };
  const outcome = validateInOrder(record, options);
  if (outcome.exit === 20) {
    if (input.json === true) {
      return {
        exitCode: 20,
        stdout: `${JSON.stringify({
          schema: JSON_SCHEMA_FIELD.render,
          ok: false,
          exit: 20,
          errors: classifiedErrors({
            composedErrors: outcome.composedErrors as ClassifiedComposedError[],
            problems: outcome.problems,
          }),
        })}\n`,
        stderr: "",
      };
    }
    const lines = ["invalid launch contract:"];
    for (const error of outcome.composedErrors) {
      lines.push(`${error.path || "/"}: ${error.message} (${error.keyword})`);
    }
    for (const problem of outcome.problems) {
      lines.push(`${problem.path}: ${problem.message}`);
    }
    return refuse(`cannot render launcher: ${lines.join("\n")}`);
  }
  if (outcome.exit === 23) {
    const lines = ["stale contract sources:"];
    for (const source of outcome.changed) {
      // The golden's wording, as in `contract validate` (C-234).
      const wording = source.state === "changed" ? "hash changed" : source.state;
      lines.push(`sources[${source.index}] ${wording}: ${source.path}`);
    }
    return { exitCode: 23, stdout: "", stderr: `${lines.join("\n")}\n` };
  }

  const id = String(record.id ?? "");
  const contractHash = contractHashOf(record);

  // 3. The existing launcher (F107-FR-028).
  const refusalLine = editedLauncherRefusal(input.output, input.replaceEdited === true);
  if (refusalLine !== undefined) {
    return refuse(`cannot render launcher: ${refusalLine}`);
  }

  // 4. The bundle (F107-FR-029).
  const published = publishBundle({
    root,
    pipelineId: id,
    contract: record,
    contractHash,
  });
  if (!published.ok) {
    return refuse(`cannot render launcher: ${published.reason}`);
  }
  const bundle = published.bundle;
  const bundleProblems = bundleInconsistencies(bundle.path, contractHash);
  if (bundleProblems.length > 0) {
    return refuse(`cannot render launcher: ${bundleProblems[0] ?? "the bundle is inconsistent"}`);
  }

  // 5. The launcher (F107-FR-030).
  const text = launcherText({
    pipelineId: id,
    contractHash,
    contractLogicalName: contractStateName(id),
    bundleLogicalName: bundleStateName(id, bundle.address),
    bundleHash: bundle.bundleHash,
    mode: input.mode ?? "run",
  });
  writeLauncher(input.output, text);

  return {
    exitCode: 0,
    stdout: `rendered ${input.output}\nbundle ${bundle.path}\n`,
    stderr: "",
    bundle,
  };
}

/** The launcher path under the control plane, when a host wires it there. */
export function launcherPathUnderState(root: string, pipelineId: string): string {
  return physicalStatePath(root, launcherStateName(pipelineId));
}

export { existsSync, readFileSync, join };
