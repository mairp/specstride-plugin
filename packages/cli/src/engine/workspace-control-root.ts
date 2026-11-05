/**
 * The control root of a workspace: the ONE derivation the engine and the
 * front-door commands share, so that a record one of them writes is the
 * record the other reads. The engine has always resolved its per-workspace
 * state under the home directory (`run-feature.ts`); the commands that
 * answer a live run — `stop` first among them (F143-FR-026) — must name the
 * SAME root, or their request lands where no engine looks.
 *
 * The layout table's `<control>` for a workspace run is
 * `~/.specstride/workspaces/<sha256(real workdir)[:16]>`; the id is the hash
 * of the workdir exactly as the engine received it (the physical path the
 * front door resolves before the launch).
 */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/** The id of a workspace: the first sixteen hex digits of sha256(workdir). */
export function workspaceIdOfWorkspace(workdir: string): string {
  return createHash("sha256").update(workdir).digest("hex").slice(0, 16);
}

/** The control root the engine of a workspace writes and the commands read. */
export function controlRootOfWorkspace(workdir: string): string {
  return join(homedir(), ".specstride", "workspaces", workspaceIdOfWorkspace(workdir));
}
