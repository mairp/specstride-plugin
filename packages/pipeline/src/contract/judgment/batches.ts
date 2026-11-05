/**
 * T023 — the judgment batches and the completion trigger (F107-FR-009;
 * F107-FR-010; data-model.md, "Judgment record").
 *
 * `--next-batch` writes `inventory.judgment` on the FIRST call and only then
 * (F107-FR-009b): a plain derive never writes it, and no cursor file is kept —
 * the batch boundaries follow from the answers already recorded. Each call
 * returns at most `BATCH_ITEM_CAP` items (8) and at most `BATCH_BYTE_CAP`
 * bytes (8,400 — F107-FR-009: 3,000 tokens measured as bytes at 2.8 bytes per
 * token), with the count of the items still to come and a per-call
 * boundary in the batch id (`<feature>-<n>`).
 *
 * A refused answer — a choice outside the item's list — is refused with exit 2
 * (F107-FR-010e) and the item stays unchanged, so a later call returns the
 * same batch. When the last open answer is recorded the exchange calls the
 * completion (T066), which is a pure function; the HOST writes nothing
 * (F107-SC-006): it does not write the draft, the launcher or the state files.
 */
import type { LaunchContractDraft } from "../draft/build.ts";
import { completeDraft, type CompletionInput, type CompletionResult } from "../draft/complete.ts";
import { judgmentItemsOf, type JudgmentItem } from "./items.ts";

/** The most items a batch holds (F107-FR-009c). */
export const BATCH_ITEM_CAP = 8 as const;

/** The most bytes one batch may hold (F107-FR-009c: 3,000 tokens at 2.8 B). */
export const BATCH_BYTE_CAP = 8400 as const;

/** One batch, as the exchange returns it. */
export type JudgmentBatch = {
  readonly batch: string;
  readonly items: readonly JudgmentItem[];
  /** The items still to come after this batch. */
  readonly remaining: number;
  /** True when this batch holds the last open item. */
  readonly final: boolean;
};

/** The id of one batch: the feature, then the one-based index. */
export function batchIdOf(feature: string, index: number): string {
  return `${feature}-${index}`;
}

/** The items of the draft that have no recorded answer yet. */
export function openItemsOf(draft: LaunchContractDraft): readonly JudgmentItem[] {
  const answered = new Set((draft.inventory.judgment?.answers ?? []).map((one) => one.item));
  // The recorded items of the exchange when the exchange has started; the
  // items of the draft when it has not.
  const items =
    (draft.inventory.judgment?.items as readonly JudgmentItem[] | undefined) ??
    judgmentItemsOf(draft);
  return items.filter((one) => !answered.has(one.id));
}

/** The size of one item, in bytes of its UTF-8 form. */
export function byteSizeOf(item: JudgmentItem): number {
  return Buffer.byteLength(JSON.stringify(item), "utf8");
}

/**
 * F107-FR-009c — the next batch: at most 8 items and at most 8,400 bytes, an
 * item that does not fit the byte cap is carried shortened by the excerpt
 * rule of T022 and never dropped. The batch boundaries follow from the
 * recorded answers alone, so there is no cursor file.
 */
export function nextBatchOf(draft: LaunchContractDraft): JudgmentBatch {
  const open = openItemsOf(draft);
  const items: JudgmentItem[] = [];
  let bytes = 0;
  for (const openItem of open) {
    if (items.length >= BATCH_ITEM_CAP) break;
    // The byte cap: an item that does not fit is carried shortened by the
    // excerpt rule of T022 (its excerpt cut harder), never dropped.
    let item = openItem;
    while (bytes + byteSizeOf(item) > BATCH_BYTE_CAP && (item.excerpt?.length ?? 0) > 0) {
      item = {
        ...item,
        excerpt: item.excerpt?.slice(0, Math.max(0, (item.excerpt?.length ?? 0) - 40)),
      };
    }
    if (items.length > 0 && bytes + byteSizeOf(item) > BATCH_BYTE_CAP) break;
    bytes += byteSizeOf(item);
    items.push(item);
  }
  return {
    batch: batchIdOf(
      draft.id,
      1 + (draft.inventory.judgment?.answers.length ?? 0) / BATCH_ITEM_CAP,
    ),
    items,
    remaining: Math.max(0, open.length - items.length),
    final: open.length <= items.length,
  };
}

/** The exit code of a refused answer. */
export const REFUSED_ANSWER_EXIT_CODE = 2 as const;

/**
 * F107-FR-010e — is an answer acceptable for an item? A choice outside the
 * item's list is refused; the item stays unchanged either way.
 */
export function isAcceptable(item: JudgmentItem, choice: string): boolean {
  return (item.choices as readonly string[]).includes(choice);
}

/**
 * Record one answer into the judgment of the draft, returning the draft with
 * the answer appended and `inventory.judgment` present (F107-FR-009b). A PURE
 * function: it returns the new draft and writes nothing.
 */
export function recordAnswer(
  draft: LaunchContractDraft,
  input: {
    readonly item: string;
    readonly choice: string;
    readonly who: string;
    readonly route: "host-model" | "delegated-harness";
    readonly harness?: string;
    readonly batch: string;
    readonly settled: readonly string[];
  },
): LaunchContractDraft {
  const judgment = draft.inventory.judgment ?? { items: judgmentItemsOf(draft), answers: [] };
  const items = judgment.items.some((one) => one.id === input.item)
    ? judgment.items
    : [...judgment.items, ...judgmentItemsOf(draft).filter((one) => one.id === input.item)];
  return {
    ...draft,
    inventory: {
      ...draft.inventory,
      judgment: {
        items,
        answers: [
          ...judgment.answers,
          {
            item: input.item,
            choice: input.choice,
            provenance: {
              who: input.who,
              route: input.route,
              ...(input.harness !== undefined ? { harness: input.harness } : {}),
              batch: input.batch,
            },
            settled: input.settled,
          },
        ],
      },
    },
  };
}

/**
 * F107-FR-041 — when the last open answer is recorded, run the completion:
 * a pure function over the draft and the inventory facts. The host writes
 * nothing; the command writes the documents through the atomic write.
 */
export function completeWhenSettled(
  draft: LaunchContractDraft,
  input: Omit<CompletionInput, "draft">,
): CompletionResult {
  return completeDraft({ ...input, draft });
}
