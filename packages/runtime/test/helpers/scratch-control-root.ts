/**
 * T008 — an empty control root per test.
 *
 * The control root is the control plane of the product: it lies outside the
 * working tree and holds the lock, the lease, the registry, the inbox and the
 * approvals. It is keyed by `state.dir` (F122-FR-039; row 116 of the `parity`
 * profile), whose environment name is `SPECSTRIDE_STATE_DIR` by rule 3 of the
 * spelling of the catalogue.
 *
 * The quickstart requires it under "Prerequisites": *a scratch control root:
 * set the key of the control root to an empty directory — no test touches the
 * real state directory*. This helper is how that is kept true. Every call makes
 * a fresh directory of its own under the temporary directory of the platform,
 * proves it is empty, and hands back the environment that points the product at
 * it. `dispose` removes it with everything inside.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** The key of the control root (F122-FR-039). */
export const CONTROL_ROOT_KEY = "state.dir";

/** The environment name of that key (spelling rule 3: `SPECSTRIDE_STATE_DIR`). */
export const CONTROL_ROOT_ENV = "SPECSTRIDE_STATE_DIR";

/** A scratch control root and the ways a test uses it. */
export type ScratchControlRoot = {
  /** The real path of the empty control root. */
  readonly path: string;
  /** The key the product reads it by. */
  readonly key: typeof CONTROL_ROOT_KEY;
  /** The environment that points the product at it. */
  readonly env: Readonly<Record<string, string>>;
  /** Remove it with everything inside; safe to call twice. */
  readonly dispose: () => void;
};

/**
 * Make an empty control root for one test.
 *
 * It throws rather than hand back a directory that is not empty: a control root
 * with anything in it is not a scratch control root, and a test that ran
 * against one would not be hermetic.
 */
export function makeScratchControlRoot(label = "control-root"): ScratchControlRoot {
  const path = resolve(mkdtempSync(join(tmpdir(), `specstride-${label}-`)));
  const entries = readdirSync(path);
  if (entries.length > 0) {
    throw new Error(`the scratch control root ${path} is not empty: ${entries.join(", ")}`);
  }
  if (!statSync(path).isDirectory()) {
    throw new Error(`the scratch control root ${path} is not a directory`);
  }

  let disposed = false;
  return Object.freeze({
    path,
    key: CONTROL_ROOT_KEY,
    env: Object.freeze({ [CONTROL_ROOT_ENV]: path }),
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      rmSync(path, { recursive: true, force: true });
    },
  });
}

/** Run `body` with an empty control root, and remove it whatever happens. */
export async function withScratchControlRoot<T>(
  body: (root: ScratchControlRoot) => Promise<T> | T,
  label?: string,
): Promise<T> {
  const root = makeScratchControlRoot(label);
  try {
    return await body(root);
  } finally {
    root.dispose();
  }
}
