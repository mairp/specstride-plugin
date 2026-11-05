/**
 * T057 (feature 112) — the real (safe) probe implementations of the probe bag
 * (F112-FR-004, F112-FR-005, F112-FR-006).
 *
 * The checks read the machine only through the injected bag; this module holds
 * the real implementations of the bag's machine probes, each one bounded to
 * what the ground rules allow:
 *
 * - the file metadata reader (F112-FR-006): a metadata read only — existence,
 *   size and mode, never content. The existence of a `file:` credential
 *   reference is this read; it never returns a value.
 * - the subprocess runner (F112-FR-005 allowed probes; F112-FR-007 bounds):
 *   the harness's own version or status command, stdin closed, output capped,
 *   a time limit, and a process group that is ended. Its implementation is the
 *   runner's (`makeSubprocessRunner`), surfaced here as the real probe so a
 *   bag builder has one place to take all three from.
 * - the network reader (F112-FR-005, research D-11, ruling 61): a free GET,
 *   redirects refused, a 3 s limit, no credential header, and — when the
 *   declared hosts are given — only to a host a credential was declared for.
 *   It never issues another method, never follows a redirect and never asks a
 *   health path that would make a real model call: any refused attempt reads
 *   as `{ status: 0, body: "" }`, the state every probe already treats as
 *   "not probed".
 */
import { statSync } from "node:fs";
import {
  endProcessGroup,
  makeSubprocessRunner,
  NETWORK_TIME_LIMIT_MS,
  SUBPROCESS_OUTPUT_CAP_BYTES,
  PROBE_TIME_LIMIT_MS,
} from "../runner/run.ts";
import type { FileMetadataReader, NetworkReader, ProbeBag } from "../registry/types.ts";

export {
  makeSubprocessRunner,
  PROBE_TIME_LIMIT_MS,
  SUBPROCESS_OUTPUT_CAP_BYTES,
  NETWORK_TIME_LIMIT_MS,
};

/** The keys the file metadata reader may return: never a content field (F112-FR-006). */
export const FILE_METADATA_KEYS: readonly string[] = Object.freeze(["size", "mode"]);

/**
 * F112-FR-006 — the real file metadata reader: existence, size and mode, and
 * nothing else. A path that does not exist reads as `undefined`; a value is
 * never returned, because none is ever read.
 */
export function makeFileMetadataReader(): FileMetadataReader {
  return {
    stat: (path: string): { size: number; mode: number } | undefined => {
      // A metadata read only: `statSync` gives the inode's fields, never the
      // bytes of the file. Content is read nowhere in the doctor.
      try {
        const st = statSync(path);
        return { size: st.size, mode: st.mode };
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * F112-FR-005 — the real network reader: GET only, redirects refused (a
 * redirect makes the fetch fail and reads as a refusal), a 3 s limit, no
 * header that carries a credential. When `allowedHosts` is given, a URL on
 * any other host is refused before the request is made: the GET goes only to
 * the host the credential was declared for.
 */
export function makeNetworkReader(allowedHosts?: readonly string[]): NetworkReader {
  const hosts = allowedHosts === undefined ? undefined : new Set(allowedHosts);
  return {
    async get(url: string): Promise<{ status: number; body: string }> {
      // The declared-host rule is checked before anything is sent.
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        return { status: 0, body: "" };
      }
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        return { status: 0, body: "" };
      }
      if (hosts !== undefined && !hosts.has(target.host)) {
        return { status: 0, body: "" };
      }
      try {
        const response = await fetch(target, {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(NETWORK_TIME_LIMIT_MS),
        });
        const body = await response.text();
        return { status: response.status, body: body.slice(0, SUBPROCESS_OUTPUT_CAP_BYTES) };
      } catch {
        // A refused redirect, a timeout, an unreachable host: not probed.
        return { status: 0, body: "" };
      }
    },
  };
}

/**
 * The real probe bag: the three safe probes of this module, over the bag
 * builder of the runner. Every member stays replaceable, so the same check
 * runs on a fixture of the test tree without the real machine (F112-FR-001).
 */
export function makeRealProbeBag(overrides?: Partial<ProbeBag>): ProbeBag {
  return {
    files: makeFileMetadataReader(),
    subprocess: makeSubprocessRunner({
      timeLimitMs: overrides?.timeLimitMs,
      outputCapBytes: overrides?.outputCapBytes,
    }),
    network: makeNetworkReader(),
    ...overrides,
  } as ProbeBag;
}

// The ended process group primitive is re-exported so the bounds of the
// subprocess probe (F112-FR-007) stay reachable from one place.
export { endProcessGroup };
