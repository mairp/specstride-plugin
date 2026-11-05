/**
 * T247 — the notebook sweep of the kernel (annex B, §B.5; F100-FR-057,
 * F100-FR-058).
 *
 * At the start of every phase the engine calls this. It looks at the two
 * as-is stray places — the directory of the phase evidence and the root of
 * the working tree — and moves a stray notebook of the proposer to
 * `feature:<slug>:notebook`, through the resolver of T034 and the atomic
 * write of T023. The newer file wins: the stray file is deleted when the
 * canonical file is newer, and replaces it otherwise. The sweep writes the
 * as-is log line with both paths and returns the event `progress.swept` with
 * `from` and `to`, for the engine to emit.
 */
import { readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  resolve,
  type NameParameters,
  type RootPaths,
} from "@specstride/contracts/ids/logical-names";
import { atomicWrite } from "../atomic-write/index.ts";

/** The logical name the sweep moves a stray notebook to (annex B, §B.5). */
export const CANONICAL_NAME = "feature:<slug>:notebook" as const;

/** The logical name of the phase evidence, whose directory is a stray place. */
export const EVIDENCE_NAME = "gate:<N>:evidence" as const;

/** The as-is file name of the proposer's notebook at the two stray places. */
export const STRAY_FILE_NAME = "NOTES.md" as const;

/** The two as-is stray places of F100-FR-057. */
export const STRAY_PLACES = ["phase-evidence-directory", "working-tree-root"] as const;
export type StrayPlace = (typeof STRAY_PLACES)[number];

/** The event the engine emits for every sweep (F100-FR-058). */
export const EVENT_TYPE = "progress.swept" as const;

/** The event of one sweep: `from` the stray path, `to` the canonical path. */
export type SweptEvent = {
  readonly type: typeof EVENT_TYPE;
  readonly data: { readonly from: string; readonly to: string };
};

/** What one sweep did. */
export type SweepResult = {
  /** The stray place the notebook was found at. */
  readonly place: StrayPlace;
  /** The stray path. */
  readonly from: string;
  /** The canonical path. */
  readonly to: string;
  /** `replaced` when the stray file was newer, `deleted` when the canonical was. */
  readonly outcome: "replaced" | "deleted";
  /** The as-is log line of the sweep, with both paths (F100-FR-057). */
  readonly logLine: string;
  /** The event for the engine to emit (F100-FR-058). */
  readonly event: SweptEvent;
};

/** What the sweep needs to resolve the two places and the canonical name. */
export type SweepInput = {
  /** The feature slug, for `feature:<slug>:notebook`. */
  readonly slug: string;
  /** The phase number, for the directory of the phase evidence. */
  readonly phase: number;
  /** The real path of the root of the working tree. */
  readonly workspaceRealPath: string;
  /** The roots of the machine, as `rootPathsOf` gives them. */
  readonly roots: RootPaths;
  /** Further parameters the two names need. */
  readonly parameters?: NameParameters | undefined;
};

/** The as-is log line of the sweep; it carries both paths (F100-FR-057). */
export function sweepLogLine(from: string, to: string): string {
  return `swept the proposer's notebook from ${from} to ${to}`;
}

function modifiedAt(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

/** The two as-is stray places, as paths (F100-FR-057). */
export function strayPaths(input: SweepInput): readonly { place: StrayPlace; path: string }[] {
  const parameters: NameParameters = {
    ...(input.parameters ?? {}),
    "<slug>": input.slug,
    "<N>": input.phase,
  };
  const evidence = resolve(EVIDENCE_NAME, parameters, input.roots);
  return Object.freeze([
    { place: "phase-evidence-directory" as const, path: join(dirname(evidence), STRAY_FILE_NAME) },
    { place: "working-tree-root" as const, path: join(input.workspaceRealPath, STRAY_FILE_NAME) },
  ]);
}

/** The canonical path of the proposer's notebook (annex B, §B.5). */
export function canonicalPath(input: SweepInput): string {
  const parameters: NameParameters = {
    ...(input.parameters ?? {}),
    "<slug>": input.slug,
    "<N>": input.phase,
  };
  return resolve(CANONICAL_NAME, parameters, input.roots);
}

/**
 * F100-FR-057, F100-FR-058 — sweep the two as-is stray places. Returns one
 * result per stray notebook found; the engine writes the log line and emits
 * the event of each.
 */
export function sweepNotebooks(input: SweepInput): readonly SweepResult[] {
  const to = canonicalPath(input);
  const canonicalAt = modifiedAt(to);
  const results: SweepResult[] = [];
  for (const { place, path: from } of strayPaths(input)) {
    if (from === to) continue;
    const strayAt = modifiedAt(from);
    if (strayAt === undefined) continue;
    // The newer file wins: the stray file is deleted when the canonical one is
    // newer, and replaces it otherwise (F100-FR-057).
    const canonicalIsNewer = canonicalAt !== undefined && canonicalAt > strayAt;
    if (canonicalIsNewer) {
      rmSync(from, { force: true });
    } else {
      atomicWrite(to, readFileSync(from), { createDirectory: true });
      rmSync(from, { force: true });
    }
    results.push(
      Object.freeze({
        place,
        from,
        to,
        outcome: canonicalIsNewer ? ("deleted" as const) : ("replaced" as const),
        logLine: sweepLogLine(from, to),
        event: Object.freeze({
          type: EVENT_TYPE,
          data: Object.freeze({ from, to }),
        }) as SweptEvent,
      }),
    );
  }
  return Object.freeze(results);
}

/** The fields of the as-is event of the sweep (F100-FR-058). */
export const EVENT_FIELDS = ["from", "to"] as const;
