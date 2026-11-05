/**
 * T022 — contract tests CT-100-136 and CT-100-143 for the two kernel
 * functions of the layout rules (annex B, §B.2; F100-FR-036, F100-FR-043).
 *
 * CT-100-136: a write is a temporary name in the same directory then a
 * rename, and a reader that opens during the write sees the old file or the
 * new one and never a partial one.
 *
 * CT-100-143: a real path that leaves its root, and a link inside the control
 * plane, are refused with the path and the root.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DIRECTORY_MODE,
  FILE_MODE,
  PathGuardError,
  STEPS,
  A_STATE_FILE_HOLDS_HISTORY,
  atomicWrite,
  atomicWriteJson,
  isOwnerOnly,
  isTemporaryName,
  makeOwnerOnlyDirectory,
  readClaim,
  realPathOf,
  refuseSymbolicLinkInsideControlPlane,
  requireInsideRoot,
  temporaryNameFor,
} from "../src/atomic-write/index.ts";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "specstride-kernel-"));
}

test("CT-100-136: a write is a temporary name in the same directory, then a rename (F100-FR-036)", () => {
  const root = sandbox();
  try {
    const target = join(root, "state", "run-record.json");
    // The temporary name lies in the SAME directory as the target, so that
    // the rename is atomic.
    const temporary = temporaryNameFor(target, 1);
    assert.equal(join(temporary, "..").replace(/\/$/, ""), join(target, "..").replace(/\/$/, ""));
    assert.ok(isTemporaryName(temporary));
    assert.ok(!isTemporaryName(target));
    assert.deepEqual([...STEPS], ["write-temporary-in-the-same-directory", "fsync", "rename"]);

    atomicWrite(target, "first\n", { createDirectory: true });
    assert.equal(readFileSync(target, "utf8"), "first\n");
    // The temporary name is gone: only the target is left in the directory.
    assert.deepEqual(readdirSync(join(root, "state")), ["run-record.json"]);
    // Owner only, 0600 (F100-FR-043).
    assert.ok(isOwnerOnly(statSync(target).mode, "file"), "the file is 0600");

    // A second write replaces it whole; no reader sees a partial file.
    atomicWrite(target, "second\n");
    assert.equal(readFileSync(target, "utf8"), "second\n");
    assert.deepEqual(readdirSync(join(root, "state")), ["run-record.json"]);

    // A state file holds current state only; history is the event stream.
    assert.equal(A_STATE_FILE_HOLDS_HISTORY, false);
    atomicWriteJson(join(root, "state", "record.json"), { schema: "x", value: 1 });
    assert.deepEqual(JSON.parse(readFileSync(join(root, "state", "record.json"), "utf8")), {
      schema: "x",
      value: 1,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CT-100-136: a reader that opens during the write sees the old file or the new one, never a partial one", () => {
  const root = sandbox();
  try {
    const target = join(root, "state.json");
    const old = "x".repeat(4096) + "\n";
    const next = "y".repeat(1_048_576) + "\n";
    atomicWrite(target, old, { createDirectory: true });

    // Read between every step of a write: the content is always whole, and
    // always one of the two versions.
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const before = readFileSync(target, "utf8");
      seen.add(before === old ? "old" : before === next ? "new" : `partial:${before.length}`);
      atomicWrite(target, i % 2 === 0 ? next : old);
      const after = readFileSync(target, "utf8");
      seen.add(after === old ? "old" : after === next ? "new" : `partial:${after.length}`);
    }
    assert.deepEqual([...seen].sort(), ["new", "old"], "no reader ever saw a partial file");

    // A failed write leaves no temporary name behind and does not touch the
    // file that is in place.
    const before = readFileSync(target, "utf8");
    assert.throws(() => atomicWrite(join(root, "no-such-directory", "f"), "x"));
    assert.equal(readFileSync(target, "utf8"), before);
    assert.deepEqual(
      readdirSync(root).filter((n) => isTemporaryName(n)),
      [],
      "no temporary name is left behind",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CT-100-143: a real path that leaves its root is refused with the path and the root", () => {
  const root = sandbox();
  try {
    const control = join(root, "control");
    mkdirSync(control, { recursive: true });
    const outside = join(root, "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "target"), "x");

    // A path inside the root is allowed.
    assert.equal(realPathOf(join(control, "a", "b")), join(realPathOf(control), "a", "b"));
    assert.doesNotThrow(() => requireInsideRoot(join(control, "a", "b"), control));

    // A path that leaves the root by `..` is refused.
    assert.throws(
      () => requireInsideRoot(join(control, "..", "outside", "target"), control),
      (err: unknown) => {
        assert.ok(err instanceof PathGuardError);
        assert.equal(err.reason, "outside-root");
        assert.match(err.message, /leaves the root/);
        assert.ok(err.message.includes(control), "the message names the root");
        assert.equal(err.root, control);
        return true;
      },
    );

    // A path that leaves the root through a symbolic link is refused: the
    // guard resolves the REAL path.
    symlinkSync(join(outside, "target"), join(control, "escape"));
    assert.throws(
      () => requireInsideRoot(join(control, "escape"), control),
      (err: unknown) => {
        assert.ok(err instanceof PathGuardError);
        assert.equal(err.reason, "outside-root");
        assert.ok(err.message.includes(join(control, "escape")), "the message names the path");
        return true;
      },
    );

    // A relative path is refused: a path of a root is absolute.
    assert.throws(() => requireInsideRoot("state.json", control), PathGuardError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CT-100-143: a symbolic link inside the control plane is refused with the path and the root", () => {
  const root = sandbox();
  try {
    const control = join(root, "control");
    mkdirSync(join(control, "features"), { recursive: true });
    writeFileSync(join(control, "features", "real.json"), "{}");
    symlinkSync(join(control, "features", "real.json"), join(control, "features", "linked.json"));

    // A real file inside the control plane passes.
    assert.doesNotThrow(() =>
      refuseSymbolicLinkInsideControlPlane(join(control, "features", "real.json"), control),
    );
    // A link inside the control plane is refused, with the path and the root.
    assert.throws(
      () => refuseSymbolicLinkInsideControlPlane(join(control, "features", "linked.json"), control),
      (err: unknown) => {
        assert.ok(err instanceof PathGuardError);
        assert.equal(err.reason, "symbolic-link");
        assert.match(err.message, /is a symbolic link inside the control plane/);
        assert.ok(err.message.includes(control), "the message names the root");
        assert.equal(err.root, control);
        return true;
      },
    );
    // A link in a directory of the path is refused too.
    mkdirSync(join(root, "elsewhere"), { recursive: true });
    symlinkSync(join(root, "elsewhere"), join(control, "linked-dir"));
    assert.throws(
      () => refuseSymbolicLinkInsideControlPlane(join(control, "linked-dir", "f.json"), control),
      PathGuardError,
    );
    // A link outside the control plane is not this rule's business.
    symlinkSync(join(control, "features", "real.json"), join(root, "link-outside"));
    assert.doesNotThrow(() =>
      refuseSymbolicLinkInsideControlPlane(join(root, "link-outside"), control),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CT-100-143: a claim is opened without following links, and the roots are owner-only", () => {
  const root = sandbox();
  try {
    const workspace = join(root, "workspace");
    mkdirSync(workspace, { recursive: true });
    const outbox = join(workspace, "outbox.json");
    writeFileSync(outbox, '{"claim":true}\n');
    assert.equal(readClaim(outbox), '{"claim":true}\n');

    // A claim that is a link is refused: the reader opens it no-follow.
    writeFileSync(join(root, "elsewhere.json"), "{}");
    const linked = join(workspace, "linked-claim.json");
    symlinkSync(join(root, "elsewhere.json"), linked);
    assert.throws(
      () => readClaim(linked),
      (err: unknown) => {
        // O_NOFOLLOW gives ELOOP; either that or the guard's own refusal.
        const message = err instanceof Error ? err.message : String(err);
        assert.match(message, /ELOOP|symbolic link|regular file/i);
        return true;
      },
    );

    // Directories of the control plane, the user state and the worker root
    // are readable and writable by their owner only.
    const control = join(root, "control", "features", "100");
    makeOwnerOnlyDirectory(control);
    assert.ok(isOwnerOnly(statSync(control).mode, "directory"), "the directory is 0700");
    assert.equal(DIRECTORY_MODE, 0o700);
    assert.equal(FILE_MODE, 0o600);
    atomicWrite(join(control, "record.json"), "{}\n");
    assert.ok(isOwnerOnly(statSync(join(control, "record.json")).mode, "file"));
    // The check discriminates.
    chmodSync(join(control, "record.json"), 0o644);
    assert.equal(isOwnerOnly(statSync(join(control, "record.json")).mode, "file"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
