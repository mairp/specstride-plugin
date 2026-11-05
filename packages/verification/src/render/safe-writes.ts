/**
 * T099 — safe and ATOMIC writes (F105-FR-023).
 *
 * Four rules, each with its own refusal:
 *
 *  1. every file this feature writes into the working directory has an
 *     ABSOLUTE place INSIDE THE REAL working directory, else
 *     `verification output escapes the authorized workdir`;
 *  2. it is NOT a symbolic link, else the as-is message for a link;
 *  3. an existing file with OTHER content is replaced only when it starts with
 *     the EXPECTED MARKER OF GENERATION, else
 *     `refusing to overwrite a non-generated or changed artifact`;
 *  4. the write is ATOMIC — a temporary name in the TARGET DIRECTORY and a
 *     rename — and a file with the SAME CONTENT is left untouched.
 *
 * The real working directory is what makes rule 1 hold: a path that reaches
 * outside through a link in a parent directory is refused, because the
 * comparison is of REAL paths and not of the text of a path.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { atomicWrite } from "@specstride/kernel/atomic-write";
import { VerificationError } from "../plan/record.ts";

/** The refusal of a place outside the working directory (F105-FR-023). */
export const ESCAPES_MESSAGE = "verification output escapes the authorized workdir" as const;
/** The refusal of a place that is a symbolic link (F105-FR-023). */
export const SYMBOLIC_LINK_MESSAGE = "verification output cannot be a symbolic link" as const;
/** The refusal of a file that is not generated output (F105-FR-023). */
export const NOT_GENERATED_MESSAGE =
  "refusing to overwrite a non-generated or changed artifact" as const;
/** The refusal of a place that is not absolute (`lib/verification_plan.py`:127). */
export const NOT_ABSOLUTE_MESSAGE = "verification output must be absolute" as const;

/** The steps of an atomic write, as the kernel makes them (F105-FR-023). */
export const STEPS = ["write-temporary-in-the-target-directory", "fsync", "rename"] as const;

/** The nearest place of a path that exists (`lib/verification_plan.py`:116). */
export function nearestExisting(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

/**
 * The authorized place of an output (F105-FR-023,
 * `lib/verification_plan.py`:126). It returns the absolute place, or refuses.
 */
export function authorizeOutput(workdir: string, path: string): string {
  if (!isAbsolute(path)) {
    throw new VerificationError(`${NOT_ABSOLUTE_MESSAGE}: ${path}`);
  }
  const root = realpathSync(workdir);
  const absolute = resolve(path);
  const parent = realpathSync(nearestExisting(dirname(absolute)));
  const fromRoot = relative(root, parent);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new VerificationError(`${ESCAPES_MESSAGE}: ${absolute}`);
  }
  if (existsSync(absolute) || existsLink(absolute)) {
    if (lstatSync(absolute).isSymbolicLink()) {
      throw new VerificationError(`${SYMBOLIC_LINK_MESSAGE}: ${absolute}`);
    }
  }
  return absolute;
}

/** True where the place exists as a link, also a link that points nowhere. */
function existsLink(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** What one safe write did (F105-FR-023). */
export const SAFE_WRITE_OUTCOMES = ["written", "unchanged"] as const;
export type SafeWriteOutcome = (typeof SAFE_WRITE_OUTCOMES)[number];

/**
 * One safe and atomic write (F105-FR-023,
 * `lib/verification_plan.py` `_atomic_write`, :1354). `marker` is the expected
 * marker of generation; without one an existing file with other content is
 * ALWAYS refused, which is how the baseline protects a canonical JSON file
 * that carries no comment line.
 */
export function safeWrite(input: {
  readonly path: string;
  readonly content: string;
  readonly marker?: string | undefined;
}): SafeWriteOutcome {
  const directory = dirname(input.path);
  mkdirSync(directory, { recursive: true });
  if (existsSync(input.path)) {
    const previous = readFileSync(input.path, "utf8");
    // A file with the SAME content is left untouched (F105-FR-023).
    if (previous === input.content) return "unchanged";
    if (input.marker === undefined || !previous.startsWith(input.marker)) {
      throw new VerificationError(`${NOT_GENERATED_MESSAGE}: ${input.path}`);
    }
  }
  // A temporary name in the TARGET directory, then a rename (F105-FR-023).
  atomicWrite(input.path, input.content);
  return "written";
}

/**
 * A safe write that first authorizes its place (F105-FR-023): the one call a
 * writer of this feature makes.
 */
export function writeInsideTheWorkdir(input: {
  readonly workdir: string;
  readonly path: string;
  readonly content: string;
  readonly marker?: string | undefined;
}): { readonly path: string; readonly outcome: SafeWriteOutcome } {
  const path = authorizeOutput(input.workdir, input.path);
  return Object.freeze({
    path,
    outcome: safeWrite({
      path,
      content: input.content,
      ...(input.marker !== undefined ? { marker: input.marker } : {}),
    }),
  });
}

/** True where the place is inside the REAL working directory. */
export function isInsideTheWorkdir(workdir: string, path: string): boolean {
  try {
    authorizeOutput(workdir, path);
    return true;
  } catch {
    return false;
  }
}

/** True where the place is a directory that exists. */
export function isADirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * The two files the derivation writes.
 * ------------------------------------------------------------------ */

/** What one persist of the plan wrote (F105-FR-022, F105-FR-023). */
export type PersistedPlan = {
  readonly markdownPath: string;
  readonly jsonPath: string;
  readonly markdown: SafeWriteOutcome;
  readonly json: SafeWriteOutcome;
};

/**
 * Write the plan: the canonical record and the plan for people
 * (`lib/verification_plan.py` `persist_plan`, :1378).
 *
 * The canonical record is written WITHOUT a marker on purpose: it has no
 * comment line to carry one, so an existing file with other content at the
 * same place is always refused — which is the rule of B-1064, "the canonical
 * JSON plan has no marker, so a changed plan at the same path is refused".
 * The plan for people carries the marker of F105-FR-022 and may be replaced
 * by its own later output.
 */
export function persistPlan(input: {
  readonly plan: { readonly project: { readonly workdir: string } };
  readonly markdownPath: string;
  readonly jsonPath: string;
  /** The plan for people; `renderPlanForPeople` of `./plan-for-people.ts`. */
  readonly markdown: string;
  /** The marker of the plan for people (F105-FR-022). */
  readonly marker: string;
  /** The canonical record as text; the baseline writes sorted keys, indent 2. */
  readonly json: string;
}): PersistedPlan {
  const workdir = input.plan.project.workdir;
  const markdownPath = authorizeOutput(workdir, input.markdownPath);
  const jsonPath = authorizeOutput(workdir, input.jsonPath);
  const json = safeWrite({ path: jsonPath, content: input.json });
  const markdown = safeWrite({ path: markdownPath, content: input.markdown, marker: input.marker });
  return Object.freeze({ markdownPath, jsonPath, markdown, json });
}
