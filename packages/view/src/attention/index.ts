/**
 * T005 — the nine kinds of attention item, their order and the FIXED table of
 * next commands (`contracts/lane-and-attention.md`; F129-FR-017).
 *
 * `next` comes from this table and NEVER from text of the run. Raising the
 * items is the work of User Story 3 (phase 5 of `tasks.md`); what this module
 * holds now is the closed set, the order and the fixed commands.
 */
import { ATTENTION_KINDS, COLLECTION_BOUNDS } from "../model/view.ts";
import type { AttentionItem, AttentionKind } from "../model/view.ts";

export { ATTENTION_KINDS };

/** The order in which items are listed (F129-FR-017): the order of the table. */
export const ATTENTION_ORDER: Readonly<Record<AttentionKind, number>> = Object.freeze(
  Object.fromEntries(ATTENTION_KINDS.map((kind, index) => [kind, index + 1])) as Record<
    AttentionKind,
    number
  >,
);

/** The fixed command of each kind; never text of the run. */
export const NEXT_COMMAND: Readonly<Record<AttentionKind, string>> = Object.freeze({
  "blocked-on-human": "resume",
  "source-changed": "resume --accept-source-change",
  "dead-run": "resume",
  "launch-abandoned": "launch",
  "quota-pause": "wait",
  "budget-alert": "status --json",
  "stale-run": "doctor",
  "orphan-processes": "resume",
  "unknown-state": "doctor",
});

/** The command a reader shows for a kind it does not know (row 244). */
export const NEXT_COMMAND_WHEN_UNKNOWN = "status --json" as const;

/** The bound on the number of items the view holds (F129-FR-026). */
export const ATTENTION_BOUND = COLLECTION_BOUNDS.attentionItems;

/** Items in the order of the table, then by `since`, cut to the bound. */
export function orderAttention(items: readonly AttentionItem[]): {
  readonly items: readonly AttentionItem[];
  readonly omitted: number;
} {
  const sorted = [...items].sort((a, b) => {
    const left = ATTENTION_ORDER[a.kind] ?? Number.MAX_SAFE_INTEGER;
    const right = ATTENTION_ORDER[b.kind] ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return (a.since ?? "") < (b.since ?? "") ? -1 : (a.since ?? "") > (b.since ?? "") ? 1 : 0;
  });
  return Object.freeze({
    items: Object.freeze(sorted.slice(0, ATTENTION_BOUND)),
    omitted: Math.max(0, sorted.length - ATTENTION_BOUND),
  });
}
