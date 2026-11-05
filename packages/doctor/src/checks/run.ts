/**
 * T033 (feature 112) — the checks of the groups `run` and `sandbox`
 * (F112-FR-019, CT-112-119; catalogue rows 37 to 40).
 *
 * `run.lock` shows the lock through the probe of the lock provider — one of
 * the six results `free`, `held-live`, `held-foreign`, `stale-owner-dead`,
 * `owner-dead-group-alive`, `unknown` — and warns for a lock without a live
 * holder; a lock that cannot be parsed is a failure. `run.stale` warns for a
 * run that reads as running without a live owner, and for an approval record
 * that does not verify. `sandbox.level` shows the containment level per role
 * and why, warns at C0 or C1 by the consumer's choice, says `protection=detect`
 * where a process of a pass cannot be guaranteed gone, and fails when a bypass
 * flag is configured that the harness would refuse. `sandbox.critic` fails
 * when the critic path allows all tools or holds tools outside the two forms
 * of the `completion` level.
 *
 * The probes read the lock probe, the run records and the resolved
 * configuration through the probe bag; the doctor removes nothing (F112-FR-004).
 */
import type { Check, ProbeBag } from "../registry/types.ts";
import { cfg } from "./read.ts";

/** The six results of the lock probe (feature 102 owns the lock provider). */
export type LockProbeResult =
  "free" | "held-live" | "held-foreign" | "stale-owner-dead" | "owner-dead-group-alive" | "unknown";

/** The severity of a lock probe result (F112-FR-019). */
export function severityOfLock(result: LockProbeResult): "ok" | "info" | "warn" | "fail" {
  switch (result) {
    case "free":
      return "ok";
    case "held-live":
    case "held-foreign":
      return "info";
    case "stale-owner-dead":
    case "owner-dead-group-alive":
      return "warn";
    default:
      // A lock that cannot be parsed (F112-FR-019, "fail when ... unparseable").
      return "fail";
  }
}

/** `run.lock` — the lock through the probe of the lock provider (row 37). */
export const runLockCheck: Check = {
  id: "run.lock",
  group: "run",
  lb: false,
  order: 37,
  messageTemplate: "lock {result}: {detail}",
  fixHint: "resume reclaims a stale lock",
  severityRule: (o: unknown) => severityOfLock((o as { result: LockProbeResult }).result),
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const lock = cfg<{ result: LockProbeResult; detail?: string; pid?: number }>(b, "run.lock", {
      result: "free",
    });
    return {
      result: lock.result,
      detail:
        lock.detail ?? (lock.pid !== undefined ? `held by pid ${String(lock.pid)}` : lock.result),
    };
  },
};

/** `run.stale` — a run running with no live owner; an approval that fails to verify (row 38). */
export const runStaleCheck: Check = {
  id: "run.stale",
  group: "run",
  lb: false,
  order: 38,
  messageTemplate: "run says {state}, {reason}",
  fixHint: "status, then resume",
  severityRule: (o: unknown) => {
    const s = o as { stale: boolean; approvalVerifies: boolean | null };
    return s.stale || s.approvalVerifies === false ? "warn" : "ok";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const record = cfg<{ state: string; liveOwner: boolean } | undefined>(
      b,
      "run.stale.record",
      undefined,
    );
    const approval = cfg<{ verifies: boolean } | undefined>(b, "run.stale.approval", undefined);
    const stale = record !== undefined && record.state === "running" && !record.liveOwner;
    return {
      stale,
      approvalVerifies: approval?.verifies ?? null,
      state: record?.state ?? "none",
      reason: stale
        ? "no live owner"
        : approval?.verifies === false
          ? "the approval record does not verify"
          : "nothing stale",
    };
  },
};

/** The containment of one role, as the sandbox records hold it. */
export type ContainmentLevel = "C0" | "C1" | "C2" | "C3";

/** `sandbox.level` — the containment level per role, and why (row 39). */
export const sandboxLevelCheck: Check = {
  id: "sandbox.level",
  group: "sandbox",
  lb: false,
  order: 39,
  messageTemplate: "{role} containment {level}{protection}",
  fixHint: "see the containment levels",
  severityRule: (o: unknown) => {
    const s = o as { level: ContainmentLevel; bypassRefused: boolean };
    if (s.bypassRefused) return "fail";
    if (s.level === "C0" || s.level === "C1") return "warn";
    return "ok";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const level = cfg<{
      role: string;
      level: ContainmentLevel;
      why: string;
      protection?: "detect" | "enforce";
      bypassRefused?: boolean;
    }>(b, "sandbox.level", {
      role: "proposer",
      level: "C2",
      why: "default",
      protection: "enforce",
    });
    return {
      role: level.role,
      level: level.level,
      why: level.why,
      bypassRefused: level.bypassRefused ?? false,
      // `protection=detect` where a process of a pass cannot be guaranteed gone
      // (F112-FR-019); the template appends it only when it is detect.
      protection: level.protection === "detect" ? " (protection=detect)" : "",
    };
  },
};

/** `sandbox.critic` — the critic path and the two forms it may hold (row 40, lb). */
export const sandboxCriticCheck: Check = {
  id: "sandbox.critic",
  group: "sandbox",
  lb: true,
  order: 40,
  messageTemplate: "critic path {problem}",
  fixHint: "remove the flag",
  severityRule: (o: unknown) => {
    const s = o as { problem: string };
    return s.problem === "ok" ? "ok" : "fail";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const critic = cfg<{ allowsAllTools: boolean; outsideForms: string[] }>(b, "sandbox.critic", {
      allowsAllTools: false,
      outsideForms: [],
    });
    return {
      allowsAllTools: critic.allowsAllTools,
      outsideForms: critic.outsideForms,
      problem: critic.allowsAllTools
        ? "allows all tools"
        : critic.outsideForms.length > 0
          ? `holds tools outside the two forms (${String(critic.outsideForms.length)})`
          : "ok",
    };
  },
};

/** The four checks of the groups `run` and `sandbox`, in catalogue order. */
export const runChecks: readonly Check[] = Object.freeze([
  runLockCheck,
  runStaleCheck,
  sandboxLevelCheck,
  sandboxCriticCheck,
]);
