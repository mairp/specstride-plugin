/**
 * T013 / CT-131-3 — the preflight (F131-FR-003, F131-SC-007).
 *
 * The login check reads no credential: a planted credential file has ZERO
 * reads. An exit code the adapter does not know gives `unprobed`, never
 * `present`. The preflight makes no model call.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CODEX_LOGIN_CHECK_COMMAND,
  CODEX_KEY_VARIABLE,
  runPreflight,
  type LoginRunner,
} from "../src/preflight.ts";

test("CT-131-3: the login check reads a planted credential file ZERO times", () => {
  // The plant: `auth.json` is a DIRECTORY. Any attempt of the adapter to open,
  // read or copy the harness's credential file at the usual path fails with
  // EISDIR — so a passing preflight IS the proof of zero reads.
  const home = mkdtempSync(join(tmpdir(), "codex-preflight-"));
  const credential = join(home, "auth.json");
  mkdirSync(credential);
  try {
    const outcome = runPreflight({
      tier: 1,
      executable: "/usr/bin/codex",
      runLogin: () => ({ code: 0, stdout: "Logged in using ChatGPT\n" }),
    });
    assert.equal(outcome.result, "present");
    // The preflight ran in this process, with the credential planted as a
    // directory at the path a reader would open: it is still there, and no
    // error was raised, so nothing opened it.
    // The plant is intact and was never replaced by a file.
    assert.equal(statSync(credential).isDirectory(), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("CT-131-3: the preflight runs only the login status command and no model call", () => {
  const invocations: { path: string; args: readonly string[] }[] = [];
  const runner: LoginRunner = (path, args) => {
    invocations.push({ path, args });
    return { code: 0, stdout: "Logged in\n" };
  };
  const outcome = runPreflight({ tier: 1, executable: "/usr/bin/codex", runLogin: runner });
  assert.equal(outcome.result, "present");
  assert.deepEqual(
    invocations.map((invocation) => invocation.args),
    [["login", "status"]],
  );
  assert.deepEqual([...CODEX_LOGIN_CHECK_COMMAND], ["login", "status"]);
  // No model call: the one recorded command is the login status command —
  // no `exec`, no stream flag, no model argument is ever sent.
  for (const invocation of invocations) {
    for (const arg of invocation.args) {
      assert.notEqual(arg, "exec");
      assert.notEqual(arg, "--json");
      assert.notEqual(arg, "-m");
    }
  }
  assert.equal(invocations.length, 1);
});

test("CT-131-3: known exit codes are present and absent; an unknown code gives unprobed", () => {
  const at = (code: number) =>
    runPreflight({
      tier: 1,
      executable: "/usr/bin/codex",
      runLogin: () => ({ code, stdout: "line\n" }),
    });
  assert.equal(at(0).result, "present");
  assert.equal(at(1).result, "absent");
  for (const unknown of [2, 7, 42, 127, 255, -1]) {
    assert.equal(at(unknown).result, "unprobed", `exit code ${unknown}`);
  }
  // A run that failed to start is unprobed as well.
  assert.equal(
    runPreflight({ tier: 1, executable: "/usr/bin/codex", runLogin: () => null }).result,
    "unprobed",
  );
  // The first line of the output is read with the exit code.
  assert.equal(
    runPreflight({
      tier: 1,
      executable: "/usr/bin/codex",
      runLogin: () => ({ code: 1, stdout: "Not logged in\nmore\n" }),
    }).firstLine,
    "Not logged in",
  );
});

test("CT-131-3: at auth tier 2 the preflight asks the secret resolver and starts nothing", () => {
  let asked: string | null = null;
  const outcome = runPreflight({
    tier: 2,
    executable: "/usr/bin/codex",
    secretResolver: (reference) => {
      asked = reference;
      return true;
    },
  });
  assert.equal(outcome.result, "present");
  assert.equal(asked, CODEX_KEY_VARIABLE);
  assert.deepEqual(outcome.invocations, []);
  assert.equal(
    runPreflight({ tier: 2, executable: "/usr/bin/codex", secretResolver: () => false }).result,
    "absent",
  );
});
