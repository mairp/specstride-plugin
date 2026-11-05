/**
 * T022 / CT-131-15 — the environment of a call (F131-FR-015, F131-SC-007).
 *
 * The environment is an allow-list; no other provider key of the consumer
 * reaches it; the key of the critic is never in the environment of the
 * proposer; a key never appears in an argument list.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CODEX_BASE_ALLOW_LIST,
  CODEX_CREDENTIAL_VARIABLES,
  CODEX_ENV_ALLOW,
  CODEX_KEY_VARIABLE,
  argumentListHoldsSecret,
  codexAllowList,
  codexCallEnvironment,
} from "../src/environment.ts";

const KEY = "sk-test-critic-key-value";
const OTHER_KEY = "sk-some-other-provider-key";

const ENV = {
  PATH: "/usr/bin:/bin",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  HOME: "/home/consumer",
  CODEX_HOME: "/home/consumer/.codex",
  [CODEX_KEY_VARIABLE]: KEY,
  ANTHROPIC_API_KEY: OTHER_KEY,
  EDITOR: "vi",
};

test("CT-131-15: the environment of a call is the allow-list and nothing else", () => {
  const environment = codexCallEnvironment({ role: "proposer", processEnv: ENV });
  assert.deepEqual(Object.keys(environment).sort(), [
    "CODEX_HOME",
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
  ]);
  assert.equal(environment.HOME, "/home/consumer");
  assert.equal(environment.CODEX_HOME, "/home/consumer/.codex");
  assert.deepEqual([...CODEX_BASE_ALLOW_LIST], ["PATH", "LANG", "LC_ALL", "HOME"]);
  assert.deepEqual([...CODEX_ENV_ALLOW], ["CODEX_HOME"]);
});

test("CT-131-15: the critic key is never in the proposer environment, and the reverse", () => {
  const proposer = codexCallEnvironment({ role: "proposer", processEnv: ENV });
  assert.ok(!(CODEX_KEY_VARIABLE in proposer));
  assert.ok(!("ANTHROPIC_API_KEY" in proposer));
  const critic = codexCallEnvironment({ role: "critic", processEnv: ENV });
  assert.equal(critic[CODEX_KEY_VARIABLE], KEY);
  assert.ok(!("ANTHROPIC_API_KEY" in critic), "no other provider key reaches the harness");
  // The separation is in the tables the allow-list is built from.
  assert.deepEqual(CODEX_CREDENTIAL_VARIABLES.proposer, []);
  assert.deepEqual(CODEX_CREDENTIAL_VARIABLES.critic, [CODEX_KEY_VARIABLE]);
  assert.ok(!codexAllowList({ role: "proposer" }).includes(CODEX_KEY_VARIABLE));
});

test("CT-131-15: an overlay home replaces HOME, and unknown names are left out", () => {
  const environment = codexCallEnvironment({
    role: "critic",
    processEnv: ENV,
    overlayHome: "/tmp/overlay-home",
  });
  assert.equal(environment.HOME, "/tmp/overlay-home");
  const bare = codexCallEnvironment({
    role: "proposer",
    processEnv: { PATH: "/usr/bin" },
  });
  assert.deepEqual(Object.keys(bare).sort(), ["PATH"]);
});

test("CT-131-15: a key never appears in an argument list", () => {
  const shapes: string[][] = [
    ["exec", "--json", "-s", "workspace-write", "-C", "/work", "-"],
    ["exec", "--dangerously-bypass-approvals-and-sandbox", "the prompt text"],
    ["exec", "resume", "thread-1", "--json", "-"],
    ["login", "status"],
    ["--version"],
  ];
  for (const args of shapes) {
    assert.equal(argumentListHoldsSecret(args, [KEY]), null);
    assert.equal(argumentListHoldsSecret(args, [OTHER_KEY]), null);
  }
  // A planted key anywhere in the list is found, so the check has teeth.
  assert.equal(argumentListHoldsSecret(["exec", KEY, "-"], [KEY]), 1);
  assert.equal(argumentListHoldsSecret(["--key=" + KEY], [KEY]), 0);
});
