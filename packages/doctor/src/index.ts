// @specstride/doctor: the registry of checks (EP-14), the core catalogue and
// the findings (feature 112). Phase 2: the finding model, the check type and
// the probe bag; the registry; the runner with its bounds; the safe read of
// untrusted files.
export * from "./registry/types.ts";
export * from "./registry/registry.ts";
export * from "./runner/run.ts";
export * from "./probes/untrusted.ts";
export {
  makeFileMetadataReader,
  makeNetworkReader,
  makeRealProbeBag,
  FILE_METADATA_KEYS,
} from "./probes/real.ts";
export { tripwireRecordCheck, phaseGateInvariantsCheck } from "./checks/tripwire.ts";
export * from "./registry/launch-subset.ts";
export * from "./checks/critic.ts";
export * from "./runner/exit.ts";
export * from "./runner/flags.ts";
export * from "./render/text.ts";
export * from "./render/json.ts";
export * from "./render/summary.ts";
export * from "./render/entry.ts";
export * from "./checks/env.ts";
export * from "./checks/config.ts";
export * from "./checks/terms.ts";
export * from "./checks/budget.ts";
export * from "./checks/run.ts";
export * from "./checks/misc.ts";
export { gateIntegrityCheck, gateIntegrityBreaches } from "./integrity/gate.ts";
export type { GateEvent, GateBreach } from "./integrity/gate.ts";
export * from "./checks/harness.ts";
export * from "./checks/auth.ts";
