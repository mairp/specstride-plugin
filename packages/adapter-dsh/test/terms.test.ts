/**
 * T014 — characterization test CT-130-4 (F130-FR-004; F130-FR-030).
 *
 * The terms row of dsh is ABSENT (no row establishes the licence or the
 * upstream terms), which the gate reads as unknown terms. While the terms are
 * unknown, dsh is NEVER a default and NEVER picked automatically, for the
 * proposer role and for the critic role alike, under the audience `personal`
 * and under `distributed` (ruling P14; `personal` lifts neither bar). It is
 * usable in a role only where the consumer named it for that role; every
 * launch that names it states "unknown terms"; where no harness is named for a
 * role, role resolution passes dsh over with the reason `terms-unknown`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  dshTermsRow,
  dshTermsDecision,
  dshNamedForRole,
  dshIsDefault,
  dshIsAutoPickCandidate,
  dshRoleResolutionPassOver,
  DSH_TERMS_ROW,
  DSH_PASS_OVER_REASON,
} from "../src/descriptor/terms.ts";

const AUDIENCES = ["personal", "distributed"] as const;
const ROLES = ["proposer", "critic"] as const;

test("CT-130-4: the terms row is absent, so the terms are unknown", () => {
  const row = dshTermsRow();
  assert.equal(row.status, "absent");
  assert.equal(row.terms, "unknown");
  assert.equal(DSH_TERMS_ROW.status, "absent");
});

test("CT-130-4: the row names auth tiers 1 and 2, never tier 3, and holds no credential", () => {
  const row = dshTermsRow();
  assert.deepEqual(row.authTiers, [1, 2]);
  assert.equal(row.tier3, "never-valid");
  assert.equal(row.credential, null);
});

test("CT-130-4: a launch that names dsh states unknown terms", () => {
  for (const role of ROLES) {
    for (const audience of AUDIENCES) {
      const decision = dshTermsDecision({
        role,
        audience,
        naming: { roles: { [role]: "dsh" } },
      });
      assert.equal(decision.named, true);
      assert.equal(decision.usable, true);
      assert.equal(decision.warning, "unknown terms");
      assert.equal(decision.warningRecordedOnly, false);
    }
  }
});

test("CT-130-4: under `parity` the unknown-terms warning is recorded and no line is printed", () => {
  const decision = dshTermsDecision({
    role: "proposer",
    audience: "distributed",
    naming: { roles: { proposer: "dsh" } },
    profile: "parity",
  });
  assert.equal(decision.warning, "unknown terms");
  assert.equal(decision.warningRecordedOnly, true);
});

test("CT-130-4: dsh is never the default, for both roles, under both audiences", () => {
  for (const role of ROLES) {
    for (const audience of AUDIENCES) {
      assert.equal(dshIsDefault(role, audience), false);
      const decision = dshTermsDecision({ role, audience, naming: { roles: { [role]: "dsh" } } });
      assert.equal(decision.isDefault, false);
      // Even named, the harness is not the default: naming lifts the bar of
      // the terms only, never the default rule.
      assert.equal(
        dshTermsDecision({ role, audience }).isDefault,
        false,
        "unnamed: not the default",
      );
    }
  }
});

test("CT-130-4: dsh is never picked automatically, for both roles, under both audiences", () => {
  for (const role of ROLES) {
    for (const audience of AUDIENCES) {
      assert.equal(dshIsAutoPickCandidate(role, audience), false);
      const decision = dshTermsDecision({ role, audience });
      assert.equal(decision.picked, false);
      assert.equal(decision.usable, false);
    }
  }
});

test("CT-130-4: where no harness is named, role resolution passes dsh over with terms-unknown", () => {
  for (const role of ROLES) {
    for (const audience of AUDIENCES) {
      const decision = dshTermsDecision({ role, audience });
      assert.equal(decision.passOverReason, DSH_PASS_OVER_REASON);
      assert.deepEqual(dshRoleResolutionPassOver({ role, audience }), {
        harness: "dsh",
        role,
        reason: "terms-unknown",
        audience,
      });
    }
  }
});

test("CT-130-4: the audience `personal` lifts neither bar (CQ-183, ruling P14)", () => {
  const personal = dshTermsDecision({ role: "critic", audience: "personal" });
  const distributed = dshTermsDecision({ role: "critic", audience: "distributed" });
  // The bars themselves are identical; only the recorded audience differs.
  for (const field of ["isDefault", "picked", "usable", "passOverReason"] as const) {
    assert.equal(personal[field], distributed[field], field);
  }
});

test("CT-130-4: the harness is usable only where the consumer named it for the role", () => {
  const naming = {
    roles: { proposer: "dsh", critic: "claude" },
    flag: { critic: null },
    fallback: { critic: "dsh" },
  };
  assert.equal(dshNamedForRole(naming, "proposer"), true, "named by roles.proposer.harness");
  assert.equal(dshNamedForRole(naming, "critic"), true, "named by a fallback entry");
  assert.equal(
    dshTermsDecision({ role: "critic", audience: "personal", naming }).usable,
    true,
    "a fallback entry names dsh as well",
  );
  assert.equal(
    dshTermsDecision({
      role: "critic",
      audience: "personal",
      naming: { roles: { critic: "claude" } },
    }).usable,
    false,
    "another harness named: dsh is passed over",
  );
  assert.equal(dshNamedForRole(undefined, "proposer"), false);
});
