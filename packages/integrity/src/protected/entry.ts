// T033 (F116-FR-004) — fingerprints at launch and at phase entry and their
// storage under `phase:<N>:protected-set` in the control plane. The
// phase-entry fingerprint is kept for the whole phase, across attempts,
// resumes and relaunches: a resumed capture keeps the earlier readings.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteJson } from "@specstride/kernel";
import { treeFingerprint } from "../fingerprint/tree.ts";
import { classAPatternsOf, classBFiles, setFingerprint, type ToolchainProfile } from "./set.ts";
import { phaseEntrySwitch, type SwitchValue } from "./phase-entry.ts";

/**
 * Whether this feature is active in a phase attempt: a loop layer is on, or
 * an integrity switch is on (F116-FR-004). Inert otherwise — with no loop
 * layer and the switch of the comparison at phase entry off, this feature
 * takes no fingerprint, writes no file, emits no event and builds no fact
 * block beyond the layer allowlist (T067).
 */
export function integrityActive(input: {
  loopLayer: "on" | "off";
  switches: Record<string, SwitchValue>;
}): boolean {
  return input.loopLayer === "on" || phaseEntrySwitch(input.switches) === "on";
}

/**
 * The layer allowlist entries this feature may ever write (CQ-084; the
 * entries of DV-052 in the layer allowlist of feature 141, F141-FR-040).
 */
export const LAYER_ALLOWLIST: readonly string[] = Object.freeze([
  "phase:<N>:manifest",
  "phase:<N>:protected-set",
]);

/** The logical name of the record in the control plane. */
export function protectedSetEntityName(phase: number): string {
  return `phase:${phase}:protected-set`;
}

/** The file name of the record under the control root. */
export function protectedSetFileName(phase: number): string {
  return `${protectedSetEntityName(phase).replaceAll(":", "-")}.json`;
}

export interface ProtectedSetRecord {
  schema: "specstride.protected-set/1";
  phase: number;
  profiles: { id: string; version: string }[];
  basic: boolean;
  classA: {
    patterns: string[];
    ignoredListings: {
      path: string;
      listingHash: string;
      contentHashed: { path: string; hash: string }[];
    }[];
  };
  classB: { files: { path: string; hash: string }[] };
  authorised: Record<string, string[]>;
  atLaunch: { set: string; tree: string };
  atPhaseEntry?: { set: string; tree: string };
  exclusions: { ignored: string[]; rule: string };
  effectiveConfig: string | null;
}

export interface CaptureOptions {
  phase: number;
  root: string;
  profiles: ToolchainProfile[];
  authorised?: Record<string, string[]>;
  basic?: boolean;
  effectiveConfig?: string | null;
  protectedPaths?: string[];
  ignoredRoots?: string[];
}

/** The fingerprint of the protected set and of the tree at launch. */
export async function captureAtLaunch(options: CaptureOptions): Promise<ProtectedSetRecord> {
  const tree = await treeFingerprint(options.root, {
    protectedPaths: options.protectedPaths,
    ignoredRoots: options.ignoredRoots,
  });
  const classB = await classBFiles(options.root, options.profiles, tree.files);
  const set = setFingerprint({
    patterns: classAPatternsOf(options.profiles),
    classB,
    ignoredListings: tree.ignoredListings,
  });
  return {
    schema: "specstride.protected-set/1",
    phase: options.phase,
    profiles: options.profiles.map((p) => ({ id: p.id, version: p.version })),
    basic: options.basic ?? options.profiles.length === 0,
    classA: {
      patterns: classAPatternsOf(options.profiles),
      ignoredListings: tree.ignoredListings.map((l) => ({
        path: l.path,
        listingHash: l.listingHash,
        contentHashed: l.contentHashed,
      })),
    },
    classB: { files: classB },
    authorised: options.authorised ?? {},
    atLaunch: { set, tree: tree.fingerprint },
    exclusions: tree.exclusions,
    effectiveConfig: options.effectiveConfig ?? null,
  };
}

/**
 * The fingerprint at phase entry. With `resumed: true`, or when the prior
 * record already holds a phase-entry reading, that reading is kept — the
 * phase-entry fingerprint survives attempts, resumes and relaunches.
 */
export async function captureAtPhaseEntry(options: {
  root: string;
  profiles: ToolchainProfile[];
  prior: ProtectedSetRecord;
  resumed?: boolean;
  effectiveConfig?: string | null;
  protectedPaths?: string[];
  ignoredRoots?: string[];
}): Promise<ProtectedSetRecord> {
  if (options.prior.atPhaseEntry !== undefined) return options.prior;
  const tree = await treeFingerprint(options.root, {
    protectedPaths: options.protectedPaths,
    ignoredRoots: options.ignoredRoots,
  });
  const classB = await classBFiles(options.root, options.profiles, tree.files);
  const set = setFingerprint({
    patterns: classAPatternsOf(options.profiles),
    classB,
    ignoredListings: tree.ignoredListings,
  });
  return {
    ...options.prior,
    atPhaseEntry: { set, tree: tree.fingerprint },
    effectiveConfig: options.effectiveConfig ?? options.prior.effectiveConfig,
  };
}

/** Store the record in the control plane, atomically (owner-only root). */
export function writeProtectedSet(controlRoot: string, record: ProtectedSetRecord): void {
  atomicWriteJson(join(controlRoot, protectedSetFileName(record.phase)), record);
}

/** Read the record back from the control plane. */
export async function readProtectedSet(
  controlRoot: string,
  phase: number,
): Promise<ProtectedSetRecord> {
  return JSON.parse(
    await readFile(join(controlRoot, protectedSetFileName(phase)), "utf8"),
  ) as ProtectedSetRecord;
}

/**
 * Capture at launch only when this feature is active (F116-FR-004); inert
 * otherwise: `null`, and — even with a `controlRoot` given — no file is
 * written and no fingerprint is taken or stored.
 */
export async function captureIfActive(
  options: CaptureOptions & {
    loopLayer: "on" | "off";
    switches: Record<string, SwitchValue>;
    controlRoot?: string;
  },
): Promise<ProtectedSetRecord | null> {
  if (!integrityActive(options)) return null;
  const record = await captureAtLaunch(options);
  if (options.controlRoot !== undefined) writeProtectedSet(options.controlRoot, record);
  return record;
}
