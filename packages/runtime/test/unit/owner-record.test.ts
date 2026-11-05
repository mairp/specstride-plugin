/**
 * T012 — unit test of the owner record: build, validate against the schema of
 * feature 100, compare with the present process (F122-FR-013; annex B §B.9).
 *
 * The three parts of the module are tested as three claims:
 *
 *   1. a record this module BUILDS passes the validator of feature 100 — which
 *      is the claim that matters, because a build and a validator that
 *      disagreed would be two opinions about one schema;
 *   2. the validator's refusals are reported as the readings row P2 of
 *      `probe-decision-table.json` needs: a missing required field, a missing
 *      or unknown schema, a different major;
 *   3. the comparison with the present process answers in the terms rows P3 to
 *      P6 ask for, and a reading the platform will not give never comes out as
 *      agreement.
 *
 * The recorded fixtures of T011 are used again here, so the comparison can be
 * shown against a boot, a host and a pid namespace that are not this machine's.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OWNER_COMPARISONS,
  OWNER_RECORD_ANNEX_SECTION,
  OWNER_RECORD_FIELDS,
  OWNER_RECORD_REFUSALS,
  SCHEMA_ID,
  UNKNOWN_FIELD,
  buildOwnerRecord,
  compareWithThisProcess,
  isValidOwnerRecord,
  missingRequiredFields,
  validateOwnerRecord,
  type BuiltOwnerRecord,
} from "../../src/lock/owner-record.ts";
import { recordedPlatformIo, type PlatformIo } from "../../src/procs/platform.ts";
import { createProcessPrimitive } from "@specstride/kernel";
import { hostname } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The recorded Linux process file system of T011: a map of path to content. */
type ProcFixture = {
  readonly procRoot: string;
  readonly files: Record<string, string>;
  readonly links: Record<string, string>;
};
const PROC: ProcFixture = JSON.parse(
  readFileSync(resolve(HERE, "..", "fixtures", "proc-linux.json"), "utf8"),
) as ProcFixture;
const PROC_ROOT = PROC.procRoot;

const ENGINE = 4101;
const STRANGER = 4104;

/** The pid namespace the recorded tree's first three processes are in. */
const RECORDED_NAMESPACE = "pid:[4026531836]";

/**
 * The recorded seam of T011's fixtures.
 *
 * The comparison asks for the pid namespace of THIS process, and this process
 * is not in the recorded tree, so the seam is told what it is through the
 * `links` override. Without it the reading would be absent, and an absent
 * reading is deliberately NOT a difference — the comparison would answer
 * `unknown` and these tests could not reach `same-boot` or `other-boot` at
 * all. Which reading is given is the point of each test, so it is a parameter.
 */
function recordedIo(
  hostName: string | null = "recorded-host",
  ourNamespace: string | null = RECORDED_NAMESPACE,
): PlatformIo {
  const links: Record<string, string> = { ...PROC.links };
  if (ourNamespace !== null) links[`${PROC_ROOT}/${process.pid}/ns/pid`] = ourNamespace;
  return recordedPlatformIo({
    platform: "linux",
    procRoot: PROC_ROOT,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    hostName,
    files: PROC.files,
    links,
  });
}

/** A whole, valid record, to mutate one field of at a time. */
function validRecord(): BuiltOwnerRecord {
  const io = recordedIo();
  return buildOwnerRecord(
    { launchId: "L-0001", runTokenHash: "b".repeat(64), pid: ENGINE },
    io,
    createProcessPrimitive(io),
  );
}

/* ------------------------------------------------------------------ *
 * 1. Build.
 * ------------------------------------------------------------------ */

test("T012 — the eight fields of §B.9 are built, and the annex is named", () => {
  assert.equal(OWNER_RECORD_ANNEX_SECTION, "annex B, §B.9");
  assert.equal(OWNER_RECORD_FIELDS.length, 8);
  const record = validRecord();
  for (const field of OWNER_RECORD_FIELDS) {
    assert.ok(field in record, `the built record lacks the field \`${field}\` of §B.9`);
  }
});

test("T012 — a record this module builds passes the validator of feature 100", () => {
  const record = validRecord();
  // This is the claim that matters: the build and the validator are one
  // opinion about the schema, not two.
  const validation = validateOwnerRecord(record);
  assert.equal(validation.ok, true, validation.ok ? "" : validation.message);
  assert.equal(isValidOwnerRecord(record), true);
  // F100-FR-048 — the record carries the id of its schema, and the build and
  // not a caller writes it.
  assert.equal(record.schema, SCHEMA_ID);
  assert.equal(SCHEMA_ID, "specstride.lease/1:owner");
});

test("T012 — the readings come from the platform and not from a guess", () => {
  const io = recordedIo();
  const record = buildOwnerRecord(
    { launchId: "L-0002", runTokenHash: "c".repeat(64), pid: ENGINE },
    io,
    createProcessPrimitive(io),
  );
  assert.equal(record.pid, ENGINE);
  // The recorded engine's own `stat` says its process group is 4101.
  assert.equal(record.processGroup, ENGINE);
  assert.equal(record.bootId, "aebf8686-5592-4fb5-924c-9e1d1ce80e2f");
  assert.equal(record.hostName, "recorded-host");
  assert.equal(record.pidNamespace, "pid:[4026531836]");
  // The start time is written as the decimal of the milliseconds, so two
  // readings of one process compare as equal.
  assert.match(record.startTime, /^\d+$/);
  assert.equal(Number(record.startTime), 1790914734000 + 7956750);
  assert.equal(record.launchId, "L-0002");
  assert.equal(record.runTokenHash, "c".repeat(64));
});

test("T012 — a reading the platform will not give becomes `unknown`, never a guess", () => {
  // A recorded platform that was given no files and no links: nothing at all
  // can be read, which is the case `unknown` exists for.
  const blind = recordedPlatformIo({ platform: "linux", procRoot: PROC_ROOT, hostName: null });
  const record = buildOwnerRecord(
    { launchId: "L-0003", runTokenHash: "d".repeat(64), pid: ENGINE },
    blind,
    createProcessPrimitive(blind),
  );
  assert.equal(record.startTime, UNKNOWN_FIELD);
  assert.equal(record.bootId, UNKNOWN_FIELD);
  assert.equal(record.hostName, UNKNOWN_FIELD);
  // `pidNamespace` is the one field whose `null` is a value: macOS has none.
  assert.equal(record.pidNamespace, null);
  // And it is STILL a valid record: a field that reads `unknown` is text, and
  // the probe is what turns it into `unknown` (row P2), not the validator.
  assert.equal(validateOwnerRecord(record).ok, true);
});

test("T012 — the record is built for this process where the caller names none", () => {
  const record = buildOwnerRecord({ launchId: "L-0004", runTokenHash: "e".repeat(64) });
  assert.equal(record.pid, process.pid);
  assert.equal(record.hostName, hostname());
});

/* ------------------------------------------------------------------ *
 * 2. Validate.
 * ------------------------------------------------------------------ */

test("T012 — a missing required field of §B.9 is refused and named", () => {
  for (const field of OWNER_RECORD_FIELDS) {
    const record = { ...validRecord() } as Record<string, unknown>;
    delete record[field];
    const validation = validateOwnerRecord(record);
    assert.equal(validation.ok, false, `a record without \`${field}\` was accepted`);
    if (validation.ok) continue;
    assert.equal(validation.refusal, "missing-required-field");
    assert.deepEqual([...validation.missing], [field]);
    assert.ok(validation.message.length > 0);
  }
  // And `missingRequiredFields` is the same answer on its own.
  assert.deepEqual([...missingRequiredFields(null)], [...OWNER_RECORD_FIELDS]);
  assert.deepEqual([...missingRequiredFields("not an object")], [...OWNER_RECORD_FIELDS]);
  assert.deepEqual([...missingRequiredFields(validRecord())], []);
});

test("T012 — `pidNamespace` of null is a VALUE and not a missing field", () => {
  // macOS has no pid namespace, so a record made there carries `null` and must
  // not read as incomplete.
  const record = { ...validRecord(), pidNamespace: null };
  assert.deepEqual([...missingRequiredFields(record)], []);
  assert.equal(validateOwnerRecord(record).ok, true);
  // Absent, however, is absent.
  const absent = { ...validRecord() } as Record<string, unknown>;
  delete absent["pidNamespace"];
  assert.deepEqual([...missingRequiredFields(absent)], ["pidNamespace"]);
});

test("T012 — a record with no schema, an unknown schema or another major is refused", () => {
  const whole = { ...validRecord() } as Record<string, unknown>;

  delete whole["schema"];
  const noSchema = validateOwnerRecord(whole);
  assert.equal(noSchema.ok, false);
  if (!noSchema.ok) assert.equal(noSchema.refusal, "missing-schema");

  const otherMajor = validateOwnerRecord({ ...validRecord(), schema: "specstride.lease/9:owner" });
  assert.equal(otherMajor.ok, false);
  if (!otherMajor.ok) assert.equal(otherMajor.refusal, "different-major");

  const unknown = validateOwnerRecord({ ...validRecord(), schema: "someone.else/1:owner" });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.refusal, "unknown-schema");

  for (const refusal of ["missing-schema", "different-major", "unknown-schema"]) {
    assert.ok(
      (OWNER_RECORD_REFUSALS as readonly string[]).includes(refusal),
      `\`${refusal}\` is not in the refusal set`,
    );
  }
});

test("T012 — an unknown FIELD is accepted: a later version is not refused by this one", () => {
  // The unknown-value rule of annex F §F.5 and annex B §B.4: an owner record
  // with an unknown field is accepted.
  const record = { ...validRecord(), somethingLater: { nested: true } };
  const validation = validateOwnerRecord(record);
  assert.equal(validation.ok, true, validation.ok ? "" : validation.message);
});

/* ------------------------------------------------------------------ *
 * 3. Compare with the present process.
 * ------------------------------------------------------------------ */

test("T012 — a record of another host is `foreign` (row P3)", () => {
  const record = { ...validRecord(), hostName: "somewhere-else" };
  const result = compareWithThisProcess(record, recordedIo("recorded-host"));
  assert.equal(result.comparison, "foreign");
  assert.equal(result.foreign, true);
  assert.match(result.detail, /somewhere-else/);
  assert.match(result.detail, /never reclaimed\s+automatically|never reclaimed automatically/);
});

test("T012 — a record of another pid namespace is `foreign` (row P3)", () => {
  const io = recordedIo();
  // The recorded stranger is in another pid namespace, and this comparison is
  // made as the engine's namespace.
  const record = {
    ...validRecord(),
    pidNamespace: "pid:[4026531999]",
  };
  const result = compareWithThisProcess(record, io);
  assert.equal(result.foreign, true);
  assert.equal(result.comparison, "foreign");
  assert.ok(STRANGER > 0);
});

test("T012 — a record of another boot is `other-boot`: the owner counts as dead", () => {
  // F122-FR-013 — *an owner whose boot identity differs from the present boot
  // MUST count as dead, whatever process now has its pid*.
  const io = recordedIo();
  const here = buildOwnerRecord(
    { launchId: "L", runTokenHash: "f".repeat(64), pid: ENGINE },
    io,
    createProcessPrimitive(io),
  );
  const result = compareWithThisProcess({ ...here, bootId: "an-older-boot" }, io);
  assert.equal(result.comparison, "other-boot");
  assert.equal(result.sameBoot, false);
  assert.equal(result.foreign, false);
  assert.match(result.detail, /counts as dead/);
  assert.match(result.detail, /an-older-boot/);
});

test("T012 — a record of this boot and host, of another process, is `same-boot`", () => {
  const io = recordedIo();
  const here = buildOwnerRecord(
    { launchId: "L", runTokenHash: "f".repeat(64), pid: ENGINE },
    io,
    createProcessPrimitive(io),
  );
  // Compared as a process whose pid namespace and host agree with the record.
  const result = compareWithThisProcess(here, io);
  assert.equal(result.foreign, false);
  assert.equal(result.sameBoot, true);
  assert.equal(result.comparison, "same-boot");
  assert.equal(result.isThisProcess, false);
  assert.match(result.detail, /for the liveness check to say/);
});

test("T012 — the record of this very process is `self`", () => {
  // Against the LIVE platform, because that is the only place this process
  // exists.
  const record = buildOwnerRecord({ launchId: "L", runTokenHash: "a".repeat(64) });
  const result = compareWithThisProcess(record);
  assert.equal(result.comparison, "self");
  assert.equal(result.isThisProcess, true);
  assert.equal(result.foreign, false);
  assert.equal(result.sameBoot, true);
  assert.deepEqual([...result.unreadable], []);
  assert.match(result.detail, new RegExp(`pid ${process.pid}`));
});

test("T012 — a reading that could not be taken is `unknown` and never agreement", () => {
  const record = validRecord();
  const blind = recordedPlatformIo({ platform: "linux", procRoot: PROC_ROOT, hostName: null });
  const result = compareWithThisProcess(record, blind);
  assert.equal(result.comparison, "unknown");
  assert.ok(result.unreadable.length > 0, "nothing was reported as unreadable");
  assert.equal(result.sameBoot, false, "an unreadable boot must never compare as the same boot");
  assert.equal(result.isThisProcess, false);
  assert.match(result.detail, /counts as held/);
});

test("T012 — a record whose own fields read `unknown` cannot be compared either", () => {
  const io = recordedIo();
  const result = compareWithThisProcess(
    { ...validRecord(), hostName: UNKNOWN_FIELD, bootId: UNKNOWN_FIELD },
    io,
  );
  assert.equal(result.sameBoot, false);
  assert.ok(result.unreadable.includes("record.hostName"));
  assert.ok(result.unreadable.includes("record.bootId"));
  assert.equal(result.comparison, "unknown");
});

test("T012 — every comparison this module can give is in the closed set", () => {
  const io = recordedIo();
  const cases = [
    validRecord(),
    { ...validRecord(), hostName: "elsewhere" },
    { ...validRecord(), bootId: "older" },
    { ...validRecord(), hostName: UNKNOWN_FIELD },
  ];
  for (const record of cases) {
    const result = compareWithThisProcess(record, io);
    assert.ok(
      (OWNER_COMPARISONS as readonly string[]).includes(result.comparison),
      `\`${result.comparison}\` is not in the closed set of comparisons`,
    );
    assert.ok(result.detail.length > 0, "a comparison came back with no detail line");
  }
});

test("T012 — an UNREADABLE pid namespace is not a differing one (it is `unknown`)", () => {
  // The defect this test pins: an absence is not a difference. A machine on
  // which `/proc/self/ns/pid` cannot be read must answer `unknown` — exit 24,
  // which `resume` can clear — and never `foreign`, which is exit 4 and is
  // never reclaimed automatically. The difference decides whether a consumer
  // can recover their workspace.
  const io = recordedIo("recorded-host", null);
  const result = compareWithThisProcess(validRecord(), io);
  assert.equal(result.foreign, false, "an unreadable pid namespace was read as a foreign one");
  assert.equal(result.comparison, "unknown");
  assert.ok(result.unreadable.includes("pidNamespace"));

  // And a namespace that really differs, both sides readable, IS foreign.
  const reallyForeign = compareWithThisProcess(
    { ...validRecord(), pidNamespace: "pid:[4026539999]" },
    recordedIo("recorded-host", RECORDED_NAMESPACE),
  );
  assert.equal(reallyForeign.foreign, true);
  assert.equal(reallyForeign.comparison, "foreign");
});
