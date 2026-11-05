/**
 * T099 — CT-109-41: recorded versions and their warnings (F109-FR-041).
 *
 * A tested harness adapter has a version range and a `verified-on` date; the
 * version is recorded per pass and per call, `null` where the harness states
 * none; the doctor warns outside the range and on a change between two passes
 * of one run; and nothing is installed, vendored or downloaded to reach a pin.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as versions from "../../src/versions/versions.ts";

const TESTED_DESCRIPTOR = Object.freeze({
  id: "example-cli",
  versionRange: ">=1.0.0 <2.0.0",
  verifiedOn: "2026-10-01",
});

test("CT-109-41: a tested harness adapter has a version range and a verified-on date", () => {
  assert.equal(versions.versionRangeOf(TESTED_DESCRIPTOR), ">=1.0.0 <2.0.0");
  assert.equal(versions.verifiedOnOf(TESTED_DESCRIPTOR), "2026-10-01");
  assert.equal(versions.isTestedVersioned(TESTED_DESCRIPTOR), true);
  // A descriptor that pins nothing (the ordinary bundled kind) is not tested.
  assert.equal(versions.versionRangeOf({ id: "example-cli" }), null);
  assert.equal(versions.verifiedOnOf({ id: "example-cli" }), null);
  assert.equal(versions.isTestedVersioned({ id: "example-cli" }), false);
  // A range without the date (or the reverse) is not the tested pair either.
  assert.equal(versions.isTestedVersioned({ ...TESTED_DESCRIPTOR, verifiedOn: "" }), false);
});

test("CT-109-41: the version is recorded per pass and per call, null where none is stated", () => {
  // A stated version is recorded as it was stated — for a pass and for a call.
  assert.deepEqual(versions.recordCallVersion("1.4.2"), { version: "1.4.2" });
  assert.equal(versions.recordVersion("1.4.2"), "1.4.2");
  // Where the harness states none, the record carries null. A version is
  // never guessed: no default, no 0.0.0, nothing filled in.
  for (const stated of [null, undefined, "", "   "]) {
    assert.deepEqual(versions.recordCallVersion(stated), { version: null });
    assert.equal(versions.recordVersion(stated), null);
  }
});

test("CT-109-41: the doctor warns outside the pinned range and stays quiet inside it", () => {
  const harness = "example-cli";
  // Inside the range: no warning.
  assert.equal(
    versions.versionDoctorWarning({
      harness,
      tested: true,
      version: "1.4.2",
      range: ">=1.0.0 <2.0.0",
    }),
    null,
  );
  // Outside, on both edges: the warning names the gap and states that nothing
  // is installed or downloaded to reach the pin.
  for (const version of ["0.9.9", "2.0.0", "3.1.0"]) {
    const warning = versions.versionDoctorWarning({
      harness,
      tested: true,
      version,
      range: ">=1.0.0 <2.0.0",
    });
    assert.match(warning ?? "", /outside the pinned range/);
    assert.match(warning ?? "", /nothing is installed or downloaded/);
  }
  // A caret and a tilde range hold where they say.
  assert.equal(
    versions.versionDoctorWarning({ harness, tested: true, version: "1.9.0", range: "^1.4.2" }),
    null,
  );
  assert.equal(
    versions.versionDoctorWarning({ harness, tested: true, version: "1.4.9", range: "~1.4.2" }),
    null,
  );
  assert.match(
    versions.versionDoctorWarning({ harness, tested: true, version: "2.0.0", range: "~1.4.2" }) ??
      "",
    /outside the pinned range/,
  );
  // An untested adapter pins nothing, so the doctor never warns through the pin.
  assert.equal(
    versions.versionDoctorWarning({ harness, tested: false, version: "9.9.9", range: null }),
    null,
  );
});

test("CT-109-41: a change of the version between two passes of one run gives a warning", () => {
  const warning = versions.checkVersionStability({
    harness: "example-cli",
    before: "1.4.2",
    after: "1.5.0",
  });
  assert.match(warning ?? "", /changed between two passes/);
  // The same version, and no version on both sides, is stable.
  assert.equal(
    versions.checkVersionStability({ harness: "x", before: "1.4.2", after: "1.4.2" }),
    null,
  );
  assert.equal(versions.checkVersionStability({ harness: "x", before: null, after: null }), null);
  // A version appearing or disappearing between passes is a change too.
  assert.match(
    versions.checkVersionStability({ harness: "x", before: null, after: "1.5.0" }) ?? "",
    /changed between two passes/,
  );
});

test("CT-109-41: nothing is installed, vendored or downloaded to reach a pin", () => {
  // The module exports no install, download or vendor operation at all. (The
  // constant INSTALL_ACTIONS names the closed set of install actions — it is
  // the empty list — so it is excluded by name from this sweep.)
  const exported = Object.keys(versions).sort();
  for (const name of exported) {
    if (name === "INSTALL_ACTIONS") continue;
    assert.doesNotMatch(
      name,
      /install|download|vendor|fetch|npm|registry-request/i,
      `the versions module exports "${name}", which reads as an install path`,
    );
  }
  assert.deepEqual(versions.INSTALL_ACTIONS, []);
  // And the range check itself is pure: it writes nothing next to the caller.
  const dir = mkdtempSync(join(tmpdir(), "ct-109-41-"));
  try {
    const before = readdirSync(dir);
    assert.equal(versions.versionInRange("1.4.2", ">=1.0.0 <2.0.0"), true);
    assert.equal(versions.versionInRange("0.1.0", ">=1.0.0 <2.0.0"), false);
    assert.deepEqual(readdirSync(dir), before, "the range check touched the file system");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
