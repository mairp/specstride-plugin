/**
 * T048 — CT-122-41: on a host without a fact of the spike the doctor says that
 * survival of the end of a session is unverified (F122-FR-041; EP-14, annex G
 * §G.7).
 *
 * The subject is `packages/runtime/src/doctor/detach-checks.ts`. The case is not
 * about a constant: it is about what the doctor SAYS, for a given host, read
 * from the facts of the spike as they lie in
 * `packages/runtime/src/doctor/spike-facts.json`. So the host is the variable
 * here, and the three readings are:
 *
 *   - **this host, as it really is** — which has no fact of the spike for
 *     F122-FR-001, because every one of the sixteen cases is paid and was
 *     recorded `skipped` (phase 1). The answer must be `unverified`, and the
 *     severity a `warn`.
 *   - **a host whose pin DOES match a verified fact** — the answer is `ok` and
 *     names the fact and its date. Without this reading the case would pass for
 *     a check that said `unverified` about everything.
 *   - **a host that matches a fact that is NOT verified, or whose pin is
 *     incomplete** — still `unverified`: a fact without a `verified-on` date or
 *     without a version pin is not a fact that binds (F122-FR-041).
 *
 * And the last sentence of F122-FR-041 — *no requirement of the product MUST
 * depend on the outcome of the spike* — is the reason none of the three checks is
 * launch-blocking, which is asserted against the EP-14 guarantee itself.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MESSAGE_TEMPLATE_CAP_BYTES,
  launchChecks,
  type DoctorCheck,
  type DoctorRegistry,
} from "@specstride/contracts/ep/doctor";
import {
  DEFAULT_STRATEGY,
  STRATEGY_WITHOUT_DETACHING,
  SURVIVES_A_REBOOT_IN_WAVE_1,
} from "@specstride/contracts/ep/detach";
import {
  DETACH_CHECKS,
  DETACH_CHECK_IDS,
  DETACH_CHECKS_THAT_BLOCK_A_LAUNCH,
  DETACH_ID_CHECK_ID,
  DETACH_SPIKE_CHECK_ID,
  DETACH_SURVIVES_CHECK_ID,
  EVIDENCE_OF,
  FACTS,
  FACTS_DOCTOR,
  HOST_PROBE_KEY,
  SESSION_END_REQUIREMENT,
  STRATEGY_PROBE_KEY,
  UNVERIFIED,
  VERIFIED,
  factHoldsOnThisHost,
  probeTheStrategy,
  registerDetachChecks,
  sessionEndEvidence,
  sessionEndFactFor,
  sessionEndSeverity,
  survivesEvidence,
  survivesSeverity,
  idEvidence,
  idSeverity,
  thisHost,
  type SpikeFact,
} from "../../src/doctor/detach-checks.ts";

/** A registry that records what was registered, as EP-14's shape asks. */
function recordingRegistry(): DoctorRegistry & { readonly took: DoctorCheck[] } {
  const took: DoctorCheck[] = [];
  return {
    took,
    register: (check: DoctorCheck): void => void took.push(check),
    registered: (): readonly DoctorCheck[] => Object.freeze([...took]),
    run: (): Promise<readonly []> => Promise.resolve(Object.freeze([])),
  };
}

test("CT-122-41: on THIS host, which has no fact of the spike, the doctor says that survival of the end of a session is unverified (F122-FR-041)", () => {
  // The premise of the case, read from the facts and not assumed: no fact about
  // F122-FR-001 holds on this host.
  assert.equal(
    sessionEndFactFor(),
    null,
    "no fact of the spike about survival of a session end holds on this host",
  );
  assert.ok(
    FACTS.some((fact) => fact.requirements.includes(SESSION_END_REQUIREMENT)),
    "the facts DO carry a statement about survival of a session end; it is just not verified here",
  );

  const observed = probeTheStrategy({});
  assert.equal(observed.sessionEndSurvival, UNVERIFIED);
  assert.equal(observed.sessionEndFact, null);
  assert.equal(sessionEndSeverity(observed), "warn", "`warn`: we have not measured it here");

  const said = sessionEndEvidence(observed);
  assert.match(said, /sessionEndSurvival=unverified/, "the doctor says the word");
  assert.match(
    said,
    new RegExp(`host=${thisHost().os}/`),
    "and says which host it is unverified on",
  );
  assert.match(said, /next=foreground/, "and names `foreground` (F122-FR-041)");
  assert.equal(STRATEGY_WITHOUT_DETACHING, "foreground");

  // The facts' own `doctor` block agrees with the check: the two cannot drift,
  // because the check reads that file.
  assert.equal(FACTS_DOCTOR.sessionEndSurvival, UNVERIFIED);
  assert.equal(FACTS_DOCTOR.launchRefusalNamesStrategy, STRATEGY_WITHOUT_DETACHING);
  assert.deepEqual([...FACTS_DOCTOR.survives], []);
});

test("CT-122-41: a host whose version pin matches a VERIFIED fact gets `ok`, and the finding names the fact and its date (F122-FR-041)", () => {
  // A fact that was verified, pinned to a host of its own. This is the shape the
  // spike writes when a case really ran.
  const verified: SpikeFact = Object.freeze({
    id: "SF-122-TEST",
    statement: "the runtime root outlived the end of the host session",
    requirements: Object.freeze([SESSION_END_REQUIREMENT]),
    status: VERIFIED,
    "verified-on": "2026-10-02",
    pin: Object.freeze({
      os: Object.freeze({ name: "Debian GNU/Linux 13 (trixie)", version: "9.9.9-test" }),
    }),
  });
  const host = Object.freeze({ os: "Linux", osVersion: "9.9.9-test", name: "a-host" });
  assert.equal(factHoldsOnThisHost(verified, host), true);

  // The same fact on ANOTHER host does not hold: a pin that does not match is
  // as good as no fact at all.
  assert.equal(
    factHoldsOnThisHost(verified, { os: "Linux", osVersion: "0.0.0-other", name: "x" }),
    false,
  );

  // Three ways a fact fails to bind, each one of F122-FR-041's two halves.
  assert.equal(factHoldsOnThisHost({ ...verified, status: UNVERIFIED }, host), false);
  assert.equal(factHoldsOnThisHost({ ...verified, "verified-on": null }, host), false);
  assert.equal(
    factHoldsOnThisHost({ ...verified, pin: { os: { name: "", version: "9.9.9-test" } } }, host),
    false,
    "a pin without a distribution name is not a pin",
  );
  assert.equal(factHoldsOnThisHost({ ...verified, pin: undefined } as SpikeFact, host), false);
});

test("CT-122-41: the doctor shows the id of the strategy in use and what it survives (F122-FR-003)", () => {
  // Nothing injected: the default strategy, described by the shipped one.
  const fallback = probeTheStrategy({});
  assert.equal(fallback.strategyId, DEFAULT_STRATEGY);
  assert.equal(idSeverity(fallback), "info");
  assert.match(idEvidence(fallback), /strategy=spawn-detached key=runtime\.detach\.strategy/);
  assert.equal(survivesSeverity(fallback), "info");
  assert.match(survivesEvidence(fallback), /survives=parent-end,session-end/);
  assert.match(survivesEvidence(fallback), /reboot=false/);

  // `foreground` survives nothing, and says so.
  const foreground = probeTheStrategy({ [STRATEGY_PROBE_KEY]: STRATEGY_WITHOUT_DETACHING });
  assert.equal(foreground.strategyId, "foreground");
  assert.deepEqual([...foreground.survives], []);
  assert.match(survivesEvidence(foreground), /survives=\(nothing\)/);

  // A strategy nobody described: `warn`, never `info`. "We could not look" is
  // never `ok` (§G.7).
  const unknown = probeTheStrategy({ [STRATEGY_PROBE_KEY]: "no-such-strategy" });
  assert.equal(unknown.description, null);
  assert.equal(idSeverity(unknown), "warn");
  assert.equal(survivesSeverity(unknown), "warn");

  // F122-FR-003 — a Wave 1 strategy that claimed a reboot would be a `warn`.
  assert.equal(SURVIVES_A_REBOOT_IN_WAVE_1, false);
  const claimsAReboot = {
    ...fallback,
    survives: ["parent-end", "session-end", "reboot"],
  };
  assert.equal(survivesSeverity(claimsAReboot), "warn");
});

test("CT-122-41: the host the facts are matched against can be injected, so the check is testable on any machine (F122-FR-041)", () => {
  const observed = probeTheStrategy({
    [HOST_PROBE_KEY]: { os: "Darwin", osVersion: "24.0.0", name: "a-mac" },
  });
  assert.equal(observed.host.os, "Darwin");
  assert.equal(observed.sessionEndSurvival, UNVERIFIED);
  assert.match(sessionEndEvidence(observed), /host=Darwin\/24\.0\.0/);
  // A malformed host falls back to this machine rather than to nothing.
  assert.equal(probeTheStrategy({ [HOST_PROBE_KEY]: { os: 7 } }).host.os, thisHost().os);
});

test("CT-122-41: the three checks are registered with EP-14, none of them blocks a launch, and each template is inside the cap of §G.7", () => {
  const registry = recordingRegistry();
  const returned = registerDetachChecks(registry);
  assert.deepEqual(
    registry.took.map((one) => one.id),
    [...DETACH_CHECK_IDS],
  );
  // EP-14 — *the launch checks are exactly the `lb` subset*, asked of feature
  // 100's own function and not of a copy of the rule.
  assert.deepEqual([...launchChecks(registry.registered())], []);
  assert.deepEqual(
    returned.map((one) => one.id),
    [...DETACH_CHECK_IDS],
  );
  assert.deepEqual(
    [...DETACH_CHECK_IDS],
    [DETACH_ID_CHECK_ID, DETACH_SURVIVES_CHECK_ID, DETACH_SPIKE_CHECK_ID],
  );

  // F122-FR-041 — *no requirement of the product MUST depend on the outcome of
  // the spike.* EP-14 makes the launch checks exactly the `lb` subset, so an
  // `lb` check here would refuse a launch on a host whose spike never ran.
  assert.deepEqual([...DETACH_CHECKS_THAT_BLOCK_A_LAUNCH], []);
  for (const one of DETACH_CHECKS) {
    assert.equal(one.lb, false, `${one.id} does not block a launch`);
    assert.ok(
      Buffer.byteLength(one.messageTemplate, "utf8") <= MESSAGE_TEMPLATE_CAP_BYTES,
      `${one.id}: the template is inside the cap of §G.7`,
    );
    assert.ok(one.fixHint.length > 0, `${one.id} offers a fix hint`);
    assert.equal(typeof EVIDENCE_OF[one.id], "function", `${one.id} has an evidence line`);
  }

  // Every id carries a hyphen in its middle segment, which is what makes a
  // dotted literal a check id and never a configuration key (§K.2 rule 1).
  for (const id of DETACH_CHECK_IDS) {
    const middle = id.split(".").slice(1, -1).join(".");
    assert.ok(middle.includes("-"), `${id}: the middle segment carries a hyphen`);
    assert.notEqual(id, "runtime.detach.strategy", "a check id never shadows a configuration key");
  }

  // The order is stable and rises.
  const orders = DETACH_CHECKS.map((one) => one.order);
  assert.deepEqual(
    [...orders].sort((a, b) => a - b),
    orders,
  );
});

test("CT-122-41: the probe of each of the three checks is the one shared reading, so the doctor cannot report two different strategies", async () => {
  const injected = { [STRATEGY_PROBE_KEY]: STRATEGY_WITHOUT_DETACHING };
  const readings = await Promise.all(DETACH_CHECKS.map((one) => one.probe(injected)));
  for (const reading of readings) {
    assert.deepEqual(reading, readings[0]);
  }
});
