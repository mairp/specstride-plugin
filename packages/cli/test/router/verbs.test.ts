/**
 * T003 — the verb table as data (F119-FR-001, F119-FR-013; annex G §G.1).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  VERBS,
  BASELINE_VERBS,
  VERB_ALIASES,
  PUBLIC_VERBS,
  verbRowOf,
  isKnownVerb,
} from "../../src/router/verbs.ts";

test("T003: the table holds the twelve baseline verbs (F119-FR-001)", () => {
  const verbs = new Set(VERBS.map((row) => row.verb));
  for (const verb of BASELINE_VERBS) {
    assert.ok(verbs.has(verb), `missing baseline verb ${verb}`);
  }
  assert.ok(verbs.has("--protocol"), "the protocol row is in the table");
  assert.equal(VERB_ALIASES.start, "run");
});

test("T003: read-only rule (F119-FR-001)", () => {
  const readOnly = new Set(VERBS.filter((row) => row.readOnly).map((row) => row.verb));
  for (const verb of ["stop", "resume", "learn", "run", "reverse"]) {
    assert.equal(readOnly.has(verb), false, `${verb} must not be read-only`);
  }
  for (const verb of ["status", "watch", "tail", "events", "verdicts", "feedback", "phases"]) {
    assert.ok(readOnly.has(verb), `${verb} must be read-only`);
  }
});

test("T003: the inspection verbs are rows of this feature with their exit codes", () => {
  for (const verb of ["tail", "events", "verdicts", "feedback", "phases", "watch"]) {
    const row = verbRowOf(verb);
    assert.ok(row, `${verb} is in the table`);
    assert.equal(row.owner, "119");
    assert.equal(row.inspect, true);
  }
  assert.deepEqual(verbRowOf("phases")?.exitCodes, [0, 1, 3]);
});

test("T003: spec and verify are public verbs of their owners (F119-FR-013)", () => {
  assert.deepEqual([...PUBLIC_VERBS], ["spec", "verify", "learn"]);
  assert.equal(verbRowOf("spec")?.owner, "104");
  assert.deepEqual(verbRowOf("spec")?.exitCodes, [0, 1, 2, 3]);
  assert.equal(verbRowOf("verify")?.owner, "105");
  assert.deepEqual(verbRowOf("verify")?.exitCodes, [0, 3, 10, 11]);
});

test("T003: no internal call is a public verb (F119-FR-013)", () => {
  const forbidden = ["pass", "critic", "banner", "presenter", "theme"];
  const verbs = new Set(VERBS.map((row) => row.verb));
  for (const name of forbidden) {
    assert.equal(verbs.has(name), false, `${name} must not be a command`);
  }
});

test("T003: lookups fold the alias and refuse unknown names", () => {
  assert.equal(verbRowOf("start")?.verb, "run");
  assert.equal(isKnownVerb("start"), true);
  assert.equal(isKnownVerb("nonsense"), false);
  assert.equal(verbRowOf("nonsense"), undefined);
});
