/**
 * T022 (feature 112) — CT-112-129 (F112-FR-029): the summary and the run
 * section.
 *
 * The doctor shows the audience in force in the summary and in `--json`, and
 * shows a run section when a run exists: the state of the run, the open
 * alerts, the caps in force, the billing mode, the fallback in force and the
 * critic-diversity warning — read through the read model (`@specstride/view`),
 * never recomputed by the doctor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { doctorSummary, runSection, type DoctorRunRecord } from "../src/render/summary.ts";
import type { Finding } from "../src/registry/types.ts";
import type { EventEnvelope } from "@specstride/contracts/envelope/event";

function finding(id: string, severity: Finding["severity"]): Finding {
  return { id, severity, lb: false, message: id, evidence: Object.freeze({}), remedy: "fix" };
}

/** An event of the read model's signal table, with the fields its signal reads. */
function event(seq: number, type: string, data: Record<string, unknown> = {}): EventEnvelope {
  return {
    v: 1,
    seq,
    ts: "2026-10-17T10:00:00.000Z",
    type,
    harness: null,
    provider: null,
    model: null,
    data,
  } as unknown as EventEnvelope;
}

test("CT-112-129: the summary shows the audience in force", () => {
  const summary = doctorSummary(
    [finding("a", "warn"), finding("b", "info"), finding("c", "info")],
    "distributed",
  );
  assert.equal(summary.audience, "distributed");
  assert.deepEqual(summary.counts, { ok: 0, info: 2, warn: 1, fail: 0 });
  assert.equal(summary.total, 3);
  assert.equal(summary.healthy, false);
  assert.equal(doctorSummary([], "personal").audience, "personal");
  assert.equal(doctorSummary([], "personal").healthy, true);
});

test("CT-112-129: the run section reads through the read model", () => {
  const runs: DoctorRunRecord[] = [
    {
      runId: "run-1",
      // The state comes from the run record of the state file, through the
      // read model's settle — the doctor never re-derives it.
      runRecord: { runId: "run-1", state: "running", stateSince: "2026-10-17T10:00:00.000Z" },
      events: [
        event(1, "run.started"),
        event(2, "pass.started", { attempt: 1 }),
        event(3, "usage.reported", { role: "proposer", cap: 25, costClass: "metered", spent: 1 }),
        event(4, "fallback.switched", { costClass: "notional" }),
        event(5, "parallel.plan", { fallbackReason: "quota" }),
        event(6, "pass.ended", { attempt: 1 }),
        event(7, "run.ended", { endCause: "done" }),
      ],
    },
  ];
  const section = runSection(runs);
  assert.ok(section !== null);
  // The state of the run, as the read model settled it.
  assert.equal(section?.state, "running");
  // The caps in force and the billing mode, from the view's budget rows.
  assert.ok(
    (section?.caps ?? []).some((c) => c.role === "proposer" && c.cap === 25),
    "the caps in force must come from the read model's budget rows",
  );
  // The fallback in force.
  assert.equal(section?.fallback !== null, true);
});

test("CT-112-129: open alerts and the critic-diversity warning are shown", () => {
  const runs: DoctorRunRecord[] = [
    {
      runId: "run-2",
      events: [
        event(1, "run.started"),
        event(2, "alert", { level: "warn", role: "critic" }),
        event(3, "run.ended", { endCause: "done" }),
      ],
      pick: { criticDiversity: "same-model" },
    },
  ];
  const section = runSection(runs);
  assert.ok((section?.alerts ?? []).includes("budget-alert"), "the open alert must be listed");
  assert.equal(section?.criticDiversity, "same-model");
});

test("CT-112-129: no run section when no run exists", () => {
  assert.equal(runSection([]), null);
  assert.equal(runSection([{ runId: "run-3", events: [] }]), null);
});

test("CT-112-129: the audience reaches the --json record as well", async () => {
  const { buildDoctorJson } = await import("../src/render/json.ts");
  const record = buildDoctorJson({
    at: "2026-10-17T10:00:00.000Z",
    host: "cli",
    audience: "distributed",
    exit: 0,
    findings: [],
  });
  assert.equal(record["audience"], "distributed");
});
