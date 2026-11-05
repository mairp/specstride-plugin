/**
 * T026 (feature 112) — CT-112-118 (F112-FR-018; DV-068): the checks of the
 * groups `config` and `secret`.
 *
 * The schema (an unknown key and an inline secret are `fail`); which layer
 * supplied an effective key (a shadowed value, a pin of the launch contract);
 * a widening key in project configuration (warned, ignored); a `file:`
 * reference inside the workspace (fail) and one readable by others (warn);
 * legacy input that is not read; children receive only their declared
 * credential variables; and an inline secret finding shows the path, the key
 * name and AT MOST FOUR characters of the value (DV-068).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  configSchemaCheck,
  configPrecedenceCheck,
  configProjectWidenCheck,
  configLegacyCheck,
  secretInlineCheck,
  secretFileCheck,
  secretEnvLeakCheck,
  SECRET_SHOWN_CHARS,
  shownOf,
  WIDENING_KEYS,
} from "../src/checks/config.ts";
import { severityOf, findingOf } from "./helpers.ts";

test("CT-112-118: a layer that does not validate, or holds an unknown key, is a failure", async () => {
  assert.equal(await severityOf(configSchemaCheck, [["config.layers", []]]), "ok");
  assert.equal(
    await severityOf(configSchemaCheck, [
      ["config.layers", [{ path: "user:config", scope: "user", valid: false }]],
    ]),
    "fail",
  );
  // An unknown key fails even when the layer otherwise validates; the finding
  // names the path, the key and the suggestion.
  const unknown = await findingOf(configSchemaCheck, [
    [
      "config.layers",
      [
        {
          path: "specstride.yaml",
          scope: "project",
          valid: true,
          unknownKey: "roles.critc",
          suggestion: "roles.critic",
        },
      ],
    ],
  ]);
  assert.equal(unknown.severity, "fail");
  assert.match(unknown.message, /roles\.critc unknown key \(did you mean roles\.critic\?\)/);
});

test("CT-112-118: a shadowed environment value and a pin of the launch contract", async () => {
  assert.equal(await severityOf(configPrecedenceCheck, [["config.shadowed", []]]), "info");
  assert.equal(
    await severityOf(configPrecedenceCheck, [
      ["config.shadowed", [{ variable: "SPECSTRIDE_LEARNING", where: "launch contract" }]],
    ]),
    "warn",
  );
  const shadowed = await findingOf(configPrecedenceCheck, [
    ["config.shadowed", [{ variable: "SPECSTRIDE_LEARNING" }]],
  ]);
  assert.match(shadowed.message, /SPECSTRIDE_LEARNING ignored: contract pins it/);
});

test("CT-112-118: a widening key in project configuration is warned and ignored", async () => {
  assert.ok(WIDENING_KEYS.includes("harnesses"));
  assert.equal(await severityOf(configProjectWidenCheck, [["config.projectWidened", []]]), "info");
  assert.equal(
    await severityOf(configProjectWidenCheck, [
      ["config.projectWidened", [{ path: "specstride.yaml", key: "harnesses" }]],
    ]),
    "warn",
  );
  const widened = await findingOf(configProjectWidenCheck, [
    ["config.projectWidened", [{ path: "specstride.yaml", key: "harnesses" }]],
  ]);
  assert.match(widened.message, /harnesses ignored \(user scope only\)/);
});

test("CT-112-118: legacy input of the as-is systems that is not read is an info", async () => {
  assert.equal(await severityOf(configLegacyCheck, []), "info");
  const legacy = await findingOf(configLegacyCheck, [
    ["config.legacyInputs", [{ what: "old state tree in the workspace" }]],
  ]);
  assert.match(legacy.message, /old state tree in the workspace/);
});

test("CT-112-118: an inline secret fails and shows at most four characters (DV-068)", async () => {
  assert.equal(SECRET_SHOWN_CHARS, 4);
  assert.equal(shownOf("sk-ant-canary-9f2b7c"), "sk-a");
  const finding = await findingOf(secretInlineCheck, [
    [
      "config.secrets.inline",
      [{ where: "user config", key: "critic key", value: "sk-ant-canary-9f2b7c" }],
    ],
  ]);
  assert.equal(finding.severity, "fail");
  assert.ok(finding.lb, "secret.inline is launch-blocking");
  // The path and the key name are shown; the value is not.
  assert.match(finding.message, /user config: critic key is inline/);
  assert.ok(!finding.message.includes("canary"), "more than four characters leaked");
  // At most four characters of the value appear anywhere in the finding.
  const evidence = JSON.stringify(finding.evidence);
  assert.ok(!evidence.includes("ant-"));
  assert.equal(await severityOf(secretInlineCheck, [["config.secrets.inline", []]]), "ok");
});

test("CT-112-118: a file: reference inside the workspace fails; an open one warns", async () => {
  assert.equal(
    await severityOf(secretFileCheck, [
      [
        "config.secretFiles",
        [{ target: "secrets.key", insideWorkspace: false, readableByOthers: false }],
      ],
    ]),
    "ok",
  );
  const inside = await severityOf(secretFileCheck, [
    [
      "config.secretFiles",
      [{ target: "./id.pem", insideWorkspace: true, readableByOthers: false }],
    ],
  ]);
  assert.equal(inside, "fail");
  const open = await severityOf(secretFileCheck, [
    [
      "config.secretFiles",
      [{ target: "/shared/id.pem", insideWorkspace: false, readableByOthers: true }],
    ],
  ]);
  assert.equal(open, "warn");
  // Both checks are launch-blocking (F112-FR-030).
  assert.equal(secretFileCheck.lb, true);
});

test("CT-112-118: children receive only the declared credential variables", async () => {
  const finding = await findingOf(secretEnvLeakCheck, [
    ["config.credentialVars.declared", ["ANTHROPIC_API_KEY"]],
    ["config.credentialVars.passed", ["ANTHROPIC_API_KEY"]],
  ]);
  assert.equal(finding.severity, "info");
  assert.equal(finding.evidence["leaked"], 0);
  // A variable a child receives that no harness declared would be counted.
  const leaked = await findingOf(secretEnvLeakCheck, [
    ["config.credentialVars.declared", ["ANTHROPIC_API_KEY"]],
    ["config.credentialVars.passed", ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]],
  ]);
  assert.equal(leaked.evidence["leaked"], 1);
});
