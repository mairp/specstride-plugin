/**
 * The names the whole redactor folder shares: the placeholder, the schema id of
 * the pattern set and the marks of dropped content.
 *
 * They were in `index.ts` while the folder held nothing else (T001). T040 and
 * T042 gave the folder modules that `index.ts` re-exports, and a module that
 * `index.ts` exports cannot import from `index.ts` — so the three names moved
 * here, the leaf every other module of the folder may read, and `index.ts`
 * re-exports them unchanged. No exported name of the package changed.
 */
import { SCHEMA_ID } from "@specstride/contracts/ep/redactor";

/** The schema id of the versioned pattern set this folder loads (annex X §X.4). */
export const PATTERN_SET_SCHEMA_ID = SCHEMA_ID;

/** The text that replaces every match, in the baseline's form (research D-6). */
export const REDACTION_PLACEHOLDER = "[REDACTED]" as const;

/**
 * The marks of dropped content (closed set, row 90). The redactor fails
 * closed: when it cannot run, the content is dropped and the record says
 * which mark applied (F100-FR-205).
 */
export const DROP_MARKS = ["redactor-unavailable", "pattern-set-invalid"] as const;
export type DropMark = (typeof DROP_MARKS)[number];

/** The feature that owns this folder, for the record. */
export const REDACTOR_OWNER = "111" as const;
