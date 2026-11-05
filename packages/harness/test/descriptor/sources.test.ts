/**
 * T012 — CT-109-15: the accepted sources of a descriptor (F109-FR-015).
 *
 * A harness declaration, an endpoint and a secret reference are accepted
 * from user configuration, the environment, flags and bundled data only. The
 * same entries in PROJECT configuration are ignored with a launch message
 * and a doctor warning, and do not change the registry.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCEPTED_SOURCES,
  PROJECT_CONFIG_KEYS_IGNORED,
  REFUSED_SOURCE,
  collectDescriptors,
} from "../../src/descriptor/sources.ts";

const harnessDeclaration = { descriptorVersion: 1, id: "my-agent", kind: "cli" };
const endpoint = { id: "my-endpoint", baseUrl: "https://api.example.com" };
const secretReference = { id: "my-secret", ref: "op://vault/my-agent/token" };

const projectConfig = {
  harnesses: [harnessDeclaration],
  endpoints: [endpoint],
  secrets: [secretReference],
};

test("CT-109-15: a harness declaration in project configuration is ignored, with a launch message and a doctor warning", () => {
  const collected = collectDescriptors({
    projectConfig,
    userConfig: [],
  });
  const harness = collected.ignored.filter((warning) => warning.path.startsWith("harnesses"));
  assert.equal(harness.length, 1);
  assert.equal(harness[0]!.severity, "warning", "a doctor warning");
  assert.equal(harness[0]!.check, "project-config-harness-entry");
  assert.match(
    harness[0]!.message,
    /ignored: harness declaration "my-agent" in project configuration/,
  );
});

test("CT-109-15: an endpoint in project configuration is ignored with a launch message and a doctor warning", () => {
  const collected = collectDescriptors({ projectConfig, userConfig: [] });
  const warning = collected.ignored.find((entry) => entry.path.startsWith("endpoints"));
  assert.ok(warning !== undefined);
  assert.match(warning.message, /ignored: endpoint "my-endpoint" in project configuration/);
});

test("CT-109-15: a secret reference in project configuration is ignored with a launch message and a doctor warning", () => {
  const collected = collectDescriptors({ projectConfig, userConfig: [] });
  const warning = collected.ignored.find((entry) => entry.path.startsWith("secrets"));
  assert.ok(warning !== undefined);
  assert.match(warning.message, /ignored: secret reference "my-secret" in project configuration/);
});

test("CT-109-15: the ignored project-configuration entries never reach the registry", () => {
  const collected = collectDescriptors({
    projectConfig,
    userConfig: [],
    bundled: [],
    environment: {},
    flags: [],
  });
  assert.equal(collected.accepted.length, 0, "the registry stays unchanged");
  assert.equal(collected.ignored.length, 3);
  for (const warning of collected.ignored) {
    assert.match(warning.message, /F109-FR-015/);
    assert.match(warning.message, /user configuration, the environment, a flag or bundled data/);
  }
});

test("CT-109-15: the same declaration is accepted from user configuration", () => {
  const collected = collectDescriptors({
    userConfig: [harnessDeclaration, endpoint, secretReference],
  });
  assert.equal(collected.accepted.length, 3);
  assert.equal(collected.accepted[0]!.source, "user-config");
  assert.equal(collected.ignored.length, 0);
});

test("CT-109-15: the environment, flags and bundled data are accepted sources too", () => {
  assert.deepEqual([...ACCEPTED_SOURCES], ["user-config", "environment", "flags", "bundled"]);
  assert.equal(REFUSED_SOURCE, "project-config");
  const collected = collectDescriptors({
    userConfig: [harnessDeclaration],
    environment: { SPECSTRIDE_HARNESS_EDGE: '{"id":"edge"}' },
    flags: [{ id: "flagged" }],
    bundled: [{ id: "bundled-one" }],
  });
  assert.deepEqual(
    collected.accepted.map((entry) => entry.source),
    ["user-config", "bundled", "flags", "environment"],
  );
  assert.equal(collected.ignored.length, 0);
});

test("CT-109-15: the keys of project configuration this feature ignores are exactly the three", () => {
  assert.deepEqual([...PROJECT_CONFIG_KEYS_IGNORED], ["harnesses", "endpoints", "secrets"]);
});

test("CT-109-15: a project configuration without harness entries produces no warning", () => {
  const collected = collectDescriptors({
    projectConfig: { model: "fast", workdir: "/tmp/x" },
    userConfig: [],
  });
  assert.equal(collected.ignored.length, 0);
  assert.equal(collected.accepted.length, 0);
});
