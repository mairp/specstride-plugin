/**
 * T033 — the lines of feature 124 (F124-FR-043, F124-FR-041, F124-FR-045)
 * and the event `critic.selected` of the catalogue of feature 111 (EV-28).
 *
 * The grammar of the lines is annex G §G.3, as
 * `specs/124-harness-discovery-and-roles/contracts/output-lines.json`
 * spells it. The lines of this feature at one launch stay within three
 * lines and 600 bytes (F124-FR-043); under the `parity` profile none of
 * them is printed. The critic-diversity warning never blocks a launch; the
 * consumer may silence the LINE (row 92 of annex X §X.7), the record and
 * the event stay.
 *
 * Pure: rendering text, no I/O.
 */
import type { CriticPick, DiversityResult } from "./types.ts";

/** The label of the pick and of the pass-over lines. */
export const CRITIC_LINE_LABEL = "SPECSTRIDE-CRITIC" as const;
/** The label of the critic-diversity warning. */
export const DIVERSITY_LINE_LABEL = "SPECSTRIDE-DIVERSITY" as const;

/** The limits of F124-FR-043. */
export const MAX_LAUNCH_LINES = 3 as const;
export const MAX_LAUNCH_BYTES = 600 as const;

/** The pick line: harness, model, step, state, form, source of the window, cap, auto. */
export function announcementLine(pick: CriticPick): string {
  const keys: ReadonlyArray<[string, string]> = [
    ["harness", pick.harness],
    ["model", pick.model ?? "null"],
    ["step", pick.step],
    ["state", pick.state],
    ["form", pick.form],
    ["window-source", pick.windowSource],
    ["cap", pick.cap === null ? "null" : String(pick.cap)],
    ["auto", String(pick.automatic)],
  ];
  return `${CRITIC_LINE_LABEL} ${keys.map(([key, value]) => `${key}=${value}`).join(" ")}`;
}

/** The pass-over line: the candidate, the reason, and the next of the order. */
export function passOverLine(harness: string, reason: string, next: string): string {
  return `${CRITIC_LINE_LABEL} passed-over=${harness} reason=${reason} next=${next}`;
}

/** The critic-diversity warning line (F124-FR-045). */
export function diversityLine(
  result: DiversityResult,
  proposerModel: string | null,
  criticModel: string | null,
): string {
  return (
    `${DIVERSITY_LINE_LABEL} result=${result}` +
    ` proposer-model=${proposerModel ?? "null"}` +
    ` critic-model=${criticModel ?? "null"}`
  );
}

/**
 * The event `critic.selected` of the catalogue of feature 111 (EV-28), with
 * the fields the catalogue names: harness, model, why, diversity and
 * sameModelWarning.
 */
export function criticSelectedEvent(pick: CriticPick): {
  readonly type: "critic.selected";
  readonly harness: string;
  readonly model: string | null;
  readonly why: CriticPick["step"];
  readonly diversity: CriticPick["diversity"];
  readonly sameModelWarning: boolean;
} {
  return {
    type: "critic.selected",
    harness: pick.harness,
    model: pick.model,
    why: pick.step,
    diversity: pick.diversity,
    sameModelWarning: pick.sameModelWarning,
  };
}

/**
 * The lines of one launch: at most three lines and 600 bytes
 * (F124-FR-043); under the `parity` profile none at all.
 */
export function launchLines(
  lines: readonly string[],
  profile: "default" | "parity",
): readonly string[] {
  if (profile === "parity") return [];
  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    if (kept.length >= MAX_LAUNCH_LINES) break;
    const size = Buffer.byteLength(line, "utf8") + 1;
    if (bytes + size > MAX_LAUNCH_BYTES) break;
    kept.push(line);
    bytes += size;
  }
  return kept;
}

/**
 * F124-FR-049 — the reading of the pick the doctor shows, rendered from the
 * result of the dry run: nothing here is written anywhere.
 */
export function doctorReading(
  pick: CriticPick,
  lost: readonly { readonly harness: string; readonly reason: string }[],
): string {
  const lines = [announcementLine(pick)];
  for (const { harness, reason } of lost) {
    lines.push(`  ${harness}: ${reason}`);
  }
  return lines.join("\n");
}
