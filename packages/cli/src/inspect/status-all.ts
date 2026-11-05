/**
 * T041 — `status --all` in compatibility output (F119-FR-027).
 *
 * The first line is `specstride status --all — <workdir>`; a workspace whose
 * feature list is empty prints `  (no features yet)`; otherwise the table
 * `  FEATURE                          PHASES     STATE` — columns of 32 and
 * 10 — one rule row, and one row per feature, exit 0. `PHASES` is
 * `<approved>/<total>`: the approval records of the feature over the phases
 * of the spec its recorded settings name, `?` where the settings or the spec
 * are missing or invalid. `STATE` is `—` with no events file,
 * `running/crashed` with no terminal event, `DONE:<outcome>` after a
 * `run_end`, and `HALTED:<reason>@<phase>` after a `run_stop`.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ControlPlane } from "../router/guards.ts";
import { VerbNotMountedError, type RoutedCall } from "../router/route.ts";
import {
  readTextOf,
  snapshotSettingsOf,
  terminalEventOf,
  outcomeOfTerminal,
  phaseOfTerminal,
  reasonOfTerminal,
  type StatusDeps,
} from "./status-state.ts";

/** The widths of the `--all` table (F119-FR-027). */
export const STATUS_ALL_COLUMNS = Object.freeze({ feature: 32, phases: 10 } as const);

/** The line for a workspace with no features (F119-FR-027). */
export const NO_FEATURES_LINE = "  (no features yet)" as const;

/** The first line of `status --all` (F119-FR-027). */
export function statusAllHeadline(workdir: string): string {
  return `specstride status --all — ${workdir}`;
}

/** The header row of the `--all` table (F119-FR-027). */
export function statusAllHeader(): string {
  return (
    `  ${"FEATURE".padEnd(STATUS_ALL_COLUMNS.feature)} ` +
    `${"PHASES".padEnd(STATUS_ALL_COLUMNS.phases)} STATE`
  );
}

/** The rule row of the `--all` table (F119-FR-027). */
export function statusAllRule(): string {
  return (
    `  ${"-".repeat(STATUS_ALL_COLUMNS.feature)} ` +
    `${"-".repeat(STATUS_ALL_COLUMNS.phases)} -----`
  );
}

/** One data row of the `--all` table (F119-FR-027). */
export function statusAllRow(feature: string, phases: string, state: string): string {
  return (
    `  ${feature.padEnd(STATUS_ALL_COLUMNS.feature)} ` +
    `${phases.padEnd(STATUS_ALL_COLUMNS.phases)} ${state}`
  );
}

/** The features of a workspace, in directory order (the feature list). */
export function knownFeaturesOf(cp: ControlPlane): readonly string[] {
  const dir = join(cp.stateDir, "features");
  try {
    return readdirSync(dir).filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
}

/**
 * The events file of one feature: its own file when it is there, the
 * workspace's current events otherwise (the read the FX-28 captures pin).
 */
export function featureEventsPathOf(cp: ControlPlane, slug: string): string {
  const own = join(cp.stateDir, "features", slug, "events.jsonl");
  return existsSync(own) ? own : join(cp.stateDir, "events.jsonl");
}

/** The STATE column for one feature (F119-FR-027). */
export function stateAllOf(cp: ControlPlane, slug: string): string {
  const path = featureEventsPathOf(cp, slug);
  if (!existsSync(path)) return "—";
  const terminal = terminalEventOf(readTextOf(path));
  if (terminal === null) return "running/crashed";
  if (terminal.event === "run_stop") {
    return `HALTED:${reasonOfTerminal(terminal, false)}@${String(phaseOfTerminal(terminal))}`;
  }
  return `DONE:${outcomeOfTerminal(terminal) ?? "all_approved"}`;
}

/** The PHASES column for one feature (F119-FR-027): `<approved>/<total>` or `?`. */
export async function phasesAllOf(cp: ControlPlane, slug: string): Promise<string> {
  const settings = snapshotSettingsOf(cp, slug);
  const specValue = (settings["SPECS"] ?? "").trim();
  const specPath = specValue === "" ? undefined : join(cp.stateDir, specValue);
  const approved = await approvedCountOf(cp, slug);
  if (specPath === undefined || !existsSync(specPath)) return `${approved}/?`;
  const specfmt = await import("@specstride/spec-formats");
  try {
    const report = specfmt.validate.validateFile(specPath, {
      file: specPath,
      format: "native",
      feature: slug,
    });
    if (!report.valid) return `${approved}/?`;
    const model = specfmt.validate.parseFile(specPath, {
      file: specPath,
      format: "native",
      feature: slug,
    });
    return `${approved}/${specfmt.validate.numbersOf(model).length}`;
  } catch {
    return `${approved}/?`;
  }
}

/** The number of approval records of one feature (the engine accepts a verifying verdict). */
async function approvedCountOf(cp: ControlPlane, slug: string): Promise<number> {
  const verdictsDir = join(cp.stateDir, "features", slug, "verdicts");
  let names: string[];
  try {
    names = readdirSync(verdictsDir);
  } catch {
    return 0;
  }
  const { approvedByVerdict } = await import("./phases.ts");
  let approved = 0;
  for (const name of names) {
    const match = name.match(/^phase-(\d+)-verdict\.md$/);
    if (match === null) continue;
    if (approvedByVerdict(cp, slug, Number(match[1]))) approved += 1;
  }
  return approved;
}

/** The whole `--all` output, as lines (F119-FR-027). */
export async function statusAllLines(cp: ControlPlane): Promise<readonly string[]> {
  const features = knownFeaturesOf(cp);
  const lines = [statusAllHeader(), statusAllRule()];
  for (const slug of features) {
    lines.push(statusAllRow(slug, await phasesAllOf(cp, slug), stateAllOf(cp, slug)));
  }
  return Object.freeze(lines);
}

/** The handler of `status --all` (F119-FR-027): compatibility output, exit 0. */
export async function statusAllHandler(call: RoutedCall, deps: StatusDeps = {}): Promise<number> {
  // The default output of `status` belongs to feature 129 (out of scope).
  if (call.mode !== "compat") throw new VerbNotMountedError("status");
  void deps;
  const cp = call.controlPlane;
  call.io.out(`${statusAllHeadline(cp.workdir)}\n`);
  const features = knownFeaturesOf(cp);
  if (features.length === 0) {
    call.io.out(`${NO_FEATURES_LINE}\n`);
    return 0;
  }
  for (const line of await statusAllLines(cp)) {
    call.io.out(`${line}\n`);
  }
  return 0;
}
