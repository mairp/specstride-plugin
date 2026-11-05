/**
 * T077 — the policy of the configuration home per auth tier (F109-FR-029).
 *
 * At auth tier 1 a call uses the consumer's real configuration home, never
 * writes it, and switches off the plugins, host hooks, skills and tool
 * servers of the harness. At auth tier 2 a call uses a throwaway home built
 * from the overlay of the entry; where a declared harness declares no
 * overlay, the call runs against the consumer's configuration home, the
 * doctor says so, and the run record holds it. Credentials are never copied
 * between homes. With the overlay scope `none` every overlay operation does
 * nothing: no process is started for it, and the harness runs with the
 * environment the consumer gave.
 */

/** What the policy decides for one call. */
export type HomePolicy = {
  /** `real`, `overlay` or `consumer` (the consumer's configuration home). */
  readonly home: "real" | "overlay" | "consumer";
  /** True exactly when the real configuration home must never be written. */
  readonly neverWritesRealHome: boolean;
  /** The overlay operations are no-ops under this policy. */
  readonly overlayNoOp: boolean;
  /** The harness features switched off at tier 1 (F109-FR-029). */
  readonly switchesOff: readonly string[];
  /** The doctor line, where the doctor must say something. */
  readonly doctorLine: string | null;
  /** What the run record holds for the home of the call. */
  readonly recorded: string;
};

/** The harness features that tier 1 switches off. */
export const TIER_ONE_SWITCHES_OFF = ["plugins", "hostHooks", "skills", "toolServers"] as const;

/** The auth tiers the seam knows. */
export const AUTH_TIERS = [1, 2, 3] as const;
export type AuthTier = (typeof AUTH_TIERS)[number];

/**
 * F109-FR-029 — the home policy of one call.
 *
 * `scopeNone` marks the overlay scope `none`: every overlay operation does
 * nothing and the harness runs with the environment the consumer gave.
 */
export function homePolicy(input: {
  readonly id: string;
  readonly authTier: AuthTier;
  readonly declaresOverlay: boolean;
  readonly scopeNone?: boolean;
}): HomePolicy {
  if (input.scopeNone) {
    return {
      home: "real",
      neverWritesRealHome: input.authTier === 1,
      overlayNoOp: true,
      switchesOff: input.authTier === 1 ? TIER_ONE_SWITCHES_OFF : [],
      doctorLine: null,
      recorded: "scope none: the harness runs with the environment the consumer gave",
    };
  }
  if (input.authTier === 1) {
    return {
      home: "real",
      neverWritesRealHome: true,
      overlayNoOp: false,
      switchesOff: TIER_ONE_SWITCHES_OFF,
      doctorLine: null,
      recorded: "auth tier 1: the real configuration home, never written",
    };
  }
  if (!input.declaresOverlay) {
    // A declared harness that declares no overlay runs against the
    // consumer's configuration home; the doctor says so and the run holds it.
    return {
      home: "consumer",
      neverWritesRealHome: false,
      overlayNoOp: false,
      switchesOff: [],
      doctorLine: `specstride: doctor: backend '${input.id}' declares no overlay; the call runs against the consumer's configuration home`,
      recorded: "auth tier 2 without an overlay: the consumer's configuration home",
    };
  }
  return {
    home: "overlay",
    neverWritesRealHome: false,
    overlayNoOp: false,
    switchesOff: [],
    doctorLine: null,
    recorded: "auth tier 2: a throwaway home from the overlay of the entry",
  };
}

/** F109-FR-029 — credentials are never copied between homes. */
export function credentialsNeverCopied(credentials: readonly string[]): readonly string[] {
  // The overlay build takes a declaration only; no credential name of any
  // home is ever in the material it receives.
  return credentials.filter(() => false);
}
