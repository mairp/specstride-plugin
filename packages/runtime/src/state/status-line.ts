/**
 * T068 — the precomputed status line (F129-FR-028), written by the runtime at
 * the logical name `run:<runId>:status-line`, with the pointer
 * `workspace:current:status-line` beside it (annex B §B.5, F100-FR-229).
 *
 * WHAT IS THE RUNTIME'S AND WHAT IS THE VIEW'S. The grammar, the drop order
 * and the cap of the line are the pure read model's (`@specstride/view`,
 * `renderLine` and `expiry` in `src/line/`), and `@specstride/runtime` imports
 * no package above it — so the line renderer arrives here as an injected
 * function on the port below, exactly as `@specstride/cli`'s `status` takes
 * the pure rule as a parameter (request R-129-04 of
 * `specs/129-run-view-and-status/analyze-report.md`). What IS the runtime's
 * here is the WRITE: when the line is written, where, under which name, and
 * what `validUntil` it carries — the lease's own for a live state, `none` for
 * a resting state — and the rewrite at every heartbeat
 * (`../lease/lease.ts`, `beat`), so that the line is rewritten before its
 * `validUntil` passes for as long as the lease lives.
 *
 * A host hook shim of feature 113 finds the line through the pointer, which
 * depends on the workspace only, and reads the same two functions of
 * `@specstride/view` to decide whether the line may still be printed
 * (F113-FR-021; the decision is characterized in
 * `tests/characterization/129/shim/line-expiry.ts`).
 */
import { readFileSync } from "node:fs";
import { atomicWrite } from "@specstride/kernel";
import { resolve, rootPathsOf } from "@specstride/contracts/ids/logical-names";
import {
  STATUS_LINE_TARGET,
  resolveStatusLine,
} from "@specstride/contracts/ids/logical-names-amendments";
import { FILE_MODE } from "../root/control-root.ts";

/** The logical name of the precomputed line (F129-FR-028; §B.5). */
export const STATUS_LINE_LOGICAL_NAME = STATUS_LINE_TARGET;

/** The line has at most 170 bytes (F129-FR-027). */
export const LINE_CAP_BYTES = 170 as const;

/** The states whose line carries the `validUntil` of the lease (F129-FR-028). */
export const LIVE_LINE_STATES: readonly string[] = Object.freeze([
  "starting",
  "running",
  "paused-quota",
  "relaunching",
  "stopping",
]);

/** The states whose line carries `none` and never expires (F129-FR-028). */
export const RESTING_LINE_STATES: readonly string[] = Object.freeze([
  "blocked-on-human",
  "finished",
  "stopped",
  "failed",
]);

/**
 * F129-FR-028 — the `validUntil` a precomputed line carries for a written
 * state: the lease's own for a live state, `none` for a resting one. A live
 * state without a lease is refused: a live run owns a lease, and a line that
 * named `none` for one could never go stale.
 */
export function validUntilForState(state: string, leaseValidUntil: string | null): string {
  if (LIVE_LINE_STATES.includes(state)) {
    if (leaseValidUntil === null || leaseValidUntil === "") {
      throw new StatusLineRefusedError(state, "a live state needs the validUntil of the lease");
    }
    return leaseValidUntil;
  }
  if (RESTING_LINE_STATES.includes(state)) return "none";
  throw new StatusLineRefusedError(state, "not a written state of annex E §E.2");
}

/** The one error this module raises; it never writes on a refused path. */
export class StatusLineRefusedError extends Error {
  readonly logicalName = STATUS_LINE_LOGICAL_NAME;
  readonly state: string;
  constructor(state: string, detail: string) {
    super(`the precomputed status line for state \`${state}\` was refused: ${detail}`);
    this.name = "StatusLineRefusedError";
    this.state = state;
  }
}

/** Where a status line of one run lies. */
export type StatusLinePlace = {
  readonly controlRoot: string;
  readonly workspaceRealPath: string;
  /** The feature slug of the run, which `run:<runId>:status-line` is keyed by. */
  readonly slug: string;
  readonly runId: string;
};

/**
 * The path of `run:<runId>:status-line` (annex B §B.5). Never written out as a
 * literal: the layout table says where it is, and a change of the table moves
 * this file with it.
 */
export function statusLinePathOf(where: StatusLinePlace): string {
  const roots = rootPathsOf({
    home: "",
    workspaceRealPath: where.workspaceRealPath,
    workspaceId: "",
    controlRoot: where.controlRoot,
    workerRoot: "",
  });
  return resolve(STATUS_LINE_LOGICAL_NAME, { "<slug>": where.slug, "<runId>": where.runId }, roots);
}

/**
 * The path of `workspace:current:status-line` (F100-FR-229): the place depends
 * on the workspace only, carries no run id and no feature slug, and a shell
 * shim of a host finds it without starting the product.
 */
export function currentStatusLinePathOf(place: {
  readonly controlRoot: string;
  readonly workspaceRealPath: string;
}): string {
  return resolveStatusLine(
    rootPathsOf({
      home: "",
      workspaceRealPath: place.workspaceRealPath,
      workspaceId: "",
      controlRoot: place.controlRoot,
      workerRoot: "",
    }),
  );
}

/**
 * The port the caller brings: the pure line renderer of `@specstride/view`
 * (`renderLine`, `src/line/`), handed in because the runtime imports no
 * package above it (R-129-04). The options object is `LineOptions` of the
 * view, read structurally.
 */
export type RenderLinePort = {
  readonly renderLine: (
    view: never,
    options?: { readonly validUntil?: string | null; readonly withCursor?: boolean },
  ) => string;
};

/** What `writeStatusLine` needs, and nothing more. */
export type WriteStatusLineInput = {
  readonly where: StatusLinePlace;
  /**
   * The view of the run (schema `specstride.view/1`), read structurally: the
   * written `state` decides which `validUntil` the line carries.
   */
  readonly view: Readonly<Record<string, unknown>>;
  /** The injected renderer of the port above. */
  readonly renderLine: RenderLinePort["renderLine"];
  /** The `validUntil` of the run's published lease, or `null` where it rests. */
  readonly leaseValidUntil: string | null;
};

/** What one write produced, for a test to read. */
export type WrittenStatusLine = {
  readonly line: string;
  readonly validUntil: string;
  readonly path: string;
  readonly pointerPath: string;
};

/**
 * F129-FR-028 — write the precomputed status line at
 * `run:<runId>:status-line`, atomically, and refresh the pointer
 * `workspace:current:status-line` to name it. The line is rendered by the
 * injected renderer of the port with the `validUntil` the state asks for; a
 * line over the cap is refused BEFORE anything is written, because a line the
 * grammar forbids must not reach a reader. Both writes are the kernel's
 * atomic ones: a reader that looks while the owner writes sees the old line
 * or the new one and never half of either.
 *
 * Called whenever the change signature changes and at every heartbeat (the
 * `rewriteStatusLine` hook of `beat` in `../lease/lease.ts`), so the line is
 * rewritten before its `validUntil` passes for as long as the lease lives.
 */
export function writeStatusLine(input: WriteStatusLineInput): WrittenStatusLine {
  const state = String(input.view["state"] ?? "");
  const validUntil = validUntilForState(state, input.leaseValidUntil);
  const line = input.renderLine(input.view as never, { validUntil });
  if (Buffer.byteLength(line, "utf8") > LINE_CAP_BYTES) {
    throw new StatusLineRefusedError(state, `the rendered line is over ${LINE_CAP_BYTES} bytes`);
  }
  const roots = rootPathsOf({
    home: "",
    workspaceRealPath: input.where.workspaceRealPath,
    workspaceId: "",
    controlRoot: input.where.controlRoot,
    workerRoot: "",
  });
  const path = resolve(
    STATUS_LINE_LOGICAL_NAME,
    { "<slug>": input.where.slug, "<runId>": input.where.runId },
    roots,
  );
  atomicWrite(path, `${line}\n`, { mode: FILE_MODE, createDirectory: true });
  const pointerPath = resolveStatusLine(roots);
  // The pointer NAMES the line of the current run (§B.5): its place, so a
  // shell shim reads the pointer and then the line, starting no product.
  atomicWrite(pointerPath, `${path}\n`, { mode: FILE_MODE, createDirectory: true });
  return Object.freeze({ line, validUntil, path, pointerPath });
}

/** The line at a path, trimmed, or `null` where there is none to read. */
export function readStatusLineAt(path: string): string | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const line = text.trim();
  return line === "" ? null : line;
}
