/**
 * T091 — the overlay of a critic-class call (F109-FR-036).
 *
 * A critic-class call of an entry that declares an overlay runs in an overlay
 * of its own, created for that call with the scope word `critic` and removed
 * when the call ends, also when the call fails or passes its time limit. The
 * configured overlay scope is NOT read for it. A declaration error or an
 * overlay error of such a call is reported as a failure of the call under
 * F109-FR-010.
 */
import { buildOverlay, type BuildOutcome } from "./build.ts";
import { releaseOverlay } from "./lifecycle.ts";
import { removeTree } from "./sweep.ts";
import {
  validateDeclaration,
  type AcceptedDeclaration,
  type DeclarationEntry,
} from "./declaration.ts";

/** The scope word a critic-class call's tree carries (CQ-064). */
export const CRITIC_SCOPE_WORD = "critic";

/** The failure of a critic-class call that its overlay caused. */
export type CriticOverlayFailure = {
  readonly ok: false;
  /** The typed failure kind under F109-FR-010. */
  readonly kind: "declaration_error" | "overlay_error";
  readonly reason: string;
};

export type CriticOverlayOutcome =
  | {
      readonly ok: true;
      readonly root: string;
      readonly env: Record<string, string>;
      /** The tree is gone when this resolves; true when the removal removed it. */
      readonly released: boolean;
      readonly lines: readonly string[];
    }
  | CriticOverlayFailure;

/**
 * F109-FR-036 — run `call` inside an overlay of its own. The configured
 * scope is not read: the tree always carries the scope word `critic`. The
 * tree is removed when the call ends — normally, with a failure, or after
 * the call passed its time limit. An overlay error is a failure of the call.
 */
export function withCriticOverlay<T>(
  input: {
    readonly entry: DeclarationEntry;
    readonly ownerPid: number;
    readonly ownerStart: string | number | null;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly tmpRoot?: string;
    readonly component?: string;
  },
  call: (overlay: { readonly root: string; readonly env: Record<string, string> }) => T,
): T | CriticOverlayFailure {
  const verdict = validateDeclaration(input.entry);
  if (!verdict.ok) {
    return { ok: false, kind: "declaration_error", reason: verdict.error };
  }
  const declaration: AcceptedDeclaration = verdict;
  const outcome: BuildOutcome = buildOverlay({
    declaration,
    scopeWord: CRITIC_SCOPE_WORD,
    ownerPid: input.ownerPid,
    ownerStart: input.ownerStart,
    env: input.env,
    tmpRoot: input.tmpRoot,
    component: input.component ?? "specstride-critic",
  });
  if (!outcome.ok) {
    return { ok: false, kind: "overlay_error", reason: outcome.message };
  }
  try {
    const result: unknown = call({ root: outcome.root, env: outcome.env });
    const release = releaseOverlay(outcome.root);
    return {
      ok: true,
      root: outcome.root,
      result,
      env: outcome.env,
      released: release.removed,
      lines: release.lines,
    } as T;
  } catch (cause) {
    // Also on a failure or a passed time limit the tree goes away.
    removeTree(outcome.root);
    throw cause;
  }
}
