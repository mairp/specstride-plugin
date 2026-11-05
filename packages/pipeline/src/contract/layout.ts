/**
 * The layout of the launch contract, the launcher and the launch bundle
 * (F107-FR-026; annex B §B.5; C-216).
 *
 * The three artifacts of a pipeline live under logical names:
 *
 * - `pipeline:<pipelineId>:contract` — the launch contract;
 * - `pipeline:<pipelineId>:launcher` — the launcher, in the working tree;
 * - `pipeline:<pipelineId>:bundle:<hash>` — the launch bundle, addressed by
 *   the first 20 hexadecimal characters of the hash of the canonical bytes
 *   of the promoted launch contract (F107-FR-029).
 *
 * A path that names state by logical name is resolved through the layout and
 * stands OUTSIDE the rule of the authorized roots (F107-FR-026); the
 * physical root of the control plane is `.specstride/state` of the
 * repository. The as-is rule "the artifact directory is beside the launcher"
 * is NOT carried.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The logical name of the launch contract of one pipeline. */
export function contractStateName(pipelineId: string): string {
  return `pipeline:${pipelineId}:contract`;
}

/** The logical name of the launcher of one pipeline. */
export function launcherStateName(pipelineId: string): string {
  return `pipeline:${pipelineId}:launcher`;
}

/** The logical name of the launch bundle of one pipeline, by its hash. */
export function bundleStateName(pipelineId: string, bundleHash: string): string {
  return `pipeline:${pipelineId}:bundle:${bundleHash}`;
}

/**
 * The physical path of a logical name under the control plane of the
 * repository (see also `physicalStatePath` of the draft, the one reader this
 * module shares).
 */
export function physicalPathOfLogicalName(root: string, logicalName: string): string {
  return join(root, ".specstride", "state", ...logicalName.split(":"));
}

/**
 * The repository root a command resolves its sources against: the nearest
 * ancestor of the working directory that holds `.specstride`, else the
 * working directory itself.
 */
export function repoRootOfContract(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".specstride"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}
