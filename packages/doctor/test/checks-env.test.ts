/**
 * T024 (feature 112) — CT-112-111 (F112-FR-011; DV-071): the checks of the
 * groups `env` and `cli`.
 *
 * The runtime floor; the platform (Windows and WSL unvalidated, a warning,
 * never a failure); the platform tools as the EVIDENCE of `env.os` (DV-071:
 * one id each instead of separate checks); the permissions of state
 * directories; the writable control root with free space; the protocol
 * mismatch; the differing product versions of the engine starts; and every
 * statement about macOS marked unverified.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  envNodeCheck,
  envOsCheck,
  envGitCheck,
  envStateDirPermsCheck,
  envTmpWritableCheck,
  cliVersionCheck,
  readableByOthers,
  NODE_FLOOR_MAJOR,
} from "../src/checks/env.ts";
import { MACOS_UNVERIFIED } from "../src/checks/read.ts";
import { severityOf, findingOf } from "./helpers.ts";

test("CT-112-111: the runtime floor — fail below 22, warn off an LTS line, ok on it", async () => {
  assert.equal(await severityOf(envNodeCheck, [["env.node.version", "18.20.1"]]), "fail");
  assert.equal(await severityOf(envNodeCheck, [["env.node.version", "21.7.3"]]), "fail");
  assert.equal(NODE_FLOOR_MAJOR, 22);
  // An odd major is not a long-term-support line: a warning, never a failure.
  assert.equal(await severityOf(envNodeCheck, [["env.node.version", "23.5.0"]]), "warn");
  assert.equal(await severityOf(envNodeCheck, [["env.node.version", "22.23.2"]]), "ok");
  // A version the probe cannot read is a failure.
  assert.equal(await severityOf(envNodeCheck, [["env.node.version", ""]]), "fail");
});

test("CT-112-111: the platform — Linux and macOS ok, Windows and WSL a warning", async () => {
  assert.equal(await severityOf(envOsCheck, [["env.os.platform", "linux"]]), "ok");
  assert.equal(await severityOf(envOsCheck, [["env.os.platform", "darwin"]]), "ok");
  // Unvalidated, as a warning, never a failure (F112-FR-011).
  assert.equal(await severityOf(envOsCheck, [["env.os.platform", "win32"]]), "warn");
  assert.equal(await severityOf(envOsCheck, [["env.os.platform", "wsl"]]), "warn");
});

test("CT-112-111: the platform tools are evidence of env.os, each probed (DV-071)", async () => {
  const osCheck = await findingOf(envOsCheck, [
    ["env.os.tools", { git: true, ps: true, pgrep: true, keychain: false }],
  ]);
  assert.match(osCheck.message, /git, ps, pgrep present/);
  assert.equal(
    await severityOf(envOsCheck, [
      ["env.os.tools", { git: false, ps: true, pgrep: true, keychain: true }],
    ]),
    "info",
  );
  // The evidence names the tool that is missing.
  const missing = await findingOf(envOsCheck, [
    ["env.os.tools", { git: false, ps: true, pgrep: true, keychain: true }],
  ]);
  // redactEvidence stringifies an array value.
  assert.equal(missing.evidence["missingTools"], "[object]");
});

test("CT-112-111: every statement about macOS is marked unverified", async () => {
  const osCheck = await findingOf(envOsCheck, [["env.os.platform", "darwin"]]);
  assert.equal(osCheck.evidence["statement"], MACOS_UNVERIFIED);
  const linux = await findingOf(envOsCheck, [["env.os.platform", "linux"]]);
  assert.equal(linux.evidence["statement"], undefined);
});

test("CT-112-111: state directory permissions — warn when others can read", async () => {
  assert.equal(readableByOthers(0o755).world, true);
  assert.equal(readableByOthers(0o700).world, false);
  assert.equal(await severityOf(envStateDirPermsCheck, [["env.stateDir.path", "/tmp/none"]]), "ok");
  const stat = (_path: string) => ({ size: 10, mode: 0o750 });
  assert.equal(
    await severityOf(envStateDirPermsCheck, [["env.stateDir.path", "/tmp/state"]], {
      files: { stat },
    }),
    "warn",
  );
  assert.equal(
    await severityOf(envStateDirPermsCheck, [["env.stateDir.path", "/tmp/state"]], {
      files: { stat: (_p: string) => ({ size: 10, mode: 0o700 }) },
    }),
    "ok",
  );
});

test("CT-112-111: the control root — fail when not writable, warn under 1 GiB free", async () => {
  assert.equal(
    await severityOf(envTmpWritableCheck, [
      ["env.controlRoot", { writable: false, freeBytes: 9e9 }],
    ]),
    "fail",
  );
  assert.equal(
    await severityOf(envTmpWritableCheck, [
      ["env.controlRoot", { writable: true, freeBytes: 5e8 }],
    ]),
    "warn",
  );
  assert.equal(
    await severityOf(envTmpWritableCheck, [
      ["env.controlRoot", { writable: true, freeBytes: 5e10 }],
    ]),
    "ok",
  );
});

test("CT-112-111: the protocol mismatch fails; differing product versions warn", async () => {
  assert.equal(
    await severityOf(cliVersionCheck, [
      ["cli.protocol", 2],
      ["host.protocolRange", { from: 1, to: 1 }],
    ]),
    "fail",
  );
  assert.equal(
    await severityOf(cliVersionCheck, [
      ["cli.protocol", 1],
      ["host.protocolRange", { from: 1, to: 1 }],
    ]),
    "ok",
  );
  // The engine starts of a run carry different product versions: a warning.
  const mixed = await severityOf(
    cliVersionCheck,
    [["cli.protocol", 1]],
    // the run records: two engine starts with different product versions
    {
      runs: [
        { kind: "engine-start", productVersion: "1.2.0" },
        { kind: "engine-start", productVersion: "1.3.0" },
      ],
    } as never,
  );
  assert.equal(mixed, "warn");
  const same = await severityOf(cliVersionCheck, [["cli.protocol", 1]], {
    runs: [
      { kind: "engine-start", productVersion: "1.2.0" },
      { kind: "engine-start", productVersion: "1.2.0" },
    ],
  } as never);
  assert.equal(same, "ok");
});

test("CT-112-111: git missing is a warning through the injected subprocess", async () => {
  assert.equal(await severityOf(envGitCheck, [["env.git.present", false]]), "warn");
  assert.equal(await severityOf(envGitCheck, [["env.git.present", true]]), "ok");
  // Without fixture data the probe goes through the bag's subprocess runner.
  assert.equal(
    await severityOf(envGitCheck, [], {
      subprocess: {
        run: () =>
          Promise.resolve({
            code: 0,
            signal: null,
            stdout: "",
            stderr: "",
            timedOut: false,
            truncated: false,
          }),
      },
    }),
    "ok",
  );
});
