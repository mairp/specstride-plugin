/**
 * T006 — the mode selector of the front door (F119-FR-029; annex G §G.2).
 *
 * The front door prints in exactly the two output modes of annex G §G.2.
 * Compatibility output is selected by the key `output.compat` and is always
 * in force under the profile `parity`; default output is used otherwise.
 * Under `parity` no line without an as-is equivalent is printed, on any
 * stream — which is why the profile alone selects compatibility output.
 */

/** The two output modes (annex G §G.2). */
export type OutputMode = "compat" | "default";

/** The configuration key that selects compatibility output (F119-FR-029). */
export const OUTPUT_COMPAT_KEY = "output.compat" as const;

/** The profile that always selects compatibility output (F119-FR-029). */
export const PARITY_PROFILE = "parity" as const;

/**
 * Read the value of `output.compat` as the configuration layer hands it over:
 * a boolean, the strings `on`/`off` (as the parity table of feature 110
 * writes them), or `on (compatibility output)`, the cell of the catalogue.
 */
export function isCompatValue(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  if (typeof value === "string") {
    return value === "on" || value.startsWith("on ") || value === "true";
  }
  return false;
}

/**
 * Select the output mode of one call (F119-FR-029): compatibility output
 * when `output.compat` is on OR the profile in force is `parity`; default
 * output otherwise.
 */
export function selectMode(options: {
  compat?: unknown;
  profile?: string | undefined;
}): OutputMode {
  if (options.profile === PARITY_PROFILE) {
    return "compat";
  }
  return isCompatValue(options.compat) ? "compat" : "default";
}

/** True when the mode prints baseline lines and nothing else (§G.2). A call
 * that carries no mode is a default-output call. */
export function isCompatibilityMode(mode: OutputMode | undefined): boolean {
  return mode === "compat";
}
