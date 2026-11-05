/**
 * T018 — the contention test CT-122-15: eight contenders, three hundred
 * rounds, for `acquire` on a free lock and for `reclaim` on a stale lock
 * (F122-FR-011, F122-FR-015, F122-SC-002).
 *
 * F122-SC-002: *in the contention test, 8 contenders over 300 rounds, 300 of
 * 300 rounds have exactly one winner, for `acquire` and for `reclaim`.*
 *
 * The eight contenders are eight PROCESSES (`contender.ts`), because the two
 * guarantees under test belong to the kernel and not to this product: a
 * rename onto a non-empty directory fails (research D-1), and of several
 * renames of one directory to one name, one succeeds (research D-4). Eight
 * promises in one event loop would take their turns politely and prove
 * nothing. The round is started with a shared instant and every contender
 * spins until it, so the eight arrive together.
 *
 * Why R2v's measurement matters here: remove-then-create gave SEVERAL winners
 * in 297 of 300 rounds. "300 of 300 with exactly one winner" is therefore not
 * a formality — it is the difference between the shape this feature ships and
 * the shape it rejected.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOMBSTONE_PREFIX, lockPathsOf } from "../../src/lock/paths.ts";
import { probeLock } from "../../src/lock/probe.ts";
import { buildOwnerRecord } from "../../src/lock/owner-record.ts";
import { mintRunToken } from "../../src/procs/run-token.ts";
import type { ResultMessage, RoundMessage } from "./contender.ts";

/** F122-SC-002 — the two numbers of the success criterion. */
export const CONTENDERS = 8 as const;
export const ROUNDS = 300 as const;

/** The two things that are contended (T018). */
const MODES = ["acquire", "reclaim"] as const;

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENDER = join(HERE, "contender.ts");

/** How far ahead of the round the barrier is set. */
const BARRIER_MS = 4;

type Round = {
  readonly winners: number;
  readonly losers: readonly ResultMessage[];
};

test(
  `CT-122-15: ${CONTENDERS} contenders, ${ROUNDS} rounds, exactly one winner per round, ` +
    `for \`acquire\` on a free lock and for \`reclaim\` on a stale lock`,
  { timeout: 20 * 60_000 },
  async () => {
    const controlRoot = mkdtempSync(join(tmpdir(), "ss-contention-c-"));
    const workspaceRealPath = mkdtempSync(join(tmpdir(), "ss-contention-w-"));
    const runtimeDirectory = mkdtempSync(join(tmpdir(), "ss-contention-r-"));
    const place = { controlRoot, workspaceRealPath };
    const paths = lockPathsOf(place);
    const children: ChildProcess[] = [];
    try {
      for (let i = 0; i < CONTENDERS; i++) {
        children.push(fork(CONTENDER, [String(i)], { stdio: ["ignore", "ignore", "pipe", "ipc"] }));
      }

      for (const mode of MODES) {
        let roundsWithExactlyOneWinner = 0;
        const refusalsSeen = new Set<string>();
        for (let round = 0; round < ROUNDS; round++) {
          prepare(mode, place, round);
          const results = await runRound(children, {
            type: "round",
            round,
            mode,
            controlRoot,
            workspaceRealPath,
            runtimeDirectory,
            atMs: Date.now() + BARRIER_MS,
          });
          const outcome = judge(results);
          if (outcome.winners === 1) roundsWithExactlyOneWinner++;
          assert.equal(
            outcome.winners,
            1,
            `round ${round} of \`${mode}\` had ${outcome.winners} winners: ` +
              JSON.stringify(results),
          );
          // F122-FR-011 — every loser of an `acquire` receives a conflict
          // that NAMES THE HOLDER. F122-FR-015 — every loser of a `reclaim`
          // receives `lost-race`.
          for (const loser of outcome.losers) {
            if (loser.type !== "result") continue;
            refusalsSeen.add(loser.reason);
            if (mode === "acquire") {
              assert.equal(loser.reason, "conflict", `round ${round}: ${loser.detail}`);
              assert.notEqual(loser.holder, null, `round ${round}: the conflict names no holder`);
              assert.match(
                String(loser.holder?.launchId),
                /^launch-/,
                `round ${round}: the holder named is not a contender of this round`,
              );
            } else {
              assert.equal(loser.reason, "lost-race", `round ${round}: ${loser.detail}`);
            }
          }
          await cleanUpRound(children);
          sweep(place);
        }
        // F122-SC-002 — 300 of 300.
        assert.equal(
          roundsWithExactlyOneWinner,
          ROUNDS,
          `\`${mode}\`: ${roundsWithExactlyOneWinner} of ${ROUNDS} rounds had one winner`,
        );
        assert.deepEqual(
          [...refusalsSeen].sort(),
          mode === "acquire" ? ["conflict"] : ["lost-race"],
          `\`${mode}\`: the losers were refused for one reason only`,
        );
      }

      // The lock is free at the end, read off the disk and not from a tally.
      sweep(place);
      assert.equal(existsSync(paths.lockDirectory), false);
      assert.equal((await probeLock(place)).result, "free");
    } finally {
      for (const child of children) {
        child.send({ type: "stop" } satisfies RoundMessage);
        child.kill("SIGKILL");
      }
      for (const path of [controlRoot, workspaceRealPath, runtimeDirectory]) {
        rmSync(path, { recursive: true, force: true });
      }
    }
  },
);

/** Put the workspace in the state the round contends over. */
function prepare(
  mode: (typeof MODES)[number],
  place: { controlRoot: string; workspaceRealPath: string },
  round: number,
): void {
  const paths = lockPathsOf(place);
  rmSync(paths.lockDirectory, { recursive: true, force: true });
  if (mode === "acquire") return;
  // A STALE lock: an owner record of a PREVIOUS BOOT. F122-FR-013 — *an owner
  // whose boot identity differs from the present boot MUST count as dead,
  // whatever process now has its pid* — so the probe says `stale-owner-dead`
  // without this test having to kill anything, and the round is about the
  // rename and nothing else. The launch is unique per round, so the tombstone
  // of one round never stands in the way of the next.
  const stale = {
    ...buildOwnerRecord({
      launchId: `stale-${round}`,
      runTokenHash: mintRunToken().hash,
    }),
    bootId: `a-boot-that-is-over-${round}`,
  };
  mkdirSync(paths.lockDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(paths.ownerRecordFile, JSON.stringify(stale, null, 2) + "\n", { mode: 0o600 });
}

/** Remove what a round left behind, so the next one starts from the same place. */
function sweep(place: { controlRoot: string; workspaceRealPath: string }): void {
  const paths = lockPathsOf(place);
  rmSync(paths.lockDirectory, { recursive: true, force: true });
  for (const name of readdirSync(paths.parentDirectory)) {
    if (name.startsWith(TOMBSTONE_PREFIX)) {
      rmSync(join(paths.parentDirectory, name), { recursive: true, force: true });
    }
  }
}

/** Send one round to every contender and collect the eight answers. */
function runRound(
  children: readonly ChildProcess[],
  message: RoundMessage,
): Promise<readonly ResultMessage[]> {
  return collect(children, message, "result");
}

/** Tell the winner to release, and wait until it has. */
function cleanUpRound(children: readonly ChildProcess[]): Promise<readonly ResultMessage[]> {
  return collect(children, { type: "cleanup" }, "cleaned");
}

function collect(
  children: readonly ChildProcess[],
  message: RoundMessage,
  waitFor: ResultMessage["type"],
): Promise<readonly ResultMessage[]> {
  return new Promise((settle, fail) => {
    const answers: ResultMessage[] = [];
    const listeners: (() => void)[] = [];
    const timer = setTimeout(() => {
      for (const off of listeners) off();
      fail(
        new Error(
          `only ${answers.length} of ${children.length} contenders answered ` +
            `\`${message.type}\` inside the limit`,
        ),
      );
    }, 120_000);
    for (const child of children) {
      const onMessage = (raw: unknown): void => {
        const answer = raw as ResultMessage;
        if (answer.type !== waitFor) return;
        child.removeListener("message", onMessage);
        answers.push(answer);
        if (answers.length === children.length) {
          clearTimeout(timer);
          settle(Object.freeze(answers));
        }
      };
      listeners.push(() => child.removeListener("message", onMessage));
      child.on("message", onMessage);
    }
    for (const child of children) child.send(message);
  });
}

/** How many won, and who did not. */
function judge(results: readonly ResultMessage[]): Round {
  const named = results.filter(
    (r): r is Extract<ResultMessage, { type: "result" }> => r.type === "result",
  );
  return {
    winners: named.filter((r) => r.won).length,
    losers: named.filter((r) => !r.won),
  };
}
