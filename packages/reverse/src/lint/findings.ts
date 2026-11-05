/**
 * The finding of the reverse lint, and its two printers (F140-FR-003).
 *
 * "Every finding MUST have a code of the closed family of 'Closed sets', a
 * severity, a file, an optional line and a message." The family is
 * `../codes.ts`, which `codes-check.ts` holds equal to
 * `data/finding-codes.json`; this module adds the record itself, the order
 * the lint prints findings in, and the two output modes.
 *
 * Both printers are ports of the baseline's `_print_findings`
 * (`lib/reverse.py` at `9cab15d`), so the bytes are the baseline's:
 *
 *   text  `ERROR <file>[:<line>] [<code>] <message>`
 *         `warn  <file>[:<line>] [<code>] <message>`   (two spaces: `warn ` + ` `)
 *         `-` where the finding names no file,
 *         then `<E> error(s), <W> warning(s)`.
 *   json  `json.dumps(result, indent=1, sort_keys=True)` over
 *         `{"errors": [...], "warnings": [...]}` and no summary line.
 *
 * In the JSON form the code is written under the key `rule`, which is what
 * the baseline named it. F140-FR-003 keeps that name in compatibility output
 * ("parity: as at the baseline — the field `rule` of `--json` is kept in
 * compatibility output"), so `findingToJson` renames the field and nothing
 * else does.
 */

import { type FindingCode, type FindingSeverity, isFindingCode, severityOf } from "../codes.ts";
import { compareCodePoint, type JsonValue, serializeJson } from "../inventory/serialize.ts";

/**
 * One finding of the lint.
 *
 * `file` is null for a finding that names no file (printed `-`); `line` is
 * null for a finding that names no line. `severity` is never free: it is the
 * one the closed family gives the code, which `finding()` enforces.
 */
export interface Finding {
  /** A code of the closed family. */
  readonly code: FindingCode;
  /** `error` or `warning`, as `data/finding-codes.json` gives it. */
  readonly severity: FindingSeverity;
  /** The file the finding is about, or null. */
  readonly file: string | null;
  /** The line, or null. */
  readonly line: number | null;
  /** The message, as the requirement's literal text writes it. */
  readonly message: string;
}

/** The result of a lint run: the two lists the `--json` object carries. */
export interface FindingReport {
  readonly errors: readonly Finding[];
  readonly warnings: readonly Finding[];
}

/**
 * Build a finding, refusing a code outside the closed family and a severity
 * that disagrees with the contract. The family is CLOSED (F140-SC-001): a
 * typo in a code must fail here and not reach the output.
 */
export function finding(
  code: string,
  file: string | null,
  line: number | null,
  message: string,
): Finding {
  if (!isFindingCode(code)) {
    throw new RangeError(`finding: '${code}' is not a code of the closed family`);
  }
  const severity = severityOf(code) as FindingSeverity;
  return Object.freeze({ code, severity, file, line, message });
}

/**
 * The order the lint prints findings in: by file, line, code and message
 * (F140-FR-003), with a missing file read as `""` and a missing line as `0`,
 * exactly as the baseline's sort key
 * `(f["file"] or "", f["line"] or 0, f["rule"], f["message"])`. Strings are
 * compared by code point, never by UTF-16 unit or locale.
 */
export function compareFindings(a: Finding, b: Finding): number {
  const byFile = compareCodePoint(a.file ?? "", b.file ?? "");
  if (byFile !== 0) return byFile;
  const lineA = a.line ?? 0;
  const lineB = b.line ?? 0;
  if (lineA !== lineB) return lineA < lineB ? -1 : 1;
  const byCode = compareCodePoint(a.code, b.code);
  if (byCode !== 0) return byCode;
  return compareCodePoint(a.message, b.message);
}

/**
 * Collects findings during a lint run and renders them sorted. Errors and
 * warnings are kept apart because the output prints every error before every
 * warning, and the summary counts them separately.
 */
export class Findings {
  readonly #errors: Finding[] = [];
  readonly #warnings: Finding[] = [];

  /** Record a finding; its list follows from the severity of its code. */
  add(code: string, file: string | null, line: number | null, message: string): Finding {
    const made = finding(code, file, line, message);
    (made.severity === "error" ? this.#errors : this.#warnings).push(made);
    return made;
  }

  /** Record a finding whose code must be an error of the family. */
  error(code: string, file: string | null, line: number | null, message: string): Finding {
    const made = this.add(code, file, line, message);
    if (made.severity !== "error") {
      throw new RangeError(`findings.error: '${code}' is a warning in the closed family`);
    }
    return made;
  }

  /** Record a finding whose code must be a warning of the family. */
  warn(code: string, file: string | null, line: number | null, message: string): Finding {
    const made = this.add(code, file, line, message);
    if (made.severity !== "warning") {
      throw new RangeError(`findings.warn: '${code}' is an error in the closed family`);
    }
    return made;
  }

  /** How many errors were recorded (the lint exits 3 when this is not 0). */
  get errorCount(): number {
    return this.#errors.length;
  }

  /** How many warnings were recorded. */
  get warningCount(): number {
    return this.#warnings.length;
  }

  /** The two lists, each in the printing order. The collector is not changed. */
  report(): FindingReport {
    return Object.freeze({
      errors: Object.freeze([...this.#errors].sort(compareFindings)),
      warnings: Object.freeze([...this.#warnings].sort(compareFindings)),
    });
  }
}

/** `<file>:<line>`, `<file>`, or `-` where the finding names no file. */
export function findingWhere(item: Finding): string {
  const file = item.file === null || item.file === "" ? "-" : item.file;
  // The baseline tests the line with `if f["line"]`, so a line 0 is no line.
  return item.line ? `${file}:${item.line}` : file;
}

/** One text line of a finding, without its line end. */
export function findingLine(item: Finding): string {
  const label = item.severity === "error" ? "ERROR" : "warn ";
  return `${label} ${findingWhere(item)} [${item.code}] ${item.message}`;
}

/**
 * The TEXT printer: every error, then every warning, then the summary line
 * `<E> error(s), <W> warning(s)`. Ends with a line end, as `print` leaves it.
 */
export function printFindingsText(report: FindingReport): string {
  const lines: string[] = [];
  for (const item of report.errors) lines.push(findingLine(item));
  for (const item of report.warnings) lines.push(findingLine(item));
  lines.push(`${report.errors.length} error(s), ${report.warnings.length} warning(s)`);
  return `${lines.join("\n")}\n`;
}

/**
 * One finding as the `--json` object carries it: the four keys the baseline
 * wrote, with the code under the compatibility name `rule`. The severity is
 * not a key — it is the list the finding is in.
 */
export function findingToJson(item: Finding): { readonly [key: string]: JsonValue } {
  return { rule: item.code, file: item.file, line: item.line, message: item.message };
}

/**
 * The JSON printer: one object with the lists `errors` and `warnings`,
 * indented by one space with sorted keys, and NO summary line
 * (F140-FR-003). This is the baseline's
 * `json.dumps(result, indent=1, sort_keys=True)`, whose `ensure_ascii` is
 * left at Python's default TRUE — so this is the third setting of
 * `serializeJson` and not the inventory's document serializer, which keeps
 * non-ASCII characters. Ends with a line end, as `print` leaves it.
 */
export function printFindingsJson(report: FindingReport): string {
  const document: JsonValue = {
    errors: report.errors.map(findingToJson),
    warnings: report.warnings.map(findingToJson),
  };
  return `${serializeJson(document, { indent: 1, sortKeys: true, ensureAscii: true })}\n`;
}
