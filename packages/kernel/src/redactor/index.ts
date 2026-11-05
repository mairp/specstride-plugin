/**
 * T001 — the folder of the redactor in `@specstride/kernel` (feature 111).
 *
 * The redactor is ONE function with ONE point of redaction, the ingress of
 * annex A F100-FR-009; its interface type lives in `@specstride/contracts`
 * (`src/ep/redactor.ts`) and nothing of it is an extension point. This module
 * is the entry of the folder: Phase 1 fixed the names and the placeholder
 * (which now live in `marks.ts`, the leaf the other modules read), and tasks
 * T040, T042 and T044 filled the rules, the versioned pattern set and the
 * registration with the commit scan.
 *
 * The package graph marks `@specstride/kernel` neither `core` nor `edge`; its
 * `mayImport` is `@specstride/contracts` alone, so this folder imports no core
 * package (F100-FR-012, `assumption: CQ-185`). The file calls of the writer
 * live in `@specstride/observability`, an edge-side package of layer L1.
 */
import type { RedactResult, Redactor } from "@specstride/contracts/ep/redactor";

/** The placeholder, the schema id and the marks of row 90. */
export * from "./marks.ts";

/** The result and the interface of the redactor, re-exported for this folder. */
export type { RedactResult, Redactor };

/* The rules, the pattern set, the registration and the scan (T040, T042, T044). */
export * from "./patterns.ts";
export * from "./rules.ts";
export * from "./redactor.ts";
export * from "./register.ts";
export * from "./scan.ts";
