/**
 * T030 — the layout of the invocation artifacts (F126-FR-027; origins
 * C-056 B-0633, B-0634, B-0635; C-165 B-2182, B-2183).
 *
 * The artifacts live under logical names (`pass:<passId>:invocation`,
 * `pass:<passId>:result`, ...). The layout table maps every logical name of
 * the invocation to its file inside the as-is directory of the invocation,
 * one per pass, whose name has the identity components sanitized, and maps
 * `run:<runId>:current-pass` to `.last-invocation-dir`. The prompt and the
 * response are kept only while `invocation.debug` is on, and the raw stream
 * while raw capture is on.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathSafeComponent, type InvocationIdentity } from "./identity.ts";

/** The file each logical name of the invocation maps to inside its directory. */
export const LAYOUT_TABLE = {
  "pass:invocation": "metadata.json",
  "pass:stream": "provider.jsonl",
  "pass:producer-status": "producer.json",
  "pass:provider-terminal": "provider-terminal.json",
  "pass:result": "result.json",
  "pass:prompt": "prompt.txt",
  "pass:response": "response.txt",
} as const;

/** A logical name of the layout table. */
export type LayoutName = keyof typeof LAYOUT_TABLE;

/**
 * The as-is pointer that names the invocation directory of the newest pass,
 * so the finalization finds the artifacts (F126-FR-027, B-0634). It is the
 * layout table's mapping of `run:<runId>:current-pass`.
 */
export const CURRENT_PASS_POINTER = ".last-invocation-dir";

/**
 * The as-is directory of one invocation, under the root of the control plane
 * (B-0633, B-2182): `<root>/debug/invocations/<run_id>/<role>/phase-<P>/-
 * attempt-<A>/iter-<i>/<invocation_id>`, every component sanitized
 * (F126-FR-026).
 */
export function invocationDirectory(root: string, identity: InvocationIdentity): string {
  return join(
    resolve(root),
    "debug",
    "invocations",
    pathSafeComponent(identity.runId),
    pathSafeComponent(identity.role),
    `phase-${pathSafeComponent(identity.phase)}`,
    `attempt-${String(identity.attempt)}`,
    `iter-${String(identity.iteration)}`,
    pathSafeComponent(identity.invocationId),
  );
}

/** The path of one artifact of the invocation, by logical name. */
export function artifactPath(dir: string, name: LayoutName): string {
  return join(dir, LAYOUT_TABLE[name]);
}

/**
 * The refusal of a creation that would overwrite an existing invocation
 * artifact set (F126-FR-028, B-2198).
 */
export class InvocationExistsError extends Error {
  constructor(dir: string) {
    super(`invocation directory already exists: ${dir}`);
    this.name = "InvocationExistsError";
  }
}

/**
 * Create the directory of one invocation exclusively (F126-FR-028): an
 * existing directory refuses with the message of the baseline. The caller
 * writes the invocation record into the returned path afterwards.
 */
export function ensureInvocationDirectory(root: string, identity: InvocationIdentity): string {
  const dir = invocationDirectory(root, identity);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "EISFILE") throw new InvocationExistsError(dir);
    throw error;
  }
  if (existsSync(artifactPath(dir, "pass:invocation"))) {
    throw new InvocationExistsError(dir);
  }
  return dir;
}

/**
 * Point `run:<runId>:current-pass` at the directory of the newest pass
 * (B-0634). The pointer is written atomically.
 */
export function writeCurrentPassPointer(root: string, dir: string): string {
  const path = join(resolve(root), CURRENT_PASS_POINTER);
  writeFileSync(path, `${resolve(dir)}\n`, "utf8");
  return path;
}

/** Read the pointer, or null where it is missing or unreadable (B-0781). */
export function readCurrentPassPointer(root: string): string | null {
  const path = join(resolve(root), CURRENT_PASS_POINTER);
  try {
    const text = readFileSync(path, "utf8").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}
