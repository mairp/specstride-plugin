// CT-125-15 (T025) — the three stops (F125-FR-021): the polite stop sends
// the interrupt, the terminate stop the termination, the kill stop the kill,
// all aimed at the process group of the call; the polite-stop signal is the
// interrupt; and exit 143 is the stop of the run, never a provider failure
// by itself.
// Level: integration, effect witness — a real process in its own group is
// stopped and the resulting exit code is observed on an independent read
// path (the child's exit event), not from the mutation's return value.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  POLITE_STOP_SIGNAL,
  ProcessGroupRefusedError,
  STOP_KINDS,
  TERMINATED_EXIT_CODE,
  exitIsProviderFailure,
  stopCall,
} from "../../src/stop.ts";

describe("CT-125-15 — the three stops and the polite-stop signal", () => {
  it("the closed set of the stops is polite, terminate, kill", () => {
    assert.deepEqual([...STOP_KINDS], ["polite", "terminate", "kill"]);
    assert.equal(POLITE_STOP_SIGNAL, "SIGINT");
  });

  it("each stop sends its own signal to the group, through the injectable sender", () => {
    const sent: Array<[number, NodeJS.Signals]> = [];
    const send = (pgid: number, signal: NodeJS.Signals): void => {
      sent.push([pgid, signal]);
    };
    assert.equal(stopCall(4242, "polite", { signal: send }), "SIGINT");
    assert.equal(stopCall(4242, "terminate", { signal: send }), "SIGTERM");
    assert.equal(stopCall(4242, "kill", { signal: send }), "SIGKILL");
    assert.deepEqual(sent, [
      [4242, "SIGINT"],
      [4242, "SIGTERM"],
      [4242, "SIGKILL"],
    ]);
  });

  it("a pgid that is not an integer above one is refused (owner ruling 2026-10-02)", () => {
    for (const pgid of [0, 1, -5, 2.5, Number.NaN]) {
      assert.throws(
        () => stopCall(pgid, "polite", { signal: () => {} }),
        ProcessGroupRefusedError,
        `pgid ${pgid}`,
      );
    }
  });

  it("exit 143 — the terminate stop — is never a provider failure by itself", () => {
    assert.equal(TERMINATED_EXIT_CODE, 143);
    assert.equal(exitIsProviderFailure({ exitCode: 143 }), false);
    assert.equal(exitIsProviderFailure({ exitCode: null, signalName: "SIGTERM" }), false);
    assert.equal(exitIsProviderFailure({ exitCode: null, signalName: "SIGINT" }), false);
    assert.equal(exitIsProviderFailure({ exitCode: null, signalName: "SIGKILL" }), false);
    // A genuine exit of the CLI is a provider fact.
    assert.equal(exitIsProviderFailure({ exitCode: 1 }), true);
  });

  it("effect witness: the terminate stop of a real process group ends it with exit 143", async () => {
    // The child converts the signal it receives into the conventional exit
    // code a shell would report, so the numeric code is observable.
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM', () => process.exit(143)); " +
          "console.log('ready'); setInterval(() => {}, 1000);",
      ],
      { detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    // Wait until the child has installed its handler, so the stop reaches a
    // running process, not one still booting.
    await new Promise<void>((resolve) =>
      child.stdout!.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("ready")) resolve();
      }),
    );
    const pgid = child.pid!;
    const signal = stopCall(pgid, "terminate");
    assert.equal(signal, "SIGTERM");
    const outcome = await new Promise<{ code: number | null; signal: string | null }>((resolve) =>
      child.on("exit", (code, sig) => resolve({ code, signal: sig })),
    );
    // The observed effect, read from the child's exit, not from stopCall:
    // 128 + 15 = 143, the stop of the run.
    assert.equal(outcome.code, TERMINATED_EXIT_CODE);
    assert.equal(exitIsProviderFailure({ exitCode: outcome.code }), false);
  });

  it("effect witness: the polite stop ends a real process group by the interrupt", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.on('SIGINT', () => process.exit(130)); " +
          "console.log('ready'); setInterval(() => {}, 1000);",
      ],
      { detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    await new Promise<void>((resolve) =>
      child.stdout!.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("ready")) resolve();
      }),
    );
    const signal = stopCall(child.pid!, "polite");
    assert.equal(signal, POLITE_STOP_SIGNAL);
    const outcome = await new Promise<{ code: number | null }>((resolve) =>
      child.on("exit", (code) => resolve({ code })),
    );
    // The handler ran: the polite stop let the process end itself, which is
    // the pass ending by its own choice — the polite stop of the port, not
    // a provider fact (the interrupt of the stop, F125-FR-021).
    assert.equal(outcome.code, 130);
  });
});
