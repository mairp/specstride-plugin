/**
 * T029 — the liveness endpoint of the shipped provider: listen, accept and
 * close, at a short path, readable and writable by its owner only (research
 * D-2, D-3; F122-FR-014, F122-FR-021).
 *
 * F122-FR-014: *Liveness MUST rest on something that the kernel releases when
 * the owner dies, and MUST NOT rest on a process id alone or on the age of a
 * file.* A listening local stream socket is exactly that: while the owner
 * lives the kernel accepts a connection to it; the moment the owner dies —
 * killed without warning, no clean-up of its own — the kernel drops the
 * listening endpoint and the next connection is REFUSED. No process decides
 * it and no timer is involved, so a machine that slept reads as alive and not
 * as dead.
 *
 * The endpoint carries NO data. It accepts and closes at once, and never reads
 * or writes a byte, which is why principle I ("no watcher in the control
 * path") allows it at all: nothing of the product's state travels through it,
 * and a reader that cannot reach it falls back to `unknown`, which counts as
 * held.
 *
 * THE PATH IS CHECKED BEFORE THE BIND, and that is not defensive habit. T009
 * measured the limit on Linux at 108 bytes and found that past it the failure
 * is SILENT: `listen` reports success, `connect` reports success, and the
 * platform has quietly truncated the path and bound somewhere else. Two
 * workspaces whose endpoint paths agreed on their first 108 bytes would then
 * be ONE endpoint, and one run's liveness would answer for another's — a
 * probe would say `held-live` about an owner that is not there. So the length
 * is this module's own check (`MAX_ENDPOINT_PATH_BYTES`, 100, eight bytes of
 * margin on the measured limit), and a path over it gives `unknown`
 * (F122-FR-021) instead of a lie.
 *
 * The path does not grow with the path of the workspace or of the control root
 * (F122-FR-021): it is built from the per-user runtime directory, a fixed
 * segment, the first sixteen hexadecimal characters of the workspace identity,
 * and the process id of the owner. The process id is in the NAME and not in
 * the directory, because two contenders for one workspace must be able to
 * listen at the same moment — were the endpoint named by the workspace alone,
 * the second contender would be refused with `EADDRINUSE` before it ever
 * reached the lock, and a loser of the race would look like a failure of the
 * provider.
 */
import { createServer, connect, type Server } from "node:net";
import { chmodSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

/** The requirements this module carries, and the research it comes from. */
export const LIVENESS_REQUIREMENTS = ["F122-FR-014", "F122-FR-021"] as const;
export const LIVENESS_DECISIONS = ["D-2", "D-3"] as const;

/**
 * D-3 — the guard, in bytes. T009 measured 108 on Linux; macOS is
 * `unverified` and general knowledge says about 104. 100 is below both.
 */
export const MAX_ENDPOINT_PATH_BYTES = 100 as const;

/** The limit T009 measured on Linux, kept here so the margin is visible. */
export const MEASURED_LINUX_LIMIT_BYTES = 108 as const;

/** D-2 — the endpoint accepts and closes; no byte is read or written. */
export const THE_ENDPOINT_CARRIES_DATA = false as const;

/** F122-FR-021 — the endpoint is readable and writable by its owner only. */
export const ENDPOINT_MODE = 0o600 as const;
export const ENDPOINT_DIRECTORY_MODE = 0o700 as const;

/** The fixed segment under the runtime directory, so nothing else collides. */
export const ENDPOINT_SEGMENT = "specstride-liveness" as const;

/** How many characters of the workspace identity name the directory (D-3). */
export const ENDPOINT_IDENTITY_CHARACTERS = 16 as const;

/** What a probe of the endpoint answers. */
export const LIVENESS_ANSWERS = ["alive", "dead", "unknown"] as const;
export type LivenessAnswer = (typeof LIVENESS_ANSWERS)[number];

/** How long a connection may take before the answer is `unknown`. */
export const CONNECT_TIMEOUT_MS = 2_000 as const;

/** Why the endpoint could not be created (F122-FR-021; the doctor names it). */
export const ENDPOINT_FAILURES = [
  /** The path would be longer than the guard allows. */
  "path-too-long",
  /** The runtime directory could not be made. */
  "directory-not-writable",
  /** `listen` itself failed. */
  "listen-failed",
] as const;
export type EndpointFailure = (typeof ENDPOINT_FAILURES)[number];

/** Where the endpoint of a workspace lies, and whether it may be created. */
export type EndpointPlace =
  | { readonly ok: true; readonly path: string; readonly directory: string; readonly bytes: number }
  | {
      readonly ok: false;
      readonly failure: EndpointFailure;
      readonly path: string;
      readonly bytes: number;
      readonly cause: string;
    };

/** What a caller may pin, so that a test is hermetic. */
export type EndpointOptions = {
  /** The per-user runtime directory; the system's temporary directory where none. */
  readonly runtimeDirectory?: string | undefined;
  /** The process the endpoint belongs to; this process where none is named. */
  readonly pid?: number | undefined;
  /**
   * What tells two contenders INSIDE ONE PROCESS apart. Two providers in one
   * process are an ordinary case — the conformance suite and the
   * characterization tests make several — and were the endpoint named by the
   * process id alone, the second would be refused with `EADDRINUSE` before it
   * ever reached the rename, and a plain loser of the race would be reported
   * as a provider that FAILED. A counter per process settles it; nothing
   * reads it, so its value carries no meaning.
   */
  readonly instance?: number | undefined;
};

let instances = 0;

/** The next discriminator of an endpoint inside this process. */
export function nextEndpointInstance(): number {
  return ++instances;
}

/**
 * The per-user runtime directory, or the temporary directory of the system
 * where there is none. `XDG_RUNTIME_DIR` is the one the platform gives; it is
 * short by design (`/run/user/<uid>`), which is the whole point of D-3.
 */
export function runtimeDirectoryOfTheUser(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const named = env["XDG_RUNTIME_DIR"];
  return named !== undefined && named !== "" ? named : tmpdir();
}

/**
 * D-3 — where the endpoint of a workspace lies, with the length checked
 * BEFORE anything is created. The answer is a value and not an exception,
 * because `acquire` turns `ok: false` into `unknown` (F122-FR-021) and a
 * refusal is an ordinary outcome of this provider, not an error of the
 * product.
 */
export function endpointPlaceOf(workspaceId: string, options: EndpointOptions = {}): EndpointPlace {
  const runtime = options.runtimeDirectory ?? runtimeDirectoryOfTheUser();
  const pid = options.pid ?? process.pid;
  const instance = options.instance ?? 0;
  const directory = join(runtime, ENDPOINT_SEGMENT, shortIdentity(workspaceId));
  const path = join(directory, `${pid}-${instance}.s`);
  const bytes = Buffer.byteLength(path, "utf8");
  if (bytes > MAX_ENDPOINT_PATH_BYTES) {
    return Object.freeze({
      ok: false as const,
      failure: "path-too-long" as const,
      path,
      bytes,
      cause:
        `the liveness endpoint would be at a path of ${bytes} bytes and the guard is ` +
        `${MAX_ENDPOINT_PATH_BYTES} (the measured limit on Linux is ` +
        `${MEASURED_LINUX_LIMIT_BYTES}, past which the platform truncates the path in ` +
        `silence); set a shorter per-user runtime directory (F122-FR-021, research D-3)`,
    });
  }
  return Object.freeze({ ok: true as const, path, directory, bytes });
}

/** The first sixteen hexadecimal characters of the workspace identity (D-3). */
export function shortIdentity(workspaceId: string): string {
  const hex = workspaceId.replace(/[^0-9a-f]/gi, "").toLowerCase();
  const taken = hex.slice(0, ENDPOINT_IDENTITY_CHARACTERS);
  return taken === "" ? "0".repeat(ENDPOINT_IDENTITY_CHARACTERS) : taken;
}

/** A listening endpoint, and the one thing its owner does with it: close it. */
export type LivenessEndpoint = {
  readonly path: string;
  /** Stop listening and remove the socket file. */
  close(): Promise<void>;
  /** True until `close` has run. */
  readonly listening: boolean;
};

/** What `listenForLiveness` answers. */
export type ListenResult =
  | { readonly ok: true; readonly endpoint: LivenessEndpoint }
  | {
      readonly ok: false;
      readonly failure: EndpointFailure;
      readonly cause: string;
      readonly path: string;
    };

/**
 * D-2 — start listening. Every connection is accepted and closed at once; no
 * byte is read and none is written.
 *
 * The socket file is created by `listen` with the process umask, so the mode
 * is set afterwards: F122-FR-021 says *readable and writable by its owner
 * only*, and a umask of 022 would otherwise leave it group- and
 * world-readable. The directory above it is made 0700 for the same reason.
 */
export async function listenForLiveness(
  workspaceId: string,
  options: EndpointOptions = {},
): Promise<ListenResult> {
  const place = endpointPlaceOf(workspaceId, options);
  if (!place.ok) {
    return Object.freeze({
      ok: false as const,
      failure: place.failure,
      cause: place.cause,
      path: place.path,
    });
  }
  try {
    mkdirSync(place.directory, { recursive: true, mode: ENDPOINT_DIRECTORY_MODE });
    chmodSync(place.directory, ENDPOINT_DIRECTORY_MODE);
  } catch (error) {
    return Object.freeze({
      ok: false as const,
      failure: "directory-not-writable" as const,
      cause: `the directory of the liveness endpoint could not be made: ${messageOf(error)}`,
      path: place.path,
    });
  }
  // A socket file left behind by a dead owner would refuse the bind with
  // `EADDRINUSE`. It is removed only when nothing listens on it, which is
  // tested by connecting: a refused connection means the owner is gone.
  if (existsSync(place.path) && (await probeLiveness(place.path)) !== "alive") {
    try {
      rmSync(place.path, { force: true });
    } catch {
      /* the bind below will report it */
    }
  }
  const server = createServer({ noDelay: true }, (socket) => {
    // D-2 — accept and close. Nothing is read; nothing is written.
    socket.end();
    socket.destroy();
  });
  // The endpoint must never hold the event loop of its owner open on its own:
  // the owner's own work decides when the process ends, not this socket.
  server.unref();
  const listened = await listenOn(server, place.path);
  if (listened !== null) {
    return Object.freeze({
      ok: false as const,
      failure: "listen-failed" as const,
      cause: `the liveness endpoint could not be created: ${listened}`,
      path: place.path,
    });
  }
  try {
    chmodSync(place.path, ENDPOINT_MODE);
  } catch {
    /* the socket exists; a platform that will not chmod it is not a failure */
  }
  // T009 — the platform truncates a path past its limit IN SILENCE, so the
  // bind is read back from the file system and not from the return of
  // `listen`. The guard above makes this unreachable on Linux; it stands
  // because the guard is a number and this is the fact itself.
  if (!isSocketAt(place.path)) {
    await closeServer(server);
    return Object.freeze({
      ok: false as const,
      failure: "listen-failed" as const,
      cause:
        `\`listen\` reported success and no socket exists at \`${place.path}\`: the platform ` +
        `bound the endpoint elsewhere (T009, research D-3)`,
      path: place.path,
    });
  }
  let open = true;
  const endpoint: LivenessEndpoint = {
    path: place.path,
    get listening(): boolean {
      return open;
    },
    async close(): Promise<void> {
      if (!open) return;
      open = false;
      await closeServer(server);
      try {
        rmSync(place.path, { force: true });
      } catch {
        /* the socket is already gone */
      }
    },
  };
  return Object.freeze({ ok: true as const, endpoint });
}

/**
 * D-2 — ask the kernel whether the owner lives.
 *
 * `alive` — the connection was accepted. `dead` — the connection was REFUSED
 * while the socket file is there, which is what the kernel does the moment
 * the listener is gone. `unknown` — there is no socket file, or the answer
 * took too long, or the platform reported something else: nothing may be
 * concluded, and `unknown` counts as held (F122-FR-013).
 */
export function probeLiveness(
  path: string,
  timeoutMs: number = CONNECT_TIMEOUT_MS,
): Promise<LivenessAnswer> {
  if (!isSocketAt(path)) return Promise.resolve("unknown");
  return new Promise<LivenessAnswer>((settle) => {
    let answered = false;
    const answer = (value: LivenessAnswer): void => {
      if (answered) return;
      answered = true;
      socket.destroy();
      settle(value);
    };
    const socket = connect(path);
    socket.setTimeout(timeoutMs, () => answer("unknown"));
    socket.on("connect", () => answer("alive"));
    socket.on("error", (error: NodeJS.ErrnoException) => {
      // ECONNREFUSED: the file is there and nobody listens — the owner died.
      // ENOENT: the file went away between the check and the connect.
      answer(error.code === "ECONNREFUSED" ? "dead" : "unknown");
    });
  });
}

/** True where a socket — and not a file of another kind — lies at the path. */
export function isSocketAt(path: string): boolean {
  try {
    return statSync(path).isSocket();
  } catch {
    return false;
  }
}

function listenOn(server: Server, path: string): Promise<string | null> {
  return new Promise<string | null>((settle) => {
    const failed = (error: Error): void => {
      server.removeListener("listening", succeeded);
      settle(messageOf(error));
    };
    const succeeded = (): void => {
      server.removeListener("error", failed);
      settle(null);
    };
    server.once("error", failed);
    server.once("listening", succeeded);
    try {
      server.listen(path);
    } catch (error) {
      server.removeListener("error", failed);
      server.removeListener("listening", succeeded);
      settle(messageOf(error));
    }
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((settle) => {
    server.close(() => settle());
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
