/**
 * T031 — the resolver of the scheme `file:` (F110-FR-030).
 *
 * "The scheme `file:` MUST take an absolute path, after a leading `~/` is
 * expanded. Its real path, after symbolic links, MUST lie outside the workspace
 * and outside the control plane, and the file MUST be readable by its owner
 * only; otherwise the result MUST be `unsafe-file`. One final line end MUST be
 * removed from the value. An absent or empty file MUST be `missing`."
 *
 * The four checks in the order the requirement states them:
 *
 * 1. the path is absolute after `~/` is expanded — otherwise `inline-secret`,
 *    by the same reading as F110-FR-029's "a name that is not a valid variable
 *    name": a target that is not a path at all is a value written where a
 *    reference belongs;
 * 2. the REAL path, after symbolic links, lies outside the workspace and
 *    outside the control plane — otherwise `unsafe-file`. The link is followed
 *    first, so a link inside the workspace that points outside it, and a link
 *    outside it that points in, are both judged by the target;
 * 3. no group and no other permission bit is set — otherwise `unsafe-file`;
 * 4. absent, of size zero, or empty after one final line end is removed —
 *    `missing`.
 *
 * `exists` reads the metadata only and never the content, so it cannot return
 * the value even by accident (F110-FR-028).
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve as resolvePath, sep } from "node:path";

import {
  inlineSecretError,
  missingError,
  parseSecretReference,
  unsafeFileError,
  type BoundHostLookup,
  type ConfigSecretResolver,
  type Existence,
  type ResolvedSecret,
  type SecretReference,
  type SecretRegistrar,
} from "./reference.ts";

/** The scheme this resolver handles (§K.7). */
export const FILE_SCHEME = "file:" as const;

/** The id the conformance report prints for this resolver. */
export const FILE_RESOLVER_ID = "config-secret-resolver-file" as const;

/**
 * The permission bits that make a file unsafe: every group bit and every other
 * bit. "Readable by its owner only" admits `0600` and `0400` and refuses
 * `0640`, `0604`, `0660` and `0666`.
 */
export const FORBIDDEN_MODE_BITS = 0o077 as const;

/** The two roots a target must lie outside of (F110-FR-030, second sentence). */
export const FORBIDDEN_ROOT_NAMES = ["the workspace", "the control plane"] as const;
export type ForbiddenRootName = (typeof FORBIDDEN_ROOT_NAMES)[number];

/** The metadata and the content of a file, as the resolver reads them. */
export interface FileSeam {
  /** The real path, after symbolic links. Throws where the path is absent. */
  realpath(path: string): string;
  /** The mode bits and the size. Throws where the path is absent. */
  stat(path: string): { readonly mode: number; readonly size: number };
  /** The content, as text. */
  read(path: string): string;
}

/** The seam over `node:fs` the resolver uses when the caller names no other. */
export const nodeFileSeam: FileSeam = Object.freeze({
  realpath(path: string): string {
    return realpathSync(path);
  },
  stat(path: string): { readonly mode: number; readonly size: number } {
    const info = statSync(path);
    return Object.freeze({ mode: info.mode, size: info.size });
  },
  read(path: string): string {
    return readFileSync(path, "utf8");
  },
});

/** What the `file:` resolver is built with. */
export interface FileResolverOptions {
  /** The real path of the root of the working tree (`<workspace>`). */
  readonly workspaceRoot: string;
  /** The real path of the control plane (the root of `state.dir`). */
  readonly controlRoot: string;
  /** The home directory, for a leading `~/`. */
  readonly home: string;
  /** The redactor every resolved value is registered with (F110-FR-032). */
  readonly redactor: SecretRegistrar;
  /** Where the references were declared, for `boundHost` (F110-FR-033). */
  readonly bindings?: BoundHostLookup | undefined;
  /** The file seam; `nodeFileSeam` when the caller names none. */
  readonly fs?: FileSeam | undefined;
}

/**
 * F110-FR-030, first sentence — expand a leading `~/`. Only a LEADING `~/` is
 * expanded, and a bare `~` is not a path of a file.
 */
export function expandHome(target: string, home: string): string {
  if (target === "~") return home;
  if (target.startsWith("~/")) return join(home, target.slice(2));
  return target;
}

/**
 * True where `child` is the directory `parent` itself or lies under it. Both
 * are compared after `path.resolve`, so `/w/../w/secret` is judged as
 * `/w/secret`, and the separator guard keeps `/workspace-2` outside
 * `/workspace`.
 */
export function pathIsInside(child: string, parent: string): boolean {
  const a = resolvePath(child);
  const b = resolvePath(parent);
  if (a === b) return true;
  return a.startsWith(b.endsWith(sep) ? b : b + sep);
}

/** True where no group and no other permission bit is set (F110-FR-030). */
export function isOwnerReadableOnly(mode: number): boolean {
  return (mode & FORBIDDEN_MODE_BITS) === 0;
}

/**
 * F110-FR-030, fourth sentence — remove ONE final line end: `\r\n` or `\n`,
 * once. A value that ends in two line ends keeps one of them, and a value with
 * none is untouched.
 */
export function stripOneFinalLineEnd(text: string): string {
  if (text.endsWith("\r\n")) return text.slice(0, -2);
  if (text.endsWith("\n")) return text.slice(0, -1);
  return text;
}

/** What the path checks of F110-FR-030 decided about one target. */
interface CheckedTarget {
  /** The real path, after symbolic links. */
  readonly real: string;
  /** The mode bits of the real path. */
  readonly mode: number;
  /** The size in bytes. */
  readonly size: number;
}

/**
 * Build the `file:` resolver. It opens a file and makes no network call
 * (F110-FR-028).
 */
export function createFileResolver(options: FileResolverOptions): ConfigSecretResolver {
  const seam = options.fs ?? nodeFileSeam;

  /** The roots a target must lie outside of, each with the name of the refusal. */
  const forbiddenRoots = (): readonly { name: ForbiddenRootName; path: string }[] =>
    Object.freeze([
      Object.freeze({ name: "the workspace" as const, path: options.workspaceRoot }),
      Object.freeze({ name: "the control plane" as const, path: options.controlRoot }),
    ]);

  const pathOf = (reference: SecretReference, key?: string | undefined): string => {
    const parsed = parseSecretReference(reference);
    if (parsed === undefined || parsed.scheme !== FILE_SCHEME) {
      throw missingError(reference, `is no reference of the scheme \`${FILE_SCHEME}\``, key);
    }
    const expanded = expandHome(parsed.target, options.home);
    if (expanded === "" || !isAbsolute(expanded)) {
      throw inlineSecretError(
        reference,
        `names \`${parsed.target}\`, which is not an absolute path after a ` +
          `leading \`~/\` is expanded (F110-FR-030): a value was written where a ` +
          `reference belongs`,
        key,
      );
    }
    return expanded;
  };

  /**
   * The two `unsafe-file` checks and the metadata, or `undefined` where the
   * file is absent (which is `missing`, not `unsafe-file`).
   */
  const check = (
    reference: SecretReference,
    key?: string | undefined,
  ): CheckedTarget | undefined => {
    const path = pathOf(reference, key);
    let real: string;
    try {
      real = seam.realpath(path);
    } catch {
      return undefined; // absent — F110-FR-030, last sentence
    }
    // The link is followed BEFORE the roots are judged, so the target decides.
    for (const root of forbiddenRoots()) {
      if (root.path !== "" && pathIsInside(real, root.path)) {
        throw unsafeFileError(
          reference,
          `has the real path \`${real}\`, which lies inside ${root.name} ` +
            `(\`${resolvePath(root.path)}\`); a secret file must lie outside both ` +
            `(F110-FR-030)`,
          key,
        );
      }
    }
    let info: { readonly mode: number; readonly size: number };
    try {
      info = seam.stat(real);
    } catch {
      return undefined;
    }
    if (!isOwnerReadableOnly(info.mode)) {
      throw unsafeFileError(
        reference,
        `has the mode \`0${(info.mode & 0o777).toString(8)}\`, which is readable ` +
          `by a group or by others; a secret file must be readable by its owner ` +
          `only (F110-FR-030)`,
        key,
      );
    }
    return Object.freeze({ real, mode: info.mode, size: info.size });
  };

  return Object.freeze({
    id: FILE_RESOLVER_ID,
    scheme: FILE_SCHEME,
    makesANetworkCall: false as const,

    handles(scheme: string): boolean {
      return scheme === FILE_SCHEME;
    },

    /**
     * F110-FR-028 — `exists` reads the metadata and never the content: an
     * absent file or a file of size zero is `no`, a safe non-empty file is
     * `yes`, and an unsafe target is refused with `unsafe-file`.
     */
    exists(reference: SecretReference): Promise<Existence> {
      if (parseSecretReference(reference)?.scheme !== FILE_SCHEME) {
        return Promise.resolve<Existence>("no");
      }
      let checked: CheckedTarget | undefined;
      try {
        checked = check(reference);
      } catch (error) {
        return Promise.reject(error as Error);
      }
      if (checked === undefined || checked.size === 0) return Promise.resolve<Existence>("no");
      return Promise.resolve<Existence>("yes");
    },

    /**
     * F110-FR-030 — the content of the file with one final line end removed,
     * in memory only, registered with the redactor (F110-FR-032).
     */
    resolve(reference: SecretReference): Promise<ResolvedSecret> {
      let checked: CheckedTarget | undefined;
      try {
        checked = check(reference);
      } catch (error) {
        return Promise.reject(error as Error);
      }
      if (checked === undefined) {
        return Promise.reject(
          missingError(reference, "names a file that is not there (F110-FR-030)"),
        );
      }
      if (checked.size === 0) {
        return Promise.reject(missingError(reference, "names an empty file (F110-FR-030)"));
      }
      let value: string;
      try {
        value = stripOneFinalLineEnd(seam.read(checked.real));
      } catch {
        // F110-FR-028, last sentence — a resolver that fails gives `missing`.
        return Promise.reject(missingError(reference, "names a file that cannot be read"));
      }
      if (value === "") {
        return Promise.reject(
          missingError(reference, "names a file that holds nothing but one line end"),
        );
      }
      options.redactor.register(value);
      return Promise.resolve(Object.freeze({ value, registeredWithTheRedactor: true as const }));
    },

    boundHost(reference: SecretReference): string | null {
      return options.bindings?.hostOf(reference) ?? null;
    },
  });
}
