/**
 * T001 of `specs/113-host-claude-code/tasks.md`, the hermetic part — the
 * verification record of the host facts exists, and EVERY fact the paid live
 * capture would settle is recorded as `unverified` with its reason, its pin and
 * the declared fallback that applies while it is unverified (F113-FR-035).
 *
 * The record MUST NOT claim a capture that was not run. The strongest case
 * below is the negative one: `liveCaptureIsUnrun()` is true and no row carries
 * a `verifiedOn` date, so a future edit that marks a fact `verified` without a
 * capture fails this test.
 *
 * This test calls no model and makes no network call: it reads the record and
 * the capability table of `@specstride/contracts/ep/host` only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPABILITIES, fallbackOf } from "@specstride/contracts/ep/host";
import {
  FACT_STATUSES,
  HOST_FACTS,
  HOST_FACT_IDS,
  HOST_NAME,
  HOST_PIN,
  HOST_VERSION_PIN,
  PAID_PROBE_REASON,
  REQUIREMENTS_OF_T001,
  UNVERIFIED_REASONS,
  factOf,
  fallbackWhileUnverified,
  liveCaptureIsUnrun,
  unverifiedFacts,
} from "../src/host-facts.ts";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The thirteen facts T001 names, in the order it names them. */
const FACTS_OF_T001 = [
  "re-waking-host-hook-lifetime",
  "host-hook-search-path-for-bin",
  "host-hook-numeric-limits",
  "session-start-on-resume-and-compact",
  "host-limit-events",
  "tier-1-child",
  "background-session-isolation",
  "manifest-options-version-floor",
  "marketplace-entry-exact-version",
  "plugin-entry-npm-source-and-version-rule",
  "first-audience-notice",
  "six-capabilities-of-the-host",
  "run-ended-by-a-usage-limit",
] as const;

test("T001: the record holds the thirteen facts of T001, pinned to Claude Code 2.1.284", () => {
  assert.equal(HOST_NAME, "Claude Code");
  assert.equal(HOST_VERSION_PIN, "2.1.284");
  assert.equal(HOST_PIN, "claude-code@2.1.284");
  assert.equal(HOST_FACTS.length, 13, "T001 names thirteen facts");
  assert.deepEqual([...HOST_FACT_IDS], [...FACTS_OF_T001]);
  // Every row carries the pin (F113-FR-035).
  for (const fact of HOST_FACTS) {
    assert.equal(fact.pin, HOST_PIN, `${fact.id} is pinned to ${fact.pin}`);
    assert.ok(fact.fact.length > 0, `${fact.id} records no fact`);
  }
  assert.equal(factOf("re-waking-host-hook-lifetime")?.fact.includes("re-arming"), true);
  assert.equal(factOf("no-such-fact"), undefined);
});

test("T001: EVERY fact is `unverified` — the paid capture is never run and never faked", () => {
  assert.deepEqual([...FACT_STATUSES], ["verified", "unverified"]);
  // The negative case: no row claims a capture.
  assert.equal(liveCaptureIsUnrun(), true, "a row claims a capture that was not run");
  assert.equal(unverifiedFacts().length, 13);
  for (const fact of HOST_FACTS) {
    assert.equal(fact.status, "unverified", `${fact.id} is recorded as ${fact.status}`);
    assert.equal(fact.verifiedOn, null, `${fact.id} carries a verified-on date`);
    assert.equal(fact.unverifiedReason, "paid-probe", `${fact.id}: ${fact.unverifiedReason}`);
    assert.equal(fact.reason, PAID_PROBE_REASON, `${fact.id} softens the reason`);
  }
  assert.ok(UNVERIFIED_REASONS.includes("paid-probe"));
  // The reason names what the capture costs and the ruling that forbids it.
  assert.match(PAID_PROBE_REASON, /PAID/);
  assert.match(PAID_PROBE_REASON, /model calls/);
  assert.match(PAID_PROBE_REASON, /a person starts it/);
  assert.match(PAID_PROBE_REASON, /never run and never faked/);
  assert.match(PAID_PROBE_REASON, /2026-09-30/);
});

test("T001: every fact declares the fallback that applies while it is unverified", () => {
  for (const fact of HOST_FACTS) {
    assert.ok(fact.fallback.length > 0, `${fact.id} declares no fallback`);
    assert.equal(fallbackWhileUnverified(fact.id), fact.fallback);
  }
  assert.throws(() => fallbackWhileUnverified("no-such-fact"), /holds no host fact/);
  // The push alert: the monitor is the primary way until the capture has run
  // (plan.md, the design point "Push alert"; F113-FR-026).
  assert.match(fallbackWhileUnverified("re-waking-host-hook-lifetime"), /monitor/);
  // The six capability fallbacks come from the table of annex H §H.1, so the
  // record and the annex cannot drift.
  const capabilityFallback = fallbackWhileUnverified("six-capabilities-of-the-host");
  for (const capability of CAPABILITIES) {
    assert.ok(capabilityFallback.includes(capability), `the row names no \`${capability}\``);
    assert.ok(
      capabilityFallback.includes(fallbackOf(capability)),
      `the row does not carry the declared fallback of \`${capability}\``,
    );
  }
  assert.ok(capabilityFallback.includes("The session-log driver"), "the fallback of `evals`");
});

test("T001: the record covers the eleven requirements T001 carries the facts of", () => {
  assert.equal(REQUIREMENTS_OF_T001.length, 11);
  const covered = new Set(HOST_FACTS.flatMap((f) => f.requirements));
  for (const requirement of REQUIREMENTS_OF_T001) {
    assert.ok(covered.has(requirement), `no fact of the record carries ${requirement}`);
  }
  // And no row cites a requirement outside the list of T001.
  for (const requirement of covered) {
    assert.ok(
      REQUIREMENTS_OF_T001.includes(requirement),
      `${requirement} is not one of the requirements T001 names`,
    );
  }
  assert.deepEqual([...covered].sort(), [...REQUIREMENTS_OF_T001].sort());
});

test("T001: the record names no model id (Principle XII; F113-FR-039)", () => {
  // A model id stands in no suite file, test, check or rule: the record holds
  // the facts of the capture, and the model of a run comes from configuration.
  const source = readFileSync(join(PKG, "src/host-facts.ts"), "utf8");
  for (const pattern of [/claude-[a-z]+-\d/i, /gpt-\d/i, /\bo[1-9]-(mini|preview)\b/i]) {
    assert.equal(pattern.test(source), false, `the record names a model id: ${String(pattern)}`);
  }
  // The usage-limit row says what the suite does with such a run.
  assert.match(fallbackWhileUnverified("run-ended-by-a-usage-limit"), /not scored/);
});
