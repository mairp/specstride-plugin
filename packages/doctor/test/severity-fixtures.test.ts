/**
 * T061 (feature 112) — CT-112-206 (F112-SC-006): every one of the 45 checks
 * has a fixture for each severity it can return.
 *
 * The fixture table below holds one entry per catalogue row (45 rows, in the
 * order of `packages/doctor/data/check-catalogue.tsv`). For every row it
 * declares the set of severities the check CAN return — read from the row's
 * own severity rule in the catalogue — and, for each such severity, one
 * concrete fixture: the probe-bag configuration entries (and, where a probe
 * reads more than the configuration, bag overrides) that drive the check to
 * that severity. Every fixture runs through the real runner with an injected
 * probe bag, never the real machine (F112-FR-001).
 *
 * The four rows of group `host` (7 to 10) are supplied by the host package
 * (F112-FR-012); the core holds no probe of them. Their fixtures are
 * descriptor fixtures: a stand-in check carrying the row's own id, flag and
 * severity rule from the catalogue, over the existence-only probe shape
 * CT-112-112 fixes, so the severity rule itself — the part this feature owns —
 * is what the fixture exercises.
 *
 * The per-harness forms (`bin.<id>`, `harness.*.<id>`, `auth.<id>.<role>`,
 * `model.*.<role>`, `quota.state.<role>`) are exercised on one representative
 * instance built from an entry of the resolved registry the bag carries
 * (F112-FR-009); the severity rule is the same for every instance.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  envChecks,
  configChecks,
  termsChecks,
  budgetChecks,
  runChecks,
  miscChecks,
  criticChecks,
  harnessChecksOf,
  binCheckFor,
  authCheckFor,
  authTierCheckFor,
  modelReachCheckFor,
  modelWindowCheckFor,
  quotaStateCheck,
  gateIntegrityCheck,
  gateIntegrityBreaches,
  type Check,
  type HarnessEntry,
  type ProbeBag,
  type Severity,
} from "../src/index.ts";
import type { GateEvent } from "../src/integrity/gate.ts";
import { findingOf } from "./helpers.ts";

const CATALOGUE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "check-catalogue.tsv",
);

/** The 45 catalogue row ids, in catalogue order. */
function catalogueIds(): readonly string[] {
  return readFileSync(CATALOGUE, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .slice(1)
    .map((l) => l.split("\t")[1] as string);
}

/** The representative harness entry every per-harness fixture builds on. */
function harnessEntry(overrides?: Partial<HarnessEntry>): HarnessEntry {
  return {
    id: "fixture-harness",
    state: "tested",
    roles: ["critic"],
    resolvedPath: "/usr/local/bin/fixture-harness",
    version: "2.1.5",
    testedRange: { min: "2.1.0", max: "2.2.0" },
    verifiedOn: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    declaredCaps: { window: 200000 },
    probedCaps: { window: 200000 },
    uncoveredTools: [],
    ...overrides,
  };
}

/** A bag override carrying a resolved registry with the given entries. */
function registryWith(...entries: HarnessEntry[]): Partial<ProbeBag> {
  return { registry: { ids: entries.map((e) => e.id), harnesses: entries } };
}

const DAY = 24 * 60 * 60 * 1000;

/** One severity fixture: the entries, and the bag overrides a probe needs. */
type SeverityFixture = {
  readonly entries?: readonly [string, unknown][];
  readonly bag?: Partial<ProbeBag>;
  /** Only the `events.gateIntegrity` fixtures carry the injected event log. */
  readonly events?: readonly GateEvent[];
};

/** One row of the table: the check and one fixture per severity it can return. */
type Row = {
  readonly id: string;
  /** The severities the check CAN return, from its catalogue severity rule. */
  readonly can: readonly Severity[];
  readonly fixtures: Partial<Record<Severity, SeverityFixture>>;
};

/** A descriptor check of group `host`: the row's data, a rule-shaped probe. */
function hostDescriptorCheck(
  id: string,
  order: number,
  messageTemplate: string,
  fixHint: string,
  rule: (observed: unknown) => Severity,
): Check {
  return {
    id,
    group: "host",
    lb: false,
    order,
    messageTemplate,
    fixHint,
    severityRule: rule,
    probe: async (bag) => (bag as ProbeBag).config.values.get(id) ?? { present: false },
  };
}

const ROWS: readonly Row[] = [
  {
    id: "env.node",
    can: ["fail", "warn", "ok"],
    fixtures: {
      fail: { entries: [["env.node.version", "v20.11.0"]] },
      warn: { entries: [["env.node.version", "v23.6.0"]] },
      ok: { entries: [["env.node.version", "v22.12.0"]] },
    },
  },
  {
    id: "env.os",
    can: ["ok", "warn", "info"],
    fixtures: {
      ok: { entries: [] },
      warn: { entries: [["env.os.platform", "win32"]] },
      info: {
        entries: [["env.os.tools", { git: false, ps: true, pgrep: true, keychain: true }]],
      },
    },
  },
  {
    id: "env.git",
    can: ["ok", "warn"],
    fixtures: {
      ok: { entries: [["env.git.present", true]] },
      warn: { entries: [["env.git.present", false]] },
    },
  },
  {
    id: "env.stateDirPerms",
    can: ["ok", "warn"],
    fixtures: {
      ok: {
        entries: [["env.stateDir.path", "/state/dir"]],
        bag: { files: { stat: () => ({ size: 1, mode: 0o600 }) } },
      },
      warn: {
        entries: [["env.stateDir.path", "/state/dir"]],
        bag: { files: { stat: () => ({ size: 1, mode: 0o644 }) } },
      },
    },
  },
  {
    id: "env.tmpWritable",
    can: ["ok", "warn", "fail"],
    fixtures: {
      ok: { entries: [] },
      warn: { entries: [["env.controlRoot", { writable: true, freeBytes: 100 }]] },
      fail: { entries: [["env.controlRoot", { writable: false, freeBytes: 1 << 40 }]] },
    },
  },
  {
    id: "cli.version",
    can: ["ok", "warn", "fail"],
    fixtures: {
      ok: { entries: [] },
      warn: {
        entries: [],
        bag: {
          runs: [
            { kind: "engine-start", productVersion: "1.0.0" },
            { kind: "engine-start", productVersion: "2.0.0" },
          ],
        },
      },
      fail: { entries: [["cli.protocol", 2]] },
    },
  },
  {
    // Host package row: the descriptor fixture exercises the severity rule.
    id: "host.plugin",
    can: ["info"],
    fixtures: {
      info: {
        entries: [["host.plugin", { present: true, version: "2.1.284" }]],
      },
    },
  },
  {
    id: "host.claudeFloor",
    can: ["warn", "info"],
    fixtures: {
      warn: { entries: [["host.claudeFloor", { version: "2.1.0", floor: "2.2.0" }]] },
      info: { entries: [["host.claudeFloor", { version: "2.2.3", floor: "2.2.0" }]] },
    },
  },
  {
    id: "host.managedSettings",
    can: ["warn", "info"],
    fixtures: {
      warn: { entries: [["host.managedSettings", { path: "/s.json", policyHook: true }]] },
      info: { entries: [["host.managedSettings", { path: "/s.json", policyHook: false }]] },
    },
  },
  {
    id: "host.bgIsolation",
    can: ["warn", "info"],
    fixtures: {
      warn: { entries: [["host.bgIsolation", { bindsToCheckout: true }]] },
      info: { entries: [["host.bgIsolation", { bindsToCheckout: false }]] },
    },
  },
  {
    id: "bin.<id>",
    can: ["ok", "fail", "info"],
    fixtures: {
      ok: { bag: registryWith(harnessEntry()) },
      fail: { bag: registryWith(harnessEntry({ resolvedPath: undefined })) },
      info: {
        bag: registryWith(harnessEntry({ resolvedPath: undefined, roles: [] })),
      },
    },
  },
  {
    id: "harness.discovered",
    can: ["info"],
    fixtures: {
      info: { bag: registryWith(harnessEntry()) },
    },
  },
  {
    id: "harness.state.<id>",
    can: ["warn", "info"],
    fixtures: {
      warn: { bag: registryWith(harnessEntry({ state: "declared" })) },
      info: { bag: registryWith(harnessEntry()) },
    },
  },
  {
    id: "harness.version.<id>",
    can: ["warn", "info"],
    fixtures: {
      warn: { bag: registryWith(harnessEntry({ version: "2.0.4" })) },
      info: { bag: registryWith(harnessEntry()) },
    },
  },
  {
    id: "harness.caps.<id>",
    can: ["warn", "ok"],
    fixtures: {
      warn: { bag: registryWith(harnessEntry({ probedCaps: { window: 64000 } })) },
      ok: { bag: registryWith(harnessEntry()) },
    },
  },
  {
    id: "harness.denylist.<id>",
    can: ["warn", "ok"],
    fixtures: {
      warn: { bag: registryWith(harnessEntry({ uncoveredTools: ["web-search"] })) },
      ok: { bag: registryWith(harnessEntry()) },
    },
  },
  {
    id: "auth.<id>.<role>",
    can: ["ok", "fail", "info"],
    fixtures: {
      ok: { entries: [["auth.fixture-harness.critic", { tier: 1, state: "present" }]] },
      fail: { entries: [["auth.fixture-harness.critic", { tier: 1, state: "missing" }]] },
      info: { entries: [["auth.fixture-harness.critic", { tier: 2 }]] },
    },
  },
  {
    id: "auth.tier.<role>",
    can: ["info", "warn"],
    fixtures: {
      info: { entries: [["auth.tier.critic", { tier: 1 }]] },
      warn: { entries: [["auth.tier.critic", { tier: 1, apiKey: true }]] },
    },
  },
  {
    id: "model.reach.<role>",
    can: ["ok", "fail", "info"],
    fixtures: {
      ok: { entries: [["model.reach.critic", { model: "m-1", served: true }]] },
      fail: { entries: [["model.reach.critic", { model: "m-1", served: false }]] },
      info: { entries: [["model.reach.critic", { model: "m-1" }]] },
    },
  },
  {
    id: "model.window.<role>",
    can: ["ok", "warn"],
    fixtures: {
      ok: { entries: [["model.window.critic", { window: 200000, criticCandidate: true }]] },
      warn: { entries: [["model.window.critic", { criticCandidate: true }]] },
    },
  },
  {
    id: "critic.diversity",
    can: ["ok", "info", "warn"],
    fixtures: {
      ok: { entries: [["critic.diversity.result", "diverse"]] },
      info: { entries: [["critic.diversity.result", "same-provider"]] },
      warn: { entries: [["critic.diversity.result", "same-model"]] },
    },
  },
  {
    id: "critic.independence",
    can: ["ok", "warn", "fail"],
    fixtures: {
      ok: { entries: [["critic.independence", {}]] },
      warn: { entries: [["critic.independence", { canCallTools: true }]] },
      fail: { entries: [["critic.independence", { allowsAllTools: true }]] },
    },
  },
  {
    id: "critic.autopick",
    can: ["info"],
    fixtures: {
      info: {
        entries: [
          [
            "critic.autopick",
            { pick: "c-1", candidates: [{ id: "c-2", why: "no window declared" }] },
          ],
        ],
      },
    },
  },
  {
    id: "terms.gate",
    can: ["info", "warn", "fail"],
    fixtures: {
      info: { entries: [["terms.row", { result: "allowed", tier: 1, audience: "personal" }]] },
      warn: {
        entries: [["terms.row", { result: "conditional", tier: 1, audience: "personal" }]],
      },
      fail: { entries: [["terms.row", { result: "refused", tier: 1, audience: "personal" }]] },
    },
  },
  {
    id: "terms.stale",
    can: ["info", "warn"],
    fixtures: {
      info: { entries: [["terms.checkedAt", Date.now() - 5 * DAY]] },
      warn: { entries: [["terms.checkedAt", Date.now() - 40 * DAY]] },
    },
  },
  {
    id: "terms.audience",
    can: ["info"],
    fixtures: {
      info: { entries: [["terms.audience", "distributed"]] },
    },
  },
  {
    id: "quota.state.<role>",
    can: ["ok", "warn", "fail"],
    fixtures: {
      ok: { entries: [] },
      warn: {
        entries: [["quota.states", [{ role: "critic", state: "near-threshold" }]]],
      },
      fail: {
        entries: [["quota.states", [{ role: "critic", state: "blocked-on-credit" }]]],
      },
    },
  },
  {
    id: "budget.caps",
    can: ["info", "warn", "fail"],
    fixtures: {
      info: { entries: [] },
      warn: {
        entries: [
          [
            "budget.caps.roles",
            [{ role: "proposer", cap: null, costClass: null, spendMeasurable: true }],
          ],
        ],
      },
      fail: {
        entries: [["budget.caps.autopickCritic", { picked: true, metered: true, cap: null }]],
      },
    },
  },
  {
    id: "quota.shared",
    can: ["ok", "info"],
    fixtures: {
      ok: { entries: [] },
      info: { entries: [["quota.shared", true]] },
    },
  },
  {
    id: "config.schema",
    can: ["ok", "fail"],
    fixtures: {
      ok: { entries: [] },
      fail: { entries: [["config.layers", [{ path: "cfg.yaml", scope: "user", valid: false }]]] },
    },
  },
  {
    id: "config.precedence",
    can: ["info", "warn"],
    fixtures: {
      info: { entries: [] },
      warn: { entries: [["config.shadowed", [{ variable: "model" }]]] },
    },
  },
  {
    id: "config.projectWiden",
    can: ["info", "warn"],
    fixtures: {
      info: { entries: [] },
      warn: {
        entries: [["config.projectWidened", [{ path: "specstride.yaml", key: "roles" }]]],
      },
    },
  },
  {
    id: "config.legacy",
    can: ["info"],
    fixtures: {
      info: { entries: [["config.legacyInputs", [{ what: "old state tree" }]]] },
    },
  },
  {
    id: "secret.inline",
    can: ["ok", "fail"],
    fixtures: {
      ok: { entries: [] },
      fail: {
        entries: [["config.secrets.inline", [{ where: "user config", key: "k", value: "s3cr3t" }]]],
      },
    },
  },
  {
    id: "secret.file",
    can: ["ok", "warn", "fail"],
    fixtures: {
      ok: {
        entries: [
          [
            "config.secretFiles",
            [{ target: "/outside/a", insideWorkspace: false, readableByOthers: false }],
          ],
        ],
      },
      warn: {
        entries: [
          [
            "config.secretFiles",
            [{ target: "/outside/a", insideWorkspace: false, readableByOthers: true }],
          ],
        ],
      },
      fail: {
        entries: [
          [
            "config.secretFiles",
            [{ target: "./in-workspace", insideWorkspace: true, readableByOthers: false }],
          ],
        ],
      },
    },
  },
  {
    id: "secret.envLeak",
    can: ["info"],
    fixtures: {
      info: { entries: [["config.credentialVars.declared", ["A"]]] },
    },
  },
  {
    id: "run.lock",
    can: ["ok", "info", "warn", "fail"],
    fixtures: {
      ok: { entries: [] },
      info: { entries: [["run.lock", { result: "held-live", pid: 42 }]] },
      warn: { entries: [["run.lock", { result: "stale-owner-dead" }]] },
      fail: { entries: [["run.lock", { result: "unknown" }]] },
    },
  },
  {
    id: "run.stale",
    can: ["ok", "warn"],
    fixtures: {
      ok: { entries: [] },
      warn: { entries: [["run.stale.record", { state: "running", liveOwner: false }]] },
    },
  },
  {
    id: "sandbox.level",
    can: ["ok", "warn", "fail"],
    fixtures: {
      ok: { entries: [] },
      warn: {
        entries: [["sandbox.level", { role: "proposer", level: "C1", why: "consumer choice" }]],
      },
      fail: {
        entries: [
          ["sandbox.level", { role: "proposer", level: "C2", why: "default", bypassRefused: true }],
        ],
      },
    },
  },
  {
    id: "sandbox.critic",
    can: ["ok", "fail"],
    fixtures: {
      ok: { entries: [] },
      fail: { entries: [["sandbox.critic", { allowsAllTools: true, outsideForms: [] }]] },
    },
  },
  {
    id: "ui.endpoint",
    can: ["info", "warn", "fail"],
    fixtures: {
      info: { entries: [] },
      warn: {
        entries: [["ui.endpoint", { running: false, outsideLoopback: false, deadProcess: true }]],
      },
      fail: {
        entries: [["ui.endpoint", { running: true, outsideLoopback: true, deadProcess: false }]],
      },
    },
  },
  {
    id: "telemetry.endpoint",
    can: ["info", "warn"],
    fixtures: {
      info: { entries: [] },
      warn: { entries: [["telemetry.endpoint", { collector: "local", capture: true }]] },
    },
  },
  {
    id: "events.schema",
    can: ["info", "warn"],
    fixtures: {
      info: { entries: [] },
      warn: {
        entries: [["events.schema", { readerRange: { from: 1, to: 1 }, recordMajor: 2 }]],
      },
    },
  },
  {
    id: "memory.native",
    can: ["info", "warn"],
    fixtures: {
      info: { entries: [] },
      warn: { entries: [["memory.native", { role: "critic", on: true }]] },
    },
  },
  {
    id: "events.gateIntegrity",
    can: ["ok", "info", "fail"],
    fixtures: {
      ok: { events: healthyLog() },
      info: { events: [] },
      fail: { events: healthyLog().filter((e) => e.type !== "verdict.recorded") },
    },
  },
];

/** A healthy event log: openers and closers paired, seq without gaps. */
function healthyLog(): GateEvent[] {
  const e = (seq: number, type: string, data?: Record<string, unknown>): GateEvent => ({
    seq,
    type,
    ...(data === undefined ? {} : { data }),
  });
  return [
    e(1, "run.started"),
    e(2, "attempt.started", { attempt: 1 }),
    e(3, "pass.started", { attempt: 1 }),
    e(4, "pass.ended", { attempt: 1 }),
    e(5, "verification.started", { attempt: 1 }),
    e(6, "verification.ended", { attempt: 1, result: "pass" }),
    e(7, "verdict.recorded", { attempt: 1, nonce: "n-1" }),
    e(8, "approval.recorded", { attempt: 1, nonce: "n-1" }),
    e(9, "attempt.ended", { attempt: 1 }),
    e(10, "run.ended", { endCause: "done" }),
  ];
}

/** The concrete check a table row runs (one representative instance). */
function checkOf(row: Row): Check {
  switch (row.id) {
    case "bin.<id>":
      return binCheckFor("fixture-harness");
    case "harness.discovered":
      return harnessChecksOf([])[0] as Check;
    case "harness.state.<id>":
      return harnessChecksOf([harnessEntry({ state: "declared" })])[2] as Check;
    case "harness.version.<id>":
      return harnessChecksOf([harnessEntry()])[3] as Check;
    case "harness.caps.<id>":
      return harnessChecksOf([harnessEntry()])[4] as Check;
    case "harness.denylist.<id>":
      return harnessChecksOf([harnessEntry({ uncoveredTools: [] })])[5] as Check;
    case "auth.<id>.<role>":
      return authCheckFor("fixture-harness", "critic");
    case "auth.tier.<role>":
      return authTierCheckFor("critic");
    case "model.reach.<role>":
      return modelReachCheckFor("critic");
    case "model.window.<role>":
      return modelWindowCheckFor("critic");
    case "quota.state.<role>":
      return quotaStateCheck("critic");
    case "host.plugin":
      return hostDescriptorCheck(
        "host.plugin",
        7,
        "host plugin {present}",
        "install the host plugin yourself (printed, never run)",
        (o) => ((o as { present: boolean }).present ? "info" : "warn"),
      );
    case "host.claudeFloor":
      return hostDescriptorCheck(
        "host.claudeFloor",
        8,
        "host {version} below the floor {floor}",
        "upgrade the host",
        (o) => {
          const s = o as { version: string; floor: string };
          return s.version !== undefined && s.version < s.floor ? "warn" : "info";
        },
      );
    case "host.managedSettings":
      return hostDescriptorCheck(
        "host.managedSettings",
        9,
        "managed settings {policyHook}",
        "review the policy",
        (o) => ((o as { policyHook: boolean }).policyHook ? "warn" : "info"),
      );
    case "host.bgIsolation":
      return hostDescriptorCheck(
        "host.bgIsolation",
        10,
        "background work binds the run to the checkout",
        "run in the foreground",
        (o) => ((o as { bindsToCheckout: boolean }).bindsToCheckout ? "warn" : "info"),
      );
    case "events.gateIntegrity":
      return gateIntegrityCheck as unknown as Check;
    default:
      break;
  }
  const pools: readonly (readonly Check[])[] = [
    envChecks,
    configChecks,
    termsChecks,
    budgetChecks,
    runChecks,
    miscChecks,
    criticChecks,
  ];
  for (const pool of pools) {
    const found = pool.find((c) => c.id === row.id);
    if (found !== undefined) return found;
  }
  throw new Error(`no check object for catalogue row ${row.id}`);
}

test("CT-112-206: the fixture table covers all 45 catalogue rows, in order", () => {
  const ids = catalogueIds();
  assert.equal(ids.length, 45);
  assert.deepEqual(
    ROWS.map((r) => r.id),
    ids,
    "the fixture table has exactly one row per catalogue row, in catalogue order",
  );
});

test("CT-112-206: every check has a fixture for each severity it can return", async () => {
  for (const row of ROWS) {
    const check = checkOf(row);
    if (!row.id.includes("<")) {
      assert.equal(check.id, row.id, `row ${row.id}: the check object matches the row`);
    }
    for (const severity of row.can) {
      const fixture = row.fixtures[severity];
      assert.ok(fixture !== undefined, `${row.id}: no fixture for severity ${severity}`);
      let observed: string;
      if (row.id === "events.gateIntegrity") {
        // The gate-integrity probe reads the injected event log, not the bag.
        const direct = await gateIntegrityCheck.probe({ events: fixture.events ?? [] });
        observed = gateIntegrityCheck.severityRule(direct);
      } else {
        const finding = await findingOf(check, fixture.entries ?? [], {
          ...fixture.bag,
        });
        observed = finding.severity;
      }
      assert.equal(
        observed,
        severity,
        `${row.id}: the fixture for ${severity} produced ${observed}`,
      );
    }
  }
});

test("CT-112-206: every fixture map covers exactly the severities the row declares", () => {
  for (const row of ROWS) {
    const declared = [...row.can].sort().join(",");
    const fixtureSeverities = Object.keys(row.fixtures).sort().join(",");
    assert.equal(fixtureSeverities, declared, `${row.id}: the fixtures cover exactly ${declared}`);
  }
});

test("CT-112-206: the gate-integrity fixtures read the real invariants", () => {
  // ok: a healthy log, no breach; info: a log without the events; fail: a
  // planted breach (an approval with no critic verdict behind it).
  assert.deepEqual(gateIntegrityBreaches(healthyLog()).breaches, []);
  assert.ok(
    gateIntegrityBreaches(healthyLog().filter((e) => e.type !== "verdict.recorded")).breaches
      .length > 0,
  );
});
