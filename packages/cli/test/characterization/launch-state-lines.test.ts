/**
 * T074 — the characterization of the lines `launch` and the `state` commands
 * print (F122-FR-006, F122-FR-036; annex G, §G.3).
 *
 *   - `launch` prints ONE line, `[SPECSTRIDE-LAUNCH]`, with the keys `run`
 *     and `state`;
 *   - a refusal prints ONE line, `[SPECSTRIDE-REFUSE]`, with the keys
 *     `action`, `reason` and `next` — and never the label of a command that
 *     succeeded;
 *   - the `state` commands print `[SPECSTRIDE-STATE]` only when they
 *     succeed, and `[SPECSTRIDE-REFUSE]` when they refuse;
 *   - under the `parity` profile nothing is printed at all.
 *
 * The command is driven with an injected `print`, so the test reads the lines
 * the command would have written to the standard output, byte for byte.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { printLine } from "@specstride/contracts/grammar/line-keys";
import {
  LAUNCH_LABEL,
  PROFILE_THAT_PRINTS_NO_LINE,
  runLaunchHandshake,
} from "../../../cli/src/commands/launch-handshake.ts";
import {
  REFUSE_LABEL as STATE_REFUSE_LABEL,
  STATE_LABEL,
  runStateCommand,
  type StateCommandPort,
  type StateOutcome,
} from "../../../cli/src/commands/state.ts";

/** A strategy whose steps never run: the kinds below refuse before step 1. */
const neverStrategy = {
  available: () => ({ available: true, reason: "available" }),
  async start(): Promise<never> {
    throw new Error("the strategy is never called here");
  },
  describe: () => ({
    id: "spawn-detached",
    survives: { parentEnd: true, sessionEnd: true, reboot: false },
  }),
} as never;

function handshakeInput(printed: string[], over: { profile?: string } = {}) {
  return {
    place: { controlRoot: "/tmp/t074-none", workspaceRealPath: "/tmp/t074-none" },
    slug: "t074",
    launchId: "launch-t074",
    runId: "run-t074",
    workspaceId: "ws-t074",
    requestKind: "a-kind-no-table-names",
    request: { pipelineId: "p", bundleHash: "sha256:x" },
    engineExecutable: { path: process.execPath, hash: "sha256:e" },
    strategy: neverStrategy,
    runtimeEntry: [process.execPath],
    environmentAllowList: ["PATH"],
    runtimeLogLogicalName: "launch:l:runtime-log",
    launchNonce: "nonce-t074",
    handshakeLimitSeconds: 5,
    ...(over.profile === undefined ? {} : { profile: over.profile }),
    print: (line: string): void => void printed.push(line),
  } as Parameters<typeof runLaunchHandshake>[0];
}

test("T074: launch prints [SPECSTRIDE-LAUNCH] with run and state, and a refusal prints [SPECSTRIDE-REFUSE] with action, reason and next", async () => {
  // The line the launch prints on success, as the step 4 of the handshake
  // builds it — with the table of §G.3 checking the keys.
  const startedLine = printLine(LAUNCH_LABEL, { run: "run-t074", state: "running" });
  assert.match(startedLine, /^\[SPECSTRIDE-LAUNCH\]/);
  assert.match(startedLine, /\brun=run-t074\b/);
  assert.match(startedLine, /\bstate=running\b/);
  assert.doesNotMatch(startedLine, /\baction=/);

  const printed: string[] = [];
  const refused = await runLaunchHandshake(handshakeInput(printed));
  assert.equal(refused.outcome, "refused");
  assert.equal(printed.length, 1, "a refusal is ONE line, and nothing else");
  assert.match(printed[0] ?? "", /^\[SPECSTRIDE-REFUSE\]/);
  assert.match(printed[0] ?? "", /\baction=launch\b/);
  assert.match(printed[0] ?? "", /\breason=/);
  assert.match(printed[0] ?? "", /\bnext=/);
  assert.doesNotMatch(printed[0] ?? "", /\[SPECSTRIDE-LAUNCH\]/);
  // The label of the success is never printed by a refused launch.
  assert.equal(refused.line, printed[0]);
});

test("T074: the state commands print [SPECSTRIDE-STATE] only on success, and [SPECSTRIDE-REFUSE] on a refusal", async () => {
  // A port that mirrors what the runtime's implementation does with the
  // `print` handed to it: it prints the state line only when it succeeds.
  function portOf(over: { readonly exit: number }): StateCommandPort {
    const outcome = (line: string): StateOutcome => ({
      exit: over.exit,
      line: over.exit === 0 ? line : "",
      feature: "t074",
      approvals: 1,
      wroteNothing: false,
      json: {},
    });
    return {
      async export(input) {
        if (over.exit !== 0)
          return printLine(STATE_REFUSE_LABEL, {
            action: "export",
            reason: "no-state",
            next: "adopt first",
          }) === ""
            ? ({} as never)
            : ({} as never);
        const line = printLine(STATE_LABEL, {
          action: "export",
          feature: input.slug,
          approvals: 1,
          out: input.out,
        });
        input.print?.(line);
        return outcome(line);
      },
      async import() {
        throw new Error("not driven here");
      },
      async adopt() {
        throw new Error("not driven here");
      },
    };
  }

  // Success: one `[SPECSTRIDE-STATE]` line, and never `[SPECSTRIDE-REFUSE]`.
  const printed: string[] = [];
  const ok = await runStateCommand(["export", "--feature", "t074", "--out", "/tmp/t074/out.json"], {
    place: {},
    commands: portOf({ exit: 0 }),
    print: (l) => void printed.push(l),
  });
  assert.equal(ok.exit, 0);
  assert.equal(printed.length, 1);
  assert.match(printed[0] ?? "", /^\[SPECSTRIDE-STATE\]/);
  assert.match(printed[0] ?? "", /\baction=export\b/);
  assert.match(printed[0] ?? "", /\bfeature=t074\b/);
  assert.doesNotMatch(printed[0] ?? "", /SPECSTRIDE-REFUSE/);

  // A usage refusal is the CLI's own line, with the three keys.
  const refusedPrints: string[] = [];
  const bad = await runStateCommand(
    ["export", "--feature"], // a flag without its value
    { place: {}, commands: portOf({ exit: 0 }), print: (l) => void refusedPrints.push(l) },
  );
  assert.equal(bad.exit, 3);
  assert.equal(refusedPrints.length, 1);
  assert.match(refusedPrints[0] ?? "", /^\[SPECSTRIDE-REFUSE\]/);
  assert.match(refusedPrints[0] ?? "", /\baction=state-export\b/);
  assert.match(refusedPrints[0] ?? "", /\breason=usage\b/);
  assert.match(refusedPrints[0] ?? "", /\bnext=/);
  assert.equal(bad.outcome, null);
});

test("T074: under the parity profile nothing is printed, by launch or by state", async () => {
  const quietLaunch: string[] = [];
  const outcome = await runLaunchHandshake(
    handshakeInput(quietLaunch, { profile: PROFILE_THAT_PRINTS_NO_LINE }),
  );
  assert.equal(outcome.outcome, "refused");
  assert.deepEqual(quietLaunch, [], "the parity profile prints no launch line");
  assert.equal(outcome.line, "", "the outcome carries no line under parity");

  const quietState: string[] = [];
  await runStateCommand(["export", "--feature", "t074", "--out", "/tmp/t074/out.json"], {
    place: {},
    commands: {
      async export(input) {
        // The port, like the runtime's own implementation, keeps quiet
        // under the profile that prints no line.
        if (input.profile !== PROFILE_THAT_PRINTS_NO_LINE) {
          input.print?.(
            printLine(STATE_LABEL, { action: "export", feature: "t074", approvals: 0 }),
          );
        }
        return {
          exit: 0,
          line: "relayed",
          feature: "t074",
          approvals: 0,
          wroteNothing: false,
          json: {},
        };
      },
      async import() {
        throw new Error("not driven");
      },
      async adopt() {
        throw new Error("not driven");
      },
    } as StateCommandPort,
    profile: PROFILE_THAT_PRINTS_NO_LINE,
    print: (l) => void quietState.push(l),
  });
  assert.deepEqual(quietState, [], "the parity profile prints no state line");
});
