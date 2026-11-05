/**
 * T058 — the handler of `watch` (F119-FR-021).
 *
 * `watch` shows the live status card of the workspace's current run, as the
 * PRESENTER'S CARD MODE renders it, reached through the presenter interface
 * of annex G §G.10 (F100-FR-233); the card's lines are specified by feature
 * `145-presenter`, which is not in this build, so the renderer is a
 * PARAMETER of this module and the built-in renderer draws the card from the
 * same closed fields the default output of the inspection verbs uses. `watch`
 * ignores `--feature` and always follows the current event file of the
 * workspace; it needs the state check of F119-FR-009, which the router runs
 * first and which this handler re-asserts; and it ends normally on Ctrl-C —
 * the follow loop stops on the interrupt, and nothing re-raises it.
 *
 * `watch` writes no file (F119-FR-016).
 */

import { existsSync, readFileSync, statSync, watchFile } from "node:fs";
import { parseInspectArgs, featureOfTheLastRun, DEFAULT_FEATURE } from "../router/inspect-args.ts";
import { stateExists, eventsPathOf, type ControlPlane } from "../router/guards.ts";
import type { RoutedCall } from "../router/route.ts";
import { failureLine } from "../output/default.ts";
import { byteLimitOf, capOutput } from "../output/lines.ts";
import { eventsHandler } from "./tail-events.ts";
import { milestonesOf, milestoneOf, type MilestoneEvent } from "./tail-events.ts";

/**
 * The presenter's card mode (annex G §G.10, `specstride.presenter/1`, mode
 * `card`): it takes the facts of the current run and returns the lines of the
 * card. Feature `145-presenter` owns the real renderer; until it lands, this
 * build mounts the plain renderer below.
 */
export type CardRenderer = (input: CardInput) => readonly string[];

/** The facts of the current run the card mode is given. */
export type CardInput = {
  readonly feature: string;
  readonly events: readonly MilestoneEvent[];
  readonly current: string;
};

/** The built-in plain renderer of the card (the seam default). */
export const plainCardRenderer: CardRenderer = (input) => {
  const lines = [`feature=${input.feature} current=${input.current}`];
  for (const event of input.events) {
    const phase = event.phase === null ? "" : ` phase=${event.phase}`;
    const attempt = event.attempt === null ? "" : ` attempt=${event.attempt}`;
    lines.push(`[SPECSTRIDE-EVENT] seq=${event.seq} type=${event.type}${phase}${attempt}`);
  }
  return lines;
};

/** The renderer in force; a test or a later feature mounts its own. */
let cardRenderer: CardRenderer = plainCardRenderer;

/** Mount the presenter's card mode (annex G §G.10). */
export function mountCardRenderer(renderer: CardRenderer): void {
  cardRenderer = renderer;
}

/** The card of the current run, as the presenter's card mode renders it. */
export function cardOf(call: RoutedCall): readonly string[] {
  // F119-FR-021 — `--feature` is IGNORED: the card is always sourced from the
  // current event file of the workspace (`workspace:current:events`), never
  // from a feature-specific one, so `select()` is not consulted here and no
  // flag of the call can influence what the card reads.
  void parseInspectArgs(call.extras).feature;
  const cp = call.controlPlane;
  const path = eventsPathOf(cp);
  const events = existsSync(path) ? milestonesOf(readFileSync(path, "utf8")) : [];
  const approvedEvent = [...events].reverse().find((event) => event.type === "gate_approved");
  const feature = featureOfTheLastRun(cp.stateDir) ?? DEFAULT_FEATURE;
  return cardRenderer({
    feature,
    events,
    current: approvedEvent === undefined ? "running" : `phase:${approvedEvent.phase ?? 0}`,
  });
}

/** The card only, without the follow loop — the form the tests observe. */
export function watchOnce(call: RoutedCall): number {
  const args = parseInspectArgs(call.extras);
  const cp: ControlPlane = call.controlPlane;
  // F119-FR-021 — `watch` needs the state check; re-assert it here so the
  // handler holds the guard even where it is called without the router's.
  if (!stateExists(cp)) {
    call.io.out(`${failureLine("watch", "no-state")}\n`);
    return 1;
  }
  const limit = byteLimitOf({ failure: false, verbose: args.verbose, follows: false });
  call.io.out(capOutput(`${cardOf(call).join("\n")}\n`, limit).text);
  return 0;
}

/** The handler of `watch` (F119-FR-021): the card, then the live follow. */
export function watchHandler(call: RoutedCall): number {
  const args = parseInspectArgs(call.extras);
  // F119-FR-021 — `--feature` is IGNORED: watch always follows the current
  // event file of the workspace. The flag is parsed and never read.
  void args.feature;
  // F119-FR-033 — watch has no record of its own; with `--json` it prints
  // the record of `events`.
  if (args.json) return eventsHandler(call);
  const exit = watchOnce(call);
  if (exit !== 0) return exit;
  followCurrentEvents(call);
  return 0;
}

/**
 * Follow the current event file of the workspace: each new milestone event
 * is printed as it arrives (F119-FR-021). The loop ends when the host
 * interrupts the process (Ctrl-C ends it normally) or when `shouldStop`
 * says so — the seam the tests use.
 */
export function followCurrentEvents(
  call: RoutedCall,
  options?: {
    readonly shouldStop?: (() => boolean) | undefined;
    readonly onEvent?: ((event: MilestoneEvent) => void) | undefined;
  },
): void {
  const path = eventsPathOf(call.controlPlane);
  if (!existsSync(path)) return;
  let seen = statSync(path).size;
  let seq = milestonesOf(readFileSync(path, "utf8")).length;
  const stop = options?.shouldStop ?? (() => false);
  watchFile(path, { interval: 250 }, () => {
    if (stop()) {
      unwatch(path);
      return;
    }
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      unwatch(path);
      return;
    }
    if (size <= seen) return;
    const text = readFileSync(path, "utf8").slice(seen);
    seen = size;
    for (const row of text.split("\n")) {
      if (row.trim() === "") continue;
      seq += 1;
      const event = milestoneOf(row, seq);
      if (event === null) continue;
      options?.onEvent?.(event);
      call.io.out(`${event.type}\n`);
    }
  });
}

function unwatch(path: string): void {
  // `fs.unwatchFile` is the paired call of `watchFile`.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("node:fs").unwatchFile(path);
}
