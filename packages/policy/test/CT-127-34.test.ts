/**
 * CT-127-34 (T073) — the characterization test of A METERED CANDIDATE WITH AND
 * WITHOUT A CAP (F127-FR-036, DV-049, CQ-132).
 *
 * The requirement, clause by clause:
 *
 *  1. a critic that is PICKED AUTOMATICALLY and runs on a METERED ENDPOINT
 *     MUST have a hard spending cap;
 *  2. the cap MUST be ANNOUNCED AT LAUNCH;
 *  3. a candidate without a declared cap (`budget.role.critic.costUsd`) MUST
 *     NOT be picked;
 *  4. the pick MUST record the reason `no-cap` and GO ON TO THE NEXT
 *     CANDIDATE.
 *
 * CQ-132: no default cap is invented for such a candidate — it is passed over.
 * Row 35 of annex X §X.7: under the `parity` profile every fixture names the
 * critic, so this path is not reached there.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CRITIC_CAP_KEY,
  CRITIC_PICK_REASON_SET,
  METERED_BILLING_MODES,
  NO_DEFAULT_CAP,
  PARITY_NAMES_THE_CRITIC,
  PICK_KINDS,
  PICK_REASON_NO_CAP,
  ROW_182_MEMBER,
  SKIP_REASON_SET,
  announcementLine,
  checkCandidate,
  declaredCapOf,
  hasADeclaredCap,
  isMetered,
  pickCritic,
  requiresACap,
  type CriticCandidate,
} from "../src/budget/critic-cap.ts";
import { SKIP_REASONS } from "../src/budget/fallback.ts";
import { API_KEY_IN_USE, formatCap } from "../src/budget/announce.ts";

/** A metered candidate with no declared cap: the one that is passed over. */
const METERED_NO_CAP: CriticCandidate = Object.freeze({
  harness: "stub-api-nocap",
  model: "stub-metered",
  billingMode: "api",
  capUsd: null,
});

/** A metered candidate with a declared cap. */
const METERED_WITH_CAP: CriticCandidate = Object.freeze({
  harness: "stub-api",
  model: "stub-metered",
  billingMode: "api",
  capUsd: 25,
});

/** A candidate on a subscription: no metered money per call. */
const ON_A_SUBSCRIPTION: CriticCandidate = Object.freeze({
  harness: "stub-harness",
  model: "stub-base",
  billingMode: "subscription",
});

/** A candidate whose billing mode is not known to be metered. */
const UNKNOWN_BILLING: CriticCandidate = Object.freeze({
  harness: "stub-unknown",
  billingMode: "unknown",
});

/* ------------------------------------------------------------------ *
 * The key, the reason, and the two sets.
 * ------------------------------------------------------------------ */

test("CT-127-34: the key is `budget.role.critic.costUsd` and the reason is `no-cap`", () => {
  assert.equal(CRITIC_CAP_KEY, "budget.role.critic.costUsd");
  assert.equal(PICK_REASON_NO_CAP, "no-cap");
  // The reason is a member of row 208 of annex X §X.6, which this feature owns.
  assert.ok((SKIP_REASONS as readonly string[]).includes("no-cap"));
  assert.ok((SKIP_REASON_SET?.members ?? []).includes("no-cap"));
});

test("CT-127-34: the neighbouring member of row 182 is named, not invented", () => {
  assert.equal(ROW_182_MEMBER, "no-spend-cap");
  // Feature 124 owns row 182; the member is read from it and not guessed.
  assert.ok((CRITIC_PICK_REASON_SET?.members ?? []).includes("no-spend-cap"));
});

test("CT-127-34: CQ-132 — no default cap is invented, and `parity` names the critic", () => {
  assert.equal(NO_DEFAULT_CAP, true);
  assert.equal(PARITY_NAMES_THE_CRITIC, true);
});

/* ------------------------------------------------------------------ *
 * 1. Metered, and picked automatically.
 * ------------------------------------------------------------------ */

test("CT-127-34: `api` alone is a metered endpoint", () => {
  assert.deepEqual([...METERED_BILLING_MODES], ["api"]);
  assert.equal(isMetered(METERED_NO_CAP), true);
  assert.equal(isMetered(METERED_WITH_CAP), true);
  assert.equal(isMetered(ON_A_SUBSCRIPTION), false);
  assert.equal(isMetered(UNKNOWN_BILLING), false);
});

test("CT-127-34: a cap is required of a metered candidate picked AUTOMATICALLY", () => {
  assert.deepEqual([...PICK_KINDS], ["automatic", "named"]);
  assert.equal(requiresACap(METERED_NO_CAP, "automatic"), true);
  // A critic the consumer named is their own choice.
  assert.equal(requiresACap(METERED_NO_CAP, "named"), false);
  // A subscription spends no metered money per call.
  assert.equal(requiresACap(ON_A_SUBSCRIPTION, "automatic"), false);
  assert.equal(requiresACap(UNKNOWN_BILLING, "automatic"), false);
});

/* ------------------------------------------------------------------ *
 * The cap in force.
 * ------------------------------------------------------------------ */

test("CT-127-34: the cap comes from the candidate, else from the configured key", () => {
  assert.equal(declaredCapOf(METERED_WITH_CAP), 25);
  assert.equal(declaredCapOf(METERED_NO_CAP), null);
  assert.equal(declaredCapOf(METERED_NO_CAP, 12), 12);
  // The candidate's own cap wins over the configured one.
  assert.equal(declaredCapOf(METERED_WITH_CAP, 12), 25);
  assert.equal(hasADeclaredCap(METERED_NO_CAP), false);
  assert.equal(hasADeclaredCap(METERED_NO_CAP, 12), true);
});

test("CT-127-34: a cap of 0 or not finite is NO cap, as every ceiling of 0 is off", () => {
  for (const value of [0, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
    assert.equal(
      declaredCapOf({ ...METERED_NO_CAP, capUsd: value as number | null }),
      null,
      `cap ${String(value)}`,
    );
  }
  assert.equal(declaredCapOf(METERED_NO_CAP, 0), null);
});

/* ------------------------------------------------------------------ *
 * 3. A metered candidate WITHOUT a cap does not qualify.
 * ------------------------------------------------------------------ */

test("CT-127-34: a metered candidate WITHOUT a cap does not qualify, with the reason `no-cap`", () => {
  const check = checkCandidate({ candidate: METERED_NO_CAP, pick: "automatic" });
  assert.equal(check.metered, true);
  assert.equal(check.requiresACap, true);
  assert.equal(check.capUsd, null);
  assert.equal(check.qualifies, false);
  assert.equal(check.reason, "no-cap");
  assert.equal(check.row182Reason, "no-spend-cap");
  assert.match(check.note ?? "", /metered endpoint/);
  assert.match(check.note ?? "", new RegExp(CRITIC_CAP_KEY.replace(/\./g, "\\.")));
});

test("CT-127-34: a metered candidate WITH a cap qualifies, with no reason", () => {
  const check = checkCandidate({ candidate: METERED_WITH_CAP, pick: "automatic" });
  assert.equal(check.qualifies, true);
  assert.equal(check.capUsd, 25);
  assert.equal(check.reason, null);
  assert.equal(check.row182Reason, null);
  assert.equal(check.note, null);
});

test("CT-127-34: the configured key alone is enough to make it qualify", () => {
  const check = checkCandidate({
    candidate: METERED_NO_CAP,
    pick: "automatic",
    configuredCapUsd: 40,
  });
  assert.equal(check.qualifies, true);
  assert.equal(check.capUsd, 40);
});

test("CT-127-34: the same candidate NAMED by the consumer qualifies without a cap", () => {
  const check = checkCandidate({ candidate: METERED_NO_CAP, pick: "named" });
  assert.equal(check.qualifies, true);
  assert.equal(check.requiresACap, false);
  assert.equal(check.capUsd, null);
});

test("CT-127-34: a candidate on a subscription qualifies without a cap", () => {
  const check = checkCandidate({ candidate: ON_A_SUBSCRIPTION, pick: "automatic" });
  assert.equal(check.qualifies, true);
  assert.equal(check.metered, false);
  assert.equal(check.requiresACap, false);
});

/* ------------------------------------------------------------------ *
 * 4. The pick goes on to the next candidate.
 * ------------------------------------------------------------------ */

test("CT-127-34: the pick passes over the capless candidate and takes the next", () => {
  const pick = pickCritic({ candidates: [METERED_NO_CAP, METERED_WITH_CAP] });
  assert.equal(pick.picked?.harness, "stub-api");
  assert.equal(pick.capUsd, 25);
  assert.equal(pick.skipped.length, 1);
  assert.equal(pick.skipped[0].harness, "stub-api-nocap");
  assert.equal(pick.skipped[0].reason, "no-cap");
  assert.match(pick.note, /passed over: stub-api-nocap/);
});

test("CT-127-34: the candidates are walked IN ORDER", () => {
  const pick = pickCritic({
    candidates: [METERED_NO_CAP, ON_A_SUBSCRIPTION, METERED_WITH_CAP],
  });
  // The subscription entry comes before the capped metered one and is taken.
  assert.equal(pick.picked?.harness, "stub-harness");
  assert.equal(pick.capUsd, null);
  assert.deepEqual(
    pick.checks.map((check) => check.harness),
    ["stub-api-nocap", "stub-harness", "stub-api"],
  );
});

test("CT-127-34: every skip is recorded, and no default cap is used instead", () => {
  const pick = pickCritic({
    candidates: [
      METERED_NO_CAP,
      { ...METERED_NO_CAP, harness: "stub-api-nocap-2" },
      METERED_WITH_CAP,
    ],
  });
  assert.equal(pick.picked?.harness, "stub-api");
  assert.deepEqual(
    pick.skipped.map((check) => check.harness),
    ["stub-api-nocap", "stub-api-nocap-2"],
  );
  assert.equal(
    pick.skipped.every((check) => check.reason === PICK_REASON_NO_CAP),
    true,
  );
  assert.equal(
    pick.skipped.every((check) => check.capUsd === null),
    true,
  );
});

test("CT-127-34: where NO candidate qualifies, none is picked and the key is named", () => {
  const pick = pickCritic({
    candidates: [METERED_NO_CAP, { ...METERED_NO_CAP, harness: "stub-api-nocap-2" }],
  });
  assert.equal(pick.picked, null);
  assert.equal(pick.capUsd, null);
  assert.equal(pick.announcementLine, null);
  assert.equal(pick.skipped.length, 2);
  assert.match(pick.note, /no candidate qualified/);
  assert.match(pick.note, new RegExp(CRITIC_CAP_KEY.replace(/\./g, "\\.")));
});

test("CT-127-34: an empty list of candidates picks nothing and skips nothing", () => {
  const pick = pickCritic({ candidates: [] });
  assert.equal(pick.picked, null);
  assert.deepEqual([...pick.skipped], []);
  assert.deepEqual([...pick.checks], []);
});

test("CT-127-34: a NAMED pick takes the capless candidate at once", () => {
  const pick = pickCritic({ candidates: [METERED_NO_CAP, METERED_WITH_CAP], pick: "named" });
  assert.equal(pick.picked?.harness, "stub-api-nocap");
  assert.deepEqual([...pick.skipped], []);
});

/* ------------------------------------------------------------------ *
 * 2. The cap is announced at launch.
 * ------------------------------------------------------------------ */

test("CT-127-34: the cap of the picked metered critic is announced at launch", () => {
  const pick = pickCritic({ candidates: [METERED_NO_CAP, METERED_WITH_CAP] });
  assert.equal(
    pick.announcementLine,
    `critic: stub-api/stub-metered — ${API_KEY_IN_USE}, cap ${formatCap(25)}`,
  );
  assert.match(pick.announcementLine ?? "", /cap 25 USD/);
  assert.match(pick.note, /with the cap 25 USD announced at launch/);
});

test("CT-127-34: a critic on a subscription announces its billing mode, not a cap", () => {
  const line = announcementLine({
    candidate: ON_A_SUBSCRIPTION,
    pick: "automatic",
    capUsd: null,
  });
  assert.equal(line, "critic: stub-harness/stub-base — subscription in use");
  assert.doesNotMatch(line, /cap/);
});

test("CT-127-34: a named metered critic with no cap says so rather than hiding it", () => {
  const line = announcementLine({ candidate: METERED_NO_CAP, pick: "named", capUsd: null });
  assert.match(line, /API key in use, no cap set/);
});

test("CT-127-34: a candidate with no model is announced by its harness alone", () => {
  const line = announcementLine({
    candidate: { harness: "stub-api", billingMode: "api", capUsd: 5 },
    pick: "automatic",
    capUsd: 5,
  });
  assert.equal(line, `critic: stub-api — ${API_KEY_IN_USE}, cap ${formatCap(5)}`);
});
