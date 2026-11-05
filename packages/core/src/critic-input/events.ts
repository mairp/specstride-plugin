// Feature 117 (T042) — the grounding events (F117-FR-015, F117-FR-043).
//
// Three events, in the envelope of annex X §X.1, with the types of the
// catalogue of feature 111
// (`packages/observability/data/event-catalogue.tsv`):
//
//  - `critic.grounding_carried` — paths are carried by F117-FR-013. The
//    compatibility projection of feature 144 renders it as the as-is event
//    `grounding_carried` (fields `phase`, `attempt`, `paths` joined by
//    commas). This feature adds NO row to the projection table.
//  - `critic.grounding_gap` — a grounding gap exists (F117-FR-014), at most
//    the first 20 tokens. Rendered as `grounding_gap`.
//  - `critic.citation_unresolved` — a cited path or wildcard did not
//    resolve, at most the first 20 paths. It has NO as-is equivalent and
//    projects to NOTHING. It is never typed `critic.grounding_gap`. Its
//    catalogue row is proposed to feature 111 as P1 of `analyze-report.md`.
//
// A path outside the workspace MUST NOT be held in clear by an event with no
// as-is equivalent (`prompt.built`, `critic.citation_unresolved`, a refusal
// record): such a field holds `outside:` followed by the FIRST 16 HEXADECIMAL
// CHARACTERS of the hash of the real path by the canonical hasher of annex X
// §X.5. The two events that project to as-is events keep the path as the
// baseline gives it, after the ingress of the class `target`.

import { MAJOR, SCHEMA, type EventEnvelope } from "@specstride/contracts/envelope/event";
import { contentHash } from "@specstride/kernel/hasher";
import { throughIngress, type OutsideTextIngress } from "./ingress.ts";

/** At most this many paths on either grounding event (F117-FR-015). */
export const GROUNDING_EVENT_PATH_CAP = 20;

/** The three types, joined from the catalogue of feature 111. */
export const GROUNDING_CARRIED_TYPE = "critic.grounding_carried" as const;
export const GROUNDING_GAP_TYPE = "critic.grounding_gap" as const;
export const CITATION_UNRESOLVED_TYPE = "critic.citation_unresolved" as const;

/** The prefix a path outside the workspace carries in an event with no as-is equivalent. */
export const OUTSIDE_PREFIX = "outside:";

/** How many hexadecimal characters of the canonical hash an outside path shows. */
export const OUTSIDE_HASH_CHARS = 16;

/** `outside:` + the first 16 hexadecimal characters of the canonical hash of the real path (F117-FR-043). */
export function outsideToken(realPath: string): string {
  return OUTSIDE_PREFIX + contentHash(realPath).slice(0, OUTSIDE_HASH_CHARS);
}

/** True when the path lies outside the workspace root (a lexical test; the caller may refine by real path). */
export function isOutsideWorkspace(path: string, workdir: string): boolean {
  if (path.startsWith(workdir + "/") || path === workdir) return false;
  return path.startsWith("/");
}

export interface GroundingEventIdentity {
  readonly runId: string;
  readonly launchId: string;
  readonly attemptId?: string | undefined;
  readonly attempt?: number | undefined;
}

type GroundingEventData = {
  readonly phase: number;
  readonly attempt: number;
  readonly paths: readonly string[];
};

function envelope(
  type: string,
  seq: number,
  ts: string,
  identity: GroundingEventIdentity,
  data: GroundingEventData,
): EventEnvelope {
  const out: Record<string, unknown> = {
    schema: SCHEMA,
    v: MAJOR,
    seq,
    ts,
    type,
    runId: identity.runId,
    launchId: identity.launchId,
    data: { phase: data.phase, attempt: data.attempt, paths: [...data.paths] },
  };
  if (identity.attemptId !== undefined) out.attemptId = identity.attemptId;
  if (identity.attempt !== undefined) out.attempt = identity.attempt;
  return out as unknown as EventEnvelope;
}

/**
 * The paths of an event that projects to an AS-IS event: as the baseline gives
 * them (F117-FR-043), AFTER each passes the one ingress of F100-FR-009 when
 * the composition root wired one (T097). Without a wired ingress the text
 * stands as it is, which is the shape the parity fixtures compare.
 */
function asIsPaths(paths: readonly string[], ingress: OutsideTextIngress | undefined): string[] {
  return paths.slice(0, GROUNDING_EVENT_PATH_CAP).map((path) => throughIngress(path, ingress));
}

/** `critic.grounding_carried` — the carried paths of F117-FR-013, as the baseline gives them. */
export function groundingCarriedEvent(
  data: GroundingEventData,
  seq: number,
  ts: string,
  identity: GroundingEventIdentity,
  ingress?: OutsideTextIngress | undefined,
): EventEnvelope {
  return envelope(GROUNDING_CARRIED_TYPE, seq, ts, identity, {
    phase: data.phase,
    attempt: data.attempt,
    paths: asIsPaths(data.paths, ingress),
  });
}

/** `critic.grounding_gap` — the gap tokens, at most the first 20, as the baseline gives them. */
export function groundingGapEvent(
  data: GroundingEventData,
  seq: number,
  ts: string,
  identity: GroundingEventIdentity,
  ingress?: OutsideTextIngress | undefined,
): EventEnvelope {
  return envelope(GROUNDING_GAP_TYPE, seq, ts, identity, {
    phase: data.phase,
    attempt: data.attempt,
    paths: asIsPaths(data.paths, ingress),
  });
}

/**
 * `critic.citation_unresolved` — the cited paths and wildcards that did not
 * resolve, at most the first 20. No content, no as-is equivalent, never
 * typed `critic.grounding_gap`. A path outside the workspace is held as
 * `outside:` + 16 hexadecimal characters of its canonical hash (F117-FR-043).
 */
export function citationUnresolvedEvent(
  data: GroundingEventData & { readonly workdir: string },
  seq: number,
  ts: string,
  identity: GroundingEventIdentity,
  ingress?: OutsideTextIngress | undefined,
): EventEnvelope {
  const paths = data.paths
    .slice(0, GROUNDING_EVENT_PATH_CAP)
    .map((path) =>
      throughIngress(isOutsideWorkspace(path, data.workdir) ? outsideToken(path) : path, ingress),
    );
  return envelope(CITATION_UNRESOLVED_TYPE, seq, ts, identity, {
    phase: data.phase,
    attempt: data.attempt,
    paths,
  });
}

/** A refusal record for the events: the token, the closed-set member, no content. */
export interface RefusalEventRecord {
  readonly token: string;
  readonly root: string;
}

/**
 * The path a refusal record holds: a real path outside the workspace is
 * `outside:` + 16 hexadecimal characters of its canonical hash
 * (F117-FR-043); the root itself is NEVER held (F117-FR-018).
 */
export function refusalRecordPath(
  realPath: string | undefined,
  workdir: string,
  ingress?: OutsideTextIngress | undefined,
): string | undefined {
  if (realPath === undefined) return undefined;
  return throughIngress(
    isOutsideWorkspace(realPath, workdir) ? outsideToken(realPath) : realPath,
    ingress,
  );
}

/** `prompt.built` — the counts of the assembled prompt; never the prompt, never the nonce. */

/** The token estimate of a block: the bytes divided by the measured 3.18 B/token (F117-FR-028). */
export function tokenEstimate(bytes: number): number {
  return Math.round(bytes / 3.18);
}

/** One block of `prompt.built`: the id, the bytes and the token estimate. No content. */
export type PromptBlockCount = {
  readonly id: string;
  readonly bytes: number;
  readonly tokens: number;
};

/** One reduction `prompt.built` states: which block, and the reason (F117-FR-028). */
export type PromptReduction = {
  readonly id: string;
  readonly reason: string;
};

/**
 * The residual risk of the second form (F117-FR-039, T079): what a critic of
 * the form `read-only-tools` reads by itself does not pass the grounding
 * snapshot — the runtime cannot frame it, redact it or remove marker lines
 * from it. The risk is accepted by the owner and is STATED in the record of
 * the call (`prompt.built`) whenever the form is used. It is a fixed
 * sentence of the runtime, never content.
 */
export const READ_ONLY_TOOLS_RESIDUAL_RISK: string =
  "What the critic reads with its own tools does not pass the grounding " +
  "snapshot: the runtime cannot frame it, redact it or remove marker lines " +
  "from it. This residual risk is accepted by the owner.";

/**
 * `prompt.built` — for every critic-class call: the total bytes, the bytes
 * and the token estimate per block, every reduction with its reason, and NO
 * content of the prompt and no nonce (F117-FR-028, F117-FR-043). A path
 * outside the workspace is held as `outside:` + 16 hexadecimal characters of
 * its canonical hash.
 */
export function promptBuiltEvent(
  data: {
    readonly phase: number;
    readonly attempt: number;
    readonly bytes: number;
    readonly blocks?: readonly { readonly id: string; readonly bytes: number }[];
    readonly reductions?: readonly PromptReduction[];
    readonly outsidePaths?: readonly string[];
    /** The residual risk of the second form, stated whenever that form is used (F117-FR-039). */
    readonly residualRisk?: string | undefined;
    readonly workdir: string;
  },
  seq: number,
  ts: string,
  identity: GroundingEventIdentity,
): EventEnvelope {
  const blocks: PromptBlockCount[] | undefined = data.blocks?.map((b) => ({
    id: b.id,
    bytes: b.bytes,
    tokens: tokenEstimate(b.bytes),
  }));
  const envelopeOut: Record<string, unknown> = {
    schema: SCHEMA,
    v: MAJOR,
    seq,
    ts,
    type: "prompt.built",
    runId: identity.runId,
    launchId: identity.launchId,
    data: {
      phase: data.phase,
      attempt: data.attempt,
      bytes: data.bytes,
      ...(blocks !== undefined ? { blocks } : {}),
      ...(data.reductions !== undefined ? { reductions: [...data.reductions] } : {}),
      ...(data.residualRisk !== undefined ? { residualRisk: data.residualRisk } : {}),
      ...(data.outsidePaths !== undefined
        ? {
            outsidePaths: data.outsidePaths.map((p) =>
              isOutsideWorkspace(p, data.workdir) ? outsideToken(p) : p,
            ),
          }
        : {}),
    },
  };
  if (identity.attemptId !== undefined) envelopeOut.attemptId = identity.attemptId;
  if (identity.attempt !== undefined) envelopeOut.attempt = identity.attempt;
  return envelopeOut as unknown as EventEnvelope;
}
