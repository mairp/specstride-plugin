/**
 * The Spec Kit templates the product SHIPS, and the check of their notice
 * (F140-FR-026).
 *
 * The five templates live in `packages/reverse/templates/`, copied unchanged
 * from the Spec Kit templates at the commit `UPSTREAM.txt` records, with the
 * MIT notice of their project beside them (T002 of phase 1). The lint reads
 * them when the source has no `.specify/templates/`, by the logical name
 * `package:templates:<name>` of annex B §B.5, whose path is
 * `<package>/templates/<name>`.
 *
 * Nothing here lists a heading of a template: the heading rules of
 * F140-FR-026 are DERIVED from these bytes by `templates.ts`, which is what
 * makes "required headings are never listed in the code" true (F140-FR-005).
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The five templates the product ships, by their file name. */
export const SHIPPED_TEMPLATE_NAMES = Object.freeze([
  "checklist-template.md",
  "constitution-template.md",
  "plan-template.md",
  "spec-template.md",
  "tasks-template.md",
] as const);

/** A template the product ships. */
export type ShippedTemplateName = (typeof SHIPPED_TEMPLATE_NAMES)[number];

/** The MIT notice of the upstream project, shipped beside the templates. */
export const NOTICE_FILE = "LICENSE" as const;

/** The file that records the upstream commit the copy was taken at. */
export const UPSTREAM_RECORD_FILE = "UPSTREAM.txt" as const;

/** The directory of the layout table the templates are reached by. */
export const TEMPLATES_DIRECTORY = "templates" as const;

/** The logical name of a shipped template (annex B §B.5). */
export function logicalNameOfATemplate(name: string): string {
  return `package:templates:${name}`;
}

/**
 * The root of the installed product: the package directory, two levels above
 * `src/lint/`. A message that names a shipped template prints its path
 * relative to this root (F140-FR-005).
 */
export function productRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Where the shipped templates lie: `<package>/templates/`. */
export function shippedTemplatesDirectory(root: string = productRoot()): string {
  return join(root, TEMPLATES_DIRECTORY);
}

/** The path of one shipped template. */
export function shippedTemplatePath(name: string, root: string = productRoot()): string {
  return join(shippedTemplatesDirectory(root), name);
}

/** The bytes of one shipped template, as text. */
export function readShippedTemplate(name: string, root: string = productRoot()): string {
  return readFileSync(shippedTemplatePath(name, root), "utf8");
}

/** What the notice check found. */
export interface NoticeReport {
  /** The templates that are present, in the order they are shipped. */
  readonly templates: readonly string[];
  /** The templates F140-FR-026 names that are NOT on disk. */
  readonly missing: readonly string[];
  /** Is the MIT notice beside them? */
  readonly notice: boolean;
  /** Is the record of the upstream commit beside them? */
  readonly record: boolean;
  /** The upstream commit the record names, or null. */
  readonly upstreamCommit: string | null;
  /** True only when the five templates, the notice and the record are there. */
  readonly complete: boolean;
}

/** `Upstream commit <sha>` of the record file. */
const UPSTREAM_COMMIT_RE = /^Upstream commit\s+(\S+)\s*$/m;

function isAFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Check the shipped copy (F140-FR-026): the five templates, their MIT notice
 * and the recorded upstream commit. The lint frame runs this when it falls
 * back to the shipped templates, so a product built without them fails
 * loudly instead of silently linting against nothing.
 */
export function checkTheNotice(root: string = productRoot()): NoticeReport {
  const directory = shippedTemplatesDirectory(root);
  const templates: string[] = [];
  const missing: string[] = [];
  for (const name of SHIPPED_TEMPLATE_NAMES) {
    if (isAFile(join(directory, name))) templates.push(name);
    else missing.push(name);
  }
  const notice = isAFile(join(directory, NOTICE_FILE));
  const recordPath = join(directory, UPSTREAM_RECORD_FILE);
  const record = isAFile(recordPath);
  let upstreamCommit: string | null = null;
  if (record) {
    const found = UPSTREAM_COMMIT_RE.exec(readFileSync(recordPath, "utf8"));
    upstreamCommit = found === null ? null : (found[1] as string);
  }
  return Object.freeze({
    templates: Object.freeze(templates),
    missing: Object.freeze(missing),
    notice,
    record,
    upstreamCommit,
    complete: missing.length === 0 && notice && record && upstreamCommit !== null,
  });
}

/** A product whose shipped templates or whose notice are not there. */
export class ShippedTemplatesIncompleteError extends Error {
  readonly report: NoticeReport;
  constructor(report: NoticeReport) {
    const parts: string[] = [];
    if (report.missing.length > 0) parts.push(`missing ${report.missing.join(", ")}`);
    if (!report.notice) parts.push(`no ${NOTICE_FILE} beside them`);
    if (!report.record) parts.push(`no ${UPSTREAM_RECORD_FILE} beside them`);
    else if (report.upstreamCommit === null) {
      parts.push(`${UPSTREAM_RECORD_FILE} records no upstream commit`);
    }
    super(`the shipped Spec Kit templates are incomplete: ${parts.join("; ")}`);
    this.name = "ShippedTemplatesIncompleteError";
    this.report = report;
  }
}

/** The notice check as an assertion, for the loader's fallback path. */
export function requireTheNotice(root: string = productRoot()): NoticeReport {
  const report = checkTheNotice(root);
  if (!report.complete) throw new ShippedTemplatesIncompleteError(report);
  return report;
}
