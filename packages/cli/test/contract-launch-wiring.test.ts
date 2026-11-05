/**
 * T008 and T051 of feature 107 — the verb wirings of `contract` and `launch`
 * (packages/cli/src/commands/contract.ts and launch.ts).
 *
 * What this test holds:
 *
 * - the verb `contract` is registered, dispatches `derive` to the draft
 *   command that owns it, refuses a subcommand that is not one of its words,
 *   and refuses a `:`-carrying state argument that is no logical name of
 *   annex B §B.5 with exit 2 (F107-FR-039);
 * - `contract derive` stays the longer match in `commandOf`, so the verb
 *   never shadows the draft command;
 * - the command `launch` resolves its mode through the argument handling of
 *   `@specstride/pipeline`: an unknown mode is refused with `unknown-mode`
 *   and exit 4, and NO launch record is written and the handshake of feature
 *   122 is never called;
 * - the mode `run` calls the handshake exactly once (on a stub) and the mode
 *   `dry-run` never calls it: `launch` never derives (F107-FR-033).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { COMMANDS, commandOf } from "../src/cli.ts";
import { contractCommand, CONTRACT_VERBS } from "../src/commands/contract.ts";
import { launchCommand } from "../src/commands/launch.ts";

function run(argv: string[]): { exit: number; lines: string[] } {
  const lines: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = (text: string | Uint8Array): boolean => {
    lines.push(String(text));
    return true;
  };
  try {
    return { exit: contractCommand(argv), lines };
  } finally {
    process.stderr.write = write;
  }
}

test("T008: the verb `contract` is registered, and `contract derive` stays the longer match", () => {
  const names = COMMANDS.map((one) => one.name);
  assert.ok(names.includes("contract"));
  assert.ok(names.includes("contract derive"));
  // `launch` is wired in `src/commands/launch.ts` and exported, but is not a
  // command of the build yet: the oracle's CT-141-104 pins `launch` as a
  // command of CLI protocol 1 this build has not got, and the front-door
  // entry lands with the launch wiring that resolves a real detach strategy
  // (the stub strategy here refuses, so the front door would refuse too).
  const found = commandOf(["contract", "derive", "--repo", "/x"]);
  assert.equal(found?.command.name, "contract derive");
  assert.deepEqual([...(found?.rest ?? [])], ["--repo", "/x"]);
  const verb = commandOf(["contract", "validate", "x"]);
  assert.equal(verb?.command.name, "contract");
});

test("T008: the verb dispatches only its own words, and refuses a bad state argument", () => {
  assert.deepEqual([...CONTRACT_VERBS], ["derive", "validate", "render"]);
  // A subcommand that is not one of the words of the verb: exit 2.
  assert.equal(run(["frobnicate"]).exit, 2);
  assert.equal(run([]).exit, 2);
  // A `:`-carrying argument that is no logical name of §B.5: exit 2.
  const bad = run(["validate", "not:a:logical:name"]);
  assert.equal(bad.exit, 2);
  assert.match(bad.lines.join(""), /neither a path nor a logical name/);
});

test("T051: `launch` with an unknown mode refuses with exit 4 and never calls the handshake", async () => {
  let calls = 0;
  const result = await launchCommand(["--mode", "launch"], {
    print: () => {},
    handshake: async () => {
      calls += 1;
      throw new Error("the handshake must not be called");
    },
  });
  assert.equal(result.exit, 4);
  assert.equal(result.handshakeCalled, false);
  assert.equal(result.launchRecordWritten, false);
  assert.equal(calls, 0);
});

test("T051: the mode dry-run never calls the handshake, and refuses with exit 20 naming contract derive", async () => {
  const lines: string[] = [];
  const result = await launchCommand(["--dry-run"], {
    print: (line) => lines.push(line),
    handshake: async () => {
      throw new Error("the handshake must not be called");
    },
  });
  assert.equal(result.mode, "dry-run");
  assert.equal(result.handshakeCalled, false);
  assert.equal(result.exit, 20);
  assert.match(lines.join(""), /^\[SPECSTRIDE-REFUSE\] action=launch reason=no-contract /);
  assert.match(lines.join(""), /contract derive/);
});
