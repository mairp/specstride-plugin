/**
 * T068 — the precomputed status line (F129-FR-028): the writer at
 * `run:<runId>:status-line` plus the pointer `workspace:current:status-line`,
 * and the rewrite at every heartbeat through the `rewriteStatusLine` hook of
 * `beat` — so the line is rewritten before its `validUntil` passes for as
 * long as the lease lives.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderLine } from "@specstride/view";
import {
  StatusLineRefusedError,
  currentStatusLinePathOf,
  readStatusLineAt,
  statusLinePathOf,
  validUntilForState,
  writeStatusLine,
} from "../../src/state/status-line.ts";
import { beat, writeTheLease } from "../../src/lease/lease.ts";
import { buildOwnerRecord } from "../../src/lock/owner-record.ts";

const SLUG = "129-run-view-and-status";
const RUN = "r-status-line";

/** A running view, structural: the writer hands the whole view to the port. */
const RUNNING_VIEW = Object.freeze({
  schema: "specstride.view/1",
  runId: RUN,
  state: "running",
  display: "running",
  progress: Object.freeze({
    phase: 2,
    phases: 7,
    units: Object.freeze({ done: 3, declared: 9 }),
    rejects: 1,
    elapsedSeconds: 3600,
  }),
  supervision: null,
  strategy: Object.freeze({ strategy: "classic" }),
  attention: Object.freeze([]),
});

function scratch(label: string): {
  controlRoot: string;
  workspaceRealPath: string;
  dispose(): void;
} {
  const controlRoot = mkdtempSync(join(tmpdir(), `sl-${label}-c-`));
  const workspaceRealPath = mkdtempSync(join(tmpdir(), `sl-${label}-w-`));
  return {
    controlRoot,
    workspaceRealPath,
    dispose(): void {
      rmSync(controlRoot, { recursive: true, force: true });
      rmSync(workspaceRealPath, { recursive: true, force: true });
    },
  };
}

/** The two shapes of `where`: the flat one the writer takes, and the lease's. */
function whereOf(box: { controlRoot: string; workspaceRealPath: string }): {
  readonly flat: {
    readonly controlRoot: string;
    readonly workspaceRealPath: string;
    readonly slug: string;
    readonly runId: string;
  };
  readonly leaseWhere: {
    readonly place: { readonly controlRoot: string; readonly workspaceRealPath: string };
    readonly slug: string;
    readonly runId: string;
  };
} {
  const place = { controlRoot: box.controlRoot, workspaceRealPath: box.workspaceRealPath };
  return {
    flat: { ...place, slug: SLUG, runId: RUN },
    leaseWhere: { place, slug: SLUG, runId: RUN },
  };
}

const renderLinePort = renderLine as (
  view: never,
  options?: { validUntil?: string | null; withCursor?: boolean },
) => string;

test("the writer puts the line at run:<runId>:status-line and the pointer names it", () => {
  const box = scratch("write");
  try {
    const { flat } = whereOf(box);
    const written = writeStatusLine({
      where: flat,
      view: RUNNING_VIEW,
      renderLine: renderLinePort,
      leaseValidUntil: "2026-09-29T09:30:00.000Z",
    });
    assert.equal(written.path, statusLinePathOf(flat));
    assert.equal(written.pointerPath, currentStatusLinePathOf(box));
    assert.ok(existsSync(written.path));
    assert.equal(readStatusLineAt(written.pointerPath), written.path);
    assert.match(written.line, /^run=/u);
    assert.ok(written.line.includes("validUntil=2026-09-29T09:30:00.000Z"), written.line);
  } finally {
    box.dispose();
  }
});

test("a live state takes the lease's validUntil; a resting state takes none; a live state without a lease is refused", () => {
  const box = scratch("states");
  try {
    const { flat } = whereOf(box);
    assert.equal(
      validUntilForState("running", "2026-09-29T09:30:00.000Z"),
      "2026-09-29T09:30:00.000Z",
    );
    assert.equal(validUntilForState("finished", null), "none");
    assert.equal(validUntilForState("failed", null), "none");
    assert.throws(
      () =>
        writeStatusLine({
          where: flat,
          view: RUNNING_VIEW,
          renderLine: renderLinePort,
          leaseValidUntil: null,
        }),
      StatusLineRefusedError,
    );
    assert.equal(readStatusLineAt(statusLinePathOf(flat)), null);
    assert.equal(existsSync(currentStatusLinePathOf(box)), false);
  } finally {
    box.dispose();
  }
});

test("every heartbeat rewrites the line before its validUntil passes", () => {
  const box = scratch("beat");
  try {
    const { flat, leaseWhere } = whereOf(box);
    const t0 = new Date("2026-09-29T08:00:00.000Z");
    writeTheLease({
      where: leaseWhere,
      launchId: "launch-sl",
      launchNonce: "nonce-sl",
      owner: buildOwnerRecord({ launchId: "launch-sl", runTokenHash: "token-sl" }),
      leaseTokenHash: "token-sl",
      now: (): Date => t0,
    });
    const seen: string[] = [];
    const t1 = new Date("2026-09-29T08:01:00.000Z");
    const result = beat(leaseWhere, {
      now: (): Date => t1,
      rewriteStatusLine: (lease): void => {
        seen.push(String(lease.validUntil));
        writeStatusLine({
          where: flat,
          view: RUNNING_VIEW,
          renderLine: renderLinePort,
          leaseValidUntil: String(lease.validUntil),
        });
      },
    });
    assert.ok(result !== null);
    // The hook saw the lease just written, with ITS new validUntil…
    assert.deepEqual(seen, [String(result.validUntil)]);
    // …and the line on the disk carries it, so it stands until the next beat.
    const line = readStatusLineAt(statusLinePathOf(flat)) as string;
    assert.ok(line.includes(`validUntil=${result.validUntil}`), line);
  } finally {
    box.dispose();
  }
});
