/**
 * T011 — the slug of a reverse run, the default output directory and every
 * refusal of an output directory (F108-FR-024, F108-FR-025, F108-FR-013).
 *
 * The output directory is the state with the logical name
 * `reverse:<slug>:output` of annex B §B.5: it lies in the working tree outside
 * the workspace part, the proposer is its only writer, and `reverse` and its
 * verbs never write into it (F108-FR-024). This module therefore only NAMES
 * and JUDGES it; nothing here creates it.
 *
 * Every judgment is made on REAL paths, as F108-FR-025 says, and the seven
 * refusals are checked in the order the requirement lists them: the order is
 * behaviour, because a path that is both outside the source and not a
 * directory must give the FIRST message of the two.
 */
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve as resolvePath, sep } from "node:path";

import { REFUSED_EXIT_CODE, USAGE_EXIT_CODE } from "./inventory-call.ts";

/* ------------------------------------------------------------------------- *
 * The slug (F108-FR-024)
 * ------------------------------------------------------------------------- */

/** The length a slug is cut to (F108-FR-024). */
export const SLUG_MAX_LENGTH = 40 as const;

/** The slug a name with nothing usable gives (F108-FR-024). */
export const SLUG_OF_NOTHING_USABLE = "project" as const;

/** The characters a slug keeps; every run of anything else becomes one `-`. */
export const SLUG_KEEPS = /[^a-z0-9]+/g;

/**
 * F108-FR-024 — the slug of a name: lower-cased, every run of characters
 * outside `a-z0-9` replaced by `-`, leading and trailing `-` removed, cut to
 * 40 characters and THEN stripped of a trailing `-`. A name with nothing
 * usable gives `project`.
 *
 * The second strip is not the first one repeated: the cut at 40 characters can
 * itself end the text on a `-`, and that `-` goes too.
 */
export function slugify(name: string): string {
  const replaced = name.toLowerCase().replace(SLUG_KEEPS, "-");
  const trimmed = replaced.replace(/^-+/, "").replace(/-+$/, "");
  const cut = trimmed.slice(0, SLUG_MAX_LENGTH).replace(/-+$/, "");
  return cut === "" ? SLUG_OF_NOTHING_USABLE : cut;
}

/** The feature of a reverse run, `reverse-<slug>` (F108-FR-018). */
export function featureOfSlug(slug: string): string {
  return `reverse-${slug}`;
}

/* ------------------------------------------------------------------------- *
 * The default output directory (F108-FR-024)
 * ------------------------------------------------------------------------- */

/** The directory of the source the numbered feature directories lie in. */
export const SPECS_DIRECTORY = "specs" as const;

/** A numbered spec directory: three or more digits, then anything. */
export const NUMBERED_SPEC_DIRECTORY = /^(\d+)(?:-.*)?$/;

/** The number a source whose `specs/` holds no numbered directory gives. */
export const FIRST_SPEC_NUMBER = 1 as const;

/** Three digits, as the default output directory spells the number. */
export function threeDigits(n: number): string {
  return String(n).padStart(3, "0");
}

/**
 * The highest number of a numbered directory under `specs/` of the source, or
 * `undefined` where there is none (F108-FR-024). A file is not a directory and
 * does not count; an unreadable or absent `specs/` counts as none.
 */
export function highestSpecNumber(src: string): number | undefined {
  const specs = join(src, SPECS_DIRECTORY);
  let entries: readonly string[];
  try {
    entries = readdirSync(specs, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return undefined;
  }
  let highest: number | undefined;
  for (const name of entries) {
    const match = NUMBERED_SPEC_DIRECTORY.exec(name);
    if (match === null) continue;
    const n = Number.parseInt(match[1] as string, 10);
    if (!Number.isFinite(n)) continue;
    if (highest === undefined || n > highest) highest = n;
  }
  return highest;
}

/**
 * F108-FR-024 — the default output directory: `specs/NNN-as-is-<slug>` of the
 * source, with NNN three digits and one above the highest existing spec
 * number, or `001` when `specs/` holds no numbered directory.
 */
export function defaultOutputDirectory(src: string, slug: string): string {
  const highest = highestSpecNumber(src);
  const number = highest === undefined ? FIRST_SPEC_NUMBER : highest + 1;
  return join(src, SPECS_DIRECTORY, `${threeDigits(number)}-as-is-${slug}`);
}

/* ------------------------------------------------------------------------- *
 * The refusals (F108-FR-013, F108-FR-025)
 * ------------------------------------------------------------------------- */

/** Why an output directory, or a source, was refused. */
export const OUTPUT_REFUSALS = [
  "source-not-a-directory",
  "out-is-the-source-root",
  "out-outside-the-source",
  "out-inside-git",
  "out-inside-the-state-directory",
  "out-inside-specify",
  "out-exists-and-is-not-a-directory",
  "out-exists-and-is-not-empty",
] as const;

/** One reason of `OUTPUT_REFUSALS`. */
export type OutputRefusal = (typeof OUTPUT_REFUSALS)[number];

/**
 * The ORDER in which F108-FR-025 checks the output directory. The order is
 * behaviour: a path that is both outside the source and not a directory gives
 * the outside-the-source message, never the other one.
 */
export const OUT_REFUSAL_ORDER: readonly OutputRefusal[] = Object.freeze([
  "out-is-the-source-root",
  "out-outside-the-source",
  "out-inside-git",
  "out-inside-the-state-directory",
  "out-inside-specify",
  "out-exists-and-is-not-a-directory",
  "out-exists-and-is-not-empty",
]);

/** The workspace part, and the old state trees of the products this replaces. */
export const STATE_DIRECTORY_NAMES = Object.freeze([".specstride", ".lisa"] as const);

/** The name of the legacy tree F108-FR-025 does NOT refuse. */
export const NOT_REFUSED_LEGACY_STATE_NAME = ".wiggum" as const;

/** The git directory of the source. */
export const GIT_DIRECTORY = ".git" as const;

/** The Spec Kit directory a reverse run never touches (F108-FR-017). */
export const SPECIFY_DIRECTORY = ".specify" as const;

/** A refusal of the plan: a message and the exit code it carries. */
export class ReverseError extends Error {
  /** The exit code; 3 for a refusal, 2 for a usage error (annex G §G.4). */
  readonly exitCode: number;
  /** The member of `OUTPUT_REFUSALS`, or another reason of the plan. */
  readonly refusal: string;
  constructor(message: string, refusal: string, exitCode: number = REFUSED_EXIT_CODE) {
    super(message);
    this.name = "ReverseError";
    this.refusal = refusal;
    this.exitCode = exitCode;
  }
}

/** F108-FR-013 — `source is not a directory: <src>`. */
export function sourceIsNotADirectoryMessage(src: string): string {
  return `source is not a directory: ${src}`;
}

/** F108-FR-025 — the source root itself. */
export function outIsTheSourceRootMessage(out: string): string {
  return `--out cannot be the source root itself; choose a dedicated output folder: ${out}`;
}

/** F108-FR-025 — outside the source tree. */
export function outOutsideTheSourceMessage(src: string, out: string): string {
  return `--out must be inside the source tree ${src} (got ${out})`;
}

/** F108-FR-025 — inside `.git`. */
export function outInsideGitMessage(out: string): string {
  return `--out cannot be inside the project's .git directory: ${out}`;
}

/** F108-FR-025 — inside the workspace part or an old state tree. */
export function outInsideTheStateDirectoryMessage(name: string, out: string): string {
  return `--out cannot be inside the state directory ${name}/: ${out}`;
}

/** F108-FR-025 — inside `.specify`. */
export function outInsideSpecifyMessage(out: string): string {
  return `--out cannot be inside .specify/ (the run never touches it): ${out}`;
}

/** F108-FR-025 — it exists and is not a directory. */
export function outExistsAndIsNotADirectoryMessage(out: string): string {
  return `--out exists and is not a directory: ${out}`;
}

/** F108-FR-025 — it exists, is a directory and is not empty. */
export function outExistsAndIsNotEmptyMessage(out: string, slug: string): string {
  return (
    `--out already exists and is not empty: ${out} ` +
    `(resume an existing reverse run with specstride resume --feature ${featureOfSlug(slug)})`
  );
}

/**
 * F108-FR-013 — the source, resolved to its real path. A path that is not a
 * directory, and one that cannot be resolved at all, is the same refusal:
 * `source is not a directory: <src>`, exit 3. The message carries the path as
 * the consumer WROTE it, because the real path of a missing path does not
 * exist.
 */
export function realSource(src: string): string {
  let real: string;
  try {
    real = realpathSync(src);
  } catch {
    throw new ReverseError(sourceIsNotADirectoryMessage(src), "source-not-a-directory");
  }
  if (!statSync(real).isDirectory()) {
    throw new ReverseError(sourceIsNotADirectoryMessage(src), "source-not-a-directory");
  }
  return real;
}

/**
 * The real path of a path that may not exist yet: the real path of the deepest
 * existing ancestor, with the rest of the path joined back on. A link in the
 * part that exists is therefore resolved — which is what makes a link that
 * resolves outside the source refusable (F108-FR-025).
 */
export function realPathOfAPathThatMayNotExist(path: string): string {
  const absolute = isAbsolute(path) ? path : resolvePath(path);
  const parts = absolute.split(sep);
  const tail: string[] = [];
  let head = parts.join(sep) === "" ? sep : absolute;
  for (;;) {
    try {
      const real = realpathSync(head);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch {
      const cut = head.lastIndexOf(sep);
      if (cut <= 0) return absolute;
      tail.unshift(head.slice(cut + 1));
      head = cut === 0 ? sep : head.slice(0, cut);
    }
  }
}

/** True where `inner` is `outer` itself or lies under it. Both are real paths. */
export function isAtOrUnder(inner: string, outer: string): boolean {
  if (inner === outer) return true;
  return inner.startsWith(outer.endsWith(sep) ? outer : outer + sep);
}

/** True where any path segment of `inner` below `outer` is `name`. */
export function hasSegmentUnder(inner: string, outer: string, name: string): boolean {
  if (!isAtOrUnder(inner, outer)) return false;
  const relative = inner
    .slice(outer.length)
    .split(sep)
    .filter((part) => part !== "");
  return relative.includes(name);
}

/** The path `--out` is made absolute against, when it is relative (F108-FR-013). */
export function absoluteOut(out: string, currentDirectory: string): string {
  return isAbsolute(out) ? out : resolvePath(currentDirectory, out);
}

/** True where a directory holds no entry at all. */
export function isAnEmptyDirectory(path: string): boolean {
  return readdirSync(path).length === 0;
}

/**
 * F108-FR-025 — judge an output directory against the source, on real paths,
 * in the order of the requirement. It returns the real path of the accepted
 * output directory and throws `ReverseError` with the matching message and
 * exit 3 on a refusal. It creates nothing: an existing EMPTY directory is
 * accepted and left as it is.
 */
export function checkOutputDirectory(input: {
  readonly src: string;
  readonly out: string;
  readonly slug: string;
}): string {
  const src = input.src;
  const out = realPathOfAPathThatMayNotExist(input.out);

  if (out === src) throw new ReverseError(outIsTheSourceRootMessage(out), "out-is-the-source-root");
  if (!isAtOrUnder(out, src)) {
    throw new ReverseError(outOutsideTheSourceMessage(src, out), "out-outside-the-source");
  }
  if (hasSegmentUnder(out, src, GIT_DIRECTORY)) {
    throw new ReverseError(outInsideGitMessage(out), "out-inside-git");
  }
  for (const name of STATE_DIRECTORY_NAMES) {
    if (hasSegmentUnder(out, src, name)) {
      throw new ReverseError(
        outInsideTheStateDirectoryMessage(name, out),
        "out-inside-the-state-directory",
      );
    }
  }
  if (hasSegmentUnder(out, src, SPECIFY_DIRECTORY)) {
    throw new ReverseError(outInsideSpecifyMessage(out), "out-inside-specify");
  }
  if (existsSync(out)) {
    // `out` is already a REAL path, so `lstat` and `stat` agree here: a link
    // was resolved before the checks, which is how a link that resolves
    // outside the source was refused above.
    if (!lstatSync(out).isDirectory()) {
      throw new ReverseError(
        outExistsAndIsNotADirectoryMessage(out),
        "out-exists-and-is-not-a-directory",
      );
    }
    if (!isAnEmptyDirectory(out)) {
      throw new ReverseError(
        outExistsAndIsNotEmptyMessage(out, input.slug),
        "out-exists-and-is-not-empty",
      );
    }
  }
  return out;
}

/** The exit code of a usage error, re-exported so a caller needs one import. */
export { REFUSED_EXIT_CODE, USAGE_EXIT_CODE };
