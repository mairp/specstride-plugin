/**
 * T020 — the run request of kind `engine` (F123-FR-020).
 *
 * The request is one stage of kind `specstride` that declares no recovery,
 * with the relaunch budget 2 and no deadline of its own; the wall-clock
 * deadline comes from the relaunch budget of the run, never from the request.
 */
import type { Stage } from "../executor/types.ts";

/** The kinds of run request (row 18 of the closed sets). */
export const RUN_REQUEST_KINDS = ["pipeline", "engine"] as const;
export type RunRequestKind = (typeof RUN_REQUEST_KINDS)[number];

/** The default relaunch budget of the engine request. */
export const ENGINE_BUDGET = { maximum: 2, wallClockSeconds: null } as const;

/** The id of the one stage of the engine request. */
export const ENGINE_STAGE_ID = "engine" as const;

/** The run request of kind `engine` (F123-FR-020). */
export type EngineRequest = {
  kind: "engine";
  stages: [Stage];
  relaunchBudget: { maximum: number; wallClockSeconds: number | null };
};

/**
 * Build the engine request: one stage of kind `specstride` that runs the
 * engine command and declares no recovery — the retry of the engine is the
 * relaunch of the run, never an in-stage retry.
 */
export function engineRequest(input: {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: Stage["action"] extends { env?: infer E } ? E : never;
}): EngineRequest {
  const argv = [input.command, ...(input.args ?? [])];
  return {
    kind: "engine",
    stages: [
      {
        id: ENGINE_STAGE_ID,
        kind: "specstride",
        dependencies: [],
        cwd: input.cwd,
        action: { argv, env: input.env ?? [] },
        preconditions: [],
        postconditions: [],
        recovery: undefined,
      },
    ],
    relaunchBudget: { ...ENGINE_BUDGET },
  };
}

/** True when the value is a kind of run request; the unknown value refuses the launch. */
export function isRunRequestKind(value: string): value is RunRequestKind {
  return (RUN_REQUEST_KINDS as readonly string[]).includes(value);
}
