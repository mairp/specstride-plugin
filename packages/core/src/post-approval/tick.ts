/**
 * T045 of feature 101 — ticking the tasks after an approval (F101-FR-034).
 *
 * The task checkboxes of the phase are ticked in the specification through the
 * operation `tick` of the SPEC-FORMAT PORT (annex C §C.7), unless ticking is
 * switched off or the format is `native` (B-0324).
 *
 * | Rule | Where it comes from |
 * |---|---|
 * | ticking is ON by default; only the literal that means false switches it off | B-0083 |
 * | the format `native` is never ticked | B-0324 |
 * | a failed tick logs the as-is WARNING, leaves the file as it was and NEVER undoes the approval | B-0324, F101-FR-034 |
 * | a tick that worked emits the as-is event with the phase and the count, and writes the as-is line with the count | B-0103, B-0225 |
 */
import type { SpecFormatPort, TickResult } from "@specstride/contracts/ep/spec-format";
import { tasksTicked, tasksNotTicked } from "../gate/lines.ts";

/** F101-FR-034 — ticking is on by default. */
export const TICKING_IS_ON_BY_DEFAULT = true as const;

/** B-0083 — ONLY this literal switches ticking off. */
export const THE_LITERAL_THAT_MEANS_FALSE = "false" as const;

/** The format that is never ticked (B-0324). */
export const FORMAT_THAT_IS_NEVER_TICKED = "native" as const;

/** F101-FR-034 — a failed tick never undoes the approval. */
export const A_FAILED_TICK_UNDOES_THE_APPROVAL = false as const;

/** F101-FR-034 — a failed tick leaves the file as it was. */
export const A_FAILED_TICK_CHANGES_THE_FILE = false as const;

/**
 * B-0083 — whether ticking is on. The configured value is read as text, and
 * ONLY the literal `false` switches it off: every other value, and an absent
 * value, leave ticking on.
 */
export function tickingIsOn(configured: string | boolean | undefined): boolean {
  if (configured === undefined) return TICKING_IS_ON_BY_DEFAULT;
  if (typeof configured === "boolean") return configured;
  return configured !== THE_LITERAL_THAT_MEANS_FALSE;
}

/** Why ticking did not run, where it did not. */
export const REASONS_NOT_TO_TICK = ["switched-off", "native-format"] as const;
export type ReasonNotToTick = (typeof REASONS_NOT_TO_TICK)[number];

/** What the step reports back. */
export type TickOutcome =
  | {
      readonly ran: false;
      readonly reason: ReasonNotToTick;
      readonly count?: undefined;
      readonly line?: undefined;
      readonly event?: undefined;
    }
  | {
      readonly ran: true;
      readonly ticked: true;
      readonly count: number;
      readonly result: TickResult;
      /** The as-is line with the count (B-0225). */
      readonly line: string;
      /** The as-is event with the phase and the count (B-0103). */
      readonly event: { readonly phase: number; readonly count: number };
      readonly warning?: undefined;
    }
  | {
      readonly ran: true;
      readonly ticked: false;
      /** The as-is warning line; the approval stands. */
      readonly line: string;
      readonly warning: string;
      readonly count?: undefined;
      readonly event?: undefined;
    };

/** What the step needs from outside. */
export type TickInputs = {
  readonly phase: number;
  /** The path of the specification, as the as-is line names it. */
  readonly spec: string;
  readonly format: string;
  /** The configured value of `loop.tickTasks` / `SPECSTRIDE_TICK_TASKS`. */
  readonly ticking: string | boolean | undefined;
  readonly specFormat: Pick<SpecFormatPort, "tick">;
};

/**
 * F101-FR-034 — tick the tasks of an approved phase. Every failure path ends
 * in a warning and an approval that stands: the operation is wrapped, because
 * "Failure of an implementation" of §C.7 for `tick` is exactly "the file is
 * left unchanged and it is reported; it never undoes an approval".
 */
export function tickTheTasks(inputs: TickInputs): TickOutcome {
  if (!tickingIsOn(inputs.ticking)) {
    return Object.freeze({ ran: false as const, reason: "switched-off" as const });
  }
  if (inputs.format === FORMAT_THAT_IS_NEVER_TICKED) {
    return Object.freeze({ ran: false as const, reason: "native-format" as const });
  }
  try {
    const result = inputs.specFormat.tick({ phase: inputs.phase });
    const count = result.ticked.length;
    return Object.freeze({
      ran: true as const,
      ticked: true as const,
      count,
      result,
      line: tasksTicked(count, inputs.phase, inputs.spec),
      event: Object.freeze({ phase: inputs.phase, count }),
    });
  } catch (error) {
    return Object.freeze({
      ran: true as const,
      ticked: false as const,
      line: tasksNotTicked(inputs.phase, inputs.spec),
      warning: error instanceof Error ? error.message : String(error),
    });
  }
}
