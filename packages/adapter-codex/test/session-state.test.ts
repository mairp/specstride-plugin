/**
 * T031 / CT-131-13 — session state per phase attempt (F131-FR-013).
 *
 * The state lives per phase attempt and is removed when the phase attempt
 * ends. At auth tier 2 it lives in the throwaway home of the attempt. At
 * auth tier 1 the adapter writes, creates, edits and removes NOTHING in the
 * real configuration home — the removal of session state included — and,
 * while the fact of capture 4 is null, continuation is off, no session
 * state is persisted, and the pass runs ephemeral.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  beginPhaseAttemptSession,
  capture4SessionFact,
  endPhaseAttemptSession,
  recordSessionId,
  treeSnapshot,
} from "../src/session.ts";
import { buildProposerPlan } from "../src/arguments.ts";

function captureFixture(number: number): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../fixtures/capture-${number}/capture.json`, import.meta.url)),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

test("CT-131-13: session state lives per phase attempt, in the throwaway home at tier 2", () => {
  const scratch = mkdtempSync(join(tmpdir(), "ct131-13-tier2-"));
  const attempt = beginPhaseAttemptSession({
    phaseAttemptId: "att-1",
    authTier: 2,
    sessionOutsideHome: true,
    scratchRoot: scratch,
  });
  assert.ok(attempt.home !== null && attempt.home.startsWith(scratch));
  assert.notEqual(attempt.home, tmpdir());
  assert.equal(attempt.continuationAllowed, true);
  assert.equal(attempt.ephemeral, false);
  // Two attempts never share a home.
  const other = beginPhaseAttemptSession({
    phaseAttemptId: "att-2",
    authTier: 2,
    sessionOutsideHome: true,
    scratchRoot: scratch,
  });
  assert.notEqual(attempt.home, other.home);
});

test("CT-131-13: the session state of a phase attempt is removed when the attempt ends", () => {
  const scratch = mkdtempSync(join(tmpdir(), "ct131-13-removal-"));
  const attempt = beginPhaseAttemptSession({
    phaseAttemptId: "att-end",
    authTier: 2,
    sessionOutsideHome: true,
    scratchRoot: scratch,
  });
  recordSessionId(attempt, "first-record-id");
  assert.equal(attempt.sessionIds[0], "first-record-id");
  const home = attempt.home as string;
  const ended = endPhaseAttemptSession(attempt);
  assert.equal(ended.removed, home);
  assert.equal(existsSync(home), false, "the throwaway home is gone");
  assert.equal(ended.tier1TouchedRealHome, false);
});

test("CT-131-13: at auth tier 1 the adapter writes and removes NOTHING in a planted home", () => {
  // Plant a home that stands for the real configuration home, login inside.
  const realHome = mkdtempSync(join(tmpdir(), "ct131-13-planted-home-"));
  mkdirSync(join(realHome, ".codex"), { recursive: true });
  writeFileSync(join(realHome, ".codex", "auth.json"), '{"tokens":"the login"}\n');
  const before = treeSnapshot(realHome);
  const attempt = beginPhaseAttemptSession({
    phaseAttemptId: "att-tier1",
    authTier: 1,
    sessionOutsideHome: capture4SessionFact(
      captureFixture(4) as { status?: string; sessionLayoutFixture?: string | null },
    ),
  });
  // The state is null: the adapter created nothing anywhere near the home.
  assert.equal(attempt.home, null);
  assert.equal(attempt.authTier, 1);
  assert.equal(attempt.continuationAllowed, false);
  assert.equal(attempt.ephemeral, true);
  const ended = endPhaseAttemptSession(attempt);
  assert.equal(ended.removed, null);
  const after = treeSnapshot(realHome);
  assert.deepEqual(after, before, "the planted home is byte-for-byte unchanged");
  assert.match(after.join("\n"), /auth\.json/, "the login is still in the home");
});

test("CT-131-13: continuation is off at tier 1 while the fact of capture 4 is null", () => {
  const capture4 = captureFixture(4);
  assert.equal(capture4["status"], "unverified", "capture 4 has not been made");
  const fact = capture4SessionFact(
    capture4 as { status?: string; sessionLayoutFixture?: string | null },
  );
  assert.equal(fact, null, "until capture 4 the fact is null");
  const attempt = beginPhaseAttemptSession({
    phaseAttemptId: "att-tier1-null",
    authTier: 1,
    sessionOutsideHome: fact,
  });
  assert.equal(attempt.continuationAllowed, false);
  assert.equal(attempt.ephemeral, true, "nothing is persisted while the fact is null");
  // The closed forms once the capture lands.
  assert.equal(
    capture4SessionFact({ status: "verified", sessionLayoutFixture: "layout.json" }),
    true,
  );
  assert.equal(capture4SessionFact({ status: "verified", sessionLayoutFixture: null }), false);
  assert.equal(capture4SessionFact(null), null);
});

test("CT-131-13: where a pass does not continue it runs without persisting session files", () => {
  const plan = buildProposerPlan({
    profile: "default",
    prompt: "p",
    workdir: "/w",
    ephemeral: true,
  });
  assert.equal(plan.args.includes("--ephemeral"), true, "the ephemeral flag is on the list");
  const continuing = buildProposerPlan({
    profile: "default",
    prompt: "p",
    workdir: "/w",
    ephemeral: false,
  });
  assert.equal(continuing.args.includes("--ephemeral"), false);
});
