/**
 * The inspection verbs (feature 119, T001 layout).
 *
 * This directory holds the commands that only look at a run: `tail`, `events`,
 * `verdicts`, `feedback`, `phases` and `watch`, each reading by logical name
 * and writing no file. It is a layout placeholder of Phase 1; the verbs land
 * with the tasks of the later phases.
 */
export const INSPECT_LAYOUT = "119-front-door-and-presenter/inspect" as const;

/** The inspection verbs of the front door (annex G §G.2). */
export const INSPECT_VERBS = [
  "tail",
  "events",
  "verdicts",
  "feedback",
  "phases",
  "watch",
  "status",
] as const;

/**
 * The handlers this feature mounts (phase 4, T029 to T034, T058): every read
 * verb of the front door except `status`, whose owner is feature 129. The
 * router merges these under the handlers a caller gives, so a test can
 * override one verb and the executable mounts all of them. The imports are
 * LAZY (F119-FR-015): a call pays only for the module graph its dispatch
 * already touches, and the merge happens once per call.
 */
export async function inspectHandlers(): Promise<import("../router/route.ts").RouteHandlers> {
  const [tailEvents, verdicts, phases, watch, status] = await Promise.all([
    import("./tail-events.ts"),
    import("./verdicts.ts"),
    import("./phases.ts"),
    import("./watch.ts"),
    import("./status-state.ts"),
  ]);
  return {
    tail: tailEvents.tailHandler,
    events: tailEvents.eventsHandler,
    verdicts: verdicts.verdictsHandler,
    feedback: verdicts.feedbackHandler,
    phases: (call) => phases.phasesHandler(call),
    watch: watch.watchHandler,
    // Phase 5 (T039) — `status` prints the compatibility output; in default
    // output its owner is feature 129 and the handler refuses truthfully.
    status: (call) => status.statusHandler(call),
  };
}
