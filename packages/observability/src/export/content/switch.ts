/**
 * T061 — the capture switch (F128-FR-036; CT-128-17).
 *
 * F128-FR-036: *Prompt and reply content MUST be captured for export whenever
 * traces are on, and the consumer MUST be able to switch capture off with
 * `telemetry.content` in user configuration. The values of the key MUST be
 * `auto`, the default, which means captured whenever traces are on, and `off`.
 * Traces MUST stay off by default, so that a run with default configuration
 * sends nothing. `telemetry.content` MUST be a widening key: project
 * configuration cannot set it. Under the `parity` profile capture MUST be
 * off.*
 */

/** The resolved key of the capture switch (F128-FR-036). */
export const CONTENT_SWITCH_KEY = "telemetry.content" as const;

/** The values of the key: `auto` (the default) and `off` (F128-FR-036). */
export const CONTENT_VALUES = ["auto", "off"] as const;
export type ContentValue = (typeof CONTENT_VALUES)[number];

/** The trust class of the key: a widening key, project configuration cannot set it. */
export const CONTENT_IS_A_WIDENING_KEY = true as const;

/** The profile under which capture is always off. */
export const CAPTURE_OFF_UNDER_PROFILES: readonly string[] = Object.freeze(["parity"]);

/**
 * The value of the capture switch: `auto` for everything that is not `off`,
 * `off` when the consumer set it so (case-insensitive).
 */
export function contentValueOf(raw: unknown): ContentValue {
  // Fail closed: only an explicit `auto` widens; any other value (including
  // `off` in any case, garbage, and numbers) narrows capture (F128-FR-036).
  if (typeof raw === "string" && raw.trim().toLowerCase() === "auto") return "auto";
  if (raw === undefined || raw === null) return "auto"; // the default
  return "off";
}

/**
 * Whether content is captured: only when traces are on, the switch is not
 * `off`, and the profile is not `parity` (F128-FR-036). This is the whole
 * decision — capture is never on when traces are off, so a run with default
 * configuration, whose traces are off, captures nothing.
 */
export function contentCaptureOn(options: {
  readonly tracesOn: boolean;
  readonly content?: unknown;
  readonly profile?: string | null;
}): boolean {
  if (!options.tracesOn) return false;
  if (contentValueOf(options.content) === "off") return false;
  const profile = options.profile ?? null;
  if (profile !== null && CAPTURE_OFF_UNDER_PROFILES.includes(profile)) {
    return false;
  }
  return true;
}
