/**
 * The sub-commands of the public verb `verify` and their exit codes 0, 3, 10
 * and 11 (`plan.md`, "Project Structure"; F105-FR-039; `research.md` D-14
 * keeps the names of the baseline).
 *
 * | Module | Content |
 * |---|---|
 * | `exit-codes.ts` | The four codes and the component name of a refusal, each read from a table of feature 100 |
 * | `arguments.ts` | The seven sub-commands and their flags, read from this feature's contract; the phase rule of `run`; the argument checks of `create` |
 * | `verify.ts` | `runVerify`: the one entry point, which dispatches to the modules that already hold the behaviour |
 * | `mount.ts` | T136: the mount in the CLI through the command table of feature 100, annex G §G.1 |
 */
export * from "./exit-codes.ts";
export * from "./arguments.ts";
export * from "./verify.ts";
export * from "./mount.ts";
