/**
 * T190 — the two output modes of §G.2 and the predicate that says whether a
 * line may be written to a compared stream under a profile (annex G, §G.2;
 * F100-FR-175, F100-FR-176, F100-FR-177).
 *
 * The modes are row 80 of `data/closed-sets.json` ("Output modes"), whose
 * members this module gives. The switch is row 18 of the `parity` profile,
 * read through the loader of T072.
 */
import cliProtocol from "../../data/cli-protocol.json" with { type: "json" };
import { profileRow } from "../profile/parity.ts";

/** The section of annex G that owns the modes. */
export const ANNEX_SECTION = "annex G, §G.2" as const;

/** The two output modes, and no other (F100-FR-175). */
export const OUTPUT_MODES = ["default", "compat"] as const;
export type OutputMode = (typeof OUTPUT_MODES)[number];

/** The names the table of §G.2 gives the two modes. */
export const MODE_NAMES: Readonly<Record<OutputMode, string>> = Object.freeze({
  default: "Default output",
  compat: "Compatibility output",
});

/** Row 80 of annex X §X.6, whose members are the two modes. */
export const CLOSED_SET_ROW = 80 as const;

/** Row 80 — a value outside the set is a configuration error. */
export const MODE_WHEN_UNKNOWN = Object.freeze({ outcome: "configuration-error" as const });

type RawMode = { Mode: string; "What it prints": string; When: string };

/** One row of the table of §G.2. */
export type OutputModeRow = {
  readonly mode: OutputMode;
  /** The `Mode` cell as the annex writes it. */
  readonly name: string;
  readonly whatItPrints: string;
  readonly when: string;
};

/** Load the table of §G.2 from `data/cli-protocol.json` (F100-FR-175). */
export function loadOutputModes(): readonly OutputModeRow[] {
  return Object.freeze(
    (cliProtocol as { outputModes: RawMode[] }).outputModes.map((row) => {
      const mode: OutputMode = /compat/i.test(row.Mode) ? "compat" : "default";
      return Object.freeze({
        mode,
        name: row.Mode,
        whatItPrints: row["What it prints"],
        when: row.When,
      });
    }),
  );
}

/** The rows of the table of §G.2, in the order of the annex. */
export const outputModeRows: readonly OutputModeRow[] = loadOutputModes();

/** The row of a mode. */
export function outputModeRow(mode: OutputMode): OutputModeRow | undefined {
  return outputModeRows.find((row) => row.mode === mode);
}

/** The configuration key that selects compatibility output (§G.2). */
export const KEY = "output.compat" as const;

/** The default of the key, and its value under `parity` (row 18 of §X.7). */
export const PARITY_ROW = 18 as const;
export const DEFAULT_MODE: OutputMode = "default";
export const MODE_UNDER_PARITY: OutputMode = "compat";

/** The mode in force, from the key and the profile (§G.2). */
export function modeInForce(input: {
  readonly outputCompat?: boolean | undefined;
  readonly profile?: string | undefined;
}): OutputMode {
  if (input.profile === "parity") return MODE_UNDER_PARITY;
  return input.outputCompat === true ? "compat" : DEFAULT_MODE;
}

/** The row of the `parity` profile that switches the mode (row 18). */
export function profileRowOfTheMode(): ReturnType<typeof profileRow> {
  return profileRow(PARITY_ROW);
}

/* ------------------------------------------------------------------ *
 * F100-FR-175 — compatibility output reproduces every as-is line byte
 * for byte.
 * ------------------------------------------------------------------ */

/** The three cases F100-FR-175 names by name. */
export const BYTE_FOR_BYTE_CASES = [
  "the literal for an absent child exit code",
  "the quoting of the old language in the relaunch line",
  "the hold line on every unchanged poll",
] as const;

/** Compatibility output prints no line that is not an as-is line (§G.2). */
export const COMPAT_PRINTS_ONLY_AS_IS_LINES = true as const;

/* ------------------------------------------------------------------ *
 * F100-FR-176 — a line with no as-is equivalent and the compared streams.
 * ------------------------------------------------------------------ */

/** Row 19 of §X.7: lines with no as-is equivalent, `[LOOP]` included. */
export const NEW_LINE_PARITY_ROW = 19 as const;

/** The streams the oracle compares with the reference (F100-FR-176). */
export const COMPARED_STREAMS = ["stdout", "stderr"] as const;
export type ComparedStream = (typeof COMPARED_STREAMS)[number];

/** What the predicate is told about a line. */
export type LineUnderTest = {
  /** The stream the line would be written to. */
  readonly stream: ComparedStream;
  /** True where the line has an as-is equivalent at a baseline. */
  readonly hasAnAsIsEquivalent: boolean;
  /** True where the feature the line belongs to is on. */
  readonly featureIsOn?: boolean | undefined;
};

/** Why a line may not be written (F100-FR-176). */
export type LineRefusal = "no-as-is-equivalent-on-a-compared-stream" | "feature-is-off";

/**
 * F100-FR-176 — the predicate that says whether a line may be written to a
 * compared stream under a profile.
 *
 * Under the `parity` profile no line without an as-is equivalent is printed on
 * any stream. Outside it, such a line is printed only when the feature it
 * belongs to is on. A line that has an as-is equivalent is always allowed.
 */
export function mayBeWritten(
  line: LineUnderTest,
  profile: string | undefined = undefined,
):
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: LineRefusal; readonly message: string } {
  if (line.hasAnAsIsEquivalent) return Object.freeze({ allowed: true as const });
  if (profile === "parity") {
    return Object.freeze({
      allowed: false as const,
      reason: "no-as-is-equivalent-on-a-compared-stream" as const,
      message:
        `a line with no as-is equivalent is never written to ${line.stream}, which the ` +
        `oracle compares, and under the \`parity\` profile it is printed on no stream ` +
        `(F100-FR-176, row ${NEW_LINE_PARITY_ROW} of annex X §X.7)`,
    });
  }
  if (line.featureIsOn !== true) {
    return Object.freeze({
      allowed: false as const,
      reason: "feature-is-off" as const,
      message: "a new line is printed only when the feature it belongs to is on (F100-FR-176)",
    });
  }
  return Object.freeze({ allowed: true as const });
}

/* ------------------------------------------------------------------ *
 * F100-FR-177 — text from outside the runtime is never echoed.
 * ------------------------------------------------------------------ */

/** What F100-FR-177 names as text from outside the runtime. */
export const TEXT_FROM_OUTSIDE = [
  "feedback of the critic",
  "names of tests",
  "messages of a harness",
] as const;

/** Default output never echoes it; it refers to it by logical name. */
export const DEFAULT_OUTPUT_ECHOES_OUTSIDE_TEXT = false as const;
export const DEFAULT_OUTPUT_REFERS_BY = "logical name" as const;

/** Every message that names state names it by logical name (F100-FR-177). */
export const STATE_IS_NAMED_BY = "logical name" as const;

/**
 * F100-FR-177 — a message that at the baseline carried a physical path of
 * state is compared through the layout table (annex X §X.8).
 */
export const A_PHYSICAL_PATH_IS_COMPARED_THROUGH = "the layout table" as const;

/**
 * F100-FR-177 — the check of one message of default output: it may not carry
 * text from outside the runtime, and it may not name state by a physical path.
 */
export function messageIsAllowedInDefaultOutput(
  message: string,
  outsideText: readonly string[] = [],
): { readonly allowed: boolean; readonly reason?: string } {
  for (const text of outsideText) {
    if (text !== "" && message.includes(text)) {
      return Object.freeze({
        allowed: false,
        reason:
          "default output never echoes text from outside the runtime; it refers to it by " +
          "logical name (F100-FR-177)",
      });
    }
  }
  return Object.freeze({ allowed: true });
}
