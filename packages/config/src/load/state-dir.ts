/**
 * T011 — the control root and the key `state.dir` (F110-FR-011).
 *
 * The control root is settable by the user-scope key `state.dir`, by the
 * environment and by a flag, as annex B requires (F100-FR-034). The key is
 * widening, so a project file may not set it — the catalogue gives it the layers
 * `F E U`, and the ordinary layer rule of F110-FR-001 refuses `P`. A control root
 * inside the working tree is accepted only together with the deny rule that
 * annex B names for the proposer's harness, and the run then records
 * `protection=detect` unless the harness adapter confirms the denial.
 */
import { controlRoot, type ControlRootResolution } from "@specstride/contracts/ids/roots";

import { catalogueEntry } from "../schema/catalogue.ts";
import { ConfigValueError, type LayerCode } from "../schema/types.ts";
import { validateKeyValue } from "../schema/validate.ts";
import type { FileEnvironment } from "./files.ts";

/** The key that sets the control root (F110-FR-011). */
export const STATE_DIR_KEY = "state.dir";

/** The layers the catalogue lets set `state.dir`: flag, environment, user file. */
export function stateDirLayers(): readonly LayerCode[] {
  return catalogueEntry(STATE_DIR_KEY)?.layers ?? [];
}

/** True where the layer may set `state.dir` (F110-FR-011 with F110-FR-001). */
export function stateDirMayBeSetBy(layer: LayerCode): boolean {
  return stateDirLayers().includes(layer);
}

/** The trust class of `state.dir`; F110-FR-011 requires `W`. */
export function stateDirTrustClass(): string {
  return catalogueEntry(STATE_DIR_KEY)?.trust ?? "";
}

/** A control root the run refuses (F110-FR-011 with F100-FR-034). */
export class ControlRootError extends Error {
  readonly reason = "deny-rule-missing" as const;
  readonly path: string;
  constructor(path: string, workspace: string) {
    super(
      `the control root \`${path}\` lies inside the working tree \`${workspace}\`. ` +
        `A control root inside the working tree is accepted only together with a deny ` +
        `rule for the proposer's harness (annex B §B.2; F100-FR-034; F110-FR-011)`,
    );
    this.name = "ControlRootError";
    this.path = path;
  }
}

/** What the caller knows when it resolves the control root. */
export interface ControlRootRequest {
  /** The machine, as the file loader sees it. */
  readonly env: FileEnvironment;
  /** The value of `state.dir`, where a layer set it, and the layer that did. */
  readonly stateDir?: { readonly value: unknown; readonly layer: LayerCode } | undefined;
  /** True where the consumer declared the deny rule that annex B names. */
  readonly denyRuleForProposerHarness?: boolean | undefined;
  /** True where the harness adapter confirmed the sandbox denies the control plane. */
  readonly sandboxDeniesControlPlane?: boolean | undefined;
}

/** The control root of the run, with what annex B records about it. */
export interface ControlRootDecision extends ControlRootResolution {
  /** The key that set it, where a layer did. */
  readonly setBy?: LayerCode | undefined;
}

/**
 * F110-FR-011 — resolve the control root.
 *
 * `state.dir` is validated like any other key: an offer from a layer the
 * catalogue does not list for it is refused, and so is a value that is not a
 * path. The resolution itself is feature 100's (`controlRoot` of
 * `@specstride/contracts`), so the fallback, the `protection` field and the
 * disjointness rules stay in the one place that owns them.
 */
export function resolveControlRoot(request: ControlRootRequest): ControlRootDecision {
  const { env, stateDir } = request;
  let override = env.controlRootOverride;
  if (stateDir !== undefined) {
    const verdict = validateKeyValue(STATE_DIR_KEY, stateDir.value, stateDir.layer, {
      place: stateDir.layer === "E" ? "environment" : stateDir.layer === "F" ? "flag" : "user file",
    });
    if (!verdict.ok) throw verdict.error;
    override = String(verdict.value);
  }
  const resolution = controlRoot({
    home: env.home,
    xdgConfigHome: env.xdgConfigHome,
    xdgStateHome: env.xdgStateHome,
    xdgCacheHome: env.xdgCacheHome,
    workspaceRealPath: env.workspaceRealPath,
    workspaceId: env.workspaceId ?? "",
    controlRootOverride: override,
    sandboxDeniesControlPlane: request.sandboxDeniesControlPlane,
  });
  if (resolution.requiresDenyRule && request.denyRuleForProposerHarness !== true) {
    throw new ControlRootError(resolution.path, env.workspaceRealPath);
  }
  return Object.freeze({
    ...resolution,
    ...(stateDir === undefined ? {} : { setBy: stateDir.layer }),
  });
}

export { ConfigValueError };
