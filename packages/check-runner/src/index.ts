/**
 * `@specstride/check-runner` (layer L1, owner 148): the one component that
 * runs a deterministic command for a check — a command of the verification
 * gate, of release verification, of an inner check, of the closing check or
 * of the merge check. Because there is one runner, a result means the same
 * wherever it was obtained (`research.md` D-2).
 *
 * It owns the content of EP-05: the operations `pin`, `start`, `poll`,
 * `result`, `cancel` and `environment`, the kind `command`, the option
 * `steps`, the conformance suite and the sample.
 *
 * The folders of `plan.md`, "Project Structure", each carry one concern:
 *
 * | Folder | Concern |
 * |---|---|
 * | `registry/` | the EP-05 registry, the pin, the handles, `environment` |
 * | `command/` | the kind `command`: spawn, group, limit, cap, environment |
 * | `result/` | conditions, reasons, errors, unknown values |
 * | `guard/` | no start while a pass lives; manifest hash; pin; search path |
 * | `bracket/` | the two fingerprint readings; the taint |
 * | `steps/` | the step runner |
 * | `batch/` | admission, formation, isolation, second execution, demotion |
 * | `events/` | the five event types of a check |
 *
 * Phase 1 creates the folders and extracts the executor of Lisa's
 * verification package into `command/` (T006, `research.md` D-1, recorded in
 * `../EXTRACTED.md`). The later phases fill the rest; this index names what
 * is built.
 */
export * from "./result/index.ts";
export * from "./command/index.ts";
export * from "./registry/index.ts";
export * from "./guard/index.ts";
export * from "./events/index.ts";
export * from "./bracket/index.ts";
export * from "./batch/index.ts";
export * from "./steps/index.ts";
