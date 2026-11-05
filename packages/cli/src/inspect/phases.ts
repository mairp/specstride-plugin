/**
 * T032 — the handler of `phases`, through the canonical spec model
 * (F119-FR-020).
 *
 * Phase numbers, titles and the count come from the canonical spec model of
 * `@specstride/spec-formats` (EP-03) — no phase heading is parsed here. The
 * state of a phase is one of `pending`, `evidence-written`,
 * `rejected(has-feedback)`, `APPROVED`; the later of them in that order wins
 * when the phase has the corresponding record. `phases` needs the spec and
 * the phase records and no run state, and writes nothing (F119-FR-016): the
 * validator's findings stay in memory — never in a fixed temporary file
 * (B-1513, C-113).
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ControlPlane } from "../router/guards.ts";
import { parseInspectArgs } from "../router/inspect-args.ts";
import type { RoutedCall } from "../router/route.ts";
import { phasesLine, displayPath } from "../output/default.ts";
import { isCompatibilityMode } from "../output/mode.ts";
import { compatText, phasesCompatText } from "../output/compat.ts";
import { select } from "./select.ts";
import { emit } from "./tail-events.ts";

/** The states of a phase, in the order the later wins (F119-FR-020). */
export const PHASE_STATES: readonly string[] = Object.freeze([
  "pending",
  "evidence-written",
  "rejected(has-feedback)",
  "APPROVED",
]);

/** The evidence record of one phase — the logical name `gate:<N>:evidence`. */
export function evidencePathOf(cp: ControlPlane, slug: string, phase: number): string {
  return join(cp.stateDir, "features", slug, "gates", `GATE${phase}-EVIDENCE.md`);
}

/** The verdict record of one phase — the logical name `gate:<N>:verdict`. */
export function verdictPathOf(cp: ControlPlane, slug: string, phase: number): string {
  return join(cp.stateDir, "features", slug, "verdicts", `phase-${phase}-verdict.md`);
}

/** The feedback record of one phase — the logical name `gate:<N>:feedback`. */
export function feedbackPathOfPhase(cp: ControlPlane, slug: string, phase: number): string {
  return join(cp.stateDir, "features", slug, "gates", `GATE${phase}-FEEDBACK.md`);
}

/** True where the verdict record of the phase APPROVES it. */
export function approvedByVerdict(cp: ControlPlane, slug: string, phase: number): boolean {
  const path = verdictPathOf(cp, slug, phase);
  if (!existsSync(path)) return false;
  try {
    // The verdict result is a closed field of the record: read, matched, and
    // never printed (F119-FR-032).
    return /\bAPPROVED\b/.test(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}

/** True where the phase has the record of the state. */
export function hasRecordOf(cp: ControlPlane, slug: string, phase: number, state: string): boolean {
  if (state === "pending") return true;
  if (state === "evidence-written") return existsSync(evidencePathOf(cp, slug, phase));
  if (state === "rejected(has-feedback)") return existsSync(feedbackPathOfPhase(cp, slug, phase));
  return approvedByVerdict(cp, slug, phase);
}

/** The state of one phase: the later satisfied state wins (F119-FR-020). */
export function phaseState(cp: ControlPlane, slug: string, phase: number): string {
  let state = PHASE_STATES[0] as string;
  for (const candidate of PHASE_STATES) {
    if (hasRecordOf(cp, slug, phase, candidate)) state = candidate;
  }
  return state;
}

/**
 * The spec path as the line prints it (F119-FR-030): relative to the working
 * directory, and only once per call.
 */
export function specDisplayOf(specPath: string, workdir: string): string {
  const rel = relative(workdir, specPath);
  if (rel !== "" && !rel.startsWith("..")) return rel;
  return displayPath(specPath);
}

/** The spec of the call, by the same rule the guard used (F119-FR-008). */
export function resolveSpecPath(call: RoutedCall, spec: string | undefined): string {
  if (spec !== undefined) return resolve(call.workdir, spec);
  return join(call.workdir, "SPECS.md");
}

/** The handler of `phases` (F119-FR-020). */
export async function phasesHandler(call: RoutedCall): Promise<number> {
  const args = parseInspectArgs(call.extras);
  const chosen = select(args, call.controlPlane);
  const specPath = resolveSpecPath(call, args.spec);
  const specfmt = await import("@specstride/spec-formats");
  const report = specfmt.validate.validateFile(specPath, {
    file: specPath,
    format: "native",
    feature: chosen.feature,
  });
  // B-1513 (C-113) — the validator's findings stay in this memory; nothing is
  // written, and no fixed temporary file is created.
  if (!report.valid) {
    return emit(call, args, "phases", [], { feature: chosen.feature }, "spec-invalid");
  }
  const model = specfmt.validate.parseFile(specPath, {
    file: specPath,
    format: "native",
    feature: chosen.feature,
  });
  const numbers = specfmt.validate.numbersOf(model);
  const states: Record<string, number[]> = {};
  const phaseStates: string[] = numbers.map((phase) => {
    const state = phaseState(call.controlPlane, chosen.feature, phase);
    (states[state] ??= []).push(phase);
    return state;
  });
  // F119-FR-029 — in compatibility output `phases` prints the spec by its
  // path and one row per phase, as the baseline prints it.
  if (isCompatibilityMode(call.mode)) {
    call.io.out(
      compatText(
        phasesCompatText(
          specPath,
          numbers.map((phase, at) => ({
            number: phase,
            title: specfmt.validate.titleOf(model, phase),
            state: phaseStates[at] as string,
          })),
        ),
      ),
    );
    return 0;
  }
  const approved = phaseStates.filter((state) => state === "APPROVED").length;
  const firstOpen = phaseStates.findIndex((state) => state !== "APPROVED");
  const current = firstOpen === -1 ? "done" : (numbers[firstOpen] as number);
  const spec = specDisplayOf(specPath, call.workdir);
  const line = phasesLine({
    spec,
    phases: phaseStates.length,
    approved,
    current,
    states,
  });
  const json = {
    feature: chosen.feature,
    spec,
    phases: phaseStates.length,
    approved,
    current,
    states: Object.entries(states).map(([state, list]) => ({ state, phases: [...list] })),
  };
  return emit(call, args, "phases", [line], json, undefined);
}
