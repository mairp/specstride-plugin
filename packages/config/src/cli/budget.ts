/**
 * T018 — the token budget of `config show` and `config schema` (F110-FR-012,
 * F110-FR-025; annex G §G.5 with F100-FR-187).
 *
 * §G.5 does not give a budget per command: it gives the budgets of host-facing
 * output and the measure of the build (bytes, at 2.8 bytes per token), and
 * F100-FR-187 says that the output of every command a host skill calls must stay
 * inside "the byte limit that **its owner** derives from the budgets of §G.5".
 * Feature 110 is the owner of `config show` and `config schema`, so the
 * derivation is stated here, once, as data a check reads:
 *
 * - The host skill that calls them is `specstride-run`, whose budget is 8,000
 *   tokens (§G.5, row 1). A configuration command is one of several calls the
 *   skill makes in a run, so the owner takes **one quarter** of that skill's
 *   budget for one call: 2,000 tokens, which is 5,600 bytes at 2.8 bytes per
 *   token.
 * - `config show` without `--all` and `config schema` without `--all` are the
 *   host-facing forms and are held to that limit, in both output forms (the form
 *   for people and the `--json` form of F100-FR-172). This is what "terse by
 *   default" means for these two commands (`plan.md`, Constitution row XIX).
 * - `--all` prints every one of the 259 keys of the catalogue. It is asked for by
 *   a person or by a tool, never by a host skill, so it carries no §G.5 budget.
 *   The check measures it and reports the figure instead of failing on it, so
 *   that the cost of the full dump is never silently unknown.
 */
import { Buffer } from "node:buffer";
import cliProtocol from "@specstride/contracts/data/cli-protocol.json" with { type: "json" };
import { BYTES_PER_TOKEN } from "@specstride/contracts/grammar/judgment";

export { BYTES_PER_TOKEN };

/** The section of annex G that holds the budgets. */
export const ANNEX_SECTION = "annex G, §G.5" as const;

/** The skill of §G.5 whose budget the two commands take a share of. */
export const HOST_SKILL = "specstride-run" as const;

/** The row of §G.5 that states that skill's budget, read from the annex data. */
export const HOST_SKILL_ROW = "Host skill `specstride-run`" as const;

type RawBudget = { Subject: string; Budget: string };

/** The budget of a subject of §G.5 in tokens, read from the table itself. */
export function tokenBudgetOf(subject: string): number {
  const rows = (cliProtocol as { budgets: RawBudget[] }).budgets;
  const row = rows.find((r) => r.Subject === subject);
  if (row === undefined) {
    throw new Error(
      `${ANNEX_SECTION} holds no row \`${subject}\`; the rows are ` +
        `${rows.map((r) => r.Subject).join(", ")} (F100-FR-187)`,
    );
  }
  const match = /([\d,]+)\s*tokens?/.exec(row.Budget);
  if (match === null) {
    throw new Error(`the row \`${subject}\` of ${ANNEX_SECTION} states no budget in tokens`);
  }
  return Number((match[1] as string).replace(/,/g, ""));
}

/** Its budget, in tokens (§G.5, row 1), read from `data/cli-protocol.json`. */
export const HOST_SKILL_TOKEN_BUDGET: number = tokenBudgetOf(HOST_SKILL_ROW);

/** The share of that budget one configuration command may take. */
export const SHARE_OF_THE_SKILL_BUDGET = 0.25 as const;

/** The derived budget of one host-facing configuration command, in tokens. */
export const COMMAND_TOKEN_BUDGET: number = HOST_SKILL_TOKEN_BUDGET * SHARE_OF_THE_SKILL_BUDGET;

/** The same budget in bytes, which is what the build measures (§G.5, last row). */
export const COMMAND_BYTE_BUDGET: number = Math.floor(COMMAND_TOKEN_BUDGET * BYTES_PER_TOKEN);

/** The derivation in one sentence, for the line a check prints. */
export const DERIVATION: string =
  `one quarter of the ${HOST_SKILL_TOKEN_BUDGET}-token budget of the host skill ` +
  `\`${HOST_SKILL}\` (annex G §G.5) is ${COMMAND_TOKEN_BUDGET} tokens, which is ` +
  `${COMMAND_BYTE_BUDGET} bytes at ${BYTES_PER_TOKEN} bytes per token`;

/** The bytes of one output, as the build measures them (§G.5, last row). */
export function byteLength(output: string): number {
  return Buffer.byteLength(output, "utf8");
}

/** The tokens of one output, at the measure of §G.5. */
export function tokensOf(output: string): number {
  return byteLength(output) / BYTES_PER_TOKEN;
}

/** One measurement of the check: a named output against the derived limit. */
export interface BudgetMeasurement {
  /** The command and its flags, as the check names them. */
  readonly subject: string;
  readonly bytes: number;
  readonly tokens: number;
  /** The limit the subject is held to, or `undefined` where it carries none. */
  readonly limit: number | undefined;
  /** True where a limit applies and the output is inside it. */
  readonly withinBudget: boolean;
  /** The share of the skill's budget the output takes. */
  readonly shareOfSkillBudget: number;
}

/** Measure one output against the derived budget (F100-FR-187). */
export function measure(
  subject: string,
  output: string,
  options: { readonly hostFacing?: boolean } = {},
): BudgetMeasurement {
  const bytes = byteLength(output);
  const limit = options.hostFacing === false ? undefined : COMMAND_BYTE_BUDGET;
  return Object.freeze({
    subject,
    bytes,
    tokens: bytes / BYTES_PER_TOKEN,
    limit,
    withinBudget: limit === undefined ? true : bytes <= limit,
    shareOfSkillBudget: bytes / BYTES_PER_TOKEN / HOST_SKILL_TOKEN_BUDGET,
  });
}

/** The line the build prints for one measurement. */
export function reportLine(m: BudgetMeasurement): string {
  const share = `${(m.shareOfSkillBudget * 100).toFixed(1)} per cent of \`${HOST_SKILL}\``;
  if (m.limit === undefined) {
    return `${m.subject}: ${m.bytes} bytes (${Math.round(m.tokens)} tokens, ${share}) — no §G.5 budget`;
  }
  return (
    `${m.subject}: ${m.bytes} bytes of ${m.limit} (${Math.round(m.tokens)} tokens of ` +
    `${COMMAND_TOKEN_BUDGET}, ${share}) — ${m.withinBudget ? "within budget" : "OVER BUDGET"}`
  );
}
