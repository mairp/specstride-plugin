/**
 * Where the generator reads and where it writes (T207, the port of
 * `specs/100-specstride/contracts/tools/generate.py`; F100-FR-030).
 *
 * The Python script fixes its four places from the path of the script itself
 * (`HERE.parents[1]`, `[2]`, `[4]`). The port takes them as a `Places` bag so
 * that the byte-identical proof of T293 can generate into a scratch directory
 * while reading the same annexes.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** This file: `tools/contracts-gen/src/paths.ts`. */
const HERE = fileURLToPath(import.meta.url);
/** The root of the repository: three directories above `src/`. */
export const REPO_ROOT = resolve(dirname(dirname(dirname(dirname(HERE)))));

/** The nine annexes of feature 100: the letter and the file stem of each. */
export const ANNEXES: readonly (readonly [string, string])[] = [
  ["A", "A-foundations"],
  ["B", "B-state"],
  ["C", "C-ports-and-edges"],
  ["D", "D-pass-loop"],
  ["E", "E-engine"],
  ["F", "F-runtime-root"],
  ["G", "G-cli"],
  ["H", "H-hosts"],
  ["X", "X-cross-layer"],
];

/** The prefix of the `$id` of every record schema (contracts/README.md). */
export const URN = "urn:specstride:schema:";

/** The `note` and the `description` that every generated file carries. */
export const NOTE =
  "Generated from the annexes of specs/100-specstride by contracts/tools/generate.py. " +
  "The annex stands where the two differ.";

/** The four places the generator reads from and writes to. */
export interface Places {
  /** `specs/100-specstride/annexes` — the authority. */
  readonly annexDir: string;
  /** `specs/100-specstride/contracts` — the hand-written sources and the output. */
  readonly contractsDir: string;
  /** The root of the repository: `docs/ecosystem/` is read below it. */
  readonly repoDir: string;
}

/** The places of this repository: what the Python script computes from its own path. */
export function defaultPlaces(repo: string = REPO_ROOT): Places {
  return Object.freeze({
    annexDir: join(repo, "specs/100-specstride/annexes"),
    contractsDir: join(repo, "specs/100-specstride/contracts"),
    repoDir: repo,
  });
}
