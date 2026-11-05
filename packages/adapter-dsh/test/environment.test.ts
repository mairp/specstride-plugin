/**
 * T047 — characterization tests CT-130-39, CT-130-40 and CT-130-41 of the
 * environment.
 *
 * CT-130-39 — the harness reports no usage on standard output: every pass
 * emits `usage.unavailable` with the reason `harness-does-not-report`, the
 * descriptor declares `usageSource: none`, no token count and no cost is
 * invented, and a killed pass is counted as unknown (F130-FR-039).
 * CT-130-40 — the harness's own telemetry is switched off for every
 * process by `DSH_TELEMETRY_MODE`, and the trace parent of the open pass
 * span is exported as the standard `TRACEPARENT` only when traces are on
 * (F130-FR-040).
 * CT-130-41 — the environment of every call is an allow-list (the search
 * path, the locale, the home, the permission mode, the telemetry mode),
 * only the three own variables of the harness are set, the consumer's other
 * provider keys are not inherited, a credential of one role never reaches
 * the other role's environment, and no secret is passed in an argument list
 * (F130-FR-041).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDshEnvironment,
  dshArgumentsCarrySecret,
  dshTelemetryEnvironment,
  dshTraceParentEnvironment,
  dshUsageStatement,
  dshVariableIsAllowed,
  DSH_ENV_ALLOW_LIST,
  DSH_OWN_VARIABLES,
  DSH_TELEMETRY_VARIABLE,
  DSH_TRACEPARENT_VARIABLE,
} from "../src/environment/index.ts";
import { dshCapabilities } from "../src/descriptor/index.ts";
import { readRawDescriptorData } from "../src/descriptor/data.ts";

test("CT-130-39: every pass emits usage.unavailable with the reason harness-does-not-report", () => {
  const statement = dshUsageStatement();
  assert.equal(statement.type, "usage.unavailable");
  assert.equal(statement.reason, "harness-does-not-report");
  // Every pass, killed or not: the reason names itself for a killed pass.
  const killed = dshUsageStatement({ killed: true });
  assert.equal(killed.type, "usage.unavailable");
  assert.equal(killed.reason, "pass-killed-unknown");
});

test("CT-130-39: no token count and no cost is invented; the usage source is none", () => {
  const statement = dshUsageStatement();
  assert.equal(statement.tokens, null);
  assert.equal(statement.cost, null);
  assert.equal(statement.usageSource, "none");
  const capability = dshCapabilities().capabilities.find((row) => row.id === "usage.source");
  assert.ok(capability, "the capabilities carry the usage source");
  assert.equal(capability!.value, "none");
  const descriptor = readRawDescriptorData() as { "x-usageSource"?: string };
  assert.equal(descriptor["x-usageSource"], "none");
});

test("CT-130-40: the telemetry mode variable is set to its off value for every process", () => {
  const telemetry = dshTelemetryEnvironment();
  assert.deepEqual(Object.keys(telemetry), [DSH_TELEMETRY_VARIABLE]);
  const built = buildDshEnvironment({
    home: "/tmp/overlay",
    permissionMode: "workspace-write",
  });
  assert.equal(built[DSH_TELEMETRY_VARIABLE], "");
  const builtCritic = buildDshEnvironment({
    home: "/tmp/overlay",
    permissionMode: "read-only",
  });
  assert.equal(builtCritic[DSH_TELEMETRY_VARIABLE], "");
});

test("CT-130-40: the trace parent is exported as TRACEPARENT only when traces are on", () => {
  assert.deepEqual(dshTraceParentEnvironment(undefined), {});
  const on = dshTraceParentEnvironment("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
  assert.deepEqual(Object.keys(on), [DSH_TRACEPARENT_VARIABLE]);
  assert.equal(
    on[DSH_TRACEPARENT_VARIABLE],
    "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  );
  const built = buildDshEnvironment({
    home: "/tmp/h",
    permissionMode: "workspace-write",
    traceparent: "00-abc-000-01",
  });
  assert.equal(built[DSH_TRACEPARENT_VARIABLE], "00-abc-000-01");
  const off = buildDshEnvironment({ home: "/tmp/h", permissionMode: "workspace-write" });
  assert.equal(DSH_TRACEPARENT_VARIABLE in off, false);
});

test("CT-130-41: the environment of a call is the allow-list, and only that", () => {
  const consumer = {
    PATH: "/usr/bin:/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    DSH_HOME: "/home/u/.dsh",
    HOME: "/home/u",
    ANTHROPIC_API_KEY: "sk-consumer",
    OPENAI_API_KEY: "sk-other-provider",
    DEEPSEEK_API_KEY: "sk-harness-credential",
    SPECSTRIDE_TOKEN: "a-secret",
  };
  const env = buildDshEnvironment({
    env: consumer,
    home: "/tmp/specstride-dsh-home.abc",
    permissionMode: "workspace-write",
  });
  for (const name of Object.keys(env)) {
    assert.ok(
      dshVariableIsAllowed(name),
      `${name} is on the allow-list (${DSH_ENV_ALLOW_LIST.join(", ")})`,
    );
  }
  assert.equal(env.PATH, consumer.PATH);
  assert.equal(env.LANG, consumer.LANG);
  assert.equal(env.LC_ALL, consumer.LC_ALL);
  assert.equal(env.DSH_HOME, "/tmp/specstride-dsh-home.abc");
  assert.equal(env.DSH_PERMISSION_MODE, "workspace-write");
  // The consumer's other provider keys are NOT inherited.
  assert.equal("ANTHROPIC_API_KEY" in env, false);
  assert.equal("OPENAI_API_KEY" in env, false);
  assert.equal("DEEPSEEK_API_KEY" in env, false);
  assert.equal("SPECSTRIDE_TOKEN" in env, false);
  assert.equal("HOME" in env, false);
});

test("CT-130-41: only the home, the permission mode and the telemetry mode of the harness are set", () => {
  assert.deepEqual(DSH_OWN_VARIABLES, ["DSH_HOME", "DSH_PERMISSION_MODE", "DSH_TELEMETRY_MODE"]);
  const env = buildDshEnvironment({ home: "/tmp/h", permissionMode: "read-only" });
  const own = Object.keys(env).filter((name) => name.startsWith("DSH_"));
  assert.deepEqual(own.sort(), [...DSH_OWN_VARIABLES].sort());
});

test("CT-130-41: a credential of the critic is never in the environment of the proposer, or the reverse", () => {
  const criticCredential = { env: { DSH_CRITIC_KEY: "sk-critic-only" } as Record<string, string> };
  const proposerEnv = buildDshEnvironment({
    env: criticCredential.env,
    home: "/tmp/h",
    permissionMode: "workspace-write",
  });
  assert.equal("DSH_CRITIC_KEY" in proposerEnv, false);
  const criticEnv = buildDshEnvironment({
    env: { DSH_PROPOSER_KEY: "sk-proposer-only" },
    home: "/tmp/h",
    permissionMode: "read-only",
  });
  assert.equal("DSH_PROPOSER_KEY" in criticEnv, false);
  // The allow-list itself carries no credential variable.
  for (const name of DSH_ENV_ALLOW_LIST) {
    assert.equal(/KEY|TOKEN|SECRET|PASSWORD/i.test(name), false, name);
  }
});

test("CT-130-41: no secret is passed in an argument list", () => {
  assert.deepEqual(dshArgumentsCarrySecret(["dsh", "--profile", "headless", "do the work"]), []);
  const withSecret = dshArgumentsCarrySecret([
    "dsh",
    "--api-key=sk-harness",
    "--profile",
    "headless",
  ]);
  assert.deepEqual(withSecret, ["--api-key=sk-harness"]);
  // The argv the adapter builds never carries an assignment of a credential.
  const argv = ["dsh", "--profile", "headless", "--patch", "/tmp/patch.json", "--", "grade"];
  assert.deepEqual(dshArgumentsCarrySecret(argv), []);
});
