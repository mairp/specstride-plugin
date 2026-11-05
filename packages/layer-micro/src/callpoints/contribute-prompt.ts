/**
 * T040 — the checkpoint contract block (F115-FR-008).
 *
 * With the layer on, the layer contributes one protected block to the prompt
 * of every pass, the checkpoint contract block. The block says how a unit of
 * work is declared, asks for one task per unit sized at 5 to 15 minutes of
 * work, allows a group of tasks where they cannot be checked apart, and says
 * that the pass ends after the checkpoint. The block is byte-stable inside a
 * run: the text is a module constant, so two calls in one run give the same
 * bytes, and the bytes and the hash travel with the block as §D.5 asks.
 *
 * The block is protected: it is contributed by the layer, and the proposer
 * contract of the prompt protects it against edits by the pass itself.
 *
 * Purity: imports `@specstride/contracts` and `@specstride/kernel` only; no
 * `node:fs`, no process.
 */
import { epLoopLayer, type epLoopLayer as epLoopLayerTypes } from "@specstride/contracts";
import { contentHash } from "@specstride/kernel";

type PromptBlock = epLoopLayerTypes.PromptBlock;

function makeBlock(text: string): PromptBlock {
  return {
    id: "checkpoint-contract",
    bytes: Buffer.byteLength(text, "utf8"),
    hash: contentHash(text),
    writer: "layer-micro",
    protected: true,
    stability: "stable",
    text,
  };
}

/**
 * The text of the block. It is declared once, at the module level: the block
 * MUST be byte-stable inside a run (F115-FR-008), and a constant is
 * byte-stable across calls, runs and processes.
 */
const CHECKPOINT_CONTRACT_TEXT = `<!-- layer-micro: checkpoint contract (protected) -->
## Checkpoint contract

Inside this phase attempt you work one unit of work at a time. A unit of work
is declared in a checkpoint file written into the outbox before your pass
ends.

How to declare a unit of work:

- Write a checkpoint that names one or more task ids of the current phase,
  from the task list as it was read at launch. For a spec format without
  task ids, name criterion indexes of the phase instead.
- Size one task per unit at 5 to 15 minutes of work. Do not name several
  independent tasks in one unit.
- You MAY group tasks into one unit only where they cannot be checked apart.
- You MAY add a short free-text note; at most 512 bytes of it are kept, and
  the note never reaches a critic-class call.
- Every other field you write is ignored: only the ids and the note are read.

The pass ends after the checkpoint. The runtime reads the checkpoint only
after your pass has exited, treats it as a claim — never as a verdict — runs
the inner check set of the phase itself, and decides kept, repair or
unresolved. The phase gate, not the layer and not a check result, is the
only source of an approval.
`;

/** The checkpoint contract block, byte-stable inside a run (F115-FR-008). */
export function checkpointContractBlock(): PromptBlock {
  return makeBlock(CHECKPOINT_CONTRACT_TEXT);
}

/** True when two calls of the provider gave the very same bytes. */
export function blockIsByteStable(): boolean {
  const first = checkpointContractBlock();
  const second = checkpointContractBlock();
  return first.text === second.text && first.hash === second.hash;
}

/** The call point this provider serves, as annex D §D.1 row 1 names it. */
export const CALLED_POINT = epLoopLayer.CALL_POINTS[0];
