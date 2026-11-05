/**
 * The router of the front door (feature 119, T001 layout).
 *
 * This directory holds the verb table and the routing of the one `specstride`
 * command: `verbs.ts` (T003, annex G §G.1) and the modules that read the first
 * argument, match unknown verbs and flags, and end the process with the code of
 * the command it ran (70 on an uncaught error). It is a layout placeholder of
 * Phase 1; the behaviour lands with the tasks of Phases 2 and 3.
 */
export const ROUTER_LAYOUT = "119-front-door-and-presenter/router" as const;

export {
  VERBS,
  BASELINE_VERBS,
  VERB_ALIASES,
  PUBLIC_VERBS,
  verbRowOf,
  isKnownVerb,
  type VerbRow,
} from "./verbs.ts";

/** The routing entry of the front door: argv in, exit code out. */
export type Route = (argv: readonly string[]) => Promise<number>;

/**
 * Phase 1 stub: nothing is routed yet, so every argv ends with exit 2
 * (unrouted command). The real verb table lands with T003.
 */
export const route: Route = async () => 2;
