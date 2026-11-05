/**
 * T015 (feature 112) — the text renderer (F112-FR-023, F112-FR-024;
 * CT-112-123, CT-112-124).
 *
 * A healthy doctor prints EXACTLY ONE line of at most 200 bytes that names the
 * host, the audience, the proposer, the critic and the counts; warnings print
 * as further lines after that line; a finding of severity `ok` is never
 * printed (F112-FR-023).
 *
 * With `fail` findings the renderer prints a header line, at most 7 finding
 * lines ordered by severity and id, each of at most 200 bytes, in the form
 * `<mark> <id>: <message> -> <fix>`, and a footer that gives the number of
 * further findings and the exit code. The worst case stays at 1,700 bytes or
 * fewer (F112-FR-024, R16 F4).
 *
 * The renderer echoes NO text from outside the runtime: it prints only the
 * finding data and the subject names the configuration holds, and it names
 * state by logical name, never by a machine path.
 */
import { orderFindings } from "../runner/run.ts";
import type { Finding } from "../registry/types.ts";

/** The most finding lines the renderer prints (R16 F4). */
export const MAX_FINDING_LINES = 7 as const;
/** The cap of one printed line, in bytes (R16 F3). */
export const MAX_LINE_BYTES = 200 as const;
/** The cap of the whole text output, in bytes (R16 F4, worst case). */
export const WORST_CASE_BYTES = 1_700 as const;
/** The whole doctor skill: 1,500 tokens measured at 2.8 bytes per token. */
export const SKILL_TOKENS = 1_500 as const;
export const BYTES_PER_TOKEN = 2.8 as const;
export const SKILL_BUDGET_BYTES = Math.floor(SKILL_TOKENS * BYTES_PER_TOKEN) as number;

/** Cut a line at the byte cap without splitting a UTF-8 code point (R16 F3). */
function cutLine(line: string, cap: number = MAX_LINE_BYTES): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.byteLength <= cap) return line;
  let cut = cap - 3; // room for the ellipsis
  while (cut > 0 && ((bytes[cut] as number) & 0xc0) === 0x80) cut -= 1;
  return `${bytes.subarray(0, cut).toString("utf8")}…`;
}

/** The mark of a severity in a finding line. */
export function markOf(severity: string): string {
  if (severity === "fail") return "!!";
  if (severity === "warn") return " !";
  return " -";
}

/** The subject the healthy line names (F112-FR-023). */
export type DoctorSubject = {
  readonly host: string;
  readonly audience: string;
  readonly proposer: string;
  readonly critic: string;
};

/** The one healthy line: host, audience, proposer, critic and the counts. */
export function healthyLine(subject: DoctorSubject, findings: readonly Finding[] = []): string {
  let warnings = 0;
  let notes = 0;
  for (const f of findings) {
    if (f.severity === "warn") warnings += 1;
    else if (f.severity === "info") notes += 1;
  }
  return cutLine(
    `specstride doctor: host=${subject.host} audience=${subject.audience} ` +
      `proposer=${subject.proposer} critic=${subject.critic} ` +
      `warnings=${String(warnings)} notes=${String(notes)}`,
  );
}

/** One finding line, in the form `<mark> <id>: <message> -> <fix>` (F112-FR-024). */
export function findingLine(finding: Finding): string {
  return cutLine(
    `${markOf(finding.severity)} ${finding.id}: ${finding.message} -> ${finding.remedy}`,
  );
}

/**
 * Render the doctor output as text. Findings are ordered by severity, then id
 * (CT-112-102); findings of severity `ok` are never printed; the worst case
 * stays inside 1,700 bytes (F112-FR-024).
 */
export function renderText(
  findings: readonly Finding[],
  subject: DoctorSubject,
  exit?: number,
): string {
  const ordered = orderFindings(findings);
  const printable = ordered.filter((f) => f.severity !== "ok");
  const failing = printable.some((f) => f.severity === "fail");
  const lines: string[] = [];
  if (!failing) {
    // F112-FR-023: the one line first; warnings as further lines after it.
    lines.push(healthyLine(subject, ordered));
    for (const f of printable) lines.push(findingLine(f));
    if (printable.length > 0 && exit !== undefined) {
      lines.push(`exit ${String(exit)}`);
    }
  } else {
    // F112-FR-024: header, at most 7 finding lines, footer.
    lines.push(cutLine(`specstride doctor: ${subject.host} audience=${subject.audience}`));
    const shown = printable.slice(0, MAX_FINDING_LINES);
    for (const f of shown) lines.push(findingLine(f));
    const further = printable.length - shown.length;
    const exitCode = exit ?? 2;
    lines.push(
      further > 0
        ? `+${String(further)} more findings; exit ${String(exitCode)}`
        : `exit ${String(exitCode)}`,
    );
  }
  // The worst-case cap: drop trailing finding lines (never the header/footer)
  // until the output fits 1,700 bytes (F112-FR-024).
  while (lines.length > 2 && Buffer.byteLength(lines.join("\n"), "utf8") > WORST_CASE_BYTES) {
    const footer = lines[lines.length - 1] as string;
    const header = lines[0] as string;
    const middle = lines.slice(1, -1);
    middle.pop();
    const stillPrinted = Math.max(middle.length, 0);
    const moreFooter =
      failing && stillPrinted < printable.length
        ? `+${String(printable.length - stillPrinted)} more findings; exit ${String(exit ?? 2)}`
        : footer;
    lines.splice(0, lines.length, header, ...middle, moreFooter);
  }
  return lines.join("\n");
}

/** The token budget of F112-FR-024 breached: the build MUST fail on a breach. */
export class TokenBudgetBreachedError extends Error {
  readonly bytes: number;
  readonly budgetBytes: number;
  constructor(bytes: number, budgetBytes: number) {
    super(
      `the doctor skill is ${String(bytes)} bytes, over the budget of ` +
        `${String(budgetBytes)} bytes (${String(SKILL_TOKENS)} tokens at ` +
        `${String(BYTES_PER_TOKEN)} bytes per token) (F112-FR-024)`,
    );
    this.name = "TokenBudgetBreachedError";
    this.bytes = bytes;
    this.budgetBytes = budgetBytes;
  }
}

/**
 * The whole-skill budget (F112-FR-024): output and the body of the doctor
 * skill together stay inside 1,500 tokens at 2.8 bytes per token. Throws
 * `TokenBudgetBreachedError` on a breach, so a build that measures the skill
 * fails on it.
 */
export function checkSkillTokenBudget(outputBytes: number, bodyBytes: number): void {
  const total = outputBytes + bodyBytes;
  const budget = SKILL_TOKENS * BYTES_PER_TOKEN;
  if (total > budget) {
    throw new TokenBudgetBreachedError(total, Math.floor(budget));
  }
}
