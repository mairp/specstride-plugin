/**
 * T016 — the inventory of sources (F107-FR-001; 011 FR-001; C-213).
 *
 * For each feature in scope: the seven Spec Kit artifacts (`spec`, `plan`,
 * `tasks`, `research`, `data-model`, `quickstart` and the
 * verification-commands document, when present); every file that is not a
 * symbolic link under `contracts/` (kind `contract`) and `checklists/` (kind
 * `checklist`); and, once for the repository, the constitution (kind
 * `constitution`). The kind of an artifact is its base name without its
 * extension. Sources are sorted by absolute path.
 *
 * Each record holds its path (relative to the repository root), its kind, its
 * content hash and its line count. A `tasks` source also holds the hash that
 * ignores checkboxes. Every hash comes from the canonical hasher THROUGH the
 * sources of the canonical spec model (F104-FR-023): the spec, the plan and
 * the task list take theirs from `inputs`; every other source takes the
 * content hash. This module computes no hash of its own and holds no hasher.
 *
 * The member names are the baseline's (`sha256`, `semantic_sha256`, `lines`),
 * because the oracle compares the draft on FX-32 (data-model.md, "Member
 * names").
 */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

import {
  registry as specFormatRegistry,
  sources as specFormatSources,
} from "@specstride/spec-formats";

import { hashContent } from "../kernel.ts";

/** One source of the launch contract, with the member names of the baseline. */
export type SourceRecord = {
  readonly path: string;
  readonly kind: string;
  readonly sha256: string;
  readonly lines: number;
  readonly semantic_sha256?: string;
};

/** The seven Spec Kit artifacts of a feature, in the order of the record. */
export const ARTIFACTS = Object.freeze([
  "spec.md",
  "plan.md",
  "tasks.md",
  "research.md",
  "data-model.md",
  "quickstart.md",
  "verification-commands.json",
] as const);

/** The kind of the constitution, recorded once for the repository. */
export const CONSTITUTION_KIND = "constitution" as const;

/** The place the constitution lives in a Spec Kit repository. */
export const CONSTITUTION_PATH = ".specify/memory/constitution.md" as const;

/** The base name without its extension: the kind of an artifact (F107-FR-001). */
export function kindOfArtifact(fileName: string): string {
  const cut = fileName.lastIndexOf(".");
  return cut <= 0 ? fileName : fileName.slice(0, cut);
}

/** The repository-relative form of a path (absolute when outside the root). */
export function pathOf(root: string, absolute: string): string {
  const rel = relative(root, absolute).split(sep).join("/");
  return rel === "" ? "." : rel;
}

/** True when the bytes are text: free of NUL bytes. */
export function isText(bytes: Uint8Array): boolean {
  for (const byte of bytes) if (byte === 0) return false;
  return true;
}

/**
 * The line count: the file read as UTF-8 text, a last line without a line end
 * counted, 0 when the file is not text (F107-FR-001).
 */
export function lineCount(text: string): number {
  const parts = text.split("\n");
  return parts[parts.length - 1] === "" ? parts.length - 1 : parts.length;
}

function readText(absolute: string): string | undefined {
  try {
    return readFileSync(absolute, "utf8");
  } catch {
    return undefined;
  }
}

/** True when the path exists, is a regular file and is not a symbolic link. */
export function isARegularFile(absolute: string): boolean {
  try {
    return lstatSync(absolute).isFile();
  } catch {
    return false;
  }
}

/** The regular files directly under a directory, names sorted; none on error. */
function filesOfDirectory(directory: string): readonly string[] {
  let names: readonly string[];
  try {
    names = readdirSync(directory).sort();
  } catch {
    return [];
  }
  return names.filter((name) => isARegularFile(join(directory, name)));
}

/** The hash record of one file from its text, with the baseline member names. */
function recordFromText(input: {
  readonly root: string;
  readonly absolute: string;
  readonly kind: string;
  readonly text: string;
  readonly checkboxInsensitiveHash?: string | undefined;
}): SourceRecord {
  const record: {
    path: string;
    kind: string;
    sha256: string;
    lines: number;
    semantic_sha256?: string;
  } = {
    path: pathOf(input.root, input.absolute),
    kind: input.kind,
    sha256: hashContent(input.text),
    lines: lineCount(input.text),
  };
  if (input.checkboxInsensitiveHash !== undefined) {
    record.semantic_sha256 = input.checkboxInsensitiveHash;
  }
  return record;
}

/** One collected source before the sort: the absolute path travels with it. */
type Collected = { readonly absolute: string; readonly record: SourceRecord };

/**
 * The source records of the whole inventory (F107-FR-001). The spec, the plan
 * and the task list take their hashes from `inputs` of the canonical spec
 * model, so that they equal the baseline's on the same input; every other
 * source takes the content hash. Sorted by absolute path.
 */
export function inventorySources(input: {
  readonly root: string;
  readonly featureDirs: readonly string[];
  readonly specFormat?: string | undefined;
}): readonly SourceRecord[] {
  const { root } = input;
  const collected: Collected[] = [];

  const addText = (absolute: string, kind: string): void => {
    const text = readText(absolute);
    if (text === undefined) return;
    collected.push({ absolute, record: recordFromText({ root, absolute, kind, text }) });
  };

  for (const featureDir of input.featureDirs) {
    // The three sources of `inputs`, hashes and all (F104-FR-023). The format
    // is detected ONCE and handed on (F104-FR-007, D-8): the task list is the
    // file whose base name carries the built-in path rule of `speckit-tasks`,
    // and `inputs` reads the sources of the directory that path names.
    const specPath = join(featureDir, "spec.md");
    const tasksPath = join(featureDir, "tasks.md");
    const detectPath = isARegularFile(tasksPath) ? tasksPath : specPath;
    if (isARegularFile(specPath) || isARegularFile(tasksPath)) {
      const format = specFormatRegistry.detectFormat(
        detectPath,
        readText(detectPath) ?? "",
        input.specFormat,
      ) as Parameters<typeof specFormatSources.inputs>["0"]["format"];
      for (const source of specFormatSources.inputs({ root, format, specPath })) {
        const absolute = isAbsolute(source.path) ? source.path : join(root, source.path);
        collected.push({
          absolute,
          record: {
            path: source.path,
            kind: source.kind,
            sha256: source.contentHash,
            lines: lineCount(readText(absolute) ?? ""),
            ...(source.checkboxInsensitiveHash !== undefined
              ? { semantic_sha256: source.checkboxInsensitiveHash }
              : {}),
          },
        });
      }
    }
    // The further artifacts, on the content hash.
    for (const artifact of [
      "research.md",
      "data-model.md",
      "quickstart.md",
      "verification-commands.json",
    ]) {
      const absolute = join(featureDir, artifact);
      if (isARegularFile(absolute)) addText(absolute, kindOfArtifact(artifact));
    }
    // contracts/ and checklists/: every file that is not a symbolic link.
    for (const [directory, kind] of [
      ["contracts", "contract"],
      ["checklists", "checklist"],
    ] as const) {
      for (const name of filesOfDirectory(join(featureDir, directory))) {
        addText(join(featureDir, directory, name), kind);
      }
    }
  }

  // The constitution, once for the repository.
  const constitution = join(root, CONSTITUTION_PATH);
  if (isARegularFile(constitution)) addText(constitution, CONSTITUTION_KIND);

  collected.sort((a, b) => (a.absolute < b.absolute ? -1 : a.absolute > b.absolute ? 1 : 0));
  return collected.map((one) => one.record);
}
