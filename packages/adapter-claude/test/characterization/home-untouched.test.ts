// CT-125-9 (T047) — at auth tier 1 the harness adapter writes nothing and
// removes nothing in the consumer's real configuration home; the files the
// HARNESS keeps by itself are left out of the comparison by the list of
// capture E, and without that list the comparison of those files is a skip
// with its reason (F125-FR-015, F125-SC-003, CQ-143).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CAPTURE_E_FIXTURE,
  SessionRun,
  buildCallEnvironment,
  compareHomeTrees,
  directiveForPass,
  endPhaseAttempt,
  homeComparisonPlan,
} from "../../src/index.ts";

/** Recursively lists a tree as path → content digest (the byte snapshot). */
function snapshot(root: string, base: string = root): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out[path.relative(base, full)] = readFileSync(full, "utf8");
    }
  };
  if (statSync(root).isDirectory()) walk(root);
  return out;
}

describe("CT-125-9 — the real configuration home is never written at auth tier 1 (F125-FR-015)", () => {
  it("a tier 1 pass writes nothing and removes nothing in the real home", () => {
    const home = mkdtempSync(path.join(tmpdir(), "ct9-real-home-"));
    const realHome = path.join(home, ".claude");
    mkdirReal(realHome, ["settings.json", "projects/old/session-1.jsonl"]);
    const before = snapshot(realHome);

    // The acts of the ADAPTER at auth tier 1: a minted fresh directive, the
    // call environment and the end of the attempt. None of them may write,
    // edit, create or remove anything under the real home.
    const directive = directiveForPass({ passNumber: 1, authTier: 1 });
    const environment = buildCallEnvironment({
      role: "proposer",
      profile: "default",
      authTier: 1,
      processEnv: { PATH: "/usr/bin", HOME: home },
    });
    const run = new SessionRun("attempt-ct9");
    run.recordFresh(directive.sessionId, 1, null);
    const ended = endPhaseAttempt({ home: null, realConfigHome: realHome });

    const after = snapshot(realHome);
    assert.deepEqual(after, before, "the home is byte-identical after the pass");
    assert.equal(ended.removed, null, "the adapter removes nothing at auth tier 1");
    assert.ok(!("CLAUDE_CONFIG_DIR" in environment), "no CLAUDE_CONFIG_DIR is set at tier 1");
    assert.equal(
      run.sessionRecords()[0]?.persisted,
      false,
      "no session state is persisted at auth tier 1",
    );
    rmSync(home, { recursive: true, force: true });
  });

  it("the removal refuses a target inside the real home, even adapter-shaped", () => {
    const home = mkdtempSync(path.join(tmpdir(), "ct9-refuse-"));
    const realHome = path.join(home, ".claude");
    mkdirReal(realHome, []);
    const mk = (): void => {
      throw new Error("an rm inside the real home must never be attempted");
    };
    assert.throws(
      () =>
        endPhaseAttempt({
          home: { path: path.join(realHome, "session"), adapterOwned: true, scope: "pass" },
          realConfigHome: realHome,
          rm: mk,
        }),
      /real configuration home/,
    );
    rmSync(home, { recursive: true, force: true });
  });

  it("the exclusion list is the list of capture E; the fixture states it is pending", () => {
    // Capture E is `unverified` in this workdir: the fixture carries no
    // list of the files the harness keeps by itself (no list, no guess).
    const fixture = readFileSync(
      path.join(import.meta.dirname ?? ".", "../../test/fixtures/capture-e-home-writes.md"),
      "utf8",
    );
    assert.match(fixture, /Status of the paid part.*unverified/);
    assert.match(fixture, /stays empty[\s\S]*no list, no guess/);
    assert.equal(typeof CAPTURE_E_FIXTURE, "string");
  });

  it("without the list of capture E the comparison of the harness's own files is a skip with its reason", () => {
    const plan = homeComparisonPlan({ captureEFileList: null });
    assert.equal(plan.kind, "skipped");
    assert.ok(plan.kind === "skipped" && /capture E is unverified/.test(plan.reason));
  });

  it("with the list of capture E those files are left out of the comparison; the adapter's own acts stay at zero", () => {
    const plan = homeComparisonPlan({
      captureEFileList: [".claude/statsig/statsig.cache", ".claude/projects/old/session-1.jsonl"],
    });
    assert.ok(plan.kind === "compare");
    if (plan.kind !== "compare") return;
    const result = compareHomeTrees({
      before: {
        "settings.json": "aaa",
        ".claude/projects/old/session-1.jsonl": "harness-session",
      },
      after: {
        "settings.json": "aaa",
        ".claude/projects/old/session-1.jsonl": "harness-session-updated",
        ".claude/statsig/statsig.cache": "harness-own",
      },
      excluded: plan.excluded,
    });
    assert.deepEqual(result.adapterWrites, [], "the adapter writes nothing (F125-SC-003)");
    assert.deepEqual(result.adapterRemovals, [], "the adapter removes nothing (F125-SC-003)");
    assert.deepEqual(
      [...result.harnessKept].sort(),
      [".claude/projects/old/session-1.jsonl", ".claude/statsig/statsig.cache"],
      "the harness's own files are the recorded deviation (CQ-143)",
    );
  });

  it("a changed file OUTSIDE the list of capture E is an adapter write and fails the comparison", () => {
    const result = compareHomeTrees({
      before: { "settings.json": "aaa" },
      after: { "settings.json": "changed-by-someone" },
      excluded: [],
    });
    assert.deepEqual(result.adapterWrites, ["settings.json"]);
  });
});

function mkdirReal(dir: string, files: readonly string[]): void {
  mkdirSync(dir, { recursive: true });
  for (const file of files) {
    const full = path.join(dir, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "seed");
  }
}
