/**
 * T020 — CT-109-28: the environment of a call (F109-FR-028).
 *
 * The environment of a call holds the allow-list and NOTHING else; the
 * credentials of one role never reach the other; under `parity` the
 * allow-list is exactly the set of variables the baseline hands to the
 * harness.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASE_ALLOW_LIST,
  allowListOf,
  buildCallEnvironment,
} from "../../src/environment/allow-list.ts";

const CONSUMER_ENV = {
  PATH: "/usr/bin:/bin",
  HOME: "/root",
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  SHELL: "/bin/bash",
  AWS_PROFILE: "attacker-wants-this",
  PROPOSER_TOKEN: "proposer-secret",
  CRITIC_TOKEN: "critic-secret",
  EXTRA_TOOL_CONFIG: "no",
  FAKE_EXTRA: "allowed-by-descriptor",
} as const;

const CREDENTIALS = {
  proposer: ["PROPOSER_TOKEN"],
  critic: ["CRITIC_TOKEN"],
};

const DESCRIPTOR_ENV_ALLOW = ["FAKE_EXTRA"];

test("CT-109-28: the base allow-list is the search path, the locale and the home", () => {
  assert.deepEqual([...BASE_ALLOW_LIST], ["PATH", "LANG", "LC_ALL", "HOME"]);
});

test("CT-109-28: the environment of a call holds the allow-list and nothing else", () => {
  const environment = buildCallEnvironment({
    role: "proposer",
    credentialVars: CREDENTIALS,
    envAllow: DESCRIPTOR_ENV_ALLOW,
    processEnv: CONSUMER_ENV,
  });
  const expected = ["PATH", "LANG", "LC_ALL", "HOME", "PROPOSER_TOKEN", "FAKE_EXTRA"];
  assert.deepEqual(Object.keys(environment).sort(), [...expected].sort());
  // And the values are the consumer's own values for those names only.
  assert.equal(environment.PATH, CONSUMER_ENV.PATH);
  assert.equal(environment.PROPOSER_TOKEN, "proposer-secret");
  assert.equal(environment.FAKE_EXTRA, "allowed-by-descriptor");
});

test("CT-109-28: no other variable of the consumer reaches the harness", () => {
  const environment = buildCallEnvironment({
    role: "proposer",
    credentialVars: CREDENTIALS,
    envAllow: DESCRIPTOR_ENV_ALLOW,
    processEnv: CONSUMER_ENV,
  });
  for (const name of ["SHELL", "AWS_PROFILE", "EXTRA_TOOL_CONFIG", "CRITIC_TOKEN"]) {
    assert.equal(name in environment, false, `${name} must not reach the harness`);
  }
});

test("CT-109-28: the credentials of one role never reach the other", () => {
  const proposer = buildCallEnvironment({
    role: "proposer",
    credentialVars: CREDENTIALS,
    processEnv: CONSUMER_ENV,
  });
  assert.ok("PROPOSER_TOKEN" in proposer);
  assert.ok(
    !("CRITIC_TOKEN" in proposer),
    "the critic's credential is not in the proposer's environment",
  );

  const critic = buildCallEnvironment({
    role: "critic",
    credentialVars: CREDENTIALS,
    processEnv: CONSUMER_ENV,
  });
  assert.ok("CRITIC_TOKEN" in critic);
  assert.ok(
    !("PROPOSER_TOKEN" in critic),
    "the proposer's credential is not in the critic's environment",
  );

  // And the descriptor's `envAllow` cannot smuggle the other role's credential.
  const smuggler = buildCallEnvironment({
    role: "proposer",
    credentialVars: CREDENTIALS,
    envAllow: ["CRITIC_TOKEN"],
    processEnv: CONSUMER_ENV,
  });
  assert.ok(!("CRITIC_TOKEN" in smuggler), "envAllow does not override the role separation");
});

test("CT-109-28: the home or its overlay — an overlay home replaces HOME", () => {
  const environment = buildCallEnvironment({
    role: "proposer",
    credentialVars: CREDENTIALS,
    processEnv: CONSUMER_ENV,
    overlayHome: "/tmp/overlay-tree/home",
  });
  assert.equal(environment.HOME, "/tmp/overlay-tree/home");
  assert.equal(
    allowListOf({ role: "proposer", credentialVars: CREDENTIALS }).includes("HOME"),
    true,
  );
});

test("CT-109-28: under `parity` the allow-list is the set of variables the baseline hands to the harness", () => {
  const baselineVariables = ["PATH", "HOME", "LANG", "PROPOSER_TOKEN", "TERM"];
  const environment = buildCallEnvironment({
    role: "proposer",
    credentialVars: CREDENTIALS,
    envAllow: DESCRIPTOR_ENV_ALLOW,
    processEnv: CONSUMER_ENV,
    parityVariables: baselineVariables,
  });
  assert.deepEqual(
    Object.keys(environment).sort(),
    baselineVariables.filter((name) => name in CONSUMER_ENV).sort(),
    "exactly the baseline's names, and only those the consumer holds",
  );
  assert.equal("TERM" in environment, false, "a name the consumer does not hold is left out");
  assert.equal(environment.PROPOSER_TOKEN, "proposer-secret");
  // The list of names is exactly the baseline's, so the names the stub saw
  // are equal on both sides.
  assert.deepEqual(
    allowListOf({ role: "critic", parityVariables: baselineVariables }),
    baselineVariables,
  );
});

test("CT-109-28: a name the consumer does not hold is simply absent, never invented", () => {
  const environment = buildCallEnvironment({
    role: "critic",
    credentialVars: CREDENTIALS,
    envAllow: ["NOT_SET_ANYWHERE"],
    processEnv: CONSUMER_ENV,
  });
  assert.equal("NOT_SET_ANYWHERE" in environment, false);
  assert.equal(environment.CRITIC_TOKEN, "critic-secret");
});
