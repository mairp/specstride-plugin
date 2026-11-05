/**
 * T030 — the throwaway home that selects a model (F130-FR-014, F130-FR-015).
 *
 * With a model override the adapter builds a throwaway home for the pass in
 * the temporary directory (name prefix `specstride-dsh-home.`; the logical
 * name `overlay:dsh:tree`): every entry of the real home EXCEPT the settings
 * file is linked into it, including entries whose names begin with a dot; the
 * settings file is written NEW — first the block that selects the model
 * (`agent-default-model`: provider, model and, when set, the reasoning
 * effort), then the real settings file with its own block of that name
 * removed. The home is exported to the process in place of the real one and
 * REMOVED after the pass, also when the pass was killed (an exit hook covers
 * the arms a `finally` cannot reach). A failure to build it fails the pass
 * with the ONE line `could not build DSH_HOME overlay for <provider/model>`
 * on standard error, returns 1, and leaves NOTHING behind. The throwaway
 * home holds links and one new file only: the real home is never written
 * (F130-FR-015, ruling 36).
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  mkdtempSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelReference } from "../model/index.ts";

/** The name prefix of the throwaway home (the argument table's `overlay`). */
export const OVERLAY_PREFIX = "specstride-dsh-home." as const;

/** The settings file of the harness home. */
export const OVERLAY_SETTINGS_FILE = "settings.yaml" as const;

/** The block of the settings file that selects the model. */
export const OVERLAY_MODEL_BLOCK = "agent-default-model" as const;

/** The logical name the home is recorded under. */
export const OVERLAY_LOGICAL_NAME = "overlay:dsh:tree" as const;

/** The failure of an overlay that could not be built: the ONE as-is line. */
export class OverlayBuildError extends Error {
  /** The result the pass returns when the overlay cannot be built. */
  readonly result: 1;

  constructor(reference: ModelReference) {
    super(overlayFailureLine(reference));
    this.name = "OverlayBuildError";
    this.result = 1;
  }
}

/** The one stderr line of a failed overlay build (F130-FR-014, `pass-loop`). */
export function overlayFailureLine(reference: ModelReference): string {
  return (
    `pass-loop: could not build DSH_HOME overlay for ` + `${reference.provider}/${reference.model}`
  );
}

/** The model-selection block, first in the new settings file. */
export function overlayModelBlock(reference: ModelReference, effort?: string | null): string {
  const lines = [
    `${OVERLAY_MODEL_BLOCK}:`,
    `  provider: ${reference.provider}`,
    `  model: ${reference.model}`,
  ];
  if (effort !== null && effort !== undefined && effort !== "") {
    lines.push(`  reasoningEffort: ${effort}`);
  }
  return lines.join("\n");
}

/**
 * The real settings content with ITS OWN model block removed: the block from
 * its top-level key to the next top-level key (a line with no indentation)
 * or the end of the file.
 */
export function removeRealModelBlock(realSettings: string): string {
  const lines = realSettings.split("\n");
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.startsWith(`${OVERLAY_MODEL_BLOCK}:`)) {
      skipping = true;
      continue;
    }
    if (skipping && line !== "" && !line.startsWith(" ") && !line.startsWith("\t")) {
      skipping = false;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join("\n");
}

/** The new settings file: the model block FIRST, then the real file, block removed. */
export function overlaySettingsContent(
  reference: ModelReference,
  realSettings: string | null,
  effort?: string | null,
): string {
  const head = overlayModelBlock(reference, effort);
  const tail = realSettings === null ? "" : removeRealModelBlock(realSettings);
  return tail.trim() === "" ? `${head}\n` : `${head}\n\n${tail.replace(/^\n+/, "")}`;
}

/** A built throwaway home: its path, and the removal that always runs. */
export type DshOverlay = {
  readonly logicalName: typeof OVERLAY_LOGICAL_NAME;
  readonly home: string;
  /** The reference the overlay selects, as built. */
  readonly reference: ModelReference;
  /** Removes the home; idempotent; also registered as a process exit hook. */
  readonly remove: () => void;
};

/**
 * Builds the throwaway home (F130-FR-014). REALHOME may be absent: the
 * overlay is then the new settings file alone. Any failure removes what was
 * created and throws `OverlayBuildError` (the ONE line, result 1, nothing
 * left behind).
 */
export function buildOverlay(input: {
  readonly realHome: string | null;
  readonly reference: ModelReference;
  readonly effort?: string | null;
}): DshOverlay {
  const { realHome, reference } = input;
  let home: string | null = null;
  try {
    home = mkdtempSync(join(tmpdir(), OVERLAY_PREFIX));
    const realSettings =
      realHome !== null && existsSync(join(realHome, OVERLAY_SETTINGS_FILE))
        ? readFileSync(join(realHome, OVERLAY_SETTINGS_FILE), "utf8")
        : null;
    if (realHome !== null && existsSync(realHome)) {
      // Every entry except the settings file, hidden entries included
      // (readdir lists dot entries; nothing is filtered but the settings file).
      for (const entry of readdirSync(realHome)) {
        if (entry === OVERLAY_SETTINGS_FILE) continue;
        symlinkSync(join(realHome, entry), join(home, entry));
      }
    }
    writeFileSync(
      join(home, OVERLAY_SETTINGS_FILE),
      overlaySettingsContent(reference, realSettings, input.effort),
      "utf8",
    );
  } catch (error) {
    if (home !== null) rmSync(home, { recursive: true, force: true });
    if (error instanceof OverlayBuildError) throw error;
    throw new OverlayBuildError(reference);
  }
  const overlay: DshOverlay = {
    logicalName: OVERLAY_LOGICAL_NAME,
    home,
    reference,
    remove: () => {
      if (home === null) return;
      const target = home;
      home = null;
      rmSync(target, { recursive: true, force: true });
    },
  };
  // Removal also when the pass was killed: the exit hook runs on every end
  // the process observes, a watchdog kill included.
  process.once("exit", overlay.remove);
  return overlay;
}
