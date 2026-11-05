/**
 * T072 — CT-122-43: the layout version file (F122-FR-043).
 *
 * The subject is `packages/runtime/src/root/layout-version.ts`, called from
 * `packages/runtime/src/root/start.ts` at step 3 of the handshake, with the
 * doctor check of `packages/runtime/src/doctor/layout-checks.ts`.
 *
 * F122-FR-043 pins an ORDER and a WRITER, not a shape of the disk:
 *
 *   - the file is written at the first launch, AFTER the lock is taken and
 *     BEFORE the advisory marker is written;
 *   - it holds the layout version the same process writes into the field
 *     `layoutVersion` of the workspace record;
 *   - it is written to a temporary name and renamed;
 *   - at every later launch it is read: a missing file is written again, and
 *     a file of another major refuses the launch with the logical name, the
 *     major found and the major supported, and with a doctor finding;
 *   - a workspace part that holds no layout version file counts as not
 *     written by the product: nothing in it is read as state (F100-FR-041).
 *
 * Every assertion below reads the disk, or reads the doctor through the same
 * check the launch reads. The return value of a function is never evidence on
 * its own.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { layoutVersion as theLayoutVersionOfTheTable } from "@specstride/contracts/ids/logical-names";
import {
  LAYOUT_VERSION_MAJOR_REFUSAL,
  LAYOUT_VERSION_REFUSAL_EXIT,
  checkLayoutVersionAtLaunch,
  isATemporaryNameOfTheWrite,
  layoutVersionPathOf,
  readLayoutVersion,
  supportedLayoutVersion,
  supportedMajor,
} from "../../src/root/layout-version.ts";
import { startTheRoot } from "../../src/root/start.ts";
import { endTheRoot } from "../../src/root/end.ts";
import { buildOwnerRecord } from "../../src/lock/owner-record.ts";
import { mintRunToken } from "../../src/procs/run-token.ts";
import { lockPathsOf } from "../../src/lock/paths.ts";
import {
  LAYOUT_VERSION_CHECK_ID,
  LAYOUT_VERSION_PROBE_KEY,
  layoutVersionEvidence,
  layoutVersionSeverity,
  probeLayoutVersion,
  registerLayoutChecks,
} from "../../src/doctor/layout-checks.ts";
import type { DoctorRegistry } from "@specstride/contracts/ep/doctor";

const SLUG = "ct-122-43";
const RUN = "run-ct-122-43";

type Scratch = {
  readonly place: { readonly controlRoot: string; readonly workspaceRealPath: string };
  readonly where: { readonly place: object; readonly slug: string; readonly runId: string };
  dispose(): void;
};

function scratch(label: string): Scratch {
  const controlRoot = mkdtempSync(join(tmpdir(), `lv-${label}-c-`));
  const workspaceRealPath = mkdtempSync(join(tmpdir(), `lv-${label}-w-`));
  const place = { controlRoot, workspaceRealPath };
  return {
    place,
    where: { place, slug: SLUG, runId: RUN },
    dispose(): void {
      for (const path of [controlRoot, workspaceRealPath]) {
        rmSync(path, { recursive: true, force: true });
      }
    },
  };
}

/** Take the whole step 3, in this process, and give everything back after. */
async function withTheRootStarted(
  scratchOf: Scratch,
  launchId: string,
  body: (
    started: Extract<Awaited<ReturnType<typeof startTheRoot>>, { started: true }>,
  ) => Promise<void>,
): Promise<void> {
  const token = mintRunToken();
  const started = await startTheRoot({
    where: scratchOf.where as never,
    launchId,
    launchNonce: `nonce-${launchId}`,
    owner: buildOwnerRecord({ launchId, runTokenHash: token.hash }),
  });
  assert.equal(started.started, true, "step 3 took the lock");
  if (!started.started) return;
  try {
    await body(started);
  } finally {
    await endTheRoot(
      {
        where: scratchOf.where as never,
        launchId,
        provider: started.provider,
        lease: started.lease,
        heartbeat: started.heartbeat,
      },
      "completed",
    );
  }
}

/* ------------------------------------------------------------------ *
 * CT-122-43 — the first launch writes the file, after the lock and
 * before the marker, with the version of the workspace record.
 * ------------------------------------------------------------------ */

test("CT-122-43: the first launch writes workspace:layout-version after the lock and before the marker, with the layoutVersion of the workspace record, by a temporary name and a rename (F122-FR-043)", async () => {
  const s = scratch("first");
  try {
    const path = layoutVersionPathOf(s.place);
    const markerPath = lockPathsOf(s.place).advisoryMarkerFile;
    const ownerPath = lockPathsOf(s.place).ownerRecordFile;

    // Before the launch there is no file, and the workspace part counts as
    // not written by the product.
    assert.equal(existsSync(path), false, "no layout version file before the first launch");
    assert.equal(readLayoutVersion(s.place).present, false);

    await withTheRootStarted(s, "launch-lv-first", async (started) => {
      // The file is there, and the outcome says this launch wrote it.
      assert.equal(existsSync(path), true, "the first launch wrote the file");
      assert.equal(started.layoutCheck.refuse, false);
      if (!started.layoutCheck.refuse && started.layoutCheck.found.kind === "missing") {
        assert.equal(started.layoutCheck.found.written.written, true);
        assert.equal(started.layoutCheck.found.written.byATemporaryNameAndARename, true);
      }

      // The text is the layoutVersion of the workspace record — read from the
      // record on the disk, not from a constant of the test.
      const record = JSON.parse(readText(lockPathsOf(s.place).workspaceRecordFile)) as {
        layoutVersion: string;
      };
      const text = readText(path);
      assert.equal(text, record.layoutVersion, "the file holds the record's layoutVersion");
      assert.equal(text, theLayoutVersionOfTheTable);

      // THE ORDER, read off the disk: the owner record was acquired before
      // the file was renamed into place, and the marker was written after.
      const owner = JSON.parse(readText(ownerPath)) as { acquiredAt: string };
      const acquiredAt = Date.parse(owner.acquiredAt);
      const fileAt = statSync(path).mtimeMs;
      const marker = JSON.parse(readText(markerPath)) as { writtenAt: string };
      const markerAt = Date.parse(marker.writtenAt);
      assert.ok(
        acquiredAt <= fileAt,
        `the file was written after the lock (owner acquired at ${owner.acquiredAt})`,
      );
      assert.ok(
        fileAt <= markerAt + 5,
        `the file was written before the marker (marker written at ${marker.writtenAt})`,
      );

      // BY A TEMPORARY NAME AND A RENAME: the directory holds no leftover of
      // the atomic write, and the name the kernel would have used is a
      // temporary name by the module's own answer.
      const leftovers = readdirSync(basename(path) === path ? path : join(path, "..")).filter(
        (name) => name.startsWith(`.${basename(path)}.tmp-`),
      );
      assert.deepEqual(leftovers, [], "no temporary name survives the rename");
      assert.equal(isATemporaryNameOfTheWrite(`.${basename(path)}.tmp-${1}-${1}`), true);
    });
  } finally {
    s.dispose();
  }
});

/* ------------------------------------------------------------------ *
 * CT-122-43 — a later launch writes a missing file again.
 * ------------------------------------------------------------------ */

test("CT-122-43: a later launch writes a layout version file that is missing again (F122-FR-043)", async () => {
  const s = scratch("again");
  try {
    const path = layoutVersionPathOf(s.place);
    await withTheRootStarted(s, "launch-lv-1", async () => {
      assert.equal(existsSync(path), true);
    });
    // The file disappears — a workspace part copied without it, a restore
    // that dropped it. The next launch must write it again.
    rmSync(path);
    assert.equal(existsSync(path), false);
    await withTheRootStarted(s, "launch-lv-2", async (started) => {
      assert.equal(existsSync(path), true, "the later launch wrote the file again");
      assert.equal(readText(path), supportedLayoutVersion());
      if (!started.layoutCheck.refuse && started.layoutCheck.found.kind === "missing") {
        assert.equal(started.layoutCheck.found.written.written, true);
      } else {
        assert.fail("the later launch should have found the file missing");
      }
    });
    // The file that is present is left alone: the file has no other writer.
    writeFileSync(path, "1.9\n"); // same major, another minor: read, never rewritten
    await withTheRootStarted(s, "launch-lv-3", async () => {
      assert.equal(readText(path), "1.9", "a present file of the supported major is not rewritten");
    });
    rmSync(path);
  } finally {
    s.dispose();
  }
});

/* ------------------------------------------------------------------ *
 * CT-122-43 — another major refuses the launch, and the doctor says so.
 * ------------------------------------------------------------------ */

test("CT-122-43: a file of another major refuses the launch with the logical name, the major found and the major supported, and with a doctor finding (F122-FR-043; F100-FR-049)", async () => {
  const s = scratch("major");
  try {
    const path = layoutVersionPathOf(s.place);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "9.9\n");

    const token = mintRunToken();
    const refused = await startTheRoot({
      where: s.where as never,
      launchId: "launch-lv-major",
      launchNonce: "nonce-lv-major",
      owner: buildOwnerRecord({ launchId: "launch-lv-major", runTokenHash: token.hash }),
    });
    assert.equal(refused.started, false, "the launch is refused");
    if (refused.started) return;
    assert.equal(refused.refusal, LAYOUT_VERSION_MAJOR_REFUSAL);
    assert.equal(refused.exit, LAYOUT_VERSION_REFUSAL_EXIT);
    assert.match(refused.detail, /workspace:layout-version/, "the logical name is in the detail");
    assert.match(refused.detail, /\b9\b/, "the major found is named");
    assert.match(
      refused.detail,
      new RegExp(`\\b${supportedMajor()}\\b`),
      "the major supported is named",
    );

    // The refusal released the lock: the exit path controls it, and a probe
    // of a released lock says so.
    const paths = lockPathsOf(s.place);
    assert.equal(existsSync(paths.lockDirectory), false, "the lock was released");

    // THE DOCTOR FINDING, through the same check the launch reads.
    const injected = { [LAYOUT_VERSION_PROBE_KEY]: s.place };
    const probe = probeLayoutVersion(injected);
    assert.equal(probe.reading?.present, true);
    assert.equal(layoutVersionSeverity(probe), "fail", "the doctor finding is a failure");
    const evidence = layoutVersionEvidence(probe);
    assert.match(evidence, /workspace:layout-version/);
    assert.match(evidence, /9\.9/, "the version found is in the evidence");
    assert.match(evidence, new RegExp(`supported=${supportedLayoutVersion().replace(".", "\\.")}`));

    // The check is registered, and it is launch-blocking, so the doctor and
    // the launch cannot disagree.
    let registered = 0;
    const registry = {
      register(): void {
        registered += 1;
      },
    } as unknown as DoctorRegistry;
    const checks = registerLayoutChecks(registry);
    assert.equal(registered, checks.length);
    assert.equal(checks.length, 1);
    assert.equal(checks[0]?.id, LAYOUT_VERSION_CHECK_ID);
    assert.equal(checks[0]?.lb, true);
  } finally {
    s.dispose();
  }
});

/* ------------------------------------------------------------------ *
 * CT-122-43 — a workspace part without the file is not read as state.
 * ------------------------------------------------------------------ */

test("CT-122-43: a workspace part without the layout version file is not read as state (F122-FR-043; F100-FR-041)", () => {
  const s = scratch("nostate");
  try {
    // A tree that holds a directory of the workspace part and no layout
    // version file — the tree of an as-is system.
    const reading = readLayoutVersion(s.place);
    assert.equal(reading.present, false);
    if (!reading.present) {
      assert.equal(reading.theWorkspacePartIsNotReadAsState, true);
    }
    // The check at a launch writes the file in that case, and refuses
    // nothing: the first launch is what writes it.
    const check = checkLayoutVersionAtLaunch(s.place, null);
    assert.equal(check.refuse, false);
    assert.equal(existsSync(layoutVersionPathOf(s.place)), true);
  } finally {
    s.dispose();
  }
});

/** The text of a file that must be there, without the final line end. */
function readText(path: string): string {
  // The read throws where the file is gone, which is the failure a test
  // wants and not a quiet empty string.
  return readFileSync(path, "utf8").replace(/\n$/, "");
}
