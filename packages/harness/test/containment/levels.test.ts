/**
 * T072 — test CT-109-26: containment (F109-FR-026).
 *
 * The ceiling is declared with provenance and `unverified` where no run has
 * shown it; the run level is C2 where the harness offers it and else C1; C0
 * needs the opt-in in user configuration only — the same value from the
 * environment, from a flag or from project configuration gives no opt-in; a
 * proposer whose ceiling is C0 is refused at launch with a message that
 * names the key; C3 is detected and never created; the record is announced
 * for every run and says `protection=detect` at C0 and C1.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTAINMENT_LEVELS,
  CONTAINMENT_OPT_IN_KEY,
  ContainmentRefusedError,
  c0OptedIn,
  containmentCeiling,
  defaultLevel,
  protectionOf,
  resolveRunLevel,
} from "../../src/containment/levels.ts";

const CEILING = (
  level: "C0" | "C1" | "C2" | "C3",
  provenance: "declared" | "unverified" = "declared",
) => containmentCeiling(level, provenance);

test("CT-109-26: the four levels exist and a ceiling is declared with provenance", () => {
  assert.deepEqual([...CONTAINMENT_LEVELS], ["C0", "C1", "C2", "C3"]);
  assert.deepEqual(CEILING("C2"), { level: "C2", provenance: "declared" });
});

test("CT-109-26: a ceiling no run has shown is `unverified`", () => {
  assert.deepEqual(CEILING("C1", "unverified"), { level: "C1", provenance: "unverified" });
  // containmentCeiling defaults to `unverified`: nothing has been shown yet.
  assert.deepEqual(containmentCeiling("C1"), { level: "C1", provenance: "unverified" });
});

test("CT-109-26: the default is C2 where the harness offers it, else C1", () => {
  assert.equal(defaultLevel(true), "C2");
  assert.equal(defaultLevel(false), "C1");
  assert.equal(
    resolveRunLevel({ id: "h", ceiling: CEILING("C2"), offersC2: true, role: "proposer" }).level,
    "C2",
  );
  assert.equal(
    resolveRunLevel({ id: "h", ceiling: CEILING("C2"), offersC2: false, role: "proposer" }).level,
    "C1",
  );
  assert.equal(
    resolveRunLevel({ id: "h", ceiling: CEILING("C1"), offersC2: true, role: "proposer" }).level,
    "C1",
  );
});

test("CT-109-26: C0 needs the opt-in in user configuration only", () => {
  // The user configuration opts in.
  assert.equal(c0OptedIn([{ value: "C0", source: "user" }]), true);
  // The same value from the environment, a flag or project configuration: NO opt-in.
  assert.equal(c0OptedIn([{ value: "C0", source: "environment" }]), false);
  assert.equal(c0OptedIn([{ value: "C0", source: "flag" }]), false);
  assert.equal(c0OptedIn([{ value: "C0", source: "project" }]), false);
  // All three together still give no opt-in; only `user` does.
  assert.equal(
    c0OptedIn([
      { value: "C0", source: "environment" },
      { value: "C0", source: "flag" },
      { value: "C0", source: "project" },
    ]),
    false,
  );
  assert.equal(
    c0OptedIn([
      { value: "C0", source: "environment" },
      { value: "C0", source: "flag" },
      { value: "C0", source: "user" },
    ]),
    true,
  );
  // A different value in the user configuration is no C0 opt-in.
  assert.equal(c0OptedIn([{ value: "C2", source: "user" }]), false);
});

test("CT-109-26: a proposer whose ceiling is C0 is refused at launch, and the message names the key", () => {
  assert.throws(
    () =>
      resolveRunLevel({
        id: "no-sandbox",
        ceiling: CEILING("C0"),
        offersC2: true,
        role: "proposer",
        optInValues: [{ value: "C0", source: "environment" }],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ContainmentRefusedError);
      assert.match(error.message, new RegExp(CONTAINMENT_OPT_IN_KEY));
      assert.equal(error.key, CONTAINMENT_OPT_IN_KEY);
      return true;
    },
  );
  // With the opt-in in the user configuration the launch proceeds.
  const record = resolveRunLevel({
    id: "no-sandbox",
    ceiling: CEILING("C0"),
    offersC2: true,
    role: "proposer",
    optInValues: [{ value: "C0", source: "user" }],
  });
  assert.equal(record.level, "C0");
});

test("CT-109-26: C3 is detected and never created", () => {
  const record = resolveRunLevel({
    id: "h",
    ceiling: CEILING("C3"),
    offersC2: false,
    role: "proposer",
  });
  assert.deepEqual(record, { level: "C3", provenance: "detected", protection: null });
});

test("CT-109-26: the record says `protection=detect` at C0 and C1", () => {
  assert.equal(protectionOf("C0"), "detect");
  assert.equal(protectionOf("C1"), "detect");
  assert.equal(protectionOf("C2"), null);
  const c0 = resolveRunLevel({
    id: "h",
    ceiling: CEILING("C0"),
    offersC2: true,
    role: "critic", // the refusal of F109-FR-026 is the proposer's launch
    optInValues: [],
  });
  assert.deepEqual(c0, { level: "C0", provenance: "declared", protection: "detect" });
  const c1 = resolveRunLevel({
    id: "h",
    ceiling: CEILING("C1"),
    offersC2: false,
    role: "proposer",
  });
  assert.deepEqual(c1, { level: "C1", provenance: "declared", protection: "detect" });
  const unverified = resolveRunLevel({
    id: "h",
    ceiling: CEILING("C2", "unverified"),
    offersC2: true,
    role: "proposer",
  });
  assert.equal(unverified.provenance, "unverified");
});
