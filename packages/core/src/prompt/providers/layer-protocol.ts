/**
 * T065 of feature 103 — the PROTOCOL BLOCK OF A LOOP LAYER (F103-FR-038).
 *
 * The eighth of the nine shipped providers, and the only one whose CONTENT
 * belongs to somebody else. F103-FR-038, in full:
 *
 *  - the protocol block of a loop layer is added BY THE PROVIDER OF THAT
 *    LAYER, at PASS LEVEL, and it MUST BE PROTECTED;
 *  - what the block IS depends on the layer: a checkpoint block for one of
 *    the two Wave 1 layers, a block of reserved tasks and a block of a worker
 *    for the other. F103-FR-038 names them; this file may not, and the
 *    paragraph below says why;
 *  - it is a NAMED LAYER FIELD in the sense of the divergence register
 *    (DV-020): it, and the values derived from the prompt — its size and its
 *    hash — differ from the classic loop, and THE REST OF THE PROMPT is
 *    compared in full;
 *  - with NO UNIT OF WORK declared the layer adds NOTHING BUT THIS BLOCK.
 *
 * ## Why the core side names no layer
 *
 * The identifiers of the two Wave 1 layers must not appear in a core file:
 * the static check CT-103-128 of phase 3
 * (`packages/testkit/src/conformance/EP-04/module-graph.test.ts`) fails the
 * build on a core file that NAMES a layer. So this module holds the SLOT and
 * the three rules, and takes the block from the layer through
 * `contributePrompt` (call point 1 of annex D §D.1). Which layer filled it is
 * the registry's business, not this file's.
 *
 * `PROTECTED` is not advice here: whatever the layer returns is forced
 * protected on the way through, so a layer cannot hand back a block that the
 * budget would drop and thereby silently lose its own protocol.
 */
import { blockOf } from "../assembler.ts";
import type {
  Block,
  PassContext,
  PromptBlockProvider,
} from "@specstride/contracts/ep/prompt-block";
import type { PromptBlock } from "@specstride/contracts/ep/loop-layer";

/** The id of the block of the slot. A layer's own block keeps its own id. */
export const BLOCK_ID = "layer_protocol" as const;
export const WRITER = "core/prompt/providers/layer-protocol" as const;

/** F103-FR-038 — the protocol block MUST be protected. */
export const PROTECTED = true as const;

/** F103-FR-038 — it is added at PASS level. */
export const LEVEL = "pass" as const;

/** F103-FR-038 — it is added by the provider OF THAT LAYER. */
export const ADDED_BY = "the layer" as const;

/** F103-FR-038 and DV-020 — it is a named layer field of the register. */
export const DIVERGENCE = "DV-020" as const;
export const IS_A_NAMED_LAYER_FIELD = true as const;

/** F103-FR-038 — the values of the prompt that differ from the classic loop. */
export const DERIVED_VALUES_THAT_DIFFER = ["size", "hash"] as const;

/** F103-FR-038 — the rest of the prompt is compared IN FULL. */
export const THE_REST_OF_THE_PROMPT_IS_COMPARED_IN_FULL = true as const;

/**
 * F103-FR-038 — with no unit of work declared the layer adds NOTHING BUT this
 * block. The count is therefore AT MOST ONE block in that case, which is what
 * the inertness suite of EP-04 measures.
 */
export const BLOCKS_WITH_NO_UNIT_DECLARED = 1 as const;

/** The size the provider declares. */
export const DECLARED_SIZE = 16_000 as const;

/** What the provider is given: whatever the layer returned at `contributePrompt`. */
export type LayerProtocolInput = {
  /** The blocks the registered layer, or the stack of layers, contributed. */
  readonly contributed?: readonly PromptBlock[] | undefined;
  /** Whether a unit of work was declared in this phase attempt. */
  readonly aUnitOfWorkWasDeclared?: boolean | undefined;
};

/**
 * F103-FR-038 — the layer's blocks, each forced PROTECTED and STABLE. Stable,
 * because a protocol block states the protocol of the layer and not the state
 * of the pass; a layer that needs per-pass state puts it in a block of its
 * own, which is then volatile like any other.
 */
export function layerProtocolBlocks(input: LayerProtocolInput): readonly Block[] {
  const contributed = input.contributed ?? [];
  const blocks: Block[] = [];
  for (const block of contributed) {
    if (block.text === "") continue;
    blocks.push(
      blockOf({
        id: block.id,
        text: block.text,
        writer: block.writer,
        protected: PROTECTED,
        stability: "stable",
      }),
    );
  }
  return Object.freeze(blocks);
}

/** The provider. */
export function layerProtocolProvider(input: LayerProtocolInput): PromptBlockProvider & {
  readonly id: typeof BLOCK_ID;
  readonly writer: typeof WRITER;
  readonly protected: true;
} {
  return Object.freeze({
    id: BLOCK_ID,
    writer: WRITER,
    declaredSize: DECLARED_SIZE,
    protected: PROTECTED,
    blocks(_context: PassContext): readonly Block[] {
      return layerProtocolBlocks(input);
    },
  });
}
