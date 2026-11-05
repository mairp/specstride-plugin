/**
 * T037 — the `contract validate` command (F107-FR-021 … F107-FR-023;
 * annex G §G.4 rows; C-232 … C-236).
 *
 * Flags: `--allow-draft` (skips the NINE readiness rules of F107-FR-022 and
 * nothing structural), `--no-source-check` (skips only the staleness verdict)
 * and `--promote` (the one writer of `validated`).
 *
 * Exit codes: 0 valid; 2 `--promote` with `--allow-draft`; 20 invalid; 23
 * stale. On success the line is `valid <status> launch contract: <id>`;
 * promotion prints `promoted to validated: <id>` and rewrites the file with
 * the stamp as the last key. A file that cannot be read, is not JSON or is
 * not an object is the preserved defect of the baseline (F107-FR-021,
 * research.md row 12): `--promote` replaces it with a record whose only
 * member is the status `draft`, and the plain validation reports it as
 * invalid.
 */
import { existsSync } from "node:fs";

import { PreconditionCheckRegistry, StageKindRegistry } from "../../kinds/registry.ts";
import { DEFAULT_CHECKS, DEFAULT_STAGE_KINDS } from "../default-registries.ts";
import { VALIDATE_EXIT_CODES, exitOf } from "./exit-codes.ts";
import { atomicWriteJson as writeAtomicallyJson } from "@specstride/kernel";
import { readContractFromDisk, promotedRecord, rewriteContract } from "../promote/promote.ts";
import { validateInOrder, type ValidationOptions, VALIDATION_ORDER } from "../validate/order.ts";
import { ALLOW_DRAFT_SKIPS } from "../validate/rules.ts";
import {
  JSON_SCHEMA_FIELD,
  UNREADABLE_CLASS,
  classifiedErrors,
  type ClassifiedComposedError,
} from "../validate/classes.ts";
import type { LearningBindingRulesPort } from "../ports.ts";
import { physicalStatePath } from "../draft/verification-commands.ts";
import { contractStateName, repoRootOfContract } from "../layout.ts";

/** The arguments of one `contract validate` call. */
export type ValidateArgs = {
  readonly file: string;
  readonly allowDraft?: boolean;
  readonly noSourceCheck?: boolean;
  readonly promote?: boolean;
  readonly root?: string;
  readonly ceilings?: { readonly maxRelaunches: number; readonly wallClockSec: number };
  /** The `--json` form: the errors name their class (F107-FR-040). */
  readonly json?: boolean;
};

/** The result of one `contract validate` call. */
export type ValidateResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** The logical name the contract lives under, when the caller passed one. */
  readonly logicalName?: string;
};

/**
 * F107-FR-021 … F107-FR-023 — one call of `contract validate`. `learning` is
 * the learning-binding rules port (T007); `undefined` skips the binding.
 */
export function validateContract(
  input: ValidateArgs,
  learning?: LearningBindingRulesPort,
): ValidateResult {
  const file = input.file;
  const root = input.root ?? repoRootOfContract();
  const promote = input.promote === true;

  // F107-FR-023 — `--promote` with `--allow-draft` is refused.
  if (promote && input.allowDraft === true) {
    return {
      exitCode: exitOf(VALIDATE_EXIT_CODES, 2),
      stdout: "",
      stderr:
        "contract-validate: --promote refuses --allow-draft: promotion needs strict validation\n",
    };
  }

  // The contract as written on disk, before any normalization.
  const reading = readContractFromDisk(file);
  if (!reading.ok) {
    if (promote) {
      // The preserved defect (F107-FR-021, research.md row 12): the file is
      // replaced by a record whose only member is the status `draft`.
      writeAtomicallyJson(file, { status: "draft" });
      return {
        exitCode: exitOf(VALIDATE_EXIT_CODES, 20),
        stdout: "",
        stderr:
          "status set back to draft: the contract does not pass strict validation\n" +
          `invalid launch contract:\ncannot read contract: ${reading.message}\n`,
      };
    }
    return {
      exitCode: exitOf(VALIDATE_EXIT_CODES, 20),
      stdout:
        input.json === true
          ? `${JSON.stringify({
              schema: JSON_SCHEMA_FIELD.validate,
              ok: false,
              exit: exitOf(VALIDATE_EXIT_CODES, 20),
              errors: [
                { rule: "unreadable", path: "", message: reading.message, class: UNREADABLE_CLASS },
              ],
            })}\n`
          : "the contract is not JSON\n",
      stderr: `invalid launch contract:\ncannot read contract: ${reading.message}\n`,
    };
  }

  const options: ValidationOptions = {
    root,
    stageKinds: new StageKindRegistry(DEFAULT_STAGE_KINDS, "contract-validate-107"),
    checks: new PreconditionCheckRegistry(DEFAULT_CHECKS),
    allowDraft: input.allowDraft === true,
    noSourceCheck: input.noSourceCheck === true,
    ...(promote ? { promoting: true } : {}),
    ...(learning !== undefined ? { learning } : {}),
    ...(input.ceilings !== undefined ? { ceilings: input.ceilings } : {}),
  };
  const outcome = validateInOrder(reading.record, options);

  // Exit 20: the composed schema, or the post-schema rules, or the learning
  // binding's structural rules.
  if (outcome.exit === 20) {
    // F107-FR-040 — every error of the `--json` form names its class.
    if (input.json === true) {
      return {
        exitCode: exitOf(VALIDATE_EXIT_CODES, 20),
        stdout: `${JSON.stringify({
          schema: JSON_SCHEMA_FIELD.validate,
          ok: false,
          exit: exitOf(VALIDATE_EXIT_CODES, 20),
          errors: classifiedErrors({
            composedErrors: outcome.composedErrors as ClassifiedComposedError[],
            problems: outcome.problems,
          }),
        })}\n`,
        stderr: "",
      };
    }
    const lines: string[] = ["invalid launch contract:"];
    for (const error of outcome.composedErrors) {
      lines.push(`${error.path || "/"}: ${error.message} (${error.keyword})`);
    }
    for (const problem of outcome.problems) {
      lines.push(`${problem.path}: ${problem.message}`);
    }
    return {
      exitCode: exitOf(VALIDATE_EXIT_CODES, 20),
      stdout: "",
      stderr: `${lines.join("\n")}\n`,
    };
  }

  // Exit 23: the staleness verdict, or a refusal of the learning binding.
  if (outcome.exit === 23) {
    const exit = exitOf(VALIDATE_EXIT_CODES, 23);
    if (input.json === true) {
      return {
        exitCode: exit,
        stdout: `${JSON.stringify({
          schema: JSON_SCHEMA_FIELD.validate,
          ok: false,
          exit,
          errors: outcome.changed.map((one) => ({
            rule: "staleness",
            path: `/sources/${one.index}`,
            message: `sources[${one.index}] ${one.state}: ${one.path}`,
            class: "structure",
          })),
        })}\n`,
        stderr: "",
      };
    }
    if (outcome.changed.length > 0) {
      // A source of the contract changed — the golden's stdout line (C-234).
      const lines = ["stale contract sources:"];
      // The golden's stderr wording: a changed source is "hash changed"
      // (FX-33/stale-sources); an unreadable one keeps its own state.
      const wording = (state: string): string => (state === "changed" ? "hash changed" : state);
      for (const source of outcome.changed) {
        lines.push(`sources[${source.index}] ${wording(source.state)}: ${source.path}`);
      }
      return {
        exitCode: exitOf(VALIDATE_EXIT_CODES, 23),
        stdout: "a source of the contract changed\n",
        stderr: `${lines.join("\n")}\n`,
      };
    }
    const lines = ["stale contract sources:"];
    for (const source of outcome.changed) {
      lines.push(`sources[${source.index}] ${source.state}: ${source.path}`);
    }
    return {
      exitCode: exitOf(VALIDATE_EXIT_CODES, 23),
      stdout: "",
      stderr: `${lines.join("\n")}\n`,
    };
  }

  // Promotion: validate strictly, then rewrite with the stamp as the last key.
  if (promote) {
    if (reading.record.status === "validated") {
      // Already validated: the stamp must still match the record on disk.
      rewriteContract(file, reading.record);
    } else {
      rewriteContract(file, promotedRecord(reading.record));
    }
    const id = String((reading.record as { id?: unknown }).id ?? "");
    return {
      exitCode: exitOf(VALIDATE_EXIT_CODES, 0),
      stdout: `promoted to validated: ${id}\n`,
      stderr: "",
      logicalName: contractStateName(id),
    };
  }

  const status = String((reading.record as { status?: unknown }).status ?? "draft");
  const id = String((reading.record as { id?: unknown }).id ?? "");
  return {
    exitCode: exitOf(VALIDATE_EXIT_CODES, 0),
    stdout: `valid ${status} launch contract: ${id}\n`,
    stderr: "",
    logicalName: contractStateName(id),
  };
}

/** Re-exported for the parity tests and the wiring. */
export { ALLOW_DRAFT_SKIPS, VALIDATION_ORDER, physicalStatePath, existsSync, contractStateName };
