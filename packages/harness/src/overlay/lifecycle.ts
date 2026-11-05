/**
 * T085 — the lifecycle of an overlay (F109-FR-033).
 *
 * With the scope `pass` a fresh overlay is created and populated before each
 * pass and removed after the supervision of the pass has returned; after
 * every pass the seam also removes the overlays of scope `pass` that a
 * killed pass of this owner left behind. With the scope `attempt` one
 * overlay is created before the first pass, used by every pass of the
 * invocation of the pass loop, and removed when that invocation ends. The
 * environment of an overlay reaches the process tree of the harness only,
 * and never the pass loop, a watchdog or the stream tap. When populating
 * fails, the half-made tree is removed and the pass fails without the
 * harness being started. Releasing an overlay always succeeds: a failed
 * removal prints a warning and never changes the status of the pass. When
 * the pass loop ends with a scope other than `none`, it first ends the
 * process tree of the pass in flight (a request to terminate, then a kill
 * after at most 10 seconds) and then removes every overlay it owns.
 */
import { buildOverlay, type BuildOutcome, type BuildFailure } from "./build.ts";
import { reap, removalWarning, removeTree, type OverlayMarker } from "./sweep.ts";
import type { AcceptedDeclaration } from "./declaration.ts";
import type { OverlayScope } from "./scope.ts";

/** The longest a pass in flight may take to end after the terminate request. */
export const TERMINATE_GRACE_MS = 10_000;

/** What the harness process tree receives and nothing else does. */
export type OverlaySession = {
  readonly scopeWord: OverlayScope;
  /** The environment of the harness process tree only. */
  readonly harnessEnv?: Readonly<Record<string, string>>;
  /** The paths the pass loop and its supervision must never see. */
  readonly overlayRoot?: string;
};

/** Who may see the environment of an overlay (F109-FR-033). */
export const ENVIRONMENT_REACHES = ["harness-process-tree"] as const;
/** Who must never see it. */
export const ENVIRONMENT_NEVER_REACHES = ["pass-loop", "watchdog", "stream-tap"] as const;

/** True when a consumer of the overlay environment may receive it. */
export function environmentMayReach(consumer: string): boolean {
  return (ENVIRONMENT_REACHES as readonly string[]).includes(consumer);
}

/** A live overlay of one pass or one invocation. */
export type LiveOverlay = {
  readonly root: string;
  readonly marker: OverlayMarker;
  readonly session: OverlaySession;
};

/** The result of releasing an overlay: always 0, a warning at most. */
export type ReleaseResult = {
  readonly exit_code: 0;
  readonly removed: boolean;
  readonly lines: readonly string[];
};

/**
 * F109-FR-033 — create and populate the overlay of one pass (`pass` scope)
 * or of one invocation (`attempt` scope). A failed populate removes the
 * half-made tree and fails the pass without the harness being started.
 */
export function acquireOverlay(input: {
  readonly declaration: AcceptedDeclaration;
  readonly scope: OverlayScope;
  readonly ownerPid: number;
  readonly ownerStart: string | number | null;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly tmpRoot?: string;
  readonly component?: string;
}): { readonly ok: true; readonly overlay: LiveOverlay } | ({ readonly ok: false } & BuildFailure) {
  const outcome: BuildOutcome = buildOverlay({
    declaration: input.declaration,
    scopeWord: input.scope,
    ownerPid: input.ownerPid,
    ownerStart: input.ownerStart,
    env: input.env,
    tmpRoot: input.tmpRoot,
    component: input.component,
  });
  if (!outcome.ok) {
    // buildOverlay already removed the half-made tree (F109-FR-033).
    const failure: BuildFailure = outcome;
    return failure;
  }
  return {
    ok: true,
    overlay: {
      root: outcome.root,
      marker: outcome.marker,
      session: { scopeWord: input.scope, harnessEnv: outcome.env, overlayRoot: outcome.root },
    },
  };
}

/**
 * F109-FR-033 — release an overlay. Releasing ALWAYS succeeds: a failed
 * removal prints the warning line and never changes the status of the pass.
 */
export function releaseOverlay(root: string): ReleaseResult {
  const outcome = removeTree(root);
  if (outcome.removed) return { exit_code: 0, removed: true, lines: [] };
  return {
    exit_code: 0,
    removed: false,
    lines: [removalWarning(root, outcome.cause ?? "unknown")],
  };
}

/** What one pass of the loop reports about its overlay. */
export type PassOverlayPlan = {
  /** `pass`: a fresh overlay per pass. `attempt`: the invocation's one. */
  readonly scopeWord: OverlayScope;
};

/**
 * F109-FR-033 — the overlay plan of one pass inside the pass loop. Scope
 * `pass` acquires a fresh tree per pass; scope `attempt` reuses the tree the
 * invocation acquired before its first pass.
 */
export function overlayPlanForPass(
  scope: OverlayScope,
  invocationOverlay: LiveOverlay | null,
): { readonly fresh: boolean; readonly overlay: LiveOverlay | null } {
  if (scope === "pass") return { fresh: true, overlay: null };
  return { fresh: false, overlay: invocationOverlay };
}

/**
 * F109-FR-033 — after every pass with the scope `pass`, the overlays of
 * scope `pass` that a killed pass of this owner left behind are removed.
 */
export function reapAfterPass(
  ownerPid: number,
  tmpRoot?: string,
): {
  readonly exit_code: 0;
  readonly removed: boolean;
  readonly lines: readonly string[];
} {
  const outcome = reap({ tmpDir: tmpRoot, ownerPid, scope: "pass" });
  return { exit_code: 0, removed: outcome.removed.length > 0, lines: outcome.lines };
}

/**
 * F109-FR-033 — the end of a pass loop with a scope other than `none`: end
 * the process tree of the pass in flight (a request to terminate, then a
 * kill after at most 10 seconds) and then remove every overlay it owns.
 */
export function endOfInvocation(input: {
  readonly scope: OverlayScope;
  readonly overlays: readonly LiveOverlay[];
  readonly passInFlight?: { readonly pid: number };
  readonly tmpRoot?: string;
  readonly stopPass?: (pid: number) => "stopped" | "killed";
}): {
  readonly exit_code: 0;
  readonly released: readonly string[];
  readonly lines: readonly string[];
} {
  const lines: string[] = [];
  const released: string[] = [];
  if (input.scope !== "none" && input.passInFlight && input.stopPass) {
    input.stopPass(input.passInFlight.pid); // terminate request, then kill ≤ 10 s
  }
  for (const overlay of input.overlays) {
    const outcome = releaseOverlay(overlay.root);
    lines.push(...outcome.lines);
    if (outcome.removed) released.push(overlay.root);
  }
  return { exit_code: 0, released, lines };
}
