/**
 * T030 — the producer status of one pass, from the observation of the
 * controller of the pass (F126-FR-030; origins C-056 B-0626, C-058 B-0698,
 * C-162 B-2164).
 *
 * An exit status 127 sets `launch_failed`, 124 sets `timed_out`, and a
 * status above 128 sets `producer_signal` to the status minus 128; in each
 * of these `producer_exit_code` is null. Duration, exit status and signal
 * come only from here.
 */
import type { ProducerFields } from "./writers.ts";

/** The exit statuses the controller maps onto a non-exit observation. */
export const LAUNCH_FAILED_EXIT_CODE = 127 as const;
export const TIMED_OUT_EXIT_CODE = 124 as const;

/**
 * The producer fields of one pass, from the exit status of the producer, the
 * exit status of the parser (the tap) and the duration in milliseconds.
 */
export function producerFieldsOfExit(
  exitCode: number | null,
  parserExitCode: number | null,
  durationMs: number,
): ProducerFields {
  const duration = Math.max(0, Math.trunc(durationMs));
  if (exitCode === LAUNCH_FAILED_EXIT_CODE) {
    return {
      producer_exit_code: null,
      producer_signal: null,
      parser_exit_code: parserExitCode,
      timed_out: false,
      launch_failed: true,
      duration_ms: duration,
    };
  }
  if (exitCode === TIMED_OUT_EXIT_CODE) {
    return {
      producer_exit_code: null,
      producer_signal: null,
      parser_exit_code: parserExitCode,
      timed_out: true,
      launch_failed: false,
      duration_ms: duration,
    };
  }
  if (exitCode !== null && exitCode > 128) {
    return {
      producer_exit_code: null,
      producer_signal: String(exitCode - 128),
      parser_exit_code: parserExitCode,
      timed_out: false,
      launch_failed: false,
      duration_ms: duration,
    };
  }
  return {
    producer_exit_code: exitCode,
    producer_signal: null,
    parser_exit_code: parserExitCode,
    timed_out: false,
    launch_failed: false,
    duration_ms: duration,
  };
}
