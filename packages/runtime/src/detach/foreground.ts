/**
 * T041 — the strategy `foreground` of EP-17 (F122-FR-002, F122-FR-003,
 * F122-FR-041; annex F §F.6).
 *
 * It starts nothing. The consumer starts the runtime root in a terminal of
 * their own, so this strategy's whole job is the two things the task names:
 * **print the command line of the runtime entry**, and **wait for the
 * handshake**.
 *
 * Why it exists: the spike may find, on some host, that `spawn-detached` does
 * not survive the end of a session. F122-FR-002 says *the product MUST work
 * with the strategy `foreground` wherever `spawn-detached` does not survive*,
 * and *with `foreground` the lock, the lease, the launch record and the
 * handshake MUST be the same as with `spawn-detached`*. They are the same here
 * because this module touches none of them: the root it does not start takes
 * the lock and writes the lease exactly as the detached root would, and the
 * handshake confirms readiness by the lease that carries the launch nonce,
 * *whatever the detach strategy* (F100-FR-160).
 *
 * The one difference §F.6 allows is leadership of a process session: the root
 * runs in the consumer's terminal, in the consumer's session, so
 * `sessionLeader` is false and `describe` claims to survive nothing.
 *
 * HOW THE WAIT WORKS. `start` resolves when a lease carrying this launch's
 * nonce appears, and the identity it returns is read out of THAT lease's owner
 * record — so the pid this strategy reports is the pid of the process the
 * consumer actually started, observed, and never a guess or a zero. Where no
 * lease appears inside the handshake limit, `start` throws the error
 * `not-ready` of §F.6, and the message names `foreground`, because a consumer
 * who is already using `foreground` needs to be told that the root they were
 * asked to start never reported in — not sent to another strategy.
 */
import {
  STRATEGY_WITHOUT_DETACHING,
  type AvailableResult,
  type DetachStrategy,
  type StartInput,
  type StartedProcess,
  type StrategyDescription,
} from "@specstride/contracts/ep/detach";
import type { Lease } from "@specstride/contracts/records/lease";
import type { OwnerRecord } from "../lock/owner-record.ts";
import { HANDSHAKE_LIMIT_SECONDS } from "../lease/timing.ts";

/** The requirements this strategy carries. */
export const FOREGROUND_REQUIREMENTS = ["F122-FR-002", "F122-FR-003", "F122-FR-041"] as const;

/** The id of the strategy; §F.6 names it as the way to run without detaching. */
export const STRATEGY_ID = STRATEGY_WITHOUT_DETACHING;

/** F122-FR-002 — with `foreground` the root is not the leader of a new session. */
export const THE_ROOT_LEADS_A_SESSION_OF_ITS_OWN = false as const;

/**
 * F122-FR-003 — what `foreground` survives: nothing. The root is a child of
 * the consumer's terminal, so the end of the parent ends it, and no Wave 1
 * strategy claims `reboot` anyway.
 */
export const SURVIVES = Object.freeze({
  endOfTheParent: false,
  endOfTheHostSession: false,
  reboot: false,
});

/** F122-FR-002 — the four things that are the same as with `spawn-detached`. */
export const THE_SAME_AS_SPAWN_DETACHED = [
  "the lock",
  "the lease",
  "the launch record",
  "the handshake",
] as const;

/** This strategy starts no process; the consumer does. */
export const STARTS_A_PROCESS = false as const;

/**
 * The line a consumer is asked to run. A fixed argument list, quoted so that it
 * can be pasted: a member that holds a space, a quote or a shell character is
 * wrapped in single quotes with its own quotes escaped. Nothing of the
 * environment is printed — the run token is in it, and a token must never
 * reach a terminal (F100-FR-052).
 */
export function commandLineOf(runtimeEntry: readonly string[]): string {
  return runtimeEntry.map(quoteForAShell).join(" ");
}

const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

function quoteForAShell(word: string): string {
  if (word.length === 0) return "''";
  if (SAFE.test(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/** The whole instruction, as the consumer reads it. */
export function instructionFor(runtimeEntry: readonly string[]): string {
  return (
    `[SPECSTRIDE-FOREGROUND] start the runtime root in a terminal of your own:\n` +
    `  ${commandLineOf(runtimeEntry)}\n` +
    `The launch waits for the lease of this launch and no longer.`
  );
}

/** §F.6 — the error `not-ready`: the handshake did not complete in time. */
export class DetachNotReadyError extends Error {
  readonly error = "not-ready" as const;
  readonly refusal = "detach-not-ready" as const;
  /** F122-FR-005, F122-FR-041 — the message names `foreground`. */
  readonly namesTheStrategy = STRATEGY_ID;
  readonly waitedSeconds: number;
  constructor(waitedSeconds: number) {
    super(
      `no lease carrying the nonce of this launch appeared within ${waitedSeconds} seconds, so ` +
        `the handshake did not complete. With the strategy \`${STRATEGY_ID}\` the runtime root ` +
        `is started by you: check the terminal you started it in`,
    );
    this.name = "DetachNotReadyError";
    this.waitedSeconds = waitedSeconds;
  }
}

/** What the strategy is built over, so that a test waits for nothing. */
export type ForegroundContext = {
  /** Where the instruction is printed. */
  readonly print?: ((line: string) => void) | undefined;
  /**
   * The wait for the handshake: resolves with the lease that carries the nonce,
   * or `null` where none appeared inside the limit. The CLI hands in the same
   * wait it uses for step 4, so there is one wait and not two.
   */
  readonly waitForTheLease: (launchNonce: string) => Promise<Lease | null>;
  readonly handshakeLimitSeconds?: number | undefined;
};

/** Build the strategy. */
export function createForegroundStrategy(context: ForegroundContext): DetachStrategy {
  const print = context.print ?? ((line: string): void => void process.stdout.write(line + "\n"));
  const limit = context.handshakeLimitSeconds ?? HANDSHAKE_LIMIT_SECONDS;
  return Object.freeze({
    available(): AvailableResult {
      // It needs nothing of the platform: there is nothing that can be absent.
      return Object.freeze({
        available: true,
        reason:
          `\`${STRATEGY_ID}\` starts no process: you start the runtime root in a terminal of ` +
          `your own, and the launch waits for its lease`,
      });
    },

    async start(input: StartInput): Promise<StartedProcess> {
      if (input.runtimeEntry.length === 0) {
        throw new DetachNotReadyError(0);
      }
      // 1 — print the command line of the runtime entry.
      print(instructionFor(input.runtimeEntry));
      // 2 — wait for the handshake, and no longer.
      const lease = await context.waitForTheLease(input.launchNonce);
      if (lease === null) throw new DetachNotReadyError(limit);
      const owner = lease.owner as unknown as OwnerRecord;
      return Object.freeze({
        // Observed, from the owner record the root itself wrote.
        pid: Number(owner.pid),
        startTime: String(owner.startTime),
        sessionLeader: THE_ROOT_LEADS_A_SESSION_OF_ITS_OWN,
      });
    },

    describe(): StrategyDescription {
      return Object.freeze({ id: STRATEGY_ID, survives: SURVIVES });
    },
  });
}
