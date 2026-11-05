// @specstride/cli: the command line of the product (CLI protocol 1). The owning
// features (119, 145 (presenter) and the owner of each command) fill it; what it
// can run today is `COMMANDS` of `cli.ts`.
export { COMMANDS, commandOf, main, unknownCommand, type Command } from "./cli.ts";
export {
  ARTIFACTS,
  COMPONENT,
  COMPONENT_VERSION,
  LAUNCH_CONTRACT_SCHEMA,
  buildContract,
  contractDerive,
  derive,
  renderContract,
} from "./contract-derive.ts";
