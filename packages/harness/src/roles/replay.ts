/**
 * T035 — the replay of the resolved registry (F124-FR-022, F124-SC-006;
 * CQ-106).
 *
 * A resume and a relaunch READ the record at `run:<runId>:registry` and rank
 * nothing: the plan and the critic pick of the record are the plan and the
 * pick of the resumed run, byte for byte (F100-FR-092 — a resolution never
 * takes place after launch). Roles are resolved again ONLY when the consumer
 * asks by the flag `--resolve-roles` (CQ-106) or when a harness of the stored
 * plan no longer exists in the current list of harnesses; the new resolution
 * is then announced and recorded (a new write of the record through the
 * writer of T006). A changed harness version or descriptor hash raises a
 * warning and does NOT change the pick.
 *
 * This module ranks nothing itself: the re-resolution is handed in as the
 * callback `resolveAgain` (the composition root runs launch resolution into
 * it), so on the replay path no ranking code can run at all.
 */
import { existsSync, readFileSync } from "node:fs";
import {
  registryPathFor,
  writeResolvedRegistry,
  RegistryWriterError,
  type ResolvedRegistryInput,
} from "./registry-writer.ts";
import { announcementLine, diversityLine } from "./announce.ts";
import type { CriticPick, RolePlan } from "./types.ts";
import type {
  ResolvedRegistry,
  RegistryHarness,
} from "@specstride/contracts/records/resolved-registry";
import { readResolvedRegistry } from "@specstride/contracts/records/resolved-registry";

/** The flag by which the consumer asks for a new resolution (CQ-106). */
export const RESOLVE_ROLES_FLAG = "--resolve-roles" as const;

/** Why roles are resolved again on a resume or a relaunch. */
export type ReasonToResolveAgain = "flag" | "plan-harness-gone";

/** The label of the warning line of a changed version or descriptor hash. */
export const REPLAY_WARNING_LABEL = "SPECSTRIDE-ROLES" as const;

/** One warning: a harness of the plan changed since launch, the pick stays. */
export type ReplayWarning = {
  readonly harness: string;
  /** Which provenance-bearing value changed. */
  readonly what: "version" | "descriptor-hash";
  readonly from: string | null;
  readonly to: string | null;
};

/** One line per warning, raised on a resume whose harnesses changed. */
export function replayWarningLine(warning: ReplayWarning): string {
  return (
    `[${REPLAY_WARNING_LABEL}] warning=changed-${warning.what} harness=${warning.harness} ` +
    `from=${warning.from === null ? "unset" : warning.from} ` +
    `to=${warning.to === null ? "unset" : warning.to} pick=kept`
  );
}

/** The lines that announce a NEW resolution (F124-FR-022). */
export function newResolutionLines(record: ResolvedRegistry): readonly string[] {
  const pick = record.criticPick as unknown as CriticPick;
  const lines = [announcementLine(pick)];
  if (pick.sameModelWarning) {
    lines.push(diversityLine(pick.diversity, null, pick.model));
  }
  return lines;
}

/** The ids of every harness the stored plan names, in plan order. */
export function harnessesOfThePlan(plan: RolePlan): readonly string[] {
  const ids: string[] = [];
  for (const phases of Object.values(plan)) {
    for (const entries of Object.values(phases)) {
      for (const entry of entries) {
        if (!ids.includes(entry.harness)) ids.push(entry.harness);
      }
    }
  }
  return ids;
}

/** A record the replay refused to read or to act on. */
export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayError";
  }
}

/** Everything the replay is a function of (F124-FR-022). */
export type ReplayInput = {
  readonly runId: string;
  /** The root of the run state on disk; the record is read from inside it. */
  readonly stateRoot: string;
  /** The CURRENT list of harnesses, as the field `harnesses` holds them. */
  readonly currentHarnesses: readonly RegistryHarness[];
  /** True when the consumer passed `--resolve-roles` (CQ-106). */
  readonly consumerAsksByFlag: boolean;
  /**
   * The launch resolution, run only on the `resolve-again` path. On the
   * replay path it is never called: nothing is discovered or ranked again.
   */
  readonly resolveAgain?: () => ResolvedRegistryInput;
};

/** The replay outcome: the stored record, or a new resolution announced and recorded. */
export type ReplayOutcome =
  | {
      readonly action: "replay";
      readonly record: ResolvedRegistry;
      readonly plan: RolePlan;
      readonly criticPick: CriticPick;
      readonly warnings: readonly ReplayWarning[];
      /** Always false on this path: nothing was discovered or ranked again. */
      readonly rankedAgain: false;
      readonly lines: readonly string[];
    }
  | {
      readonly action: "resolve-again";
      readonly reason: ReasonToResolveAgain;
      readonly record: ResolvedRegistry;
      readonly plan: RolePlan;
      readonly criticPick: CriticPick;
      readonly warnings: readonly ReplayWarning[];
      readonly rankedAgain: true;
      /** The new resolution is announced (F124-FR-022). */
      readonly lines: readonly string[];
      /** The new resolution is recorded: the record was written here. */
      readonly path: string;
    };

/** The stored record of the run, read from the disk by its logical name. */
export function readStoredRecord(runId: string, stateRoot: string): ResolvedRegistry {
  const path = registryPathFor(runId, stateRoot);
  if (!existsSync(path)) {
    throw new ReplayError(`the run "${runId}" holds no record at run:<runId>:registry`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ReplayError(`the record at run:<runId>:registry is not readable: ${String(error)}`);
  }
  return readResolvedRegistry(raw);
}

/** The current harness with the stored id, or null where it no longer exists. */
function currentHarness(
  currentHarnesses: readonly RegistryHarness[],
  id: string,
): RegistryHarness | null {
  return currentHarnesses.find((h) => h.id === id) ?? null;
}

/**
 * The warnings of a resume: for every harness the stored plan names that
 * still exists, a version or a descriptor hash that differs from the stored
 * one. The pick stays either way (F124-FR-022).
 */
export function changedSinceLaunch(
  record: ResolvedRegistry,
  currentHarnesses: readonly RegistryHarness[],
): readonly ReplayWarning[] {
  const warnings: ReplayWarning[] = [];
  const stored = new Map(record.harnesses.map((h) => [h.id, h]));
  for (const id of harnessesOfThePlan(record.plan as unknown as RolePlan)) {
    const before = stored.get(id);
    const now = currentHarness(currentHarnesses, id);
    if (before === undefined || now === null) continue;
    if (before.version !== now.version) {
      warnings.push({ harness: id, what: "version", from: before.version, to: now.version });
    }
    if (before.descriptorHash !== now.descriptorHash) {
      warnings.push({
        harness: id,
        what: "descriptor-hash",
        from: before.descriptorHash,
        to: now.descriptorHash,
      });
    }
  }
  return warnings;
}

/** Why roles are resolved again, or null for the replay path (F124-FR-022). */
export function reasonToResolveAgain(
  record: ResolvedRegistry,
  currentHarnesses: readonly RegistryHarness[],
  consumerAsksByFlag: boolean,
): ReasonToResolveAgain | null {
  if (consumerAsksByFlag) return "flag";
  for (const id of harnessesOfThePlan(record.plan as unknown as RolePlan)) {
    if (currentHarness(currentHarnesses, id) === null) return "plan-harness-gone";
  }
  return null;
}

/**
 * F124-FR-022 — resume or relaunch: read the record and rank nothing, or
 * resolve again by flag or by a plan harness that is gone, and then announce
 * and record the new resolution. A changed version or descriptor hash warns
 * and keeps the pick.
 */
export function replay(input: ReplayInput): ReplayOutcome {
  const record = readStoredRecord(input.runId, input.stateRoot);
  const warnings = changedSinceLaunch(record, input.currentHarnesses);
  const lines = warnings.map(replayWarningLine);
  const reason = reasonToResolveAgain(record, input.currentHarnesses, input.consumerAsksByFlag);
  if (reason === null) {
    return {
      action: "replay",
      record,
      plan: record.plan as unknown as RolePlan,
      criticPick: record.criticPick as unknown as CriticPick,
      warnings,
      rankedAgain: false,
      lines,
    };
  }
  if (input.resolveAgain === undefined) {
    throw new ReplayError(`roles are resolved again (${reason}) but no resolution was handed in`);
  }
  let fresh: ResolvedRegistryInput;
  try {
    fresh = input.resolveAgain();
  } catch (error) {
    if (error instanceof RegistryWriterError) throw error;
    throw new ReplayError(`the new resolution refused: ${String(error)}`);
  }
  const { path, record: newRecord } = writeResolvedRegistry({
    runId: input.runId,
    stateRoot: input.stateRoot,
    input: fresh,
  });
  return {
    action: "resolve-again",
    reason,
    record: newRecord,
    plan: newRecord.plan as unknown as RolePlan,
    criticPick: newRecord.criticPick as unknown as CriticPick,
    warnings,
    rankedAgain: true,
    lines: [...lines, ...newResolutionLines(newRecord)],
    path,
  };
}
