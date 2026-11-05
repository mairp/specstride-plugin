/**
 * T198 — the types of the judgment exchange: a judgment item, a batch with its
 * cap of 3,000 tokens, and an answer with its provenance (annex G, §G.9;
 * F100-FR-192).
 *
 * The exchange is the part of the CLI protocol through which derivation of a
 * launch contract asks for judgment on items that the inventory could not
 * settle. Its three steps come from the key `judgmentExchange` of
 * `data/cli-protocol.json`; the schema id from `judgmentSchema`.
 *
 * The cap is stated in tokens by §G.5 and measured in BYTES in the build, at
 * 2.8 bytes per token — the measure T194 owns. This module holds the same
 * constant so that the `contracts` package needs no test-kit import, and the
 * contract test of T197 pins the two against each other.
 */
import cliProtocol from "../../data/cli-protocol.json" with { type: "json" };

/** The section of annex G that owns the exchange. */
export const ANNEX_SECTION = "annex G, §G.9" as const;

/** The schema id of the exchange (§G.9). */
export const SCHEMA_ID: string = (cliProtocol as { judgmentSchema: string }).judgmentSchema;

/** The feature that implements the exchange as the derivation half of EP-01. */
export const CONTENT_OWNER = "107" as const;

/** The extension point the exchange belongs to (F100-FR-192). */
export const POINT_ID = "specstride.host/1" as const;

type RawStep = { Step: string; Actor: string; Act: string };

/** One step of the table of §G.9. */
export type ExchangeStep = {
  readonly step: number;
  readonly actor: string;
  readonly act: string;
};

/** Load the three steps of §G.9 from `data/cli-protocol.json` (F100-FR-192). */
export function loadSteps(): readonly ExchangeStep[] {
  return Object.freeze(
    (cliProtocol as { judgmentExchange: RawStep[] }).judgmentExchange.map((row) =>
      Object.freeze({ step: Number(row.Step), actor: row.Actor, act: row.Act }),
    ),
  );
}

/** The three steps of the exchange, in the order of the annex. */
export const steps: readonly ExchangeStep[] = loadSteps();

/** The cap of one batch, in tokens (§G.5, §G.9). */
export const BATCH_TOKEN_CAP = 3000 as const;

/** The byte measure of the build: 2.8 bytes per token (§G.5, T194). */
export const BYTES_PER_TOKEN = 2.8 as const;

/** The cap of one batch, in bytes, at 2.8 bytes per token. */
export const BATCH_BYTE_CAP: number = Math.floor(BATCH_TOKEN_CAP * BYTES_PER_TOKEN);

/** The subject of §G.5 whose budget is the cap of a batch. */
export const BUDGET_SUBJECT = "One batch of the judgment exchange" as const;

/* ------------------------------------------------------------------ *
 * A judgment item.
 * ------------------------------------------------------------------ */

/** Where an item comes from: a path, a line and an anchor (§G.9, step 1). */
export type SourceAnchor = {
  readonly path: string;
  readonly line: number;
  readonly anchor: string;
};

/** One choice an item offers (§G.9, step 2: the host answers with one of them). */
export type JudgmentChoice = {
  /** The id of the choice, which the answer names. */
  readonly id: string;
  /** What the choice means, in one sentence. */
  readonly label: string;
};

/** One item of the exchange: an id, a source anchor and a short excerpt (§G.9). */
export type JudgmentItem = {
  readonly id: string;
  readonly source: SourceAnchor;
  /** A short excerpt of the source; outside text, and framed as data. */
  readonly excerpt: string;
  /** The choices the item offers; the answer names one of them. */
  readonly choices: readonly JudgmentChoice[];
};

/* ------------------------------------------------------------------ *
 * A batch, with its cap.
 * ------------------------------------------------------------------ */

/** One batch of the exchange: items that together stay inside the cap (§G.9). */
export type JudgmentBatch = {
  /** The id of the batch, stable inside the derivation. */
  readonly id: string;
  /** The items of the batch, in the order the CLI paged them. */
  readonly items: readonly JudgmentItem[];
  /** The bytes the batch holds, as it leaves the CLI. */
  readonly bytes: number;
};

/** The bytes one item holds, as the pager measures it. */
export function bytesOfItem(item: JudgmentItem): number {
  const text =
    `${item.id}\u0000${item.source.path}:${item.source.line}#${item.source.anchor}\u0000` +
    `${item.excerpt}\u0000${item.choices.map((c) => `${c.id}=${c.label}`).join("\u0000")}`;
  // The measure is bytes of UTF-8; the count is derived without a Buffer, so
  // that the `contracts` package imports no Node builtin (F100-FR-234).
  return new TextEncoder().encode(text).length;
}

/** The bytes a list of items holds. */
export function bytesOfItems(items: readonly JudgmentItem[]): number {
  return items.reduce((total, item) => total + bytesOfItem(item), 0);
}

/** True where the batch stays inside the cap of 3,000 tokens (§G.9). */
export function batchIsInsideTheCap(batch: JudgmentBatch): boolean {
  return batch.bytes <= BATCH_BYTE_CAP;
}

/** An item that is larger than the cap of one batch by itself. */
export class ItemLargerThanTheCapError extends Error {
  readonly itemId: string;
  readonly bytes: number;
  constructor(itemId: string, bytes: number) {
    super(
      `the judgment item "${itemId}" holds ${bytes} bytes by itself; the cap of one batch ` +
        `is ${BATCH_TOKEN_CAP} tokens, ${BATCH_BYTE_CAP} bytes at ${BYTES_PER_TOKEN} bytes ` +
        "per token (annex G, §G.9)",
    );
    this.name = "ItemLargerThanTheCapError";
    this.itemId = itemId;
    this.bytes = bytes;
  }
}

/**
 * Step 1 of §G.9 — the CLI pages the items that need judgment into batches of
 * AT MOST 3,000 tokens. The order of the items is kept; an item that is larger
 * than the cap by itself is an error, because no batch could hold it.
 */
export function pageIntoBatches(
  items: readonly JudgmentItem[],
  idOfBatch: (ordinal: number) => string = (n) => `batch-${n}`,
): readonly JudgmentBatch[] {
  const batches: JudgmentBatch[] = [];
  let current: JudgmentItem[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = bytesOfItem(item);
    if (size > BATCH_BYTE_CAP) throw new ItemLargerThanTheCapError(item.id, size);
    if (current.length > 0 && bytes + size > BATCH_BYTE_CAP) {
      batches.push(
        Object.freeze({ id: idOfBatch(batches.length + 1), items: Object.freeze(current), bytes }),
      );
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length > 0) {
    batches.push(
      Object.freeze({ id: idOfBatch(batches.length + 1), items: Object.freeze(current), bytes }),
    );
  }
  return Object.freeze(batches);
}

/* ------------------------------------------------------------------ *
 * An answer, with its provenance.
 * ------------------------------------------------------------------ */

/** Who answered an item (§G.9, step 3). */
export const ANSWERED_BY = ["host-model", "harness"] as const;
export type AnsweredBy = (typeof ANSWERED_BY)[number];

/** The provenance of an answer: who answered, through which harness (§G.9). */
export type AnswerProvenance = {
  readonly answeredBy: AnsweredBy;
  /** The harness the answer came through, where a harness answered. */
  readonly harness?: string | undefined;
  /** The level of the harness through which a delegation runs (F100-FR-192). */
  readonly level?: "completion" | undefined;
};

/** One answer of the exchange, with its provenance (§G.9, step 3). */
export type JudgmentAnswer = {
  /** The item the answer is about. */
  readonly itemId: string;
  /** The choice the answerer named; one of the choices the item offered. */
  readonly choiceId: string;
  /** Who answered, and through which harness. */
  readonly provenance: AnswerProvenance;
};

/** Where an answer is recorded (§G.9, step 3). */
export const ANSWER_IS_RECORDED_IN = ["the launch contract", "the digest"] as const;

/** The level through which a host without a model delegates (F100-FR-192). */
export const DELEGATION_LEVEL = "completion" as const;

/** The rank of configuration that may name the harness of a delegation. */
export const DELEGATION_IS_NAMED_IN = "user configuration" as const;

/** A delegation is recorded in the digest (F100-FR-192). */
export const A_DELEGATION_IS_RECORDED_IN_THE_DIGEST = true as const;

/** F100-FR-192 — the host never needs to open the launch contract or the sources. */
export const THE_HOST_OPENS_THE_LAUNCH_CONTRACT = false as const;
export const THE_HOST_OPENS_THE_SOURCES = false as const;

/** Why an answer is refused. */
export type AnswerRefusal = "unknown-item" | "choice-the-item-did-not-offer" | "no-provenance";

/**
 * Step 3 of §G.9 — an answer is accepted only for an item of the batch, only
 * with a choice the item offered, and only with its provenance.
 */
export function acceptAnswer(
  batch: JudgmentBatch,
  answer: JudgmentAnswer,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: AnswerRefusal; readonly message: string } {
  const item = batch.items.find((i) => i.id === answer.itemId);
  if (item === undefined) {
    return Object.freeze({
      ok: false as const,
      reason: "unknown-item" as const,
      message: `the batch "${batch.id}" holds no item "${answer.itemId}" (annex G, §G.9)`,
    });
  }
  if (!item.choices.some((c) => c.id === answer.choiceId)) {
    return Object.freeze({
      ok: false as const,
      reason: "choice-the-item-did-not-offer" as const,
      message:
        `the item "${item.id}" offers ${item.choices.map((c) => c.id).join(", ")}; the ` +
        `answer names "${answer.choiceId}" (annex G, §G.9)`,
    });
  }
  const by = answer.provenance.answeredBy;
  if (!(ANSWERED_BY as readonly string[]).includes(by)) {
    return Object.freeze({
      ok: false as const,
      reason: "no-provenance" as const,
      message: "an answer is recorded with its provenance (annex G, §G.9)",
    });
  }
  if (by === "harness" && (answer.provenance.harness ?? "") === "") {
    return Object.freeze({
      ok: false as const,
      reason: "no-provenance" as const,
      message:
        "an answer a harness gave is recorded with the harness it came through " +
        "(annex G, §G.9)",
    });
  }
  return Object.freeze({ ok: true as const });
}
