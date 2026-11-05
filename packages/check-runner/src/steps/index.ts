/**
 * The step runner as an option: the steps of one command, the stop at the
 * first failed required step, the resume and the `partial` run (plan.md,
 * "Project Structure"; F148-FR-008, F148-FR-009).
 *
 * | File | What it holds |
 * |---|---|
 * | `step-runner.ts` | T057, F148-FR-008: the option `verification.step_runner` off by default, the declaration of a step, the pin of a command of steps, the run step by step, the stop at the first failed required step and the resume |
 * | `partial.ts` | T058, F148-FR-009: the state of a run of steps, `partial` with the reason `partial` on `unchecked`, and the gate that a `partial` run never satisfies |
 */
export * from "./step-runner.ts";
export * from "./partial.ts";
