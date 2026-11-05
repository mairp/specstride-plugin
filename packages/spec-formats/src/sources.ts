/**
 * T035 — `inputs` AND THE SOURCE RECORDS (F104-FR-023; `contracts/verdict.md`,
 * the row Source of `data-model.md`).
 *
 * `inputs` is the one place that says which files of a specification are its
 * sources, what each one is called, and what its hashes are. Every hash it
 * writes comes from the canonical hasher of `@specstride/kernel` (T007,
 * F104-FR-021): this module computes none of its own, and the three functions
 * it calls — `contentHash`, `taskListHashIgnoringCheckboxes` and
 * `taskListHashIgnoringCheckboxesOfBytes` — are the hasher's.
 *
 * Which files, per format (F104-FR-023, CQ-043):
 *
 *  - `speckit-tasks`: `spec.md`, `plan.md` and `tasks.md` of the feature
 *    directory, THOSE THAT EXIST;
 *  - `openspec-change`: `tasks.md` as `tasks`, `proposal.md` as `spec` and
 *    `design.md` as `plan`, those that exist;
 *  - `native`: the one file, as `spec`.
 *
 * Who takes what (F104-FR-023, interpretation I2 of the spec):
 *
 *  - the RUN SNAPSHOT takes its source hashes from `inputs` (annex B §B.12);
 *  - the LAUNCH CONTRACT takes the hashes of the spec, the plan and the task
 *    list from `inputs`, and for every other source it records — the kinds of
 *    annex X §X.6 row 256, owner 107 — it uses the CONTENT HASH of the
 *    canonical hasher and no hash of its own.
 *
 * A read that fails is not an error here: the source is recorded as
 * `unreadable` so the verdict can say so (F104-FR-025). A file whose bytes are
 * not UTF-8 gets a content hash — the bytes always hash — but NO hash that
 * ignores checkboxes, because that rule is over text; the absence is itself a
 * difference (F104-FR-022).
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  contentHash,
  taskListHashIgnoringCheckboxes,
  taskListHashIgnoringCheckboxesOfBytes,
} from "@specstride/kernel/hasher";
import {
  KIND_WITH_A_CHECKBOX_INSENSITIVE_HASH,
  readSourceKind,
  type FormatName,
  type SourceKind,
  type SpecSource,
} from "./model.ts";
import { operatingSystemMessage } from "./errors.ts";

/** The requirement this module carries out. */
export const REQUIREMENTS = ["F104-FR-023"] as const;

/** The rows of the behaviour inventory of R18 behind the source record. */
export const BEHAVIOUR_ROWS = Object.freeze([
  // Each source record carries `path` (repo-relative), `kind`, `sha256` and
  // for kind `tasks` a `semantic_sha256`.
  "B-2485",
]);

/** Every hash of a source comes from the hasher of the kernel (F104-FR-021). */
export const HASH_OWNER = "@specstride/kernel" as const;

/** This module computes no hash of its own (F104-FR-021, F104-FR-023). */
export const HASHES_OF_ITS_OWN = 0 as const;

/* ------------------------------------------------------------------ *
 * Which files are the sources of a format (F104-FR-023; CQ-043).
 * ------------------------------------------------------------------ */

/** One file a format declares as a source: its logical name, kind and file name. */
export type DeclaredSource = {
  readonly name: string;
  readonly kind: SourceKind;
  /** The file name inside the directory of the spec. */
  readonly file: string;
};

/**
 * `speckit-tasks` — `spec.md`, `plan.md` and `tasks.md` of the feature
 * directory. The logical name of each is the member of row 50 the verdict of a
 * run names it by.
 */
export const SPECKIT_SOURCES: readonly DeclaredSource[] = Object.freeze([
  Object.freeze({ name: "spec", kind: "spec" as const, file: "spec.md" }),
  Object.freeze({ name: "plan", kind: "plan" as const, file: "plan.md" }),
  Object.freeze({ name: "tasks", kind: "tasks" as const, file: "tasks.md" }),
]);

/**
 * `openspec-change` — `tasks.md` is the task list, `proposal.md` is the `spec`
 * and `design.md` is the `plan` (CQ-043). The ORDER is the order of the
 * verdict: spec, plan, tasks (F104-FR-024).
 */
export const OPENSPEC_SOURCES: readonly DeclaredSource[] = Object.freeze([
  Object.freeze({ name: "spec", kind: "spec" as const, file: "proposal.md" }),
  Object.freeze({ name: "plan", kind: "plan" as const, file: "design.md" }),
  Object.freeze({ name: "tasks", kind: "tasks" as const, file: "tasks.md" }),
]);

/** `native` — the ONE file, as `spec`; it has no task list and is never ticked. */
export const NATIVE_SOURCE_NAME = "spec" as const;

/** The declared sources of a format, in the order the verdict names them. */
export const DECLARED_SOURCES: Readonly<Record<FormatName, readonly DeclaredSource[]>> =
  Object.freeze({
    native: Object.freeze([]),
    "speckit-tasks": SPECKIT_SOURCES,
    "openspec-change": OPENSPEC_SOURCES,
  });

/**
 * The order the verdict of a run names the sources in: spec, plan, tasks
 * (F104-FR-024). `inputs` writes the records in this order, so a caller that
 * holds the records holds the order too.
 */
export const ORDER_OF_THE_RUN_VERDICT = ["spec", "plan", "tasks"] as const;

/* ------------------------------------------------------------------ *
 * The path of a source, relative to the repository.
 * ------------------------------------------------------------------ */

/**
 * The repository-relative path of a file, with `/` as the separator on every
 * platform, so that a record moves between a workspace and a launch contract
 * unchanged (F104-FR-023). A path OUTSIDE the repository is kept absolute, as
 * B-2485 has it.
 */
export function repositoryPath(root: string, path: string): string {
  const absolute = isAbsolute(path) ? path : join(root, path);
  const inside = relative(root, absolute);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return absolute;
  return sep === "/" ? inside : inside.split(sep).join("/");
}

/* ------------------------------------------------------------------ *
 * The hashes of one source, taken from the hasher of the kernel.
 * ------------------------------------------------------------------ */

/** The bytes of a file, or the error that says it cannot be read. */
export type ReadResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly error: string };

/** The one read of this module. Nothing throws: a failure becomes `ok: false`. */
export function readSourceBytes(path: string): ReadResult {
  try {
    return Object.freeze({ ok: true as const, bytes: readFileSync(path) });
  } catch (cause) {
    return Object.freeze({ ok: false as const, error: operatingSystemMessage(cause) });
  }
}

/**
 * The hashes of one source, both taken from the canonical hasher
 * (F104-FR-021): the content hash of the bytes for EVERY source, and for a
 * task list also the hash that ignores checkboxes (F104-FR-022).
 *
 * `checkboxInsensitiveHash` is `undefined` where the bytes are not UTF-8,
 * which is itself a difference (F104-FR-022).
 */
export function hashesOfBytes(
  bytes: Uint8Array,
  kind: SourceKind,
): { readonly contentHash: string; readonly checkboxInsensitiveHash?: string } {
  const content = contentHash(bytes);
  if (kind !== KIND_WITH_A_CHECKBOX_INSENSITIVE_HASH) {
    return Object.freeze({ contentHash: content });
  }
  const insensitive = taskListHashIgnoringCheckboxesOfBytes(bytes);
  return Object.freeze(
    insensitive === undefined
      ? { contentHash: content }
      : { contentHash: content, checkboxInsensitiveHash: insensitive },
  );
}

/** The hashes of one source given its TEXT, for a caller that already holds it. */
export function hashesOfText(
  text: string,
  kind: SourceKind,
): { readonly contentHash: string; readonly checkboxInsensitiveHash?: string } {
  const content = contentHash(text);
  if (kind !== KIND_WITH_A_CHECKBOX_INSENSITIVE_HASH) {
    return Object.freeze({ contentHash: content });
  }
  return Object.freeze({
    contentHash: content,
    checkboxInsensitiveHash: taskListHashIgnoringCheckboxes(text),
  });
}

/**
 * The source record of one file: `kind`, `name`, `path`, `contentHash` and, for
 * `tasks`, `checkboxInsensitiveHash` (`contracts/verdict.md`). `undefined`
 * where the file does not exist or cannot be read — `inputs` lists the sources
 * THAT EXIST (F104-FR-023), and a source that was recorded and cannot be read
 * NOW is the verdict's business (F104-FR-025), not this function's.
 */
export function sourceRecordOf(input: {
  readonly root: string;
  readonly path: string;
  readonly name: string;
  readonly kind: string;
}): SpecSource | undefined {
  const kind = readSourceKind(input.kind);
  const absolute = isAbsolute(input.path) ? input.path : join(input.root, input.path);
  const read = readSourceBytes(absolute);
  if (!read.ok) return undefined;
  return Object.freeze({
    kind,
    name: input.name,
    path: repositoryPath(input.root, absolute),
    ...hashesOfBytes(read.bytes, kind),
  });
}

/* ------------------------------------------------------------------ *
 * `inputs` (F104-FR-023).
 * ------------------------------------------------------------------ */

/** What `inputs` is given. */
export type InputsRequest = {
  /** The root of the repository; every recorded path is relative to it. */
  readonly root: string;
  /** The format, detected ONCE and handed on (F104-FR-007, D-8). */
  readonly format: FormatName;
  /**
   * The resolved spec file, as the resolver gave it (F104-FR-001). For
   * `speckit-tasks` and `openspec-change` its DIRECTORY holds the sources; for
   * `native` it is the one source.
   */
  readonly specPath: string;
};

/** The directory the sources of a task format live in: that of the spec file. */
export function directoryOfTheSources(specPath: string): string {
  const path = specPath.split(sep).join("/");
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "." : path.slice(0, cut);
}

/**
 * F104-FR-023 — `inputs`: the sources of a declared kind with their logical
 * name, repository-relative path and hashes, in the order spec, plan, tasks.
 *
 * Only the files THAT EXIST are listed, and only a listed source can ever be
 * stale (`data-model.md`, the row Source). Every hash comes from the hasher of
 * the kernel.
 */
export function inputs(request: InputsRequest): readonly SpecSource[] {
  if (request.format === "native") {
    const one = sourceRecordOf({
      root: request.root,
      path: request.specPath,
      name: NATIVE_SOURCE_NAME,
      kind: "spec",
    });
    return Object.freeze(one === undefined ? [] : [one]);
  }
  const directory = directoryOfTheSources(request.specPath);
  const records: SpecSource[] = [];
  for (const declared of DECLARED_SOURCES[request.format]) {
    const record = sourceRecordOf({
      root: request.root,
      path: `${directory}/${declared.file}`,
      name: declared.name,
      kind: declared.kind,
    });
    if (record !== undefined) records.push(record);
  }
  return Object.freeze(records);
}

/** The record of a logical name, where `inputs` listed one. */
export function recordOfName(sources: readonly SpecSource[], name: string): SpecSource | undefined {
  return sources.find((source) => source.name === name);
}

/* ------------------------------------------------------------------ *
 * What a run snapshot and a launch contract take from `inputs` (I2).
 * ------------------------------------------------------------------ */

/**
 * The run snapshot takes its source hashes FROM `inputs` (F104-FR-023, annex B
 * §B.12): the records as they are, in their order.
 */
export function sourcesOfTheRunSnapshot(sources: readonly SpecSource[]): readonly SpecSource[] {
  return sources;
}

/**
 * The three sources a launch contract takes from `inputs` (F104-FR-023, I2),
 * in the order of the verdict. A name `inputs` did not list is left out.
 */
export function sourcesOfTheLaunchContractFromInputs(
  sources: readonly SpecSource[],
): readonly SpecSource[] {
  return Object.freeze(
    ORDER_OF_THE_RUN_VERDICT.map((name) => recordOfName(sources, name)).filter(
      (source): source is SpecSource => source !== undefined,
    ),
  );
}

/**
 * Every OTHER source a launch contract records (the kinds of annex X §X.6 row
 * 256, owner 107: the constitution, research, the data model, quickstart, the
 * verification-commands document, contracts and checklists) is hashed with the
 * CONTENT HASH of the canonical hasher and with no hash of its own
 * (F104-FR-023, I2). Its kind is read through row 97's rule, so a kind this
 * feature does not know becomes `other`.
 */
export function otherSourceOfTheLaunchContract(input: {
  readonly root: string;
  readonly path: string;
  readonly name: string;
  readonly kind?: string | undefined;
}): SpecSource | undefined {
  return sourceRecordOf({
    root: input.root,
    path: input.path,
    name: input.name,
    kind: input.kind ?? "other",
  });
}
