/**
 * T130 — THE BUILD ARTIFACTS RECORD (F105-FR-036, item B-1125).
 *
 * After a build command has PASSED, every export the workspace declares is
 * recorded with `exists`, `sizeBytes`, `mtimeEpoch` and `fresh`. `fresh` is
 * the machine-checked half: the file exists AND was written at or after the
 * build started, which is proof THIS build produced it and not a stale
 * leftover of an earlier one.
 *
 * THIS RECORD NEVER FAILS THE VERIFICATION GATE (F105-FR-036). It is a fact
 * the gate carries beside its verdict, independent of the critic's textual
 * grounding; a build that exits 0 and emits nothing is caught by whoever reads
 * the record, never by a verdict this module changes.
 * `FAILS_THE_VERIFICATION_GATE` is that sentence as a value.
 *
 * `lib/verification_plan.py` `_run_commands` (:1612, the `kind == "build"`
 * branch) and `_workspace_export_artifacts` (:571) are the baseline.
 */

/** One entry of `buildArtifacts` of a result record (F105-FR-036). */
export type BuildArtifactRecord = {
  readonly commandId: string;
  /** The place of the export, relative to the working directory. */
  readonly path: string;
  readonly absPath: string;
  readonly exists: boolean;
  readonly sizeBytes: number | null;
  readonly mtimeEpoch: number | null;
  readonly fresh: boolean;
};

/** The four fields F105-FR-036 names, in its order. */
export const BUILD_ARTIFACT_FIELDS = ["exists", "sizeBytes", "mtimeEpoch", "fresh"] as const;
export type BuildArtifactField = (typeof BUILD_ARTIFACT_FIELDS)[number];

/** Every field of one entry, the baseline's included (`:1643`). */
export const BUILD_ARTIFACT_RECORD_FIELDS = [
  "commandId",
  "path",
  "absPath",
  ...BUILD_ARTIFACT_FIELDS,
] as const;

/** When the record is taken: after a build command has PASSED (F105-FR-036). */
export const RECORDED_AFTER = "a build command has passed" as const;

/** The kind of command whose pass takes the record (`:1636`). */
export const BUILD_KIND = "build" as const;

/** F105-FR-036 — this record MUST NOT fail the verification gate. */
export const FAILS_THE_VERIFICATION_GATE = false as const;

/** F105-FR-036 — nor does it halt the run. */
export const HALTS_THE_RUN = false as const;

/**
 * The seconds of slack `fresh` allows: a file written in the same second the
 * build started counts as this build's (`:1652`, `mtime >= wall_start - 1`).
 */
export const FRESH_TOLERANCE_SECONDS = 1 as const;

/** What one reading of a declared export gave; the port's answer. */
export type ArtifactReading = {
  readonly exists: boolean;
  readonly sizeBytes: number | null;
  /** Seconds since the epoch, as the baseline's `st_mtime`. */
  readonly mtimeEpoch: number | null;
};

/** The injected reading of one place. A failed reading is `exists: false`. */
export type ArtifactStat = (absolutePath: string) => ArtifactReading;

/** The reading of a place that is not there (`:1641`, the `OSError` branch). */
export const MISSING_READING: ArtifactReading = Object.freeze({
  exists: false,
  sizeBytes: null,
  mtimeEpoch: null,
});

/** `fresh` of one reading against the instant the build started (`:1652`). */
export function isFresh(reading: ArtifactReading, buildStartedAtEpoch: number): boolean {
  return (
    reading.exists &&
    reading.mtimeEpoch !== null &&
    reading.mtimeEpoch >= buildStartedAtEpoch - FRESH_TOLERANCE_SECONDS
  );
}

/** One place of the working directory, joined as the baseline joins it. */
export function absolutePathOf(workdir: string, relative: string): string {
  if (relative.startsWith("/")) return relative;
  const base = workdir.replace(/\/+$/, "");
  return `${base}/${relative}`;
}

/**
 * THE BUILD ARTIFACTS RECORD of ONE command (F105-FR-036). It is taken only
 * where the command is of the kind `build`, its exit code is 0 and the
 * workspace declared an export; in every other case the list is EMPTY, which
 * is the baseline's behaviour and not a silent omission.
 */
export function buildArtifactsOf(input: {
  readonly command: { readonly id: string; readonly kind?: string | undefined };
  readonly exitCode: number | null;
  readonly declaredArtifacts: readonly string[];
  readonly workdir: string;
  readonly stat: ArtifactStat;
  /** Whole seconds since the epoch, taken BEFORE the command started. */
  readonly buildStartedAtEpoch: number;
}): readonly BuildArtifactRecord[] {
  if (input.command.kind !== BUILD_KIND) return Object.freeze([]);
  if (input.exitCode !== 0) return Object.freeze([]);
  if (input.declaredArtifacts.length === 0) return Object.freeze([]);
  return Object.freeze(
    input.declaredArtifacts.map((relative) => {
      const absPath = absolutePathOf(input.workdir, relative);
      let reading: ArtifactReading;
      try {
        reading = input.stat(absPath);
      } catch {
        reading = MISSING_READING;
      }
      return Object.freeze({
        commandId: input.command.id,
        path: relative,
        absPath,
        exists: reading.exists,
        sizeBytes: reading.exists ? reading.sizeBytes : null,
        mtimeEpoch: reading.exists ? reading.mtimeEpoch : null,
        fresh: isFresh(reading, input.buildStartedAtEpoch),
      });
    }),
  );
}

/* ------------------------------------------------------------------ *
 * The exports the workspace DECLARES (F105-FR-036).
 * ------------------------------------------------------------------ */

/** The file that makes a project a workspace, as the baseline reads it (`:577`). */
export const WORKSPACE_FILE = "pnpm-workspace.yaml" as const;

/** The manifest of a member of the workspace. */
export const MEMBER_MANIFEST = "package.json" as const;

/** The keys of a manifest whose string value is a declared export (`:650`). */
export const EXPORT_KEYS = ["main", "module", "types", "typings"] as const;

/** The injected reader of the workspace; this module reads no place itself. */
export type WorkspacePort = {
  /** The text of a file, or `undefined` where it cannot be read. */
  readText(path: string): string | undefined;
  /** The entries of a directory, sorted, or `undefined` where there is none. */
  listDirectory(path: string): readonly string[] | undefined;
  isDirectory(path: string): boolean;
  isFile(path: string): boolean;
};

/**
 * The `packages:` globs of `pnpm-workspace.yaml`, in both the inline form and
 * the block form the baseline accepts (`:586` to `:607`).
 */
export function workspaceGlobs(text: string): readonly string[] {
  const globs: string[] = [];
  let inBlock = false;
  for (const raw of text.split("\n")) {
    const stripped = raw.trim();
    if (stripped === "" || stripped.startsWith("#")) continue;
    const packages = /^packages\s*:\s*(.*)$/.exec(stripped);
    if (packages !== null) {
      const inline = (packages[1] ?? "").trim();
      if (inline.startsWith("[")) {
        for (const found of inline.matchAll(/['"]([^'"]+)['"]/g)) globs.push(found[1] as string);
        inBlock = false;
      } else {
        inBlock = true;
      }
      continue;
    }
    if (inBlock) {
      const item = /^-\s*(.+)$/.exec(stripped);
      if (item !== null) {
        globs.push((item[1] as string).trim().replace(/^['"]|['"]$/g, ""));
      } else if (/^\w[\w-]*\s*:/.test(stripped)) {
        inBlock = false;
      }
    }
  }
  return Object.freeze(globs);
}

/** Every string a `exports` value holds, however deeply it nests (`:636`). */
export function exportTargets(value: unknown, into: string[] = []): readonly string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const one of value) exportTargets(one, into);
  else if (value !== null && typeof value === "object") {
    for (const one of Object.values(value as Record<string, unknown>)) exportTargets(one, into);
  }
  return into;
}

/** A target without its leading `./` (the baseline's `_strip_dot_slash`). */
export function stripDotSlash(value: string): string {
  return value.startsWith("./") ? value.slice(2) : value;
}

/**
 * EVERY EXPORT THE WORKSPACE DECLARES (F105-FR-036), as places relative to the
 * working directory, sorted. A project that is no workspace declares none, and
 * the list is then empty — the record is then empty too, which is what
 * F105-FR-036 means for a project with nothing declared.
 */
export function workspaceExportArtifacts(input: {
  readonly workdir: string;
  readonly port: WorkspacePort;
}): readonly string[] {
  const { workdir, port } = input;
  const workspaceFile = absolutePathOf(workdir, WORKSPACE_FILE);
  if (!port.isFile(workspaceFile)) return Object.freeze([]);
  const text = port.readText(workspaceFile);
  if (text === undefined) return Object.freeze([]);
  const members: string[] = [];
  for (const glob of workspaceGlobs(text)) {
    const cleaned = glob.trim().replace(/^\/+|\/+$/g, "");
    if (cleaned === "" || cleaned.startsWith("!")) continue;
    const parts = cleaned.split("/");
    const last = parts[parts.length - 1];
    let candidates: readonly string[];
    if (last === "*" || last === "**") {
      const baseRelative = parts.slice(0, -1).join("/");
      const baseAbsolute = baseRelative === "" ? workdir : absolutePathOf(workdir, baseRelative);
      const entries = port.listDirectory(baseAbsolute) ?? [];
      candidates = entries.map((entry) =>
        baseRelative === "" ? entry : `${baseRelative}/${entry}`,
      );
    } else {
      candidates = [cleaned];
    }
    for (const relative of candidates) {
      const directory = absolutePathOf(workdir, relative);
      if (port.isDirectory(directory) && port.isFile(`${directory}/${MEMBER_MANIFEST}`)) {
        members.push(relative);
      }
    }
  }
  const artifacts: string[] = [];
  const seen = new Set<string>();
  for (const relative of members) {
    const text = port.readText(`${absolutePathOf(workdir, relative)}/${MEMBER_MANIFEST}`);
    if (text === undefined) continue;
    let manifest: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      manifest = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const targets = [...exportTargets(manifest["exports"])];
    for (const key of EXPORT_KEYS) {
      const value = manifest[key];
      if (typeof value === "string") targets.push(value);
    }
    for (const target of targets) {
      const cleaned = stripDotSlash(target);
      if (cleaned === "" || cleaned.includes("*")) continue;
      const place = `${relative}/${cleaned}`;
      if (!seen.has(place)) {
        seen.add(place);
        artifacts.push(place);
      }
    }
  }
  return Object.freeze(artifacts.sort());
}
