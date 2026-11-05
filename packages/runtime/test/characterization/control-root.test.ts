/**
 * T016 — characterization tests CT-122-22 and CT-122-39 for the control root
 * (F122-FR-022, F122-FR-039; research D-13).
 *
 *   - **CT-122-22**: a control root that another user can write is refused
 *     with `control-root-unsafe` — a launch exits 4, a state command exits 3 —
 *     and the doctor reports it.
 *   - **CT-122-39**: a control root that cannot be written refuses the launch
 *     with `control-root-not-writable`, and the message names the key of the
 *     control root.
 *
 * Both work on a REAL directory in a scratch place, never on the consumer's
 * state directory, and the state they check is read back from the file system
 * — the mode, the owner, and whether the probe file of D-13 could be written —
 * and not from the return of the function that was called.
 *
 * **On running as root.** This lane's suites run as root in a PID namespace
 * (the owner's ruling of 2026-10-02). Root can write a directory whatever its
 * permission bits say, so the two cases are staged in ways that do not depend
 * on the bits alone:
 *
 *   - "another user can write it" is staged by SETTING the other-write bit,
 *     which is a fact about the directory and not about who is asking; and, as
 *     root, also by giving the directory to another user, which is the sharper
 *     case — a directory owned by somebody else is one whose mode that user can
 *     change at any moment.
 *   - "cannot be written" is staged by putting the control root under a path
 *     component that is a regular FILE. Nothing can create a directory there,
 *     root included, so the refusal is real rather than a permission bit that
 *     root would walk through. The permission-bit case is also run where the
 *     tests are NOT root, and skips with its reason where they are.
 *
 * There is no doctor registry in the workspace yet — EP-14 names
 * `@specstride/kernel` as the place the registration call will live, and that
 * is another feature's task — so this file carries the smallest registry that
 * satisfies the contract's `DoctorRegistry`. The subject under test is the
 * CHECK, not the registry: the finding is built by the contract's own rules
 * (`severityRule`, `lb`, `launchChecks`) and this file adds none.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  chownSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CONTROL_ROOT_KEY,
  CONTROL_ROOT_NOT_WRITABLE,
  CONTROL_ROOT_PARITY_ROW,
  CONTROL_ROOT_REFUSALS,
  CONTROL_ROOT_UNSAFE,
  DIRECTORY_MODE,
  LAUNCH_EXIT_CODE,
  OTHER_WRITE_BITS,
  PROBE_FILE_PREFIX,
  STATE_COMMAND_EXIT_CODE,
  anotherUserCanWrite,
  checkControlRoot,
  createControlRoot,
  exitCodeOf,
  modeOctalOf,
  probeWritability,
} from "../../src/root/control-root.ts";
import {
  CONTROL_ROOT_CHECKS,
  CONTROL_ROOT_CHECK_IDS,
  CONTROL_ROOT_PERMISSIONS_CHECK_ID,
  CONTROL_ROOT_PROBE_KEY,
  CONTROL_ROOT_WRITABLE_CHECK_ID,
  evidenceOf,
  registerControlRootChecks,
} from "../../src/doctor/control-root-checks.ts";
import {
  MESSAGE_TEMPLATE_CAP_BYTES,
  launchChecks,
  type DoctorCheck,
  type DoctorFinding,
  type DoctorRegistry,
  type DoctorRunInput,
} from "@specstride/contracts/ep/doctor";

/** The user this process runs as. */
const UID = typeof process.getuid === "function" ? process.getuid() : null;
const AS_ROOT = UID === 0;

/** A user that is certainly not this one, where we are root and can hand over. */
const ANOTHER_USER = 65534;

/** The reason the permission-bit case of CT-122-39 is a skip when we are root. */
const ROOT_WALKS_THROUGH_PERMISSION_BITS =
  "these tests run as root (the owner's ruling of 2026-10-02), and root writes a directory " +
  "whatever its permission bits say, so a 0500 directory is not a case of `cannot be written` " +
  "here. The case that does not depend on who is asking — a control root under a path " +
  "component that is a regular file — is run above and covers CT-122-39 on this machine";

/** Every scratch directory this file made, removed at the end. */
const made: string[] = [];

function scratch(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `cr-${label}-`));
  made.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of made) {
    try {
      // Give every directory back to this user first, so a directory handed
      // to another user above can still be removed.
      if (AS_ROOT && existsSync(dir)) chownSync(dir, UID ?? 0, 0);
      chmodSync(dir, 0o700);
    } catch {
      /* it is already gone, or it was never ours */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The smallest registry the EP-14 contract accepts. It adds no rule of its own. */
function miniDoctorRegistry(): DoctorRegistry {
  const checks: DoctorCheck[] = [];
  return {
    register(check: DoctorCheck): void {
      checks.push(check);
    },
    registered(): readonly DoctorCheck[] {
      return Object.freeze([...checks]);
    },
    async run(input: DoctorRunInput): Promise<readonly DoctorFinding[]> {
      const findings: DoctorFinding[] = [];
      for (const check of [...checks].sort((a, b) => a.order - b.order)) {
        const observed = await check.probe(input.context);
        // The severity is the CHECK's own rule, and the registry does not
        // second-guess it: that is what makes the doctor and a launch agree.
        findings.push({
          id: check.id,
          severity: check.severityRule(observed),
          lb: check.lb,
          message: check.messageTemplate,
          fix: check.fixHint,
          // The evidence line is the check's own, imported from the module
          // under test: the registry invents nothing.
          evidence: evidenceOf(observed),
        });
      }
      return Object.freeze(findings);
    },
  };
}

/* ------------------------------------------------------------------ *
 * CT-122-22 — a control root another user can write.
 * ------------------------------------------------------------------ */

test("CT-122-22 — a control root another user can write is refused `control-root-unsafe`", () => {
  const parent = scratch("unsafe-bits");
  const root = join(parent, "control");
  createControlRoot(root);
  // Stage it: the other-write bit is a fact about the directory, true whoever
  // is asking, so this case does not depend on the test's own user.
  chmodSync(root, 0o777);

  // Read the staged state back from the file system, not from what we just did.
  const stats = statSync(root);
  assert.notEqual(
    stats.mode & OTHER_WRITE_BITS,
    0,
    "the fixture did not become group/other writable",
  );
  assert.equal(anotherUserCanWrite(stats, UID), true);

  const check = checkControlRoot(root, "cli");
  assert.equal(check.usable, false);
  assert.equal(check.refusal, CONTROL_ROOT_UNSAFE);
  assert.equal(check.evidence.anotherUserCanWrite, true);
  assert.equal(check.evidence.modeOctal, modeOctalOf(stats.mode));

  // The message names the key of the control root and says why.
  assert.match(check.message, new RegExp(CONTROL_ROOT_KEY.replace(".", "\\.")));
  assert.match(check.message, /another user/);
  assert.equal(check.key, CONTROL_ROOT_KEY);

  // Nothing was written into an unsafe control root: the refusal comes before
  // the writability probe, so no probe file was left behind either.
  assert.equal(check.evidence.probeWritten, false);
  assert.deepEqual(
    readdirSync(root).filter((e) => e.startsWith(PROBE_FILE_PREFIX)),
    [],
    "a probe file was written into a control root that was refused as unsafe",
  );
});

test("CT-122-22 — a control root owned by another user is refused, bits or no bits", (t) => {
  if (!AS_ROOT) {
    t.skip("only root can hand a directory to another user, and these tests are not root");
    return;
  }
  const parent = scratch("unsafe-owner");
  const root = join(parent, "control");
  createControlRoot(root);
  // Owner-only bits, but owned by somebody else. This is the sharper case: the
  // bits say 0700 and look safe, and yet that user can change them whenever
  // they like.
  chmodSync(root, DIRECTORY_MODE);
  chownSync(root, ANOTHER_USER, ANOTHER_USER);

  const stats = statSync(root);
  assert.equal(stats.mode & OTHER_WRITE_BITS, 0, "the fixture must have owner-only bits");
  assert.equal(stats.uid, ANOTHER_USER);
  assert.equal(anotherUserCanWrite(stats, UID), true);

  const check = checkControlRoot(root, "runtime-root");
  assert.equal(check.refusal, CONTROL_ROOT_UNSAFE);
  assert.equal(check.evidence.owner, ANOTHER_USER);
  assert.equal(check.evidence.asker, UID);
  assert.match(check.message, /belongs to the user 65534/);
  assert.match(check.message, new RegExp(CONTROL_ROOT_KEY.replace(".", "\\.")));
});

test("CT-122-22 — the exit codes: a launch exits 4 and a state command exits 3", () => {
  assert.equal(LAUNCH_EXIT_CODE, 4);
  assert.equal(STATE_COMMAND_EXIT_CODE, 3);
  assert.equal(exitCodeOf("launch"), 4);
  assert.equal(exitCodeOf("state"), 3);

  // And they are the codes for a real refusal, not constants in the abstract.
  const parent = scratch("unsafe-exit");
  const root = join(parent, "control");
  createControlRoot(root);
  chmodSync(root, 0o777);
  const check = checkControlRoot(root, "cli");
  assert.equal(check.refusal, CONTROL_ROOT_UNSAFE);
  assert.equal(exitCodeOf("launch"), LAUNCH_EXIT_CODE);
  assert.equal(exitCodeOf("state"), STATE_COMMAND_EXIT_CODE);
});

test("CT-122-22 — the doctor reports an unsafe control root, and the finding is launch-blocking", async () => {
  const parent = scratch("unsafe-doctor");
  const root = join(parent, "control");
  createControlRoot(root);
  chmodSync(root, 0o777);

  const registry = miniDoctorRegistry();
  const registered = registerControlRootChecks(registry);
  assert.deepEqual(
    registry.registered().map((c) => c.id),
    [...CONTROL_ROOT_CHECK_IDS],
    "the two checks of T015 were not registered under their ids",
  );
  assert.equal(registered.length, 2);

  const findings = await registry.run({ context: { [CONTROL_ROOT_PROBE_KEY]: root }, flags: {} });
  const permissions = findings.find((f) => f.id === CONTROL_ROOT_PERMISSIONS_CHECK_ID);
  assert.notEqual(permissions, undefined, "the doctor reported no permissions finding");
  assert.equal(permissions?.severity, "fail", "an unsafe control root must be a `fail`");
  assert.equal(permissions?.lb, true, "the check must be launch-blocking");
  assert.match(permissions?.evidence ?? "", /anotherUserCanWrite=true/);
  assert.match(permissions?.evidence ?? "", new RegExp(CONTROL_ROOT_KEY.replace(".", "\\.")));
  assert.match(permissions?.message ?? "", /F122-FR-022/);

  // EP-14 guarantees the launch checks are exactly the `lb` subset, so the
  // doctor and a launch cannot disagree about this control root.
  const blocking = launchChecks(registry.registered());
  assert.deepEqual(
    blocking.map((c) => c.id),
    [...CONTROL_ROOT_CHECK_IDS],
  );
});

test("CT-122-22 — a control root only its owner can write passes both checks", async () => {
  const parent = scratch("safe");
  const root = join(parent, "control");
  createControlRoot(root);

  const stats = statSync(root);
  assert.equal(stats.mode & OTHER_WRITE_BITS, 0);
  assert.equal(modeOctalOf(stats.mode), modeOctalOf(DIRECTORY_MODE));
  assert.equal(anotherUserCanWrite(stats, UID), false);

  const check = checkControlRoot(root, "cli");
  assert.equal(check.usable, true, check.message);
  assert.equal(check.refusal, null);
  assert.equal(check.evidence.probeWritten, true);

  // D-13 — the probe file was written AND removed: nothing is left behind.
  assert.deepEqual(
    readdirSync(root).filter((e) => e.startsWith(PROBE_FILE_PREFIX)),
    [],
    "the writability probe left its file behind",
  );

  const registry = miniDoctorRegistry();
  registerControlRootChecks(registry);
  const findings = await registry.run({ context: { [CONTROL_ROOT_PROBE_KEY]: root }, flags: {} });
  assert.deepEqual(
    findings.map((f) => f.severity),
    ["ok", "ok"],
  );
});

/* ------------------------------------------------------------------ *
 * CT-122-39 — a control root that cannot be written.
 * ------------------------------------------------------------------ */

test("CT-122-39 — a control root that cannot be written refuses the launch and names the key", () => {
  const parent = scratch("not-writable");
  // A regular FILE as a path component. Nothing can make a directory under
  // it, root included, so this case does not depend on who is asking.
  const blocker = join(parent, "a-file");
  writeFileSync(blocker, "not a directory\n", { mode: 0o600 });
  const root = join(blocker, "control");

  // Read the staging back: the blocker really is a file, so the control root
  // really cannot come into being.
  assert.equal(statSync(blocker).isFile(), true);
  assert.equal(existsSync(root), false);

  const check = checkControlRoot(root, "cli");
  assert.equal(check.usable, false);
  assert.equal(check.refusal, CONTROL_ROOT_NOT_WRITABLE);
  assert.equal(check.evidence.probeWritten, false);
  assert.equal(check.evidence.exists, false);
  assert.equal(check.evidence.probeError, "ENOTDIR");

  // F122-FR-039 — *the launch MUST be refused with a message that names the
  // key of the control root*.
  assert.match(
    check.message,
    new RegExp(CONTROL_ROOT_KEY.replace(".", "\\.")),
    `the message of ${CONTROL_ROOT_NOT_WRITABLE} does not name the key \`${CONTROL_ROOT_KEY}\``,
  );
  assert.equal(check.key, CONTROL_ROOT_KEY);
  assert.match(check.message, /F122-FR-039/);
  // It says which asker tested it and before what, as F122-FR-039 names both.
  assert.match(check.message, /the CLI tests it before it writes a launch record/);
  const byRoot = checkControlRoot(root, "runtime-root");
  assert.match(byRoot.message, /the runtime root tests it before it takes the lock/);

  // The launch exits 4 on this refusal.
  assert.equal(exitCodeOf("launch"), LAUNCH_EXIT_CODE);
  // And the directory was not brought into being by the check.
  assert.equal(existsSync(root), false);
});

test("CT-122-39 — a control root that is a file, and not a directory, is refused", () => {
  const parent = scratch("is-a-file");
  const root = join(parent, "control");
  writeFileSync(root, "", { mode: 0o600 });

  assert.equal(statSync(root).isDirectory(), false);
  const check = checkControlRoot(root, "cli");
  assert.equal(check.refusal, CONTROL_ROOT_NOT_WRITABLE);
  assert.equal(check.evidence.probeError, "ENOTDIR");
  assert.match(check.message, new RegExp(CONTROL_ROOT_KEY.replace(".", "\\.")));
});

test("CT-122-39 — a directory whose bits refuse a write is refused", (t) => {
  if (AS_ROOT) {
    t.skip(ROOT_WALKS_THROUGH_PERMISSION_BITS);
    return;
  }
  const parent = scratch("mode-0500");
  const root = join(parent, "control");
  mkdirSync(root, { mode: 0o500 });
  chmodSync(root, 0o500);

  // The write probe of D-13 is what decides, not the bits: it is run and it
  // fails.
  const probe = probeWritability(root);
  assert.equal(probe.written, false);
  assert.equal(probe.error, "EACCES");

  const check = checkControlRoot(root, "cli");
  assert.equal(check.refusal, CONTROL_ROOT_NOT_WRITABLE);
  assert.match(check.message, new RegExp(CONTROL_ROOT_KEY.replace(".", "\\.")));
});

test("CT-122-39 — the doctor reports a control root that cannot be written", async () => {
  const parent = scratch("not-writable-doctor");
  const blocker = join(parent, "a-file");
  writeFileSync(blocker, "", { mode: 0o600 });
  const root = join(blocker, "control");

  const registry = miniDoctorRegistry();
  registerControlRootChecks(registry);
  const findings = await registry.run({ context: { [CONTROL_ROOT_PROBE_KEY]: root }, flags: {} });

  const writable = findings.find((f) => f.id === CONTROL_ROOT_WRITABLE_CHECK_ID);
  assert.equal(writable?.severity, "fail");
  assert.equal(writable?.lb, true);
  assert.match(writable?.message ?? "", /F122-FR-039/);
  assert.match(writable?.evidence ?? "", /probeWritten=false/);
  assert.match(writable?.evidence ?? "", /probeError=ENOTDIR/);
  assert.match(writable?.fix ?? "", new RegExp(CONTROL_ROOT_KEY.replace(".", "\\.")));

  // The permissions check does not claim this one: a directory that does not
  // exist is not a directory another user can write.
  const permissions = findings.find((f) => f.id === CONTROL_ROOT_PERMISSIONS_CHECK_ID);
  assert.equal(permissions?.severity, "ok");
});

/* ------------------------------------------------------------------ *
 * The shape of the two refusals, and the key.
 * ------------------------------------------------------------------ */

test("T015 — the two refusals are members of the closed set of row 212", async () => {
  const { readFile } = await import("node:fs/promises");
  const data = JSON.parse(
    await readFile(new URL("../../src/data/closed-sets.json", import.meta.url), "utf8"),
  ) as { sets: { name: string; row: number; members: string[] }[] };
  const set = data.sets.find((s) => s.name === "launch-refusals-of-122");
  assert.notEqual(set, undefined);
  assert.equal(set?.row, 212);
  for (const refusal of CONTROL_ROOT_REFUSALS) {
    assert.ok(
      set?.members.includes(refusal),
      `\`${refusal}\` is not a member of the closed set of row 212`,
    );
  }
});

test("T015 — the key of the control root is `state.dir`, as row 116 states", async () => {
  assert.equal(CONTROL_ROOT_KEY, "state.dir");
  assert.equal(CONTROL_ROOT_PARITY_ROW, 116);

  const { readFile } = await import("node:fs/promises");
  const rows = JSON.parse(
    await readFile(new URL("../../src/data/parity-rows.json", import.meta.url), "utf8"),
  ) as { rows: { key: string; row: number; requirement: string }[] };
  const row116 = rows.rows.find((r) => r.row === CONTROL_ROOT_PARITY_ROW);
  assert.notEqual(row116, undefined, "row 116 is not in the parity rows of this feature");
  assert.equal(row116?.key, CONTROL_ROOT_KEY);
  assert.equal(row116?.requirement, "F122-FR-039");
});

test("T015 — both message templates are inside the cap of annex G §G.7", () => {
  for (const check of CONTROL_ROOT_CHECKS) {
    const bytes = Buffer.byteLength(check.messageTemplate, "utf8");
    assert.ok(
      bytes <= MESSAGE_TEMPLATE_CAP_BYTES,
      `the template of \`${check.id}\` is ${bytes} bytes and the cap is ${MESSAGE_TEMPLATE_CAP_BYTES}`,
    );
  }
});
