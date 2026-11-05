/**
 * Step 4, the stop join (F143-FR-026) — the stop request a group runs under.
 *
 * WHAT THE REQUIREMENT SAYS. *With a group live, `stop` MUST start no further
 * worker, MUST let live workers run to the end of their pass, MUST let
 * integration and the merge check run through `group_closed`, and MUST then
 * take effect. `stop --now`, a stop by a budget and a time cap of the run
 * MUST end the workers after the identity check and MUST leave the group to
 * the states of F143-FR-025.*
 *
 * THE MECHANISM, AND WHY IT IS SHAPED LIKE THIS. The inbox is read at
 * boundaries and never interrupts a pass (F122-FR-029) — so the poll lives in
 * the ONE loop the group already runs while its workers are in flight (the
 * wait in `runTheGroupWorkers` that applies the ends as they resolve). The
 * poll is a READ of one file, never a watcher and never a signal handler; a
 * group whose workers are all ended polls nothing at all. The two answers:
 *
 *  - a CLEAN stop (`now` false, the empty request included, which is a clean
 *    stop with every default — F100-FR-065) changes NOTHING inside the group:
 *    the live workers run to the ends of their passes, the barrier, the
 *    audits, the integration and the merge check run exactly as they would,
 *    and `group_closed` is written. The stop takes effect AFTER the group:
 *    the attempt's result carries `stopAfterTheGroup`, and the composition
 *    root ends the run with exit 6 / `stop_flag` at the boundary that
 *    follows — no further worker, no further group, no further phase.
 *  - a `--now` stop ends every live worker through the runner's own ladder —
 *    the stop ladder, whose every signal goes to a pid whose start time and
 *    run token still match the registry entry (F100-FR-064) — and the group
 *    is LEFT TO THE STATES OF F143-FR-025: nothing more is written (no
 *    barrier, no integration, no `group_closed`), the ledger stands as the
 *    kill left it, the trees stand, and the next engine start decides from
 *    the last record.
 *
 * The file the poll reads is `inbox:stop` (`<control>/inbox/stop.request`,
 * annex B §B.5), resolved by the caller through the layout table; this module
 * never names the path itself.
 */
import { existsSync } from "node:fs";

import { readStopRequestFromFile } from "../run-control/records.ts";

/** The requirement this module carries out. */
export const THE_STOP_OF_A_GROUP_REQUIREMENTS = ["F143-FR-026"] as const;

/** What the engine finds when it reads the stop request of the workspace. */
export type TheStopAsItStands = {
  /** A request stands in the inbox — the empty request included (F100-FR-065). */
  readonly asked: boolean;
  /** `stop --now`: the workers end after the identity check (F143-FR-026). */
  readonly now: boolean;
  /** `--jobs` of the request; the group acts on its WORKERS, never on jobs. */
  readonly jobs: boolean;
};

/** No request stands in the inbox: the group runs as it would. */
export const NO_STOP: TheStopAsItStands = Object.freeze({
  asked: false,
  now: false,
  jobs: false,
});

/**
 * THE STOP REQUEST AS IT STANDS. A file that is absent means NO stop — this
 * is the one distinction `readStopRequestFromFile` does not make (it reads an
 * absent file as a clean stop, which is the right reading for the start
 * boundary, and the wrong one for a poll), so the existence check comes
 * first. A file that stands is read WHOLE: the writer renames it into place,
 * so the poll never sees a partial request (F102-FR-001), and whatever the
 * bytes hold the schema-validated reader decides — unreadable and empty
 * alike are a clean stop with every default.
 */
export function theStopRequestAsItStands(path: string): TheStopAsItStands {
  if (!existsSync(path)) return NO_STOP;
  const read = readStopRequestFromFile(path);
  return read.clean
    ? Object.freeze({ asked: true, now: false, jobs: false })
    : Object.freeze({
        asked: true,
        now: read.request.now === true,
        jobs: read.request.jobs === true,
      });
}

/** How often the group's wait looks at the inbox, in ms. */
export const THE_STOP_POLL_MS = 500 as const;

/** The reader of the request; the tests hand a double over `theStopRequestAsItStands`. */
export type StopPollRead = (path: string) => TheStopAsItStands;

/** What `runTheGroupWorkers` is given so the group runs under a stop poll. */
export type TheStopOfTheGroup = {
  /** The path of the request (`inbox:stop`), as the workspace resolves it. */
  readonly requestPath: string;
  /** The poll interval, in ms; the default is `THE_STOP_POLL_MS`. */
  readonly intervalMs?: number | undefined;
  /** The reader; the real one is `theStopRequestAsItStands`. */
  readonly read?: StopPollRead | undefined;
};

/** The stop the group saw, as the runner's result carries it to the attempt. */
export type TheStopSeen = {
  /** `stop --now`: the workers were ended, and NOTHING more may be written. */
  readonly now: boolean;
};
