/**
 * T012 — the gate-state refusal of the plan (F108-FR-026).
 *
 * A second reverse run over a slug whose feature already has phase-gate state
 * would write over an earlier run's ground. The plan therefore refuses when a
 * record of ANY phase gate of the feature `reverse-<slug>` exists — either
 * `gate:<N>:approved` or `gate:<N>:evidence` — with exit 3 and the as-is
 * message.
 *
 * Both names are looked up in the layout table of annex B §B.5 through
 * `@specstride/contracts`, never spelled as a path here: `gate:<N>:approved`
 * lies in the control plane and `gate:<N>:evidence` in the workspace part, and
 * the directory each sits in is the directory the run of that feature owns.
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  resolve as resolveLogicalName,
  type RootPaths,
} from "@specstride/contracts/ids/logical-names";

import { REFUSED_EXIT_CODE } from "./inventory-call.ts";
import { featureOfSlug, ReverseError } from "./output.ts";

/** The two logical names a record of a phase gate carries (annex B §B.5). */
export const GATE_STATE_NAMES = Object.freeze(["gate:<N>:approved", "gate:<N>:evidence"] as const);

/** One of the two names of `GATE_STATE_NAMES`. */
export type GateStateName = (typeof GATE_STATE_NAMES)[number];

/** The phase number the probe resolves the names with; any phase counts. */
export const PROBE_PHASE = 1 as const;

/**
 * F108-FR-026 — the as-is message. It names the LOGICAL NAME of the state that
 * was found, never its path, as F108-FR-034 requires of a line that names
 * state.
 */
export function gateStateRefusalMessage(slug: string, logicalName: string): string {
  return (
    `a reverse run for '${slug}' already has gate state in ${logicalName}; ` +
    `resume it with specstride resume -w <src> --feature ${featureOfSlug(slug)}, or pass --name`
  );
}

/** What the probe of one logical name looked at and what it found. */
export type GateStateProbe = {
  readonly logicalName: GateStateName;
  /** The directory the records of that name lie in, for the feature. */
  readonly directory: string;
  /** The file names found there; empty where the directory does not exist. */
  readonly found: readonly string[];
};

/**
 * The directory the records of one gate-state name lie in, for one reverse
 * run. The `<slug>` of the two names is the FEATURE of the run,
 * `reverse-<slug>` (F108-FR-026), not the bare slug: the records of a phase
 * gate are keyed by the feature the gated loop runs. The path itself comes
 * from the layout table — `<control>/features/<slug>/approvals/` for
 * `gate:<N>:approved` and `<workspace-part>/features/<slug>/evidence/` for
 * `gate:<N>:evidence` — and is never spelled here.
 */
export function gateStateDirectory(
  logicalName: GateStateName,
  slug: string,
  roots: RootPaths,
): string {
  return dirname(
    resolveLogicalName(logicalName, { "<slug>": featureOfSlug(slug), "<N>": PROBE_PHASE }, roots),
  );
}

/**
 * Every record of a phase gate of the feature, by logical name. A directory
 * that does not exist, or that cannot be read, holds no record: it is not an
 * error, because a first run of a slug has neither directory.
 */
export function probeGateState(slug: string, roots: RootPaths): readonly GateStateProbe[] {
  return Object.freeze(
    GATE_STATE_NAMES.map((logicalName) => {
      const directory = gateStateDirectory(logicalName, slug, roots);
      let found: readonly string[] = Object.freeze([]);
      if (existsSync(directory)) {
        try {
          found = Object.freeze(
            readdirSync(directory, { withFileTypes: true })
              .filter((entry) => entry.isFile())
              .map((entry) => entry.name)
              .sort(),
          );
        } catch {
          /* an unreadable directory holds no record the plan can see */
        }
      }
      return Object.freeze({ logicalName, directory, found });
    }),
  );
}

/**
 * F108-FR-026 — refuse the plan when phase-gate state of `reverse-<slug>`
 * exists. `gate:<N>:approved` is reported first where both exist, because the
 * requirement lists it first.
 */
export function checkGateStateCollision(slug: string, roots: RootPaths): void {
  for (const probe of probeGateState(slug, roots)) {
    if (probe.found.length === 0) continue;
    throw new ReverseError(
      gateStateRefusalMessage(slug, probe.logicalName),
      "gate-state-exists",
      REFUSED_EXIT_CODE,
    );
  }
}
