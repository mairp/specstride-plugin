/**
 * One contender of the contention test CT-122-15 (F122-FR-011, F122-FR-015).
 *
 * It is a PROCESS and not a promise. Eight promises in one event loop take
 * their turns one after another and would prove nothing about exclusion: the
 * rename of research D-1 and the rename of research D-4 are guarantees OF THE
 * KERNEL, and only eight real processes reaching them at the same moment can
 * put them to the test.
 *
 * The parent sends a round; every contender spins until the instant the round
 * names and then attempts. The spin is what makes the eight arrive together;
 * a plain `setTimeout` would scatter them over the event loops of eight
 * processes.
 */
import process from "node:process";
import { createDirectoryLock } from "../../src/lock/directory-lock.ts";
import { buildOwnerRecord } from "../../src/lock/owner-record.ts";
import { mintRunToken } from "../../src/procs/run-token.ts";
import type { Lease } from "@specstride/contracts/records/lease";

/** What the parent sends. */
export type RoundMessage =
  | {
      readonly type: "round";
      readonly round: number;
      readonly mode: "acquire" | "reclaim";
      readonly controlRoot: string;
      readonly workspaceRealPath: string;
      readonly runtimeDirectory: string;
      readonly atMs: number;
    }
  | { readonly type: "cleanup" }
  | { readonly type: "stop" };

/** What a contender answers. */
export type ResultMessage =
  | {
      readonly type: "result";
      readonly round: number;
      readonly index: number;
      readonly won: boolean;
      /** `conflict` or `lost-race`, for a loser. */
      readonly reason: string;
      /** The holder a conflict named, where it named one. */
      readonly holder: { launchId: string; runTokenHash: string } | null;
      readonly detail: string;
    }
  | { readonly type: "cleaned"; readonly released: boolean };

const index = Number(process.argv[2] ?? "0");
let heldLease: Lease | null = null;
let heldLock: ReturnType<typeof createDirectoryLock> | null = null;

function send(message: ResultMessage): void {
  process.send?.(message);
}

async function attempt(message: Extract<RoundMessage, { type: "round" }>): Promise<void> {
  const place = {
    controlRoot: message.controlRoot,
    workspaceRealPath: message.workspaceRealPath,
  };
  const lock = createDirectoryLock({ place, runtimeDirectory: message.runtimeDirectory });
  const token = mintRunToken();
  const launchId = `launch-${message.round}-${index}`;
  const owner = buildOwnerRecord({ launchId, runTokenHash: token.hash });
  const input = {
    runId: `run-${message.round}-${index}`,
    launchId,
    launchNonce: `nonce-${message.round}-${index}`,
  };
  // The barrier. Eight processes leave it inside the same millisecond.
  while (Date.now() < message.atMs) {
    /* spin */
  }
  if (message.mode === "acquire") {
    const result = await lock.acquireHere(owner, input);
    if (result.acquired) {
      heldLease = result.lease;
      heldLock = lock;
      send({
        type: "result",
        round: message.round,
        index,
        won: true,
        reason: "",
        holder: { launchId, runTokenHash: token.hash },
        detail: "",
      });
      return;
    }
    send({
      type: "result",
      round: message.round,
      index,
      won: false,
      reason: result.error === "unknown" ? "unknown" : result.conflict,
      holder: {
        launchId: String(result.holder.launchId),
        runTokenHash: String(result.holder.runTokenHash),
      },
      detail: result.detail,
    });
    return;
  }
  const result = await lock.reclaimHere(owner, input);
  if (result.reclaimed) {
    heldLease = result.lease;
    heldLock = lock;
    send({
      type: "result",
      round: message.round,
      index,
      won: true,
      reason: "",
      holder: { launchId, runTokenHash: token.hash },
      detail: "",
    });
    return;
  }
  send({
    type: "result",
    round: message.round,
    index,
    won: false,
    reason: result.error === "unknown" ? "unknown" : result.reason,
    holder: null,
    detail: result.detail,
  });
}

process.on("message", (raw: unknown) => {
  const message = raw as RoundMessage;
  if (message.type === "round") {
    void attempt(message).catch((error: unknown) => {
      send({
        type: "result",
        round: message.round,
        index,
        won: false,
        reason: "threw",
        holder: null,
        detail: error instanceof Error ? error.message : String(error),
      });
    });
    return;
  }
  if (message.type === "cleanup") {
    // The winner releases only AFTER every contender has attempted: a release
    // inside the round would free the lock for a loser that had not tried
    // yet, and the round would report two winners that never raced.
    const releasing =
      heldLock !== null && heldLease !== null ? heldLock.release(heldLease) : Promise.resolve();
    void releasing.then(() => {
      const released = heldLock !== null;
      heldLease = null;
      heldLock = null;
      send({ type: "cleaned", released });
    });
    return;
  }
  if (message.type === "stop") process.exit(0);
});
