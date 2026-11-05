/**
 * T061 — CT-122-33, CT-122-34, CT-122-35, CT-122-36: the three state commands
 * (F122-FR-033, F122-FR-034, F122-FR-035, F122-FR-036; the lines and exit
 * codes of `specs/122-detached-runtime/contracts/cli-state-commands.md`).
 *
 * The subject is `packages/runtime/src/state/archive.ts`,
 * `packages/runtime/src/state/commands.ts` and
 * `packages/cli/src/commands/state.ts`.
 *
 * Every assertion reads the DISK. A command that says it wrote nothing is not
 * believed: the test lists the directory before and after and compares the
 * listing. A command that says the archive is signed is not believed either:
 * the test changes a byte of the archive and watches the next command refuse.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDirectoryLock } from "../../src/lock/directory-lock.ts";
import { buildOwnerRecord } from "../../src/lock/owner-record.ts";
import { probeLock, countsAsHeld } from "../../src/lock/probe.ts";
import {
  ARCHIVE_FILE_MODE,
  ARCHIVE_SCHEMA_ID,
  approvalSignatureIsValid,
  decompressArchive,
  manifestSignatureIsValid,
  memberHash,
  signedText,
  validateArchive,
  verifyArchive,
} from "../../src/state/archive.ts";
import {
  EXIT_ALIVE,
  EXIT_NO_STATE_OR_VERIFICATION,
  EXIT_OK,
  EXIT_USAGE,
  aRunOfTheFeatureIsAlive,
  moveDirectory,
  stateAdopt,
  stateExport,
  stateImport,
  verifyApprovalsOf,
} from "../../src/state/commands.ts";
import { approvalFilesOf, statePathsOf } from "../../src/state/paths.ts";
import {
  IMPORTS_THE_RUNTIME_PACKAGE,
  runStateCommand,
  type StateCommandPort,
} from "../../../cli/src/commands/state.ts";

/**
 * LR-1 of annex A §A.2 forbids the CLI (L6) to import the runtime (L5) —
 * *between the CLI and the runtime root there are only files* (F100-FR-003) —
 * so `packages/cli/src/commands/state.ts` takes the three commands as a PORT
 * and names no module of `@specstride/runtime`. This is the wiring the
 * composition root of the command surface will do; the test does it here, so
 * that the surface and the behaviour are proven against each other and not
 * each against a stub.
 */
const THE_RUNTIME_IMPLEMENTATIONS: StateCommandPort = {
  export: stateExport as unknown as StateCommandPort["export"],
  import: stateImport as unknown as StateCommandPort["import"],
  adopt: stateAdopt as unknown as StateCommandPort["adopt"],
};
import {
  anApprovalRecord,
  makeScratchWorld,
  plantFeatureState,
  type ScratchWorld,
} from "../helpers/feature-state.ts";

/** Every file under a directory, relative to it, sorted: a listing to compare. */
function listing(root: string): readonly string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (at: string, prefix: string): void => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const shown = prefix === "" ? name : `${prefix}/${name}`;
      if (statSync(path).isDirectory()) walk(path, shown);
      else out.push(`${shown} ${String(statSync(path).size)}`);
    }
  };
  walk(root, "");
  return out.sort();
}

/* ================================================================== *
 * CT-122-33 — `state export` (F122-FR-033).
 * ================================================================== */

test("CT-122-33: `state export` writes one signed archive of the feature, and the line of the contract", async () => {
  const world = makeScratchWorld("ct33");
  try {
    const tree = world.tree("here");
    const planted = plantFeatureState({ plane: world.plane(tree) });
    const out = join(world.outside, "122.ssa");
    const lines: string[] = [];

    const result = await stateExport({
      place: planted.place,
      slug: planted.slug,
      out,
      productVersion: "1.2.3",
      print: (line) => void lines.push(line),
    });

    assert.equal(result.exit, EXIT_OK);
    assert.equal(result.approvals, planted.phases.length);
    // The line of `cli-state-commands.md`, to the character.
    assert.equal(
      result.line,
      `[SPECSTRIDE-STATE] action=export feature=${planted.slug} approvals=${String(planted.phases.length)} out=${out}`,
    );
    assert.deepEqual(lines, [result.line]);

    // The archive is on disk, and it is COMPRESSED: the bytes are not JSON.
    assert.ok(existsSync(out), "the archive exists");
    const bytes = readFileSync(out);
    assert.throws(() => JSON.parse(bytes.toString("utf8")), "the file is not plain JSON");
    const document = JSON.parse(gunzipSync(bytes).toString("utf8")) as Record<string, unknown>;
    assert.equal(document["schema"], ARCHIVE_SCHEMA_ID);

    // The manifest: the five required fields, and a hash of every member.
    const read = validateArchive(document);
    assert.ok(read.ok, "the archive validates against the schema of the contract");
    const archive = read.ok ? read.archive : undefined;
    assert.ok(archive !== undefined);
    assert.equal(archive.manifest.feature, planted.slug);
    assert.equal(archive.manifest.workspaceId, planted.workspaceId);
    assert.equal(archive.manifest.productVersion, "1.2.3");
    assert.ok(Date.parse(archive.manifest.createdAt) > 0, "`createdAt` is a time");
    for (const member of ["approvals", "ledger", "learning", "keys"]) {
      assert.equal(
        archive.manifest.hashes[member],
        memberHash((archive.members as Record<string, unknown>)[member]),
        `the manifest hashes \`${member}\``,
      );
    }

    // SIGNED, and verified with the key the archive carries (CQ-139).
    assert.equal(typeof archive.sig, "string");
    assert.notEqual(archive.sig, "");
    const verified = verifyArchive(document);
    assert.ok(verified.ok, `the archive verifies: ${JSON.stringify(verified.failures)}`);
    assert.equal(verified.approvals, planted.phases.length);
    assert.equal(archive.members.keys?.approval, planted.approvalKey);

    // …and signed with THE APPROVAL KEY OF THE FEATURE, which `verifyArchive`
    // alone cannot witness: it signs and verifies through one function, so a
    // signature made with any other key would still agree with itself. The
    // expectation is therefore recomputed HERE, from the planted key and
    // `node:crypto` directly, which is the only non-circular witness of WHICH
    // key signed the archive (CQ-139, F122-FR-033).
    assert.equal(
      archive.sig,
      createHmac("sha256", planted.approvalKey)
        .update(signedText(archive.manifest), "utf8")
        .digest("hex"),
      "the signature is an hmac-sha256 over the canonical manifest with the approval key",
    );
    assert.equal(
      manifestSignatureIsValid(archive, `${planted.approvalKey}-but-not-quite`),
      false,
      "and a near-miss key does not verify it",
    );

    // OWNER-ONLY: 0600 and nothing wider, read off the file system. The bits
    // are pinned as a LITERAL as well as against the module's own constant,
    // because comparing only with the constant would follow it wherever it
    // went and prove nothing about the requirement.
    const bits = statSync(out).mode & 0o777;
    assert.equal(bits, ARCHIVE_FILE_MODE);
    assert.equal(bits, 0o600, "the archive is readable and writable by its owner only");
    assert.equal(bits & 0o077, 0, "no bit at all for the group or for anybody else");

    // The members are the real records of the plane, not a sketch.
    assert.equal(archive.members.approvals.length, planted.phases.length);
    assert.equal(archive.members.ledger.length, planted.phases.length);
    for (const record of archive.members.approvals) {
      assert.ok(
        approvalSignatureIsValid(record as Record<string, unknown>, planted.approvalKey),
        "every approval record in the archive is signed with the approval key",
      );
    }
    // No temporary file is left behind by the atomic write.
    assert.deepEqual(
      readdirSync(world.outside).filter((name) => name !== "122.ssa"),
      [],
      "the write left no temporary file",
    );
  } finally {
    world.dispose();
  }
});

test("CT-122-33: `state export` refuses a location inside the working tree, exit 3, and writes nothing", async () => {
  const world = makeScratchWorld("ct33b");
  try {
    const tree = world.tree("here");
    const planted = plantFeatureState({ plane: world.plane(tree) });
    const inside = join(tree, "sub", "122.ssa");
    const before = listing(tree);
    const lines: string[] = [];

    const result = await stateExport({
      place: planted.place,
      slug: planted.slug,
      out: inside,
      print: (line) => void lines.push(line),
    });

    assert.equal(result.exit, EXIT_USAGE, "`--out` inside the working tree is exit 3");
    assert.equal(result.refusal, "location-in-the-working-tree");
    assert.ok(result.wroteNothing);
    // F122-FR-036 — one line `[SPECSTRIDE-REFUSE]` and nothing else, and NEVER
    // under `[SPECSTRIDE-STATE]`.
    assert.equal(lines.length, 1);
    assert.match(
      lines[0] ?? "",
      /^\[SPECSTRIDE-REFUSE\] action=state-export reason=location-in-the-working-tree next=/,
    );
    assert.ok(!(lines[0] ?? "").includes("SPECSTRIDE-STATE"));
    assert.ok(!existsSync(inside), "nothing was written inside the tree");
    assert.deepEqual(listing(tree), before, "the working tree is unchanged");
  } finally {
    world.dispose();
  }
});

test("CT-122-33: `state export` of a feature with no state refuses with exit 1", async () => {
  const world = makeScratchWorld("ct33c");
  try {
    const tree = world.tree("here");
    const plane = world.plane(tree);
    const out = join(world.outside, "empty.ssa");
    const result = await stateExport({
      place: plane.place,
      slug: "122-detached-runtime",
      out,
      print: () => undefined,
    });
    assert.equal(result.exit, EXIT_NO_STATE_OR_VERIFICATION);
    assert.equal(result.refusal, "no-state");
    assert.ok(!existsSync(out));
  } finally {
    world.dispose();
  }
});

/* ================================================================== *
 * CT-122-34 — `state import` (F122-FR-034).
 * ================================================================== */

test("CT-122-34: `state import` installs a verified archive into the plane of the workspace it runs in", async () => {
  const world = makeScratchWorld("ct34");
  try {
    const from = world.tree("from");
    const source = plantFeatureState({ plane: world.plane(from) });
    const out = join(world.outside, "122.ssa");
    await stateExport({ place: source.place, slug: source.slug, out, print: () => undefined });

    // Another workspace entirely: its plane is empty.
    const to = world.tree("to");
    const target = world.plane(to);
    assert.deepEqual(approvalFilesOf(target.place, source.slug), []);
    const lines: string[] = [];

    const result = await stateImport({
      place: target.place,
      slug: source.slug,
      from: out,
      print: (line) => void lines.push(line),
    });

    assert.equal(result.exit, EXIT_OK);
    assert.equal(
      result.line,
      `[SPECSTRIDE-STATE] action=import feature=${source.slug} approvals=${String(source.phases.length)}`,
    );
    assert.deepEqual(lines, [result.line]);
    // The records are in the TARGET plane, at the paths of their logical names.
    const installed = approvalFilesOf(target.place, source.slug);
    assert.deepEqual(
      installed.map((one) => one.phase),
      [...source.phases],
    );
    // And every one of them verifies in the plane it now lies in.
    const after = verifyApprovalsOf(target.place, source.slug);
    assert.ok(after.ok, after.failures.join("; "));
    assert.equal(after.checked, source.phases.length);
    // The ledger, the learning log and the keys travelled too.
    const paths = statePathsOf(target.place, source.slug);
    assert.ok(existsSync(paths.learningDecisionsFile));
    assert.ok(existsSync(paths.learningEventsFile));
    assert.equal(readFileSync(paths.approvalKeyFile, "utf8"), source.approvalKey);
    assert.equal(
      readFileSync(join(paths.runsDirectory, source.runId, "ledger.jsonl"), "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "").length,
      source.phases.length,
    );
    // The SOURCE plane is untouched: `export`/`import` copy (D-12).
    assert.equal(approvalFilesOf(source.place, source.slug).length, source.phases.length);
  } finally {
    world.dispose();
  }
});

test("CT-122-34: `state import` refuses a CHANGED archive with exit 1 and writes nothing", async () => {
  const world = makeScratchWorld("ct34b");
  try {
    const from = world.tree("from");
    const source = plantFeatureState({ plane: world.plane(from) });
    const out = join(world.outside, "122.ssa");
    await stateExport({ place: source.place, slug: source.slug, out, print: () => undefined });

    // Change ONE member inside the archive, and re-compress. The signature is
    // over the manifest, which holds the hash of every member, so this is the
    // change F122-FR-034 is about.
    const document = JSON.parse(gunzipSync(readFileSync(out)).toString("utf8")) as {
      members: { approvals: Record<string, unknown>[] };
    };
    const changed = JSON.parse(JSON.stringify(document)) as typeof document;
    (changed.members.approvals[0] as Record<string, unknown>)["treeFingerprint"] = "tampered";
    const tampered = join(world.outside, "tampered.ssa");
    writeFileSync(tampered, gzipSync(Buffer.from(JSON.stringify(changed), "utf8")), {
      mode: 0o600,
    });

    const to = world.tree("to");
    const target = world.plane(to);
    const before = listing(target.controlRoot);
    const lines: string[] = [];

    const result = await stateImport({
      place: target.place,
      slug: source.slug,
      from: tampered,
      print: (line) => void lines.push(line),
    });

    assert.equal(result.exit, EXIT_NO_STATE_OR_VERIFICATION, "a changed archive is exit 1");
    assert.equal(result.refusal, "verification-failed");
    assert.ok(result.wroteNothing);
    assert.equal(lines.length, 1);
    assert.match(
      lines[0] ?? "",
      /^\[SPECSTRIDE-REFUSE\] action=state-import reason=verification-failed next=/,
    );
    assert.deepEqual(listing(target.controlRoot), before, "nothing was written");
    assert.deepEqual(approvalFilesOf(target.place, source.slug), []);
    // And the report names both things that are wrong: the member hash and the
    // signature of the record.
    const verified = verifyArchive(
      (decompressArchive(readFileSync(tampered)) as { ok: true; archive: unknown }).archive,
    );
    assert.ok(!verified.ok);
    const kinds = verified.failures.map((one) => one.failure).sort();
    assert.ok(kinds.includes("member-hash"), JSON.stringify(kinds));
    assert.ok(kinds.includes("approval-signature"), JSON.stringify(kinds));
  } finally {
    world.dispose();
  }
});

test("CT-122-34: `state import` refuses a target that already holds approval records, exit 1, nothing written", async () => {
  const world = makeScratchWorld("ct34c");
  try {
    const from = world.tree("from");
    const source = plantFeatureState({ plane: world.plane(from) });
    const out = join(world.outside, "122.ssa");
    await stateExport({ place: source.place, slug: source.slug, out, print: () => undefined });

    // The target already holds ONE approval record of the feature.
    const to = world.tree("to");
    const target = plantFeatureState({ plane: world.plane(to), phases: [1] });
    const before = listing(target.controlRoot);
    const lines: string[] = [];

    const result = await stateImport({
      place: target.place,
      slug: source.slug,
      from: out,
      print: (line) => void lines.push(line),
    });

    assert.equal(result.exit, EXIT_NO_STATE_OR_VERIFICATION);
    assert.equal(result.refusal, "target-holds-approvals");
    assert.ok(result.wroteNothing);
    assert.equal(lines.length, 1);
    assert.match(
      lines[0] ?? "",
      /^\[SPECSTRIDE-REFUSE\] action=state-import reason=target-holds-approvals /,
    );
    assert.deepEqual(listing(target.controlRoot), before, "nothing was written or overwritten");
  } finally {
    world.dispose();
  }
});

test("CT-122-34: `state import` refuses an archive read from inside the working tree, exit 3", async () => {
  const world = makeScratchWorld("ct34d");
  try {
    const from = world.tree("from");
    const source = plantFeatureState({ plane: world.plane(from) });
    const out = join(world.outside, "122.ssa");
    await stateExport({ place: source.place, slug: source.slug, out, print: () => undefined });

    const to = world.tree("to");
    const target = world.plane(to);
    const inside = join(to, "122.ssa");
    writeFileSync(inside, readFileSync(out), { mode: 0o600 });
    const before = listing(target.controlRoot);

    const result = await stateImport({
      place: target.place,
      slug: source.slug,
      from: inside,
      print: () => undefined,
    });

    assert.equal(result.exit, EXIT_USAGE);
    assert.equal(result.refusal, "location-in-the-working-tree");
    assert.deepEqual(listing(target.controlRoot), before);
  } finally {
    world.dispose();
  }
});

/* ================================================================== *
 * CT-122-35 — `state adopt` (F122-FR-035).
 * ================================================================== */

test("CT-122-35: `state adopt` MOVES the state of the old path and every approval record verifies", async () => {
  const world = makeScratchWorld("ct35");
  try {
    // The tree was at `old` and is now at `new`; `old` is gone.
    const oldPath = world.goneTree("moved");
    const old = plantFeatureState({ plane: world.plane(oldPath) });
    const newPath = world.tree("moved-to");
    const here = world.plane(newPath);
    assert.notEqual(old.controlRoot, here.controlRoot, "two paths, two planes");
    assert.deepEqual(approvalFilesOf(here.place, old.slug), [], "the new plane is empty");
    const lines: string[] = [];

    const result = await stateAdopt({
      place: here.place,
      slug: old.slug,
      from: oldPath,
      print: (line) => void lines.push(line),
    });

    assert.equal(result.exit, EXIT_OK, JSON.stringify(result));
    assert.equal(
      result.line,
      `[SPECSTRIDE-STATE] action=adopt feature=${old.slug} approvals=${String(old.phases.length)} from=${oldPath}`,
    );
    assert.deepEqual(lines, [result.line]);

    // It MOVED: the records are here and GONE from there — F100-FR-032, no
    // mutable file shared between two workspaces.
    const moved = approvalFilesOf(here.place, old.slug);
    assert.deepEqual(
      moved.map((one) => one.phase),
      [...old.phases],
    );
    assert.ok(
      !existsSync(statePathsOf(old.place, old.slug).featureDirectory),
      "the feature's state is gone from the old plane",
    );
    for (const path of old.approvalPaths) {
      assert.ok(!existsSync(path), `the old record ${path} is gone`);
    }
    // Every approval record verifies where it now lies.
    const verified = verifyApprovalsOf(here.place, old.slug);
    assert.ok(verified.ok, verified.failures.join("; "));
    assert.equal(verified.checked, old.phases.length);
    assert.equal(result.approvals, old.phases.length);
    // The ledger and the learning log came too.
    const paths = statePathsOf(here.place, old.slug);
    assert.ok(existsSync(paths.learningDecisionsFile));
    assert.ok(existsSync(join(paths.runsDirectory, old.runId, "ledger.jsonl")));
  } finally {
    world.dispose();
  }
});

test("CT-122-35: `state adopt` refuses while a working tree exists at the old path, exit 1, nothing moved", async () => {
  const world = makeScratchWorld("ct35b");
  try {
    // A CLONE: the old tree is still there.
    const oldPath = world.tree("clone-source");
    const old = plantFeatureState({ plane: world.plane(oldPath) });
    const newPath = world.tree("clone");
    const here = world.plane(newPath);
    const beforeOld = listing(old.controlRoot);
    const beforeNew = listing(here.controlRoot);
    const lines: string[] = [];

    const result = await stateAdopt({
      place: here.place,
      slug: old.slug,
      from: oldPath,
      print: (line) => void lines.push(line),
    });

    assert.equal(result.exit, EXIT_NO_STATE_OR_VERIFICATION);
    assert.equal(result.refusal, "working-tree-at-the-old-path");
    assert.ok(result.wroteNothing);
    assert.equal(lines.length, 1);
    assert.match(
      lines[0] ?? "",
      /^\[SPECSTRIDE-REFUSE\] action=state-adopt reason=working-tree-at-the-old-path /,
    );
    // F122-FR-035 — *a cloned tree is served by `state export` and
    // `state import`*: the refusal names the way out.
    assert.match(lines[0] ?? "", /next="?specstride state export"?/);
    assert.deepEqual(listing(old.controlRoot), beforeOld, "the old plane is untouched");
    assert.deepEqual(listing(here.controlRoot), beforeNew, "the new plane is untouched");
  } finally {
    world.dispose();
  }
});

test("CT-122-35: `state adopt` refuses when no control plane exists for the old path, exit 1", async () => {
  const world = makeScratchWorld("ct35c");
  try {
    const newPath = world.tree("here");
    const here = plantFeatureState({ plane: world.plane(newPath), phases: [] });
    const result = await stateAdopt({
      place: here.place,
      slug: here.slug,
      from: world.goneTree("never-was"),
      print: () => undefined,
    });
    assert.equal(result.exit, EXIT_NO_STATE_OR_VERIFICATION);
    assert.equal(result.refusal, "no-control-plane-for-the-old-path");
    assert.ok(result.wroteNothing);
  } finally {
    world.dispose();
  }
});

test("CT-122-35: `state adopt` refuses when an approval record of the old path fails verification, exit 1, nothing moved", async () => {
  const world = makeScratchWorld("ct35d");
  try {
    const oldPath = world.goneTree("moved");
    const old = plantFeatureState({ plane: world.plane(oldPath) });
    // One record is re-signed with ANOTHER key: it is not a record this
    // product wrote (F100-FR-070).
    const second = old.approvalPaths[1];
    assert.ok(second !== undefined);
    writeFileSync(
      second,
      JSON.stringify(
        anApprovalRecord({
          slug: old.slug,
          phase: old.phases[1] ?? 2,
          runId: old.runId,
          approvalKey: "another-key-entirely",
        }),
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    const newPath = world.tree("moved-to");
    const here = world.plane(newPath);
    const beforeOld = listing(old.controlRoot);

    const result = await stateAdopt({
      place: here.place,
      slug: old.slug,
      from: oldPath,
      print: () => undefined,
    });

    assert.equal(result.exit, EXIT_NO_STATE_OR_VERIFICATION);
    assert.equal(result.refusal, "record-failed-verification");
    assert.ok(result.wroteNothing);
    assert.deepEqual(listing(old.controlRoot), beforeOld, "nothing was moved");
    assert.deepEqual(approvalFilesOf(here.place, old.slug), []);
  } finally {
    world.dispose();
  }
});

/**
 * `state adopt` MOVES, and `moveDirectory` has two branches: one atomic
 * `rename` where the two planes lie on one file system, and a copy followed by
 * the removal of the source where they do not (`EXDEV`). Every other case of
 * this file builds both planes under the temporary directory, so they share a
 * device and only the `rename` branch ever runs — the copy branch was dead to
 * the suite, and a change that dropped its `rmSync` went unnoticed.
 *
 * This case drives the copy branch for real. It needs two devices; it finds
 * them by asking the file system, never by naming a path, and where this host
 * has only one it is a SKIP with its reason and never a pass (the
 * constitution, principle XVII).
 */
test("CT-122-35: `moveDirectory` across file systems copies AND removes the source, so no mutable file is shared (F100-FR-032, D-12)", (t) => {
  const onTmp = mkdtempSync(join(tmpdir(), "specstride-xdev-a-"));
  // The second scratch lies beside this test file, which is on whatever device
  // the repository is on. Both are removed again in `finally`.
  const beside = mkdtempSync(join(import.meta.dirname, ".xdev-b-"));
  try {
    if (statSync(onTmp).dev === statSync(beside).dev) {
      t.skip(
        "prerequisite missing: the temporary directory and the repository are on ONE device " +
          "on this host, so `rename` never fails with EXDEV and the copy branch cannot be " +
          "reached. This is a SKIP with its reason and never a pass.",
      );
      return;
    }
    const source = join(onTmp, "feature");
    mkdirSync(join(source, "approvals"), { recursive: true, mode: 0o700 });
    writeFileSync(join(source, "approvals", "phase-1.json"), '{"phase":1}', { mode: 0o600 });
    const target = join(beside, "feature");

    const how = moveDirectory(source, target);

    assert.equal(how, "copied", "the two planes are on two devices, so it copied");
    assert.equal(
      readFileSync(join(target, "approvals", "phase-1.json"), "utf8"),
      '{"phase":1}',
      "the record arrived",
    );
    assert.ok(
      !existsSync(source),
      "and the SOURCE IS GONE: a copy that left it behind would share a mutable file between " +
        "two workspaces (F100-FR-032)",
    );
  } finally {
    rmSync(onTmp, { recursive: true, force: true });
    rmSync(beside, { recursive: true, force: true });
  }
});

/* ================================================================== *
 * CT-122-36 — exit 5 while a run is alive (F122-FR-036).
 * ================================================================== */

/**
 * A REAL lock of a real provider, taken in this process: `acquireHere` builds
 * the owner record from the platform, renames the lock directory into place
 * and listens on the liveness endpoint, so the probe answers `held-live`
 * because the owner really does live. Nothing about liveness is stubbed.
 */
async function withALiveRun(
  planted: {
    readonly place: { readonly controlRoot: string; readonly workspaceRealPath: string };
    readonly slug: string;
    readonly runId: string;
  },
  body: () => Promise<void>,
): Promise<void> {
  const place = {
    controlRoot: planted.place.controlRoot,
    workspaceRealPath: planted.place.workspaceRealPath,
  };
  const lock = createDirectoryLock({ place });
  const owner = buildOwnerRecord({ launchId: "L-alive", runTokenHash: "hash" });
  const acquired = await lock.acquireHere(owner, {
    runId: planted.runId,
    launchId: "L-alive",
    launchNonce: "nonce-alive",
  });
  assert.ok(acquired.acquired, "the lock was taken");
  try {
    const probe = await probeLock(place);
    assert.ok(countsAsHeld(probe.result), `the probe counts as held: ${probe.result}`);
    await body();
  } finally {
    if (acquired.acquired) await lock.release(acquired.lease);
  }
}

test("CT-122-36: each of the three commands exits 5 while a run of the feature is alive, and changes nothing", async () => {
  const world = makeScratchWorld("ct36");
  try {
    const tree = world.tree("here");
    const planted = plantFeatureState({ plane: world.plane(tree) });
    // An archive made BEFORE the run started, so `import` has one to be
    // refused over.
    const out = join(world.outside, "122.ssa");
    await stateExport({ place: planted.place, slug: planted.slug, out, print: () => undefined });
    const importable = join(world.outside, "importable.ssa");
    writeFileSync(importable, readFileSync(out), { mode: 0o600 });

    await withALiveRun(planted, async () => {
      const alive = await aRunOfTheFeatureIsAlive(planted.place, planted.slug);
      assert.ok(alive.alive, alive.because);
      assert.ok(alive.countsAsHeld);
      assert.equal(alive.runId, planted.runId);

      const before = listing(planted.controlRoot);
      const outsideBefore = listing(world.outside);

      const exported = join(world.outside, "while-alive.ssa");
      const one = await stateExport({
        place: planted.place,
        slug: planted.slug,
        out: exported,
        print: () => undefined,
      });
      const two = await stateImport({
        place: planted.place,
        slug: planted.slug,
        from: importable,
        print: () => undefined,
      });
      const three = await stateAdopt({
        place: planted.place,
        slug: planted.slug,
        from: world.goneTree("whatever"),
        print: () => undefined,
      });

      for (const [name, result] of [
        ["export", one],
        ["import", two],
        ["adopt", three],
      ] as const) {
        assert.equal(result.exit, EXIT_ALIVE, `${name} exits 5`);
        assert.equal(result.refusal, "run-alive", `${name} refuses with run-alive`);
        assert.ok(result.wroteNothing, `${name} wrote nothing`);
        assert.match(
          result.line,
          new RegExp(`^\\[SPECSTRIDE-REFUSE\\] action=state-${name} reason=run-alive next=`),
        );
        assert.ok(!result.line.includes("SPECSTRIDE-STATE"));
      }
      assert.ok(!existsSync(exported), "no archive was written while the run lives");
      assert.deepEqual(listing(planted.controlRoot), before, "the plane is unchanged");
      assert.deepEqual(listing(world.outside), outsideBefore, "nothing outside was written");
    });

    // And with the run over, the very same `export` succeeds — so exit 5 was
    // about the run and not about the command.
    const after = await stateExport({
      place: planted.place,
      slug: planted.slug,
      out: join(world.outside, "after.ssa"),
      print: () => undefined,
    });
    assert.equal(after.exit, EXIT_OK, JSON.stringify(after));
  } finally {
    world.dispose();
  }
});

/* ================================================================== *
 * The command surface (`packages/cli/src/commands/state.ts`).
 * ================================================================== */

test("CT-122-36: the command surface prints the line of the contract and answers with its exit code", async () => {
  const world = makeScratchWorld("ct36b");
  try {
    const tree = world.tree("here");
    const planted = plantFeatureState({ plane: world.plane(tree) });
    const out = join(world.outside, "surface.ssa");
    const lines: string[] = [];

    const run = await runStateCommand(["export", "--feature", planted.slug, "--out", out], {
      place: planted.place,
      commands: THE_RUNTIME_IMPLEMENTATIONS,
      productVersion: "9.9.9",
      print: (line) => void lines.push(line),
    });

    assert.equal(run.exit, EXIT_OK);
    // LR-1 — the surface names no module of the runtime package.
    assert.equal(IMPORTS_THE_RUNTIME_PACKAGE, false);
    assert.equal(
      run.line,
      `[SPECSTRIDE-STATE] action=export feature=${planted.slug} approvals=${String(planted.phases.length)} out=${out}`,
    );
    assert.deepEqual(lines, [run.line]);
    assert.ok(existsSync(out));

    // Wrong usage is exit 3 and one refusal line.
    const bad = await runStateCommand(["export", "--feature", planted.slug], {
      place: planted.place,
      commands: THE_RUNTIME_IMPLEMENTATIONS,
      print: (line) => void lines.push(line),
    });
    assert.equal(bad.exit, EXIT_USAGE);
    assert.match(bad.line, /^\[SPECSTRIDE-REFUSE\] action=state-export reason=usage next=/);

    const unknown = await runStateCommand(["frobnicate", "--feature", planted.slug], {
      place: planted.place,
      commands: THE_RUNTIME_IMPLEMENTATIONS,
      print: () => undefined,
    });
    assert.equal(unknown.exit, EXIT_USAGE);

    // `--json` prints the record as well as the line; the line stays one line.
    const jsonLines: string[] = [];
    const to = world.tree("to");
    const target = world.plane(to);
    const jsonRun = await runStateCommand(
      ["import", "--feature", planted.slug, "--from", out, "--json"],
      {
        place: target.place,
        commands: THE_RUNTIME_IMPLEMENTATIONS,
        print: (line) => void jsonLines.push(line),
      },
    );
    assert.equal(jsonRun.exit, EXIT_OK);
    assert.equal(jsonLines.length, 2, JSON.stringify(jsonLines));
    const parsed = JSON.parse(jsonLines[1] ?? "{}") as Record<string, unknown>;
    assert.equal(parsed["action"], "import");
    assert.equal(parsed["feature"], planted.slug);
    assert.equal(parsed["approvals"], planted.phases.length);
  } finally {
    world.dispose();
  }
});

test("CT-122-36: under the `parity` profile a state command prints no line at all", async () => {
  const world = makeScratchWorld("ct36c");
  try {
    const tree = world.tree("here");
    const planted = plantFeatureState({ plane: world.plane(tree) });
    const out = join(world.outside, "quiet.ssa");
    const lines: string[] = [];
    const result = await stateExport({
      place: planted.place,
      slug: planted.slug,
      out,
      profile: "parity",
      print: (line) => void lines.push(line),
    });
    assert.equal(result.exit, EXIT_OK);
    assert.equal(result.line, "");
    assert.deepEqual(lines, []);
    assert.ok(existsSync(out), "the command still did its work");
  } finally {
    world.dispose();
  }
});

/* ================================================================== *
 * The archive, directly (T063).
 * ================================================================== */

test("CT-122-33: the archive refuses a document that is not one, and never throws at `import`", () => {
  assert.equal(validateArchive(null).ok, false);
  assert.equal(validateArchive({}).ok, false);
  assert.equal(
    validateArchive({ schema: "specstride.state-archive/2", manifest: {}, members: {}, sig: "x" })
      .ok,
    false,
  );
  const bytes = Buffer.from("not gzip at all", "utf8");
  const read = decompressArchive(bytes);
  assert.equal(read.ok, false);
  assert.equal(read.ok === false ? read.refusal : "", "not-compressed");
  const notJson = decompressArchive(gzipSync(Buffer.from("{{{", "utf8")));
  assert.equal(notJson.ok, false);
  assert.equal(notJson.ok === false ? notJson.refusal : "", "not-json");
});

test("CT-122-33: an archive with no key verifies nothing; a wrong key fails the signature", () => {
  // Built by hand, so that no file and no plane is needed: the question is
  // about the verification and not about the disk.
  const withoutKeys = {
    schema: ARCHIVE_SCHEMA_ID,
    manifest: {
      feature: "f",
      workspaceId: "w",
      productVersion: "1",
      createdAt: "2026-10-01T00:00:00.000Z",
      hashes: {},
    },
    members: { approvals: [], ledger: [], learning: {} },
    sig: "deadbeef",
  };
  const verified = verifyArchive(withoutKeys);
  assert.equal(verified.ok, false);
  assert.ok(verified.failures.some((one) => one.failure === "no-key"));
  const wrongKey = verifyArchive(withoutKeys, { approvalKey: "whatever" });
  assert.ok(wrongKey.failures.some((one) => one.failure === "signature"));
});

test("CT-122-33: a member the manifest does not hash, and a hash with no member, both fail verification", () => {
  const key = "a-key";
  const good = {
    schema: ARCHIVE_SCHEMA_ID,
    manifest: {
      feature: "f",
      workspaceId: "w",
      productVersion: "1",
      createdAt: "2026-10-01T00:00:00.000Z",
      hashes: {
        approvals: memberHash([]),
        ledger: memberHash([]),
        learning: memberHash({}),
        keys: memberHash({ approval: key }),
      },
    },
    members: { approvals: [], ledger: [], learning: {}, keys: { approval: key } },
    sig: "",
  };
  // A hash the archive has no member for.
  const extra = JSON.parse(JSON.stringify(good)) as typeof good;
  (extra.manifest.hashes as Record<string, string>)["invented"] = memberHash("x");
  assert.ok(
    verifyArchive(extra, { approvalKey: key }).failures.some(
      (one) => one.failure === "hash-without-a-member",
    ),
  );
  // A member the manifest does not hash.
  const missing = JSON.parse(JSON.stringify(good)) as typeof good;
  delete (missing.manifest.hashes as Record<string, string>)["ledger"];
  assert.ok(
    verifyArchive(missing, { approvalKey: key }).failures.some(
      (one) => one.failure === "member-without-a-hash",
    ),
  );
});

test("CT-122-33: the control root of the archive is where a test says, and no real state directory is touched", () => {
  const world: ScratchWorld = makeScratchWorld("ct33e");
  try {
    const tree = world.tree("here");
    const plane = world.plane(tree);
    assert.ok(plane.controlRoot.startsWith(world.workspacesRoot));
    assert.ok(
      !plane.controlRoot.includes(join("local", "state", "specstride", "workspaces")) ||
        plane.controlRoot.startsWith(world.workspacesRoot),
    );
    mkdirSync(plane.controlRoot, { recursive: true });
    assert.ok(statSync(plane.controlRoot).isDirectory());
  } finally {
    world.dispose();
  }
});
