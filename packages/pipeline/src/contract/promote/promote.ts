/**
 * T035 — the canonical bytes, the stamp and promotion (F107-FR-019,
 * F107-FR-020, F107-FR-021; DV-066).
 *
 * The canonical bytes of a launch contract are the canonical record hash
 * input of the canonical hasher (sorted keys, compact separators, non-ASCII
 * unescaped, a final line end) — never written here, taken from
 * `@specstride/kernel` through `../kernel.ts`. The promotion stamp is the
 * hash of the canonical bytes of the contract WITHOUT `status` and
 * `promotion`, computed on the contract AS WRITTEN ON DISK, before any
 * normalization.
 *
 * The rewrite keeps the key order of the input (the preserved defect of the
 * baseline: promotion does NOT sort keys — research.md row 12): `status`
 * keeps its place and the stamp, removed and written again, is the LAST key.
 * A failed promotion sets the status back to `draft` and removes the stamp.
 */
import { readFileSync } from "node:fs";

import { canonicalRecordText, contentHash } from "@specstride/kernel";

import { atomicWriteJson as writeAtomicallyJson } from "@specstride/kernel";

/** The logical component that promotes, and the flag it promotes with. */
export const PROMOTED_BY = Object.freeze({
  tool: "contract-validate",
  flag: "--promote",
} as const);

/** The promotion stamp (F107-FR-020). */
export type PromotionStamp = {
  readonly by: { readonly tool: string; readonly flag: string };
  readonly sha256: string;
};

/** The canonical bytes of a launch contract (F107-FR-019). */
export function canonicalBytes(record: unknown): string {
  return `${canonicalRecordText(record)}\n`;
}

/** The contract without `status` and `promotion`, in its on-disk key order. */
export function withoutStatusAndPromotion(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const { status: _status, promotion: _promotion, ...rest } = record;
  void _status;
  void _promotion;
  return rest;
}

/** The promotion stamp of the contract as written on disk (F107-FR-019). */
export function stampOf(record: Record<string, unknown>): PromotionStamp {
  return {
    by: { tool: PROMOTED_BY.tool, flag: PROMOTED_BY.flag },
    sha256: canonicalRecordHashOf(withoutStatusAndPromotion(record)),
  };
}

function canonicalRecordHashOf(record: Record<string, unknown>): string {
  // The canonical record hash of the kernel, over the canonical bytes.
  return contentHash(canonicalBytes(record));
}

/** True when the stamp on the record matches the record as written on disk. */
export function stampMatches(record: Record<string, unknown>): boolean {
  const promotion = record.promotion as { sha256?: unknown } | undefined;
  return (
    promotion !== undefined &&
    promotion !== null &&
    typeof promotion.sha256 === "string" &&
    promotion.sha256 === stampOf(record).sha256
  );
}

/**
 * The promoted form of the record: the status is `validated` in ITS OWN
 * place, and the stamp is the LAST key (F107-FR-020).
 */
export function promotedRecord(record: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...record };
  next.status = "validated";
  delete next.promotion;
  next.promotion = stampOf(record);
  return next;
}

/** The set-back form: the status is `draft` again, the stamp is gone. */
export function setBackToDraft(record: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...record };
  next.status = "draft";
  delete next.promotion;
  return next;
}

/** A launch contract read off the disk, or the reason it cannot be read. */
export type ReadContract =
  | { readonly ok: true; readonly record: Record<string, unknown>; readonly text: string }
  | {
      readonly ok: false;
      readonly reason: "unreadable" | "not-json" | "not-object";
      readonly message: string;
    };

/**
 * Read the contract AS WRITTEN ON DISK, before any normalization. A file
 * that cannot be read, is not JSON or is not an object is the preserved
 * defect of the baseline (F107-FR-021): the caller decides, this reader only
 * reports the reason.
 */
export function readContractFromDisk(file: string): ReadContract {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (cause) {
    return { ok: false, reason: "unreadable", message: String((cause as Error)?.message ?? cause) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return {
      ok: false,
      reason: "not-json",
      message: String((cause as Error)?.message ?? cause),
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "not-object", message: "the contract is not an object" };
  }
  return { ok: true, record: parsed as Record<string, unknown>, text };
}

/** Rewrite the contract through a temporary name and a rename (F107-FR-020). */
export function rewriteContract(file: string, record: Record<string, unknown>): void {
  // An indent of two, non-ASCII unescaped, a final line end, keys NOT sorted.
  writeAtomicallyJson(file, record, { createDirectory: true });
}
