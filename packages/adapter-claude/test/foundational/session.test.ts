// CT for T014 (F125-FR-004, F125-FR-013, F125-FR-014) — minted session ids,
// the per-run set of proposer session ids, no persisted state at auth tier 1,
// the end of the session state with the throwaway home at auth tier 2.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SessionRefusedError,
  SessionRun,
  buildThrowawayHome,
  continueDirective,
  continuationIsInForce,
  endPhaseAttempt,
  freshDirective,
  mintSessionId,
} from "../../src/session.ts";

describe("T014 — minted session ids (F125-FR-013)", () => {
  it("every id is minted by the adapter and unique", () => {
    const ids = new Set(Array.from({ length: 200 }, () => mintSessionId()));
    assert.equal(ids.size, 200);
    for (const id of ids) assert.match(id, /^[0-9a-f-]{36}$/);
  });

  it("the first pass of a phase attempt is a fresh directive with a minted id", () => {
    const directive = freshDirective();
    assert.equal(directive.mode, "fresh");
    assert.notEqual(directive.sessionId, "");
  });

  it("a continuation with an empty id is refused (F125-FR-004)", () => {
    assert.throws(() => continueDirective(""), SessionRefusedError);
    assert.throws(() => continueDirective("   "), SessionRefusedError);
    assert.equal(continueDirective("abc").sessionId, "abc");
  });

  it("continuation is in force at auth tier 2 only (F125-FR-014)", () => {
    assert.equal(continuationIsInForce(1), false);
    assert.equal(continuationIsInForce(2), true);
  });
});

describe("T014 — the per-run set of proposer session ids", () => {
  it("the set feeds the critic proof: a proposer id is recognisable", () => {
    const run = new SessionRun("attempt-1");
    const fresh = run.recordFresh("pass-1", 1, null);
    assert.ok(run.wasUsedByProposer(fresh.sessionId));
    assert.ok(!run.wasUsedByProposer("not-a-proposer-id"));
    assert.deepEqual(run.proposerSessionIds(), [fresh.sessionId]);
  });

  it("a relaunch, a kill and an escalation start fresh: a new run mints a new id", () => {
    const first = new SessionRun("attempt-1");
    const a = first.recordFresh("pass-1", 1, null);
    const second = new SessionRun("attempt-2");
    const b = second.recordFresh("pass-1", 1, null);
    assert.notEqual(a.sessionId, b.sessionId);
    assert.ok(!second.wasUsedByProposer(a.sessionId));
  });

  it("a continued session keeps its record and its pass list", () => {
    const run = new SessionRun("attempt-1");
    const fresh = run.recordFresh("pass-1", 2, "/tmp/overlay/home");
    const record = run.record(fresh.sessionId, "pass-2", 2, "/tmp/overlay/home");
    assert.deepEqual(record.passIds, ["pass-1", "pass-2"]);
    assert.equal(record.persisted, true);
    assert.equal(record.throwawayHome, "/tmp/overlay/home");
  });
});

describe("T014 — auth tier 1 persists no session state (F125-FR-014)", () => {
  it("a record at auth tier 1 is persisted: false, with no throwaway home", () => {
    const run = new SessionRun("attempt-1");
    const record = run.recordFresh("pass-1", 1, "/tmp/overlay/home");
    assert.equal(record.persisted, false);
    assert.equal(record.throwawayHome, null);
  });

  it("ending an auth tier 1 attempt removes nothing: nothing was persisted", () => {
    let removed = 0;
    const result = endPhaseAttempt({
      home: null,
      realConfigHome: "/home/consumer/.claude",
      rm: () => removed++,
    });
    assert.deepEqual(result, { removed: null });
    assert.equal(removed, 0);
  });
});

describe("T014 — the session state ends with the throwaway home at auth tier 2", () => {
  it("the throwaway home is built by the adapter and removed with the attempt", () => {
    const made: string[] = [];
    const home = buildThrowawayHome({
      overlayRoot: "/tmp/overlays",
      attemptId: "att-9",
      mkdir: (dir) => made.push(dir),
    });
    assert.equal(home.adapterOwned, true);
    assert.equal(home.scope, "attempt");
    assert.equal(home.path, "/tmp/overlays/claude-home-att-9");
    assert.deepEqual(made, [home.path]);

    const removed: string[] = [];
    const result = endPhaseAttempt({
      home,
      realConfigHome: "/home/consumer/.claude",
      rm: (d) => removed.push(d),
    });
    assert.deepEqual(removed, [home.path]);
    assert.deepEqual(result, { removed: home.path });
  });

  it("the real configuration home is never a removal target (F125-FR-015)", () => {
    const home = {
      path: "/home/consumer/.claude/inside",
      adapterOwned: true as const,
      scope: "attempt" as const,
    };
    assert.throws(
      () => endPhaseAttempt({ home, realConfigHome: "/home/consumer/.claude", rm: () => {} }),
      (err: unknown) => err instanceof SessionRefusedError && err.reason === "real-home",
    );
  });

  it("a home the adapter did not build is refused before any removal", () => {
    assert.throws(
      () =>
        endPhaseAttempt({
          home: { path: "/tmp/other", adapterOwned: false as never, scope: "attempt" },
          realConfigHome: null,
          rm: () => {},
        }),
      (err: unknown) => err instanceof SessionRefusedError && err.reason === "not-adapter-owned",
    );
  });

  it("ending an attempt whose home was already gone is not an error", () => {
    const home = buildThrowawayHome({ overlayRoot: "/tmp/overlays", attemptId: "att-gone" });
    const result = endPhaseAttempt({ home, realConfigHome: null });
    assert.equal(result.removed, home.path);
  });
});
