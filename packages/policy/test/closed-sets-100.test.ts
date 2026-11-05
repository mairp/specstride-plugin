/**
 * T006 — the closed sets feature 127 owns, confirmed against the sets feature
 * 100 generates into `packages/contracts/src/enums/`.
 *
 * The report is `./closed-sets-100.md`; this file holds it to the code. Every
 * row of its two tables is asserted here, so a change on either side fails.
 *
 * The task also says: write nothing into `packages/contracts/`. Nothing in this
 * file imports a writer, and the one assertion that could not be made by
 * reading — that the directory is untouched — is made by the gate's own
 * `git status` and recorded in the evidence of phase 2.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { NoUnknownBranchError, readMember, type ClosedSet } from "@specstride/contracts/enums";
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { ALERT_LEVELS, CLASSES } from "@specstride/contracts/ep/quota-classifier";
import { OBSERVE_LEVELS } from "../src/quota/classify.ts";

/** The seven rows of annex X §X.6 this feature owns (T006). */
const ROWS = [46, 47, 48, 205, 206, 207, 208] as const;

/** The section "Closed sets" of `spec.md`, as data. */
const SPEC = {
  46: {
    name: "Quota classes",
    members: [
      "quota_window",
      "quota_credit",
      "rate_limit_transient",
      "overload",
      "auth",
      "context_window",
      "agent_failure",
      "provider_other",
      "budget_cap",
    ],
    unknown: { kind: "default", treatedAs: "provider_other" },
    /** D-1: the row carries its members by reference and registers none. */
    membersByReference: true,
  },
  47: {
    name: "Quota confidence",
    members: ["structured", "status", "text", "stall", "host"],
    unknown: { kind: "default", treatedAs: "text" },
    membersByReference: false,
  },
  48: {
    name: "Alert levels",
    members: ["info", "warn", "loud"],
    unknown: { kind: "default", treatedAs: "warn" },
    membersByReference: false,
  },
  205: {
    name: "Alert kinds",
    members: [
      "budget-threshold",
      "provider-warning",
      "billing-mode-change",
      "spend-unmeasurable",
      "ledger-unreadable",
    ],
    unknown: { kind: "default", treatedAs: "warn" },
    membersByReference: false,
  },
  206: {
    name: "Budget dimensions",
    members: ["tokens", "costUsd", "wallClock", "phaseAttempts", "calls"],
    unknown: { kind: "refuse", treatedAs: undefined },
    membersByReference: false,
  },
  207: {
    name: "Sources of a reset time",
    members: ["structured", "header", "parsed_text"],
    unknown: { kind: "default", treatedAs: "parsed_text" },
    membersByReference: false,
  },
  208: {
    name: "Reasons that skip a fallback entry",
    members: ["terms-refused", "no-cap", "not-in-plan", "limited"],
    unknown: { kind: "refuse", treatedAs: undefined },
    membersByReference: false,
  },
} as const;

function setOf(row: (typeof ROWS)[number]): ClosedSet {
  const set = closedSet(row);
  assert.ok(set !== undefined, `row ${row} is not registered in the one map of all-sets.ts`);
  return set;
}

test("T006: all seven sets of feature 127 are present in packages/contracts/src/enums/", () => {
  for (const row of ROWS) {
    const set = setOf(row);
    assert.equal(set.number, row);
    assert.equal(set.name, SPEC[row].name, `row ${row}: the name of the set`);
    assert.equal(set.owner, "127", `row ${row}: feature 127 owns it`);
  }
});

test("T006: the members are the ones the section 'Closed sets' of the spec gives", () => {
  for (const row of ROWS) {
    if (SPEC[row].membersByReference) continue;
    const set = setOf(row);
    assert.deepEqual([...set.members], [...SPEC[row].members], `row ${row}: the members`);
    for (const member of SPEC[row].members) {
      assert.ok(set.has(member), `row ${row}: \`${member}\` is a member`);
    }
    assert.equal(set.has("not-a-member-of-any-set"), false, `row ${row}: a non-member`);
  }
});

test("T006: the unknown-value rules are the ones the spec gives", () => {
  for (const row of ROWS) {
    const set = setOf(row);
    const outcome = set.onUnknown("not-a-member-of-any-set");
    assert.equal(outcome.kind, SPEC[row].unknown.kind, `row ${row}: the kind of the rule`);
    assert.equal(
      outcome.treatedAs,
      SPEC[row].unknown.treatedAs,
      `row ${row}: what an unknown value is read as`,
    );
    assert.equal(outcome.set, SPEC[row].name, `row ${row}: the message names the set`);
    assert.match(
      outcome.message,
      /not-a-member-of-any-set/,
      `row ${row}: the message names the value`,
    );
  }
});

test("T006: the static test of F100-FR-209 finds a branch for every unknown value", () => {
  for (const row of ROWS) {
    const set = setOf(row);
    // 1. a branch exists to be taken: `onUnknown` never throws.
    assert.doesNotThrow(() => set.onUnknown("not-a-member-of-any-set"), `row ${row}`);
    // 2. a reader with NO branch fails (F100-FR-209).
    assert.throws(
      () => readMember(set, "not-a-member-of-any-set"),
      (error: unknown) =>
        error instanceof NoUnknownBranchError && /F100-FR-209/.test((error as Error).message),
      `row ${row}: a reader without a branch must fail`,
    );
    // 3. a reader WITH a branch gets the outcome of the row's rule.
    const taken = readMember(set, "not-a-member-of-any-set", (outcome) => {
      assert.equal(outcome.kind, SPEC[row].unknown.kind);
      return (outcome.treatedAs ?? "refused") as never;
    });
    assert.equal(taken, SPEC[row].unknown.treatedAs ?? "refused", `row ${row}`);
  }
});

test("T006: a member of each set is returned unchanged by readMember", () => {
  for (const row of ROWS) {
    if (SPEC[row].membersByReference) continue;
    const set = setOf(row);
    for (const member of SPEC[row].members) {
      assert.equal(readMember(set, member), member, `row ${row}: \`${member}\``);
    }
  }
});

/* ------------------------------------------------------------------ *
 * The three differences of `./closed-sets-100.md`, each asserted so the
 * report cannot drift from the code. When feature 100 repairs one, the
 * test that pins it fails and the report is updated with it.
 * ------------------------------------------------------------------ */

test("T006 D-1: row 46 registers no member, and the nine live in EP-12's CLASSES", () => {
  const set = setOf(46);
  assert.deepEqual([...set.members], [], "D-1: `quotaClasses` carries an empty member list");
  assert.equal(set.has("quota_window"), false, "D-1: so membership through the set is false");
  // The nine the spec names do exist in the package, and match it exactly.
  assert.deepEqual([...CLASSES], [...SPEC[46].members], "D-1: EP-12's CLASSES are the nine");
  // Row 46's unknown-value rule is still the one the spec gives.
  assert.equal(set.onUnknown("zzz").treatedAs, "provider_other");
});

test("T006 D-2: EP-12's ALERT_LEVELS names `critical` where row 48 names `loud`", () => {
  assert.deepEqual([...ALERT_LEVELS], ["info", "warn", "critical"], "D-2: EP-12's list");
  assert.deepEqual([...setOf(48).members], ["info", "warn", "loud"], "D-2: row 48's list");
  assert.equal(setOf(48).has("critical"), false, "D-2: `critical` is not a member of row 48");
  // Feature 127 follows row 48, the set it owns.
  assert.deepEqual([...OBSERVE_LEVELS], ["info", "warn", "loud"], "D-2: this feature uses row 48");
  for (const level of OBSERVE_LEVELS) {
    assert.ok(setOf(48).has(level), `D-2: \`${level}\` is a member of row 48`);
  }
});

test("T006 D-3: row 208's cell resolves to the kind `refuse`, as row 206's does", () => {
  assert.equal(setOf(208).onUnknown("zzz").kind, "refuse", "D-3");
  assert.equal(setOf(206).onUnknown("zzz").kind, "refuse", "D-3: the same kind as a config error");
  assert.match(
    setOf(208).onUnknown("zzz").cell,
    /Shown as text; the entry is skipped/,
    "D-3: the cell says the entry is skipped",
  );
});
