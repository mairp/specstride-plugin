/**
 * T033 — the reading for the doctor (F124-FR-049).
 *
 * The ranking and the pick are offered as a reading that writes nothing:
 * the doctor shows the pick the product would make and why every other
 * candidate lost. The reading is the SAME pure computation as
 * `pickCritic`, run with the surface `launch`, and its result adds the
 * reason per losing candidate. It touches no file: the module imports
 * nothing that writes.
 */
import { pickCritic, type CriticOrderInput, type CriticOrderResult } from "./critic-order.ts";
import { doctorReading } from "./announce.ts";

/** Why one losing candidate lost (F124-FR-049). */
export type LostCandidate = {
  readonly harness: string;
  /** The condition that failed, the pass-over, or the key that outranked it. */
  readonly reason: string;
};

/** The reading: the pick the product would make, and why everyone else lost. */
export type DryPick = {
  readonly outcome: "picked" | "refused";
  /** The pick, exactly as the launch would record it. */
  readonly pick: Extract<CriticOrderResult, { outcome: "picked" }>["pick"] | null;
  /** Every losing candidate, with the reason it lost. */
  readonly lost: readonly LostCandidate[];
  /** The rendered reading, ready for the doctor's output. */
  readonly rendered: string;
  /** Always true: the reading wrote nothing (F124-FR-049). */
  readonly wroteNothing: true;
};

/**
 * The reading for the doctor. The same input gives the same reading as the
 * launch gives a pick (F124-SC-006); nothing is written anywhere.
 */
export function dryPick(input: CriticOrderInput): DryPick {
  const result = pickCritic(input);
  if (result.outcome === "refused") {
    const lost = result.reasons.map(({ harness, reason }) => ({ harness, reason }));
    return {
      outcome: "refused",
      pick: null,
      lost,
      rendered: result.line,
      wroteNothing: true,
    };
  }
  const lost: LostCandidate[] = [
    ...result.pick.notQualified.map(({ harness, reason }) => ({ harness, reason })),
    ...result.pick.passedOver.map(({ harness, reason }) => ({ harness, reason })),
    ...result.pick.runnersUp.map((runnerUp) => ({
      harness: runnerUp.harness,
      reason: `outranked:${result.pick.table.ruleIds[0] ?? "R0-equal"}`,
    })),
  ];
  return {
    outcome: "picked",
    pick: result.pick,
    lost,
    rendered: doctorReading(result.pick, lost),
    wroteNothing: true,
  };
}
