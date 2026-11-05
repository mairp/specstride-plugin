/**
 * T005 — the doctor check for git and its version, in the doctor check
 * registry (`packages/tree-store/src/doctor.ts`; EP-14, annex G §G.7;
 * research.md D-3).
 *
 * What this test observes:
 *
 *  1 the check REACHES THE REGISTRY: `registerGitDoctorChecks` hands it to the
 *    registration call, it is then among `registered()`, and registering twice
 *    leaves one check, because ids are never renamed;
 *  2 the FLOOR IS 2.31 and the comparison is NUMERIC: 2.31.0 and 2.47.3 are at
 *    or above it, 2.30.2 and 2.4 are below it — `2.4` is the case a string
 *    comparison gets wrong;
 *  3 an ABSENT git is `fail`, a git that reports no version is `fail`;
 *  4 the real executable of this machine is read by the probe, which starts a
 *    process with standard input closed, a time limit and an output cap;
 *  5 the check is NOT launch-blocking by default, because parallel units are
 *    off by default and off under the `parity` profile, and IS launch-blocking
 *    with parallel units on;
 *  6 the message template keeps to the cap of 200 bytes of §G.7, and the
 *    finding carries the floor and its source as evidence.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { launchChecks, MESSAGE_TEMPLATE_CAP_BYTES } from "@specstride/contracts/ep/doctor";
import type { DoctorCheck } from "@specstride/contracts/ep/doctor";
import {
  GIT_CHECK_GROUP,
  GIT_CHECK_ID,
  GIT_CHECK_MESSAGE_TEMPLATE,
  GIT_DOCTOR_CHECK,
  GIT_FLOOR,
  GIT_FLOOR_SOURCE,
  GIT_FLOOR_VERSION_PROBED,
  checksOfThisPackage,
  compareVersions,
  findingOf,
  gitDoctorCheck,
  gitSeverity,
  meetsTheGitFloor,
  probeGit,
  registerGitDoctorChecks,
  registerTheDoctorChecksOfTheFeature,
  versionFromOutput,
  type DoctorCheckRegistry,
} from "../src/doctor.ts";
import { groupsOfADoctorCheck } from "@specstride/contracts/enums/all-sets";

/** A registry of the shape §G.7 gives, standing for the kernel's. */
function registry(): DoctorCheckRegistry & { readonly all: DoctorCheck[] } {
  const all: DoctorCheck[] = [];
  return {
    all,
    register(check: DoctorCheck): void {
      all.push(check);
    },
    registered(): readonly DoctorCheck[] {
      return Object.freeze([...all]);
    },
  };
}

test("T005 the check is added to the doctor check registry, once", () => {
  const r = registry();
  assert.deepEqual(r.registered(), []);

  const added = registerGitDoctorChecks(r);
  assert.equal(added.length, 1);
  assert.equal(r.registered().length, 1);
  assert.equal(r.registered()[0]?.id, GIT_CHECK_ID);

  // Registering twice leaves one: ids are unique and never renamed (§G.7).
  registerGitDoctorChecks(r);
  assert.equal(r.registered().filter((c) => c.id === GIT_CHECK_ID).length, 1);

  // The package states which checks it registers: the git check of T005,
  // and — T069 — the three checks of the feature, in `order`.
  assert.deepEqual(
    checksOfThisPackage().map((c) => c.id),
    [
      GIT_CHECK_ID,
      "parallel.run-token.holders",
      "parallel.worker-caches",
      "store.configuration-hash",
    ],
  );
});

/* ------------------------------------------------------------------ *
 * T069 — the three checks of the feature.
 * ------------------------------------------------------------------ */

test("T069 the run-token-holders check fails on a holder the registry does not own", async () => {
  const check = checksOfThisPackage({ parallelUnitsOn: true }).find(
    (c) => c.id === "parallel.run-token.holders",
  );
  assert.ok(check, "the check is registered");
  assert.equal(check.lb, true, "launch-blocking with parallel units on");
  assert.equal(
    checksOfThisPackage().find((c) => c.id === "parallel.run-token.holders")?.lb,
    false,
    "not launch-blocking by default",
  );
  assert.equal(check.severityRule({ observable: true, holders: [{ pid: 41, known: true }] }), "ok");
  assert.equal(check.severityRule({ observable: true, holders: [] }), "ok");
  assert.equal(
    check.severityRule({
      observable: true,
      holders: [
        { pid: 41, known: true },
        { pid: 4242, known: false },
      ],
    }),
    "fail",
    "F143-FR-018: an unowned holder is a failure",
  );
  assert.equal(check.severityRule({ observable: false, holders: [] }), "warn");
  const observed = await check.probe({});
  assert.deepEqual(observed, { observable: false, holders: [] });
  const injected = await check.probe({
    "run-token-holders": { observable: true, holders: [{ pid: 7, known: false }] },
  });
  assert.equal(check.severityRule(injected), "fail");
});

test("T069 the worker-caches check accepts only `shared`", async () => {
  const check = checksOfThisPackage({ parallelUnitsOn: true }).find(
    (c) => c.id === "parallel.worker-caches",
  );
  assert.ok(check, "the check is registered");
  assert.equal(check.lb, true);
  assert.equal(check.severityRule("shared"), "ok");
  assert.equal(check.severityRule({ "worker-caches": "shared" }), "ok");
  assert.equal(check.severityRule({ "worker-caches": "per-worker" }), "fail");
  assert.equal(check.severityRule(""), "warn", "not set is a warning, not a refusal");
  const observed = await check.probe({});
  assert.equal(observed, "");
  const injected = await check.probe({ "worker-caches": "shared" });
  assert.equal(check.severityRule(injected), "ok");
});

test("T069 the store-configuration-hash check compares the store against its recorded hash", async (t) => {
  const check = checksOfThisPackage({ parallelUnitsOn: true }).find(
    (c) => c.id === "store.configuration-hash",
  );
  assert.ok(check, "the check is registered");
  assert.equal(check.lb, true);
  assert.equal(
    check.severityRule({ recorded: "a", found: "a", equal: true, compared: true }),
    "ok",
  );
  assert.equal(
    check.severityRule({ recorded: "a", found: "b", equal: false, compared: true }),
    "fail",
  );
  assert.equal(
    check.severityRule({ recorded: "", found: "b", equal: true, compared: false }),
    "warn",
  );
  assert.equal(check.severityRule(null), "warn", "no store given is a warning");
  const observed = await check.probe({});
  assert.deepEqual(observed, { recorded: "", found: "", equal: false, compared: false });

  // A real store: the probe computes the comparison from the places.
  const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "t069-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "store"), { recursive: true });
  mkdirSync(join(dir, "control"), { recursive: true });
  const places = { control: join(dir, "control"), store: join(dir, "store") };
  writeFileSync(join(places.store, "config"), "[core]\n\trepositoryformatversion = 0\n");
  const before = await check.probe({ "tree-store-places": places });
  assert.equal(check.severityRule(before), "warn", "nothing recorded yet");
  writeFileSync(
    join(places.control, "tree-store-config.sha256"),
    `${before && typeof before === "object" ? (before as { found: string }).found : ""}\n`,
  );
  const after = await check.probe({ "tree-store-places": places });
  assert.equal(check.severityRule(after), "ok");
  writeFileSync(join(places.store, "config"), "[core]\n\trepositoryformatversion = 1\n");
  const changed = await check.probe({ "tree-store-places": places });
  assert.equal(check.severityRule(changed), "fail");
});

test("T069 registerTheDoctorChecksOfTheFeature registers all four checks, once each", () => {
  const r = registry();
  const added = registerTheDoctorChecksOfTheFeature(r, { parallelUnitsOn: true });
  assert.equal(added.length, 4);
  assert.equal(new Set(added.map((c) => c.id)).size, 4);
  assert.ok(
    added.every((c) => c.lb),
    "all four are launch-blocking with parallel units on",
  );
  registerTheDoctorChecksOfTheFeature(r, { parallelUnitsOn: true });
  assert.equal(r.registered().length, 4, "registering twice adds nothing");
  for (const c of added) {
    assert.match(
      c.id,
      /^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/,
      `the id ${c.id} is of the stable dotted form`,
    );
    assert.ok(
      (groupsOfADoctorCheck.members as readonly string[]).includes(
        c.id === "parallel.run-token.holders" ? "run" : "config",
      ),
      `the group of ${c.id} is of row 134 of annex X §X.6`,
    );
    assert.ok(
      Buffer.byteLength(c.messageTemplate) <= MESSAGE_TEMPLATE_CAP_BYTES,
      `the message template of ${c.id} keeps to the cap`,
    );
  }
});

test("T005 the id is of the stable dotted form, and its group is of row 134", () => {
  assert.equal(GIT_CHECK_ID, "bin.git.version");
  assert.match(GIT_CHECK_ID, /^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/);
  assert.ok(
    (groupsOfADoctorCheck.members as readonly string[]).includes(GIT_CHECK_GROUP),
    `the group ${GIT_CHECK_GROUP} must be of row 134 of annex X §X.6`,
  );
});

test("T005 the floor is 2.31 of research.md D-3, and the comparison is numeric", () => {
  assert.equal(GIT_FLOOR, "2.31");
  assert.match(GIT_FLOOR_SOURCE, /research\.md D-3/);
  // Task T002 ran the probe CT-143-132 on this version.
  assert.equal(GIT_FLOOR_VERSION_PROBED, "2.31.0");
  assert.ok(meetsTheGitFloor(GIT_FLOOR_VERSION_PROBED));

  // At or above.
  for (const version of ["2.31", "2.31.0", "2.31.8", "2.32.0", "2.47.3", "3.0.0", "10.0.0"]) {
    assert.equal(meetsTheGitFloor(version), true, `${version} is at or above the floor`);
  }
  // Below. `2.4` is the case a string comparison gets wrong, because "2.4"
  // sorts after "2.31" as text.
  for (const version of ["2.30.2", "2.30", "2.4", "2.9.5", "1.9.1", "2"]) {
    assert.equal(meetsTheGitFloor(version), false, `${version} is below the floor`);
  }
  assert.equal(compareVersions("2.4", "2.31"), -1, "numeric, not textual");
  assert.equal(compareVersions("2.31", "2.31.0"), 0, "a missing component counts as zero");
  assert.equal(compareVersions("2.47.3", "2.31"), 1);
});

test("T005 the severity is fail where git is absent or below the floor", () => {
  assert.equal(gitSeverity({ present: true, version: "2.31.0", reason: "" }), "ok");
  assert.equal(gitSeverity({ present: true, version: "2.47.3", reason: "" }), "ok");
  assert.equal(gitSeverity({ present: true, version: "2.30.2", reason: "" }), "fail");
  assert.equal(gitSeverity({ present: false, version: "", reason: "ENOENT" }), "fail");
  assert.equal(gitSeverity({ present: true, version: "", reason: "no version" }), "fail");
  // Nothing observed at all is a failure and never an `ok`.
  assert.equal(gitSeverity(undefined), "fail");
  assert.equal(gitSeverity(null), "fail");
  assert.equal(gitSeverity("2.47.3"), "fail", "a bare string is not an observation");
});

test("T005 the probe reads a version out of the output of git --version", () => {
  assert.equal(versionFromOutput("git version 2.47.3\n"), "2.47.3");
  assert.equal(versionFromOutput("git version 2.31.0\n"), "2.31.0");
  assert.equal(versionFromOutput("git version 2.39.5 (Apple Git-154)\n"), "2.39.5");
  assert.equal(versionFromOutput("not git at all\n"), "");
});

test("T005 the probe reads the real executable of this machine", async () => {
  const observed = await GIT_DOCTOR_CHECK.probe({});
  const o = observed as { present: boolean; version: string };
  assert.equal(o.present, true, "git is a platform dependency of the product");
  assert.match(o.version, /^\d+\.\d+/);
  assert.equal(GIT_DOCTOR_CHECK.severityRule(observed), "ok");

  // An executable that is not there is `fail` and throws nothing.
  const absent = probeGit("/nonexistent/git-that-is-not-installed");
  assert.equal(absent.present, false);
  assert.ok(absent.reason.length > 0);
  assert.equal(gitSeverity(absent), "fail");

  // An injected observation is what a conformance suite feeds in.
  const injected = await GIT_DOCTOR_CHECK.probe({
    [GIT_CHECK_ID]: { present: true, version: "2.30.2", reason: "" },
  });
  assert.equal(GIT_DOCTOR_CHECK.severityRule(injected), "fail");
});

test("T005 the check is launch-blocking only with parallel units on", () => {
  // Off by default and off under the `parity` profile: an old git must not
  // refuse a launch that will never reach the store.
  assert.equal(GIT_DOCTOR_CHECK.lb, false);
  assert.deepEqual(launchChecks([GIT_DOCTOR_CHECK]), []);

  const on = gitDoctorCheck({ parallelUnitsOn: true });
  assert.equal(on.lb, true);
  assert.deepEqual(
    launchChecks([on]).map((c) => c.id),
    [GIT_CHECK_ID],
  );
});

test("T005 the message template keeps to the cap, and the finding carries the floor", () => {
  assert.ok(
    Buffer.byteLength(GIT_CHECK_MESSAGE_TEMPLATE, "utf8") <= MESSAGE_TEMPLATE_CAP_BYTES,
    "at most 200 bytes (§G.7)",
  );
  assert.match(GIT_CHECK_MESSAGE_TEMPLATE, /\{state\}/);
  assert.match(GIT_CHECK_MESSAGE_TEMPLATE, /2\.31/);

  const ok = findingOf(GIT_DOCTOR_CHECK, { present: true, version: "2.47.3", reason: "" });
  assert.equal(ok.severity, "ok");
  assert.match(ok.message, /2\.47\.3/);
  assert.ok(Buffer.byteLength(ok.message, "utf8") <= MESSAGE_TEMPLATE_CAP_BYTES);
  assert.match(ok.evidence, /floor 2\.31/);
  assert.match(ok.fix, /install git 2\.31 or later/);

  const old = findingOf(GIT_DOCTOR_CHECK, { present: true, version: "2.30.2", reason: "" });
  assert.equal(old.severity, "fail");
  assert.match(old.message, /below the floor/);

  const missing = findingOf(GIT_DOCTOR_CHECK, { present: false, version: "", reason: "ENOENT" });
  assert.equal(missing.severity, "fail");
  assert.match(missing.message, /not usable/);
});
