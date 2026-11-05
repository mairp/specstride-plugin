/**
 * The two output modes of the front door (feature 119).
 *
 * This directory holds the compatibility output (byte for byte the baseline)
 * and the default output built from closed fields: the closed sets
 * (`closed-sets.ts`, T003), the product-line writer (`lines.ts`, T004), the
 * data-frame writer (`frame.ts`, T005) and the mode selector (`mode.ts`,
 * T006). The layout marker stays for the campaign scope checks.
 */
export const OUTPUT_LAYOUT = "119-front-door-and-presenter/output" as const;

export {
  FAILURE_REASONS,
  FIX_TEXTS,
  ERROR_LABEL,
  TRUNCATED_LABEL,
  DATA_BEGIN_LABEL,
  DATA_END_LABEL,
  LINE_LABELS,
  RECORD_VERBS,
  schemaIdOf,
  isFailureReason,
  fixTextOf,
  type FailureReason,
  type LineLabel,
} from "./closed-sets.ts";
export {
  SUCCESS_BYTE_LIMIT,
  FAILURE_BYTE_LIMIT,
  quoteValue,
  productLine,
  errorLine,
  byteLimitOf,
  capOutput,
  openLineWriter,
  type Pair,
  type CappedOutput,
  type LineWriter,
} from "./lines.ts";
export {
  FRAME_TEXT_BYTE_CAP,
  freshFrameToken,
  textReference,
  frameText,
  referenceLine,
  type TextReference,
  type DataFrame,
} from "./frame.ts";
export {
  OUTPUT_COMPAT_KEY,
  PARITY_PROFILE,
  isCompatValue,
  selectMode,
  isCompatibilityMode,
  type OutputMode,
} from "./mode.ts";
