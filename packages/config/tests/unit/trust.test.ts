/**
 * T014 — CT-110-115, CT-110-116 and CT-110-117 (F110-FR-017, F110-FR-018,
 * F110-FR-019).
 *
 * CT-110-115 (F110-FR-017): a widening key in the project file is ignored, with
 * **one** launch message that names the file and the key and **one** doctor
 * warning each; the message is shown whatever the output mode except under the
 * `parity` profile, where the doctor warning stays; the run goes on. No project
 * key may declare a harness, its command line, an endpoint, a secret reference,
 * a critic, a containment level, a permission flag, a budget increase, a host
 * hook, a telemetry address or content capture.
 *
 * CT-110-116 (F110-FR-018): a narrowing key is accepted only if its value is
 * stricter than the value the ranks below the project file would give, by the
 * direction of the catalogue; an equal value is accepted; a looser value is
 * ignored with one launch message and the lower value applies. Every direction
 * the catalogue uses is exercised — `lo`, `lo0`, `on`, `off`, `sub` and the three
 * prose forms — in both directions.
 *
 * CT-110-117 (F110-FR-019): task eligibility (`loop.parallel.exclude` may gain
 * ids and never lose one) and scope narrowing (a declared scope may be narrowed
 * to a subset and a wider one is refused with a doctor finding), with the five
 * keys of the user file only.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { TRUST_CLASSES } from "@specstride/contracts/envelope/trust-classes";

import { CATALOGUE, catalogueEntry } from "../../src/schema/catalogue.ts";
import {
  loadConfigFiles,
  projectConfigPath,
  userConfigPath,
  type FileEnvironment,
} from "../../src/load/files.ts";
import { resolveConfiguration } from "../../src/load/merge.ts";
import {
  FILTERED_RANK,
  FINDING_IDS,
  PROJECT_MUST_NOT_DECLARE,
  USER_FILE_ONLY,
  WIDENING_KEYS_OF_FR019,
  filterProjectKey,
  filterUserFileOnly,
  findingsOf,
  isStricterOrEqual,
  isUserFileOnly,
  launchMessageIsPrinted,
  launchMessagesOf,
  projectMayNarrow,
  projectValuesOfFile,
  projectWouldDeclare,
  stricterByProse,
  trustClassOf,
  type TrustOutcome,
} from "../../src/load/trust.ts";

const PROJECT_FILE = "/work/specstride.yaml";

/** A filter context whose lower ranks are the table handed in. */
function context(
  lower: Readonly<Record<string, unknown>> = {},
  extra: { profile?: string; declaredScopes?: Record<string, readonly string[]> } = {},
): Parameters<typeof filterProjectKey>[2] {
  return {
    path: PROJECT_FILE,
    fromLowerRanks: (key: string): unknown => lower[key],
    ...(extra.profile === undefined ? {} : { profile: extra.profile }),
    ...(extra.declaredScopes === undefined ? {} : { declaredScopes: extra.declaredScopes }),
  };
}

/** The outcome, asserted to be an ignored one, with its message and finding. */
function ignoredOutcome(outcome: TrustOutcome): Extract<TrustOutcome, { accepted: false }> {
  assert.equal(outcome.accepted, false, `\`${outcome.key}\` was accepted`);
  assert.ok(outcome.accepted === false);
  return outcome;
}

describe("CT-110-115 — a widening key of the project file is ignored (F110-FR-017)", () => {
  it("project configuration is the one rank a trust class filters", () => {
    assert.equal(FILTERED_RANK, "project-configuration");
    assert.deepEqual([...TRUST_CLASSES], ["widening", "narrowing", "neutral", "pinnable"]);
  });

  it("one ignored key gives exactly one launch message and exactly one finding", () => {
    const outcome = ignoredOutcome(filterProjectKey("roles.critic.harness", "codex", context()));
    assert.equal(outcome.reason, "widening");
    assert.equal(trustClassOf("roles.critic.harness"), "widening");
    // One message, naming the file and the key.
    assert.match(outcome.launchMessage, /\/work\/specstride\.yaml/);
    assert.match(outcome.launchMessage, /`roles\.critic\.harness`/);
    assert.equal(launchMessagesOf([outcome]).length, 1);
    // One finding, of the group `config`.
    assert.equal(findingsOf([outcome]).length, 1);
    assert.equal(outcome.finding.id, FINDING_IDS.widening);
    assert.equal(outcome.finding.severity, "warn");
    assert.equal(outcome.finding.lb, false, "the run goes on");
    assert.match(outcome.finding.evidence, /\/work\/specstride\.yaml/);
  });

  it("two ignored keys give two messages and two findings, and no more", () => {
    const outcomes = [
      filterProjectKey("roles.critic.harness", "codex", context()),
      filterProjectKey("telemetry.loki.url", "http://elsewhere:3100", context()),
    ];
    assert.equal(launchMessagesOf(outcomes).length, 2);
    assert.equal(findingsOf(outcomes).length, 2);
    assert.deepEqual(
      findingsOf(outcomes).map((f) => f.id),
      [FINDING_IDS.widening, FINDING_IDS.widening],
    );
  });

  it("under the `parity` profile the message is not printed and the finding stays", () => {
    const outcome = ignoredOutcome(
      filterProjectKey("roles.critic.harness", "codex", context({}, { profile: "parity" })),
    );
    assert.equal(outcome.launchMessageIsPrinted, false, "row 19 of annex X §X.7");
    assert.equal(launchMessagesOf([outcome]).length, 0);
    assert.equal(findingsOf([outcome]).length, 1, "the doctor warning stays");
    // Outside the profile the message is printed.
    assert.equal(launchMessageIsPrinted(undefined), true);
    assert.equal(launchMessageIsPrinted("parity"), false);
  });

  it("the eleven things a project key may not declare each have a key that is refused", () => {
    assert.equal(PROJECT_MUST_NOT_DECLARE.length, 11);
    const cases: readonly [string, string][] = [
      ["harnesses.claude", "a harness"],
      ["roles.critic.harness", "a harness"],
      ["harnesses.claude.bin", "its command line"],
      ["telemetry.loki.url", "an endpoint"],
      ["roles.proposer.credential", "a secret reference"],
      ["roles.critic.model", "a critic"],
      ["sandbox.level", "a containment level"],
      ["sandbox.permissionMode", "a permission flag"],
      ["budget.run.costUsd", "a budget increase"],
      ["host.hooks", "a host hook"],
      ["telemetry.otel.url", "an endpoint"],
      ["traces.captureContent", "content capture"],
    ];
    for (const [key, what] of cases) {
      assert.equal(projectWouldDeclare(key), what, key);
    }
    // The negative half: an ordinary narrowing key declares none of them.
    assert.equal(projectWouldDeclare("loop.maxIter"), undefined);
    assert.equal(projectWouldDeclare("loop.strategy"), undefined);
  });

  it("the run goes on: an ignored key leaves the value of the lower ranks standing", () => {
    const resolved = resolveConfiguration({
      environment: { SPECSTRIDE_TELEMETRY_LOKI_URL: "http://localhost:3100" },
      project: {
        logicalName: "project:config",
        path: PROJECT_FILE,
        layer: "P",
        rankLayer: "project-configuration",
        major: 1,
        values: new Map<string, unknown>(),
        ignoredKeys: [],
        errors: [],
      },
    });
    assert.equal(resolved.values.get("telemetry.loki.url")?.value, "http://localhost:3100");
    assert.equal(resolved.values.get("telemetry.loki.url")?.source, "environment");
  });
});

describe("CT-110-116 — a narrowing key is accepted only if stricter (F110-FR-018)", () => {
  /**
   * One direction of the catalogue, with a value that is stricter than `lower`,
   * one equal to it, and one that is looser than `looserLower`. Each direction of
   * the catalogue stands here once, in both directions.
   */
  const DIRECTIONS: readonly {
    readonly key: string;
    readonly direction: string;
    readonly lower: unknown;
    readonly stricter: unknown;
    readonly equal: unknown;
    readonly looser: unknown;
    readonly looserLower: unknown;
  }[] = [
    {
      key: "loop.maxIter",
      direction: "lo",
      lower: 30,
      stricter: 5,
      equal: 30,
      looser: 100,
      looserLower: 30,
    },
    {
      key: "loop.maxWallMin",
      direction: "lo0",
      lower: 0,
      stricter: 60,
      equal: 0,
      looser: 0,
      looserLower: 60,
    },
    {
      key: "roles.critic.grounding",
      direction: "on",
      lower: false,
      stricter: true,
      equal: false,
      looser: false,
      looserLower: true,
    },
    {
      key: "loop.escalation",
      direction: "off",
      lower: true,
      stricter: false,
      equal: true,
      looser: true,
      looserLower: false,
    },
    {
      key: "loop.promptProtectedBlocks",
      direction: "sub",
      lower: ["yield_contract", "facts"],
      stricter: ["facts"],
      equal: ["yield_contract", "facts"],
      looser: ["yield_contract", "facts", "more"],
      looserLower: ["yield_contract", "facts"],
    },
    {
      key: "verification.mode",
      direction: "prose",
      lower: "plan",
      stricter: "required",
      equal: "plan",
      looser: "off",
      looserLower: "plan",
    },
    {
      key: "loop.strategy",
      direction: "prose",
      lower: "micro",
      stricter: "classic",
      equal: "micro",
      looser: "micro",
      looserLower: "classic",
    },
    {
      key: "loop.parallel.exclude",
      direction: "prose",
      lower: ["t1"],
      stricter: ["t1", "t2"],
      equal: ["t1"],
      looser: [],
      looserLower: ["t1"],
    },
    {
      key: "staleness.check_points",
      direction: "prose",
      lower: ["launch", "resume"],
      stricter: ["launch", "resume", "pass-start"],
      equal: ["launch", "resume"],
      looser: ["launch"],
      looserLower: ["launch", "resume"],
    },
    {
      key: "relaunch.owner",
      direction: "prose",
      lower: "root",
      stricter: "supervise",
      equal: "root",
      looser: "root",
      looserLower: "supervise",
    },
    {
      key: "harnesses.dsh.critic.proof",
      direction: "prose",
      lower: "none",
      stricter: "strict",
      equal: "none",
      looser: "none",
      looserLower: "strict",
    },
  ];

  it("every direction the catalogue uses is covered by this suite", () => {
    const used = new Set(
      CATALOGUE.filter((e) => e.trust === "N").map((e) => e.narrowing ?? "(none)"),
    );
    const covered = new Set(DIRECTIONS.map((d) => d.direction));
    assert.deepEqual([...used].sort(), [...covered].sort());
  });

  it("a stricter value is accepted and an equal value is accepted", () => {
    for (const d of DIRECTIONS) {
      const entry = catalogueEntry(d.key);
      assert.notEqual(entry, undefined, d.key);
      assert.equal(
        isStricterOrEqual(entry!, d.stricter, d.lower),
        true,
        `${d.key}: ${JSON.stringify(d.stricter)} is stricter than ${JSON.stringify(d.lower)}`,
      );
      assert.equal(
        isStricterOrEqual(entry!, d.equal, d.lower),
        true,
        `${d.key}: an equal value is accepted`,
      );
    }
  });

  it("a looser value is refused by the same comparison", () => {
    for (const d of DIRECTIONS) {
      const entry = catalogueEntry(d.key);
      assert.equal(
        isStricterOrEqual(entry!, d.looser, d.looserLower),
        false,
        `${d.key}: ${JSON.stringify(d.looser)} is not stricter`,
      );
    }
  });

  it("with nothing from the lower ranks there is nothing to loosen", () => {
    const entry = catalogueEntry("loop.maxIter");
    assert.equal(isStricterOrEqual(entry!, 100, undefined), true);
    assert.equal(filterProjectKey("loop.maxIter", 100, context()).accepted, true);
  });

  it("a stricter project value is accepted and the looser one is ignored, through the filter", () => {
    const stricter = filterProjectKey("loop.maxIter", 5, context({ "loop.maxIter": 30 }));
    assert.equal(stricter.accepted, true);
    assert.ok(stricter.accepted === true);
    assert.equal(stricter.value, 5);
    assert.equal(stricter.why, "narrowing");

    const looser = ignoredOutcome(
      filterProjectKey("loop.maxIter", 100, context({ "loop.maxIter": 30 })),
    );
    assert.equal(looser.reason, "not-stricter");
    assert.equal(looser.finding.id, FINDING_IDS.notStricter);
    assert.equal(launchMessagesOf([looser]).length, 1);
    assert.match(looser.launchMessage, /not stricter/);
    assert.match(looser.launchMessage, /\/work\/specstride\.yaml/);
  });

  it("`lo0`: 0 is unlimited, so it never narrows and any other value narrows it", () => {
    const entry = catalogueEntry("loop.maxWallMin");
    assert.equal(entry?.narrowing, "lo0");
    assert.equal(isStricterOrEqual(entry!, 0, 60), false, "0 loosens a limit of 60");
    assert.equal(isStricterOrEqual(entry!, 60, 0), true, "60 narrows `unlimited`");
    assert.equal(isStricterOrEqual(entry!, 0, 0), true, "equal");
  });

  it("the three prose forms of the catalogue are read, and an unknown note is not guessed", () => {
    assert.equal(
      stricterByProse("required is stricter than plan, plan than off", "required", "off"),
      true,
    );
    assert.equal(
      stricterByProse("required is stricter than plan, plan than off", "off", "plan"),
      false,
    );
    assert.equal(stricterByProse("a superset is stricter", ["a", "b"], ["a"]), true);
    assert.equal(stricterByProse("a superset is stricter", ["a"], ["a", "b"]), false);
    assert.equal(stricterByProse("classic is stricter", "classic", "micro"), true);
    assert.equal(stricterByProse("classic is stricter", "micro", "classic"), false);
    assert.equal(stricterByProse("a rule nobody wrote down ever", "x", "y"), undefined);
  });

  it("a neutral key of the project file is accepted as it stands", () => {
    assert.equal(trustClassOf("loop.yield.countsAsIter"), "neutral");
    const outcome = filterProjectKey("loop.yield.countsAsIter", true, context());
    assert.equal(outcome.accepted, true);
    assert.ok(outcome.accepted === true);
    assert.equal(outcome.why, "neutral");
  });
});

describe("CT-110-117 — task eligibility and scope narrowing (F110-FR-019)", () => {
  it("the keys F110-FR-019 names as widening are named, the three of feature 107 included", () => {
    assert.ok(WIDENING_KEYS_OF_FR019.includes("harnesses.<id>.pluginAllowlist"));
    assert.ok(WIDENING_KEYS_OF_FR019.includes("engine.executable"));
    assert.ok(WIDENING_KEYS_OF_FR019.includes("state.dir"));
    for (const tail of ["reads", "writes", "sideEffects"]) {
      assert.ok(WIDENING_KEYS_OF_FR019.includes(`verification.scopes.<commandId>.${tail}`), tail);
    }
    // Each of the keys the catalogue does carry is of the class widening.
    for (const key of WIDENING_KEYS_OF_FR019) {
      if (key.startsWith("verification.scopes.")) continue; // feature 107's contract
      assert.equal(trustClassOf(key.replace("<id>", "claude")), "widening", key);
    }
  });

  it("the five keys of the user file only are the five of the requirement", () => {
    assert.deepEqual(
      USER_FILE_ONLY.map((r) => r.key),
      [
        "loop.parallel.allow_detect",
        "sandbox.level",
        "distribution.audience",
        "distribution.termsOverride",
        "toolchains.<id>",
      ],
    );
    assert.equal(isUserFileOnly("loop.parallel.allow_detect", true), true);
    // Only the value `C0` of `sandbox.level` is restricted (CQ-183).
    assert.equal(isUserFileOnly("sandbox.level", "C0"), true);
    assert.equal(isUserFileOnly("sandbox.level", "C2"), false);
    assert.equal(isUserFileOnly("toolchains.node", {}), true);
    assert.equal(isUserFileOnly("loop.maxIter", 3), false);
  });

  it("a user-file-only key from a flag or the environment is ignored with a message and a finding", () => {
    for (const place of ["--set sandbox.level=C0", "SPECSTRIDE_SANDBOX_LEVEL"]) {
      const outcome = ignoredOutcome(filterUserFileOnly("sandbox.level", "C0", place));
      assert.equal(outcome.reason, "user-file-only");
      assert.equal(outcome.finding.id, FINDING_IDS.userFileOnly);
      assert.equal(launchMessagesOf([outcome]).length, 1);
      assert.match(outcome.launchMessage, /user file only/);
    }
    // A level that is not the opt-in passes from a flag.
    assert.equal(
      filterUserFileOnly("sandbox.level", "C2", "--set sandbox.level=C2").accepted,
      true,
    );
  });

  it("the whole loader ignores `--set sandbox.level=C0` and keeps the default", () => {
    const resolved = resolveConfiguration({ argv: ["--set", "sandbox.level=C0"] });
    assert.equal(resolved.values.get("sandbox.level")?.value, "auto");
    assert.equal(resolved.values.get("sandbox.level")?.source, "default");
    const ignoredKeys = resolved.trust.filter((o) => !o.accepted).map((o) => o.key);
    assert.deepEqual(ignoredKeys, ["sandbox.level"]);
  });

  it("the project file may add a task id to the exclusion and never remove one", () => {
    const added = filterProjectKey(
      "loop.parallel.exclude",
      ["t1", "t2"],
      context({ "loop.parallel.exclude": ["t1"] }),
    );
    assert.equal(added.accepted, true);
    assert.ok(added.accepted === true);
    assert.equal(added.why, "adds-an-exclusion");

    const removed = ignoredOutcome(
      filterProjectKey(
        "loop.parallel.exclude",
        ["t2"],
        context({ "loop.parallel.exclude": ["t1", "t2"] }),
      ),
    );
    assert.equal(removed.reason, "removes-an-exclusion");
    assert.match(removed.launchMessage, /`t1`/);
    assert.equal(removed.finding.id, FINDING_IDS.removesAnExclusion);
  });

  it("the project file may narrow a declared scope to a subset", () => {
    const narrowed = filterProjectKey("loop.parallel.scopes.t1", ["src/a"], {
      ...context(),
      declaredScopes: { t1: ["src/a", "src/b"] },
    });
    assert.equal(narrowed.accepted, true);
    assert.ok(narrowed.accepted === true);
    assert.equal(narrowed.why, "project-may-narrow");
    assert.equal(projectMayNarrow(catalogueEntry("loop.parallel.scopes.<taskId>")!), "sub");
  });

  it("a scope wider than the declared one is refused with a doctor finding", () => {
    const wider = ignoredOutcome(
      filterProjectKey("loop.parallel.scopes.t1", ["src/a", "src/c"], {
        ...context(),
        declaredScopes: { t1: ["src/a", "src/b"] },
      }),
    );
    assert.equal(wider.reason, "wider-scope");
    assert.equal(wider.finding.id, FINDING_IDS.widerScope);
    assert.equal(wider.finding.severity, "fail");
    assert.match(wider.launchMessage, /wider than the declared one/);
  });

  it("a scope the project file adds where none was declared is refused", () => {
    const added = ignoredOutcome(filterProjectKey("loop.parallel.scopes.t9", ["src/x"], context()));
    assert.equal(added.reason, "wider-scope");
    assert.match(added.launchMessage, /higher-trust layer declared/);
  });

  it("the project file may lower `loop.parallel.workersMax` and never raise it", () => {
    const entry = catalogueEntry("loop.parallel.workersMax");
    assert.equal(entry?.cells.layers, "F E U; P lowers");
    assert.equal(projectMayNarrow(entry!), "lo");
    const lowered = filterProjectKey(
      "loop.parallel.workersMax",
      2,
      context({ "loop.parallel.workersMax": 4 }),
    );
    assert.equal(lowered.accepted, true);
    const raised = ignoredOutcome(
      filterProjectKey("loop.parallel.workersMax", 8, context({ "loop.parallel.workersMax": 4 })),
    );
    assert.equal(raised.reason, "not-stricter");
  });
});

describe("CT-110-115, CT-110-117 — the filter over a real project file on disk", () => {
  const ROOTS: string[] = [];
  after(() => {
    for (const root of ROOTS) rmSync(root, { recursive: true, force: true });
  });

  function machine(): { readonly env: FileEnvironment; readonly project: string } {
    const root = mkdtempSync(join(tmpdir(), "specstride-110-trust-"));
    ROOTS.push(root);
    const home = join(root, "home");
    const workspace = join(root, "work");
    mkdirSync(home, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    const env: FileEnvironment = {
      home,
      xdgConfigHome: join(home, "xdg-config"),
      xdgStateHome: join(home, "xdg-state"),
      workspaceRealPath: workspace,
      workspaceId: "ws-trust",
    };
    return { env, project: projectConfigPath(env) };
  }

  function put(path: string, text: string): void {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text, "utf8");
  }

  it("the quickstart's scenario 2: a critic and a telemetry address, both ignored", () => {
    const m = machine();
    put(
      m.project,
      "schema: 1\nroles:\n  critic:\n    harness: codex\ntelemetry:\n  loki:\n    url: http://elsewhere:3100\n",
    );
    const files = loadConfigFiles(m.env);
    // The loader of T011 records both as `layer-not-allowed`; the filter is the
    // more specific rule for rank 5 and turns them into ignored keys.
    const raw = projectValuesOfFile(files.project!);
    assert.deepEqual(raw.map((v) => v.key).sort(), ["roles.critic.harness", "telemetry.loki.url"]);
    const resolved = resolveConfiguration({ user: files.user, project: files.project });
    const ignoredKeys = resolved.trust.filter((o) => !o.accepted).map((o) => o.key);
    assert.deepEqual(ignoredKeys.sort(), ["roles.critic.harness", "telemetry.loki.url"]);
    assert.equal(launchMessagesOf(resolved.trust).length, 2, "two launch messages");
    assert.equal(findingsOf(resolved.trust).length, 2, "two doctor warnings");
    // The run goes on: neither key is an error that refuses the launch.
    assert.deepEqual([...resolved.errors], []);
    // And the values are not taken.
    // `roles.critic.harness` has a deferred default ("by the critic order", §K.3),
    // so with the project value ignored no rank gives it a value at all.
    assert.equal(catalogueEntry("roles.critic.harness")?.default.kind, "deferred");
    assert.equal(resolved.values.get("roles.critic.harness"), undefined);
    assert.equal(resolved.values.get("telemetry.loki.url")?.value, "http://localhost:3100");
  });

  it("the quickstart's scenario 1: the project value is accepted only if stricter", () => {
    const m = machine();
    put(userConfigPath(m.env), "schema: 1\nloop:\n  maxIter: 10\n");
    put(m.project, "schema: 1\nloop:\n  maxIter: 5\n");
    const files = loadConfigFiles(m.env);
    const resolved = resolveConfiguration({ user: files.user, project: files.project });
    assert.equal(resolved.values.get("loop.maxIter")?.value, 5);
    assert.equal(resolved.values.get("loop.maxIter")?.source, "project-configuration");

    // With a looser project value, the user file's value stands.
    const m2 = machine();
    put(userConfigPath(m2.env), "schema: 1\nloop:\n  maxIter: 10\n");
    put(m2.project, "schema: 1\nloop:\n  maxIter: 50\n");
    const files2 = loadConfigFiles(m2.env);
    const resolved2 = resolveConfiguration({ user: files2.user, project: files2.project });
    assert.equal(resolved2.values.get("loop.maxIter")?.value, 10);
    assert.equal(resolved2.values.get("loop.maxIter")?.source, "user-configuration");
    assert.equal(launchMessagesOf(resolved2.trust).length, 1);
  });

  it("a type error of the project file still refuses the launch", () => {
    const m = machine();
    put(m.project, "schema: 1\nloop:\n  maxIter: soon\n");
    const files = loadConfigFiles(m.env);
    const resolved = resolveConfiguration({ project: files.project });
    assert.equal(resolved.errors.length, 1);
    assert.equal(resolved.errors[0]?.name, "ConfigValueError");
  });
});
