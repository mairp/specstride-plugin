/**
 * T073 — the layout version file `workspace:layout-version`
 * (F122-FR-043; feature 100, annex B §B.5 for the logical name, §B.4 with
 * F100-FR-049 for the refusal of another major, §G.7 for the doctor check).
 *
 * F122-FR-043, in full: at the first launch in a workspace the writer of the
 * workspace record — the runtime root, or the engine in start mode
 * `standalone` — MUST write the layout version file into the workspace part,
 * AFTER it took the lock and BEFORE it writes the advisory marker. The file
 * MUST hold the layout version that the same process writes into the field
 * `layoutVersion` of the workspace record, MUST be written to a temporary
 * name and renamed, and MUST have no other writer. At every later launch the
 * same process MUST read it: a file that is missing MUST be written again; a
 * file whose major differs from the major of the layout table of the product
 * MUST refuse the launch as annex B §B.4 states for a record of a different
 * major (F100-FR-049), with the logical name, the major found and the major
 * supported, and with a doctor finding. A workspace part that holds no
 * layout version file MUST count as not written by the product: nothing in
 * it MUST be read as state (F100-FR-041).
 *
 * WHY THE ORDER IS THE REQUIREMENT. The file is written after the lock, so a
 * launch that lost the lock writes nothing into a workspace a live run owns;
 * and before the marker, so a reader that finds a marker always finds a
 * workspace the product has already claimed. `startTheRoot` of
 * `./start.ts` performs the three writes in exactly that order, and the
 * characterization test CT-122-43 pins the order on the disk.
 *
 * WHY THE REFUSAL IS NOT A MEMBER OF CLOSED SET 212. The set is closed and
 * its rule for an unknown value is `shown as text; the launch stays refused`
 * (contracts/closed-sets.json, row 212). `layout-version-major` is such an
 * unknown value: the launch record carries it as text, `launch` exits 4, and
 * the closed set is not silently widened by a writer of this feature.
 */
import { existsSync, readFileSync } from "node:fs";
import { atomicWrite, isTemporaryName } from "@specstride/kernel";
import { layoutVersion as theSupportedLayoutVersion } from "@specstride/contracts/ids/logical-names";
import { layoutVersionName } from "@specstride/contracts/ids/layout-rules";
import type { WorkspaceRecord } from "@specstride/contracts/records/workspace-record";
import { lockPathsOf, type LockPlace } from "../lock/paths.ts";

export type { LockPlace };

/** The requirement this module carries. */
export const LAYOUT_VERSION_REQUIREMENT = "F122-FR-043" as const;

/** The logical name of the file (annex B, §B.5; F100-FR-041). */
export const LAYOUT_VERSION_LOGICAL_NAME = "workspace:layout-version" as const;

/** Feature 100 names the same thing; the two must agree. */
export const LAYOUT_VERSION_LOGICAL_NAME_OF_FEATURE_100: string = layoutVersionName;

/** The refusal of a file whose major the product does not support. */
export const LAYOUT_VERSION_MAJOR_REFUSAL = "layout-version-major" as const;

/** The exit code of a launch refused for another major (`cli-state-commands.md`). */
export const LAYOUT_VERSION_REFUSAL_EXIT = 4 as const;

/** The doctor check this module is read by (`./doctor/layout-checks.ts`). */
export const LAYOUT_VERSION_CHECK_ID = "runtime.layout-version.file" as const;

/** The mode of the file. The workspace part is not the control plane. */
export const LAYOUT_VERSION_FILE_MODE = 0o600 as const;

/** F122-FR-043 — the file has exactly one writer: the process that holds the lock. */
export const WRITERS_OF_THE_FILE = ["runtime-root", "engine-standalone"] as const;

/** F122-FR-043 — the write is a temporary name and a rename, never an in-place write. */
export const THE_WRITE_IS_IN_PLACE = false as const;

/** The layout version of the layout table this product ships. */
export function supportedLayoutVersion(): string {
  return theSupportedLayoutVersion;
}

/** The major of the layout table this product supports. */
export function supportedMajor(): number {
  return majorOf(theSupportedLayoutVersion);
}

/** The major of a layout version written as `major.minor`. */
export function majorOf(version: string): number {
  const major = Number(version.split(".", 1)[0]);
  return Number.isInteger(major) ? major : Number.NaN;
}

/** The minor of a layout version written as `major.minor`. */
export function minorOf(version: string): number {
  const parts = version.split(".");
  const minor = Number(parts[1] ?? Number.NaN);
  return Number.isInteger(minor) ? minor : Number.NaN;
}

/** The path of the file, resolved from the layout table and never a literal. */
export function layoutVersionPathOf(place: LockPlace): string {
  return lockPathsOf(place).layoutVersionFile;
}

/* ------------------------------------------------------------------ *
 * Reading.
 * ------------------------------------------------------------------ */

/** What a reading of the file answers. */
export type LayoutVersionReading =
  | {
      /** No file: the workspace part counts as not written by the product. */
      readonly present: false;
      readonly path: string;
      /** A file that is not there is neither readable nor unreadable. */
      readonly readable?: undefined;
      /** F100-FR-041 — nothing in such a workspace part is read as state. */
      readonly theWorkspacePartIsNotReadAsState: true;
    }
  | {
      readonly present: true;
      readonly path: string;
      readonly readable: false;
      /** Why the file could not be read as `major.minor`. */
      readonly detail: string;
    }
  | {
      readonly present: true;
      readonly path: string;
      readonly readable: true;
      readonly major: number;
      readonly minor: number;
      /** The text as it lies on the disk, trimmed of the final line end. */
      readonly text: string;
    };

/**
 * Read `workspace:layout-version`. A missing file is not an error and not
 * state: it answers `present: false` and the workspace part counts as not
 * written by the product (F100-FR-041).
 */
export function readLayoutVersion(place: LockPlace): LayoutVersionReading {
  const path = layoutVersionPathOf(place);
  if (!existsSync(path)) {
    return Object.freeze({
      present: false as const,
      path,
      theWorkspacePartIsNotReadAsState: true as const,
    });
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return Object.freeze({
      present: true as const,
      path,
      readable: false as const,
      detail: `\`${LAYOUT_VERSION_LOGICAL_NAME}\` cannot be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
  const trimmed = text.trim();
  const match = /^(\d+)\.(\d+)$/.exec(trimmed);
  if (match === null) {
    return Object.freeze({
      present: true as const,
      path,
      readable: false as const,
      detail:
        `\`${LAYOUT_VERSION_LOGICAL_NAME}\` holds \`${trimmed.slice(0, 64)}\`, which is not ` +
        `a layout version of the form \`major.minor\``,
    });
  }
  return Object.freeze({
    present: true as const,
    path,
    readable: true as const,
    major: Number(match[1]),
    minor: Number(match[2]),
    text: trimmed,
  });
}

/* ------------------------------------------------------------------ *
 * Writing.
 * ------------------------------------------------------------------ */

/** What a write of the file answers. */
export type LayoutVersionWrite = {
  readonly path: string;
  /** The text that was written: the version of the workspace record. */
  readonly text: string;
  /** True where this call wrote the file; false where it was already there. */
  readonly written: boolean;
  /** F122-FR-043 — the write went through a temporary name and a rename. */
  readonly byATemporaryNameAndARename: true;
};

/**
 * F122-FR-043 — write the file at the FIRST launch, with the layout version
 * the same process writes into `layoutVersion` of the workspace record. A
 * file that is already there is left alone: the file has no other writer, so
 * the first writer wins and every later launch only reads.
 *
 * The write is `atomicWrite` of the kernel (F100-FR-036): a temporary name in
 * the same directory, fsync, rename into place.
 */
export function writeLayoutVersion(place: LockPlace, version: string): LayoutVersionWrite {
  const path = layoutVersionPathOf(place);
  if (existsSync(path)) {
    const reading = readLayoutVersion(place);
    const text = reading.present && reading.readable ? reading.text : version;
    return Object.freeze({
      path,
      text,
      written: false,
      byATemporaryNameAndARename: true,
    });
  }
  const text = `${version}\n`;
  atomicWrite(path, text, { mode: LAYOUT_VERSION_FILE_MODE, createDirectory: true });
  return Object.freeze({
    path,
    text: text.trim(),
    written: true,
    byATemporaryNameAndARename: true,
  });
}

/**
 * The layout version the process writes: the one of the workspace record it
 * just wrote or read, which is always the layout version of the layout table
 * this product ships (`recordTheProvider` of `../lock/workspace-record.ts`
 * writes no other). A workspace record that could not be read falls back to
 * the table's version, so the file and the record can never disagree by
 * construction.
 */
export function layoutVersionOfTheWorkspaceRecord(record: WorkspaceRecord | null): string {
  return record === null ? theSupportedLayoutVersion : String(record.layoutVersion);
}

/* ------------------------------------------------------------------ *
 * The check at a launch.
 * ------------------------------------------------------------------ */

/** What the check at a launch answers. */
export type LayoutVersionCheck =
  | {
      /** Nothing to refuse: the file is there with the supported major, or missing. */
      readonly refuse: false;
      /** What was found, for the outcome the caller reports. */
      readonly found:
        | { readonly kind: "missing"; readonly written: LayoutVersionWrite }
        | { readonly kind: "present"; readonly major: number; readonly minor: number };
    }
  | {
      readonly refuse: true;
      readonly refusal: typeof LAYOUT_VERSION_MAJOR_REFUSAL;
      readonly exit: typeof LAYOUT_VERSION_REFUSAL_EXIT;
      /** The logical name, the major found and the major supported (F122-FR-043). */
      readonly logicalName: string;
      readonly majorFound: number | null;
      readonly majorSupported: number;
      readonly path: string;
      readonly detail: string;
    };

/**
 * F122-FR-043 — read the file at a launch and refuse another major. Called by
 * `startTheRoot` AFTER the lock is held and BEFORE the marker is written.
 *
 * The `record` is the workspace record of this workspace, as this launch
 * read or wrote it; its `layoutVersion` is what a missing file is written
 * with, so the file and the record carry one version from their first moment.
 */
export function checkLayoutVersionAtLaunch(
  place: LockPlace,
  record: WorkspaceRecord | null,
): LayoutVersionCheck {
  const reading = readLayoutVersion(place);
  if (!reading.present) {
    const written = writeLayoutVersion(place, layoutVersionOfTheWorkspaceRecord(record));
    return Object.freeze({
      refuse: false as const,
      found: { kind: "missing" as const, written },
    });
  }
  if (!reading.readable) {
    // A file that is not a layout version is not a file of ANOTHER MAJOR:
    // nothing in it names a major, so the honest refusal is the text of the
    // reading, with no major found. The launch is refused all the same: the
    // product cannot claim a workspace whose version it cannot read.
    return Object.freeze({
      refuse: true as const,
      refusal: LAYOUT_VERSION_MAJOR_REFUSAL,
      exit: LAYOUT_VERSION_REFUSAL_EXIT,
      logicalName: LAYOUT_VERSION_LOGICAL_NAME,
      majorFound: null,
      majorSupported: supportedMajor(),
      path: reading.path,
      detail: reading.detail,
    });
  }
  if (reading.major !== supportedMajor()) {
    return Object.freeze({
      refuse: true as const,
      refusal: LAYOUT_VERSION_MAJOR_REFUSAL,
      exit: LAYOUT_VERSION_REFUSAL_EXIT,
      logicalName: LAYOUT_VERSION_LOGICAL_NAME,
      majorFound: reading.major,
      majorSupported: supportedMajor(),
      path: reading.path,
      detail:
        `\`${LAYOUT_VERSION_LOGICAL_NAME}\` holds the major ${reading.major} and this product ` +
        `supports the major ${supportedMajor()} (layout ${theSupportedLayoutVersion}); the ` +
        `launch is refused as annex B §B.4 states for a record of a different major ` +
        `(F100-FR-049, F122-FR-043)`,
    });
  }
  return Object.freeze({
    refuse: false as const,
    found: { kind: "present" as const, major: reading.major, minor: reading.minor },
  });
}

/**
 * The detail a doctor finding carries: the version found and the one
 * supported, with the logical name. The doctor check of
 * `../doctor/layout-checks.ts` and the refusal of the launch read the SAME
 * answer, so they cannot disagree.
 */
export function layoutVersionFindingDetail(reading: LayoutVersionReading): string {
  if (!reading.present) {
    return (
      `\`${LAYOUT_VERSION_LOGICAL_NAME}\` is missing at \`${reading.path}\`; the workspace part ` +
      `counts as not written by the product (F100-FR-041) and the first launch writes it`
    );
  }
  if (!reading.readable) return reading.detail;
  return (
    `\`${LAYOUT_VERSION_LOGICAL_NAME}\` holds \`${reading.text}\` and this product supports ` +
    `\`${theSupportedLayoutVersion}\` (F122-FR-043)`
  );
}

/**
 * True for a name the atomic write produced as its temporary name; exposed so
 * the characterization test can prove the rename on the disk without
 * re-deriving the shape of the name.
 */
export function isATemporaryNameOfTheWrite(name: string): boolean {
  return isTemporaryName(name);
}
