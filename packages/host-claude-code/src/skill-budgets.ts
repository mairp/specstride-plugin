/**
 * T008, T009 and T010 — the byte limit of the BODY of each skill of this host.
 *
 * F113-FR-036 fixes the budget of the whole rendered skill (8,000; 7,000; 1,500
 * tokens; `./render/index.ts` holds those). The design point "Skill body size"
 * of plan.md fixes the tighter limit of the BODY alone, inside those totals:
 * "Body at most 2,500 tokens (7,000 bytes) for run, 2,000 (5,600) for reverse,
 * 800 (2,240) for the doctor". The figures are upper limits from research R17;
 * annex G §G.5 and the brief give only the totals.
 *
 * The limits are COMPUTED from the token figures at the rate of F113-FR-036,
 * and the bytes plan.md prints are held against that product at load, so the
 * two cannot drift.
 */
import { BYTES_PER_TOKEN, BYTE_BUDGETS, bytesForTokens } from "./render/index.ts";
import { HOST_SKILL_AND_ENTRY_IDS } from "@specstride/contracts/ep/context-cost";

export { BYTES_PER_TOKEN, BYTE_BUDGETS, bytesForTokens };

/** The token figures of the design point, per skill of this host. */
export const BODY_TOKEN_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  [HOST_SKILL_AND_ENTRY_IDS[0]]: 2_600,
  [HOST_SKILL_AND_ENTRY_IDS[1]]: 2_000,
  [HOST_SKILL_AND_ENTRY_IDS[2]]: 800,
});

/** The byte figures the design point PRINTS beside them. */
export const PRINTED_BODY_BYTE_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  // Directory policy 2026-11-10: the plugin ships no shim, so the run skill
  // spells the CLI resolution order and the install line itself; its body
  // design point moves from 2,500 to 2,600 tokens to carry that text.
  [HOST_SKILL_AND_ENTRY_IDS[0]]: 7_280,
  [HOST_SKILL_AND_ENTRY_IDS[1]]: 5_600,
  [HOST_SKILL_AND_ENTRY_IDS[2]]: 2_240,
});

/** The byte limit of the body of each skill, at 2.8 bytes per token. */
export const BODY_BYTE_LIMITS: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(
    Object.keys(BODY_TOKEN_LIMITS).map((id) => [id, bytesForTokens(BODY_TOKEN_LIMITS[id] ?? 0)]),
  ),
);

function assertNoDrift(): void {
  for (const id of Object.keys(BODY_TOKEN_LIMITS)) {
    if (BODY_BYTE_LIMITS[id] !== PRINTED_BODY_BYTE_LIMITS[id]) {
      throw new Error(
        `plan.md prints ${PRINTED_BODY_BYTE_LIMITS[id]} bytes for the body of \`${id}\`, and ` +
          `${BODY_TOKEN_LIMITS[id]} tokens at ${BYTES_PER_TOKEN} bytes per token is ` +
          `${BODY_BYTE_LIMITS[id]}`,
      );
    }
  }
}

assertNoDrift();

/** The bytes a body measures. */
export function bodyBytes(body: string): number {
  return Buffer.byteLength(body, "utf8");
}

/**
 * Fails the BUILD where the body of a skill is over the limit of the design
 * point. The whole rendered skill is checked a second time, against the budget
 * of F113-FR-036, by `renderSkill`.
 */
export function assertBodyFitsItsLimit(logicalId: string, body: string): void {
  const limit = BODY_BYTE_LIMITS[logicalId];
  if (limit === undefined) {
    throw new Error(`plan.md fixes no body limit for \`${logicalId}\``);
  }
  const measured = bodyBytes(body);
  if (measured > limit) {
    throw new Error(
      `budget-exceeded: the body of the skill \`${logicalId}\` measures ${measured} bytes and ` +
        `the limit of the design point "Skill body size" of plan.md is ${limit} bytes`,
    );
  }
}
