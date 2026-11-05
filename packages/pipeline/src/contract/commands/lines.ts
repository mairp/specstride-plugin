/**
 * T008 — the line tables of the three launch-contract commands and of
 * `launch`, from annex G §G.3 (the grammar of the product lines, pairs
 * `key=value`), this spec and `specs/107-launch-contract/contracts/commands.md`.
 *
 * Two kinds of row:
 *
 * - an AS-IS line: a line the baseline of mixture-of-loops already prints
 *   (the draft on standard output, `valid <status> launch contract: <id>`,
 *   `rendered <output>`, `bundle <bundle>`, and in the mode `run` of
 *   `launch` the lines of the owner of the handshake, feature 122). These
 *   are printed under every profile, the `parity` profile included — the
 *   oracle compares them;
 * - a PRODUCT line: a line with no as-is equivalent, in the grammar of
 *   annex G §G.3 (`[LABEL] key=value ...`). None is printed under the
 *   `parity` profile (F100-FR-176), and no value holds text of the
 *   repository (F107-FR-039): state is named by logical name.
 *
 * The table is data: the commands read the labels and the keys from here,
 * the tests compare it against commands.md, and no command writes its own
 * label outside it.
 */

/** One row of the line table. */
export type LineRow = {
  /** The label, with its brackets as it is printed. */
  readonly label: string;
  /** The keys of the line, in the order they are printed. */
  readonly keys: readonly string[];
  /** The command that prints the line. */
  readonly printedBy: string;
  /** True when the line has no as-is equivalent (the product lines table). */
  readonly productLine: boolean;
  /** True when the line is printed under the `parity` profile (F100-FR-176). */
  readonly printedUnderParity: boolean;
};

/** The line table, from contracts/commands.md (the as-is output and the product lines). */
export const LINE_TABLE: readonly LineRow[] = Object.freeze([
  // --- as-is lines: the compatibility output of the baseline ---
  Object.freeze({
    label: "(the draft on standard output)",
    keys: [],
    printedBy: "contract derive (compatibility output)",
    productLine: false,
    printedUnderParity: true,
  }),
  Object.freeze({
    label: "(valid line)",
    keys: ["valid", "<status>", "launch contract:", "<id>"],
    printedBy: "contract validate",
    productLine: false,
    printedUnderParity: true,
  }),
  Object.freeze({
    label: "(rendered line)",
    keys: ["rendered", "<output>"],
    printedBy: "contract render",
    productLine: false,
    printedUnderParity: true,
  }),
  Object.freeze({
    label: "(bundle line)",
    keys: ["bundle", "<bundle>"],
    printedBy: "contract render",
    productLine: false,
    printedUnderParity: true,
  }),
  // --- product lines: none is printed under the `parity` profile ---
  Object.freeze({
    label: "[SPECSTRIDE-DERIVE]",
    keys: [
      "contract",
      "sources",
      "tasks",
      "declarations",
      "commands",
      "mappings",
      "verification",
      "reason",
      "learning?",
    ],
    printedBy: "contract derive",
    productLine: true,
    printedUnderParity: false,
  }),
  Object.freeze({
    label: "[SPECSTRIDE-JUDGMENT]",
    keys: ["batch", "recorded", "remaining", "state", "delegated?"],
    printedBy: "contract derive --answer; --next-batch of a host without a model",
    productLine: true,
    printedUnderParity: false,
  }),
  Object.freeze({
    label: "[SPECSTRIDE-DRY-RUN]",
    keys: [
      "pipeline",
      "features",
      "stages",
      "limits",
      "verification",
      "reason",
      "comment",
      "changed",
    ],
    printedBy: "launch (mode dry-run)",
    productLine: true,
    printedUnderParity: false,
  }),
  Object.freeze({
    label: "[SPECSTRIDE-REFUSE]",
    keys: ["action", "reason", "next"],
    printedBy: "launch",
    productLine: true,
    printedUnderParity: false,
  }),
]);

/** The product lines of this feature (those never printed under `parity`). */
export const PRODUCT_LINES: readonly LineRow[] = Object.freeze(
  LINE_TABLE.filter((row) => row.productLine),
);

/** The labels of the product lines. */
export const PRODUCT_LINE_LABELS: readonly string[] = Object.freeze(
  PRODUCT_LINES.map((row) => row.label),
);

/** True when the profile is the `parity` profile (F100-FR-176). */
export function profileIsParity(profile: string | undefined): boolean {
  return profile === "parity";
}

/**
 * Whether a line may be printed under the given profile: an as-is line under
 * every profile, a product line under every profile but `parity`.
 */
export function lineMayBePrinted(row: LineRow, profile: string | undefined): boolean {
  return row.printedUnderParity || !profileIsParity(profile);
}

/** Render one product line in the grammar of annex G §G.3: `[LABEL] key=value`. */
export function productLine(
  label: string,
  values: Readonly<Record<string, string | number>>,
): string {
  const row = LINE_TABLE.find((one) => one.label === label && one.productLine);
  if (row === undefined) {
    throw new Error(`"${label}" is not a product line of contracts/commands.md (annex G §G.3)`);
  }
  const body = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return body === "" ? label : `${label} ${body}`;
}
