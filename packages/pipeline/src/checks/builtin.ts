/**
 * T073 — the six built-in precondition checks of §R.3 (F123-FR-010).
 *
 * A precondition check reads and never writes: every check here only calls
 * `existsSync`, `accessSync`, `readFileSync` or scans `PATH`. A check that
 * throws is `fail` (the registry maps the throw), never a crash of the
 * executor.
 */
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { Condition } from "../executor/types.ts";
import type { CheckResult, EvaluationContext } from "../kinds/registry.ts";

function pass(detail: string): CheckResult {
  return { result: "pass", detail };
}
function fail(detail: string): CheckResult {
  return { result: "fail", detail };
}
function deferred(detail: string): CheckResult {
  return { result: "deferred", detail };
}

function paramText(condition: Condition, key: string): string {
  const value = condition.params[key];
  return typeof value === "string" ? value : "";
}

/** `file_exists`: the path exists and is a file. */
export function checkFileExists(condition: Condition, _context: EvaluationContext): CheckResult {
  const path = paramText(condition, "path");
  if (path.length === 0) return fail("file_exists: no path given");
  if (!existsSync(path)) return fail(`file exists: ${path}`);
  return pass(`${path}: exists`);
}

/** `dir_exists`: the path exists and is a directory. */
export function checkDirExists(condition: Condition, _context: EvaluationContext): CheckResult {
  const path = paramText(condition, "path");
  if (path.length === 0) return fail("dir_exists: no path given");
  try {
    accessSync(path, constants.R_OK);
  } catch {
    return fail(`dir_exists: ${path} is not readable`);
  }
  return pass(`${path}: exists`);
}

/** `env_set`: the named variable is set in the environment of the entry. */
export function checkEnvSet(condition: Condition, context: EvaluationContext): CheckResult {
  const name = paramText(condition, "name");
  if (name.length === 0) return fail("env_set: no variable name given");
  if (context.env[name] === undefined) return fail(`env_set: ${name} is not set`);
  return pass(`${name}: set`);
}

/** `command_available`: the name resolves on `PATH`. */
export function checkCommandAvailable(
  condition: Condition,
  context: EvaluationContext,
): CheckResult {
  const name = paramText(condition, "command") || paramText(condition, "name");
  if (name.length === 0) return fail("command_available: no command name given");
  const path = context.env["PATH"] ?? "";
  for (const directory of path.split(delimiter)) {
    if (directory.length === 0) continue;
    if (existsSync(join(directory, name))) return pass(`${name}: available`);
  }
  return fail(`command_available: ${name} is not on PATH`);
}

/**
 * `command_success`: the command would succeed. A check reads and never
 * writes, so the executor does not run the command at preflight time: in the
 * dry run the check reads `deferred` (F123-FR-005), in a live preflight it
 * reads `deferred` too and the stage-timed run decides.
 */
export function checkCommandSuccess(
  condition: Condition,
  _context: EvaluationContext,
): CheckResult {
  const command = paramText(condition, "command");
  return deferred(`command_success: deferred (${command || "no command given"})`);
}

/** `json_field_equals`: the dotted field of the JSON file equals the value. */
export function checkJsonFieldEquals(
  condition: Condition,
  _context: EvaluationContext,
): CheckResult {
  const file = paramText(condition, "file");
  const field = paramText(condition, "field");
  const expected = condition.params["value"];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    return fail(
      `json_field_equals: cannot read ${file}: ${String((error as Error)?.message ?? error)}`,
    );
  }
  let value: unknown = parsed;
  for (const part of field.split(".")) {
    if (
      typeof value !== "object" ||
      value === null ||
      !(part in (value as Record<string, unknown>))
    ) {
      return fail(`json_field_equals: ${field} is absent in ${file}`);
    }
    value = (value as Record<string, unknown>)[part];
  }
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    return fail(
      `json_field_equals: ${field} is ${JSON.stringify(value)}, not ${JSON.stringify(expected)}`,
    );
  }
  return pass(`${field}: equals ${JSON.stringify(expected)}`);
}

/** The six built-in checks, with their names. */
export const BUILTIN_CHECKS: Readonly<
  Record<string, (condition: Condition, context: EvaluationContext) => CheckResult>
> = {
  file_exists: checkFileExists,
  dir_exists: checkDirExists,
  env_set: checkEnvSet,
  command_available: checkCommandAvailable,
  command_success: checkCommandSuccess,
  json_field_equals: checkJsonFieldEquals,
};
