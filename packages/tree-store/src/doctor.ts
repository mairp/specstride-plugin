/**
 * T005 — the doctor check for git and its version, added to the doctor check
 * registry (EP-14, `specstride.doctor/1`; annex G, §G.7; research.md D-3).
 *
 * The tree store runs the `git` executable of the machine as a child process
 * (plan.md, "Primary Dependencies"): it is already a platform dependency of
 * the product, and no dependency from npm is added. This module is where the
 * consumer is told, before a run needs it, whether that executable is present
 * and new enough.
 *
 * THE FLOOR IS 2.31 (research.md D-3), a starting value of low confidence: the
 * floor is what a SNAPSHOT needs, because integration is composition and never
 * a merge (R29v PU-80). Task T002 ran the probe CT-143-132 on 2.31.0 and it
 * passed, which is what moved the fact out of `unverified`.
 *
 * The check obeys the guarantees of an implementation of §G.7: it READS and
 * never writes, makes no paid call, reads no secret value, opens no credential
 * store, CLOSES STANDARD INPUT of the process it starts, and keeps to a time
 * limit and an output cap.
 *
 * It is NOT launch-blocking by default. Parallel units are off by default and
 * off under the `parity` profile, so a machine with an old git must still be
 * able to launch an ordinary serial run; `gitDoctorCheck({ parallelUnitsOn:
 * true })` returns the same check with `lb` set, which is the form a run that
 * really needs the store registers.
 */
import {
  THE_ONE_PLACE,
  theVersionOnly,
  storeConfigurationHash,
  recordedStoreConfigurationHash,
} from "./git.ts";
import type { StorePlaces } from "./git.ts";
import type {
  DoctorCheck,
  DoctorFinding,
  DoctorRegistry,
  Severity,
} from "@specstride/contracts/ep/doctor";
import { MESSAGE_TEMPLATE_CAP_BYTES } from "@specstride/contracts/ep/doctor";

/* ------------------------------------------------------------------ *
 * The floor.
 * ------------------------------------------------------------------ */

/** The git floor of research.md D-3, as the doctor check states it. */
export const GIT_FLOOR = "2.31" as const;

/** Where the floor comes from, so a reader of a finding can check it. */
export const GIT_FLOOR_SOURCE = "research.md D-3 (R29v PU-80)" as const;

/**
 * The version task T002 ran the probe CT-143-132 on. Recorded here because
 * the floor is only as good as the version that was actually tried.
 */
export const GIT_FLOOR_VERSION_PROBED = "2.31.0" as const;

/** The stable dotted id of the check. Ids are never renamed (§G.7). */
export const GIT_CHECK_ID = "bin.git.version" as const;

/** The group of the check, of row 134 of annex X §X.6. */
export const GIT_CHECK_GROUP = "bin" as const;

/** The executable the tree store starts (plan.md, "Primary Dependencies"). */
export const GIT_EXECUTABLE = "git" as const;

/** The time limit of the probe, in milliseconds (§G.7, a time limit). */
export const PROBE_TIME_LIMIT_MS = 5_000 as const;

/** The output cap of the probe, in bytes (§G.7, an output cap). */
export const PROBE_OUTPUT_CAP_BYTES = 64 * 1024;

/* ------------------------------------------------------------------ *
 * Comparing versions.
 * ------------------------------------------------------------------ */

/** The numeric components of a version string, e.g. `2.31.0` → `[2, 31, 0]`. */
export function versionComponents(version: string): readonly number[] {
  const m = /(\d+(?:\.\d+)*)/.exec(version);
  if (m === null) return Object.freeze([]);
  return Object.freeze(m[1].split(".").map((p) => Number.parseInt(p, 10)));
}

/**
 * `-1`, `0` or `1`, comparing component by component. A missing component
 * counts as zero, so `2.31` and `2.31.0` are equal and `2.4` is BELOW `2.31`:
 * the comparison is numeric and never a string comparison.
 */
export function compareVersions(left: string, right: string): number {
  const a = versionComponents(left);
  const b = versionComponents(right);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** True where `version` is at the floor of research.md D-3 or above. */
export function meetsTheGitFloor(version: string): boolean {
  return versionComponents(version).length > 0 && compareVersions(version, GIT_FLOOR) >= 0;
}

/* ------------------------------------------------------------------ *
 * What the probe observes.
 * ------------------------------------------------------------------ */

/** What the probe of the check returns. */
export type GitObservation = {
  /** The executable was found and ran. */
  readonly present: boolean;
  /** The version it reported, or the empty string. */
  readonly version: string;
  /** Why it could not be read, or the empty string. */
  readonly reason: string;
};

/** Read a version out of the output of `git --version`. */
export function versionFromOutput(output: string): string {
  const m = /git version (\d+(?:\.\d+)*)/.exec(output);
  return m === null ? "" : m[1];
}

/**
 * Start `git --version` once, with standard input CLOSED, a time limit and an
 * output cap (§G.7). The probe of a doctor check reads and never writes, so
 * the process is given no repository and no working tree.
 */
export function probeGit(executable: string = GIT_EXECUTABLE): GitObservation {
  // THE PROCESS IS STARTED BY `git.ts` AND NOWHERE ELSE (T007): the check
  // reads the version through the one place that starts git, so that even
  // this probe runs with the fixed environment of F143-FR-004 and no second
  // door into the executable exists in the package.
  const r = theVersionOnly({
    executable,
    timeLimitMs: PROBE_TIME_LIMIT_MS,
    outputCapBytes: PROBE_OUTPUT_CAP_BYTES,
  });
  if (!r.started) {
    return { present: false, version: "", reason: r.error };
  }
  if (r.status !== 0) {
    return { present: false, version: "", reason: `exited ${String(r.status)}` };
  }
  const version = versionFromOutput(r.stdout);
  if (version === "") {
    return { present: true, version: "", reason: "the output named no version" };
  }
  return { present: true, version, reason: "" };
}

/** Read an observation back out of whatever the registry handed the rule. */
export function readObservation(observed: unknown): GitObservation {
  if (typeof observed !== "object" || observed === null) {
    return { present: false, version: "", reason: "nothing was observed" };
  }
  const o = observed as Partial<GitObservation>;
  return {
    present: o.present === true,
    version: typeof o.version === "string" ? o.version : "",
    reason: typeof o.reason === "string" ? o.reason : "",
  };
}

/**
 * The severity of the check: `fail` where git is absent or below the floor,
 * `ok` where it is at the floor or above.
 */
export function gitSeverity(observed: unknown): Severity {
  const o = readObservation(observed);
  if (!o.present || o.version === "") return "fail";
  return meetsTheGitFloor(o.version) ? "ok" : "fail";
}

/* ------------------------------------------------------------------ *
 * The check itself.
 * ------------------------------------------------------------------ */

/** The message template of the check, within the cap of 200 bytes (§G.7). */
export const GIT_CHECK_MESSAGE_TEMPLATE =
  `git {state}; the tree store of parallel units needs ${GIT_FLOOR} or later` as const;

/** The fix the finding offers. */
export const GIT_CHECK_FIX_HINT =
  `install git ${GIT_FLOOR} or later, or leave parallel units off` as const;

/** The order of the check among the checks of this package. */
export const GIT_CHECK_ORDER = 100 as const;

/**
 * The doctor check for git and its version (§G.7). `parallelUnitsOn` sets
 * `lb`: with the option off, which is the default and the state under the
 * `parity` profile, an old git must not refuse a launch that will never reach
 * the store.
 */
export function gitDoctorCheck(
  options: { readonly parallelUnitsOn?: boolean; readonly executable?: string } = {},
): DoctorCheck {
  const executable = options.executable ?? GIT_EXECUTABLE;
  return Object.freeze({
    id: GIT_CHECK_ID,
    lb: options.parallelUnitsOn === true,
    order: GIT_CHECK_ORDER,
    severityRule: gitSeverity,
    probe(injected: Readonly<Record<string, unknown>>): Promise<unknown> {
      // An injected observation is what the conformance suite feeds in; with
      // nothing injected the probe starts the real process.
      const given = injected[GIT_CHECK_ID];
      if (given !== undefined) return Promise.resolve(given);
      const named = injected["executable"];
      return Promise.resolve(probeGit(typeof named === "string" ? named : executable));
    },
    messageTemplate: GIT_CHECK_MESSAGE_TEMPLATE,
    fixHint: GIT_CHECK_FIX_HINT,
  });
}

/** The check of this package, in the off-by-default form. */
export const GIT_DOCTOR_CHECK: DoctorCheck = gitDoctorCheck();

/* ================================================================== *
 * T069 — the doctor checks of the feature.
 *
 * Three checks beside `bin.git.version`, one per set-up fact a run of
 * parallel units depends on (tasks.md T069):
 *
 *   1. `parallel.run-token.holders` — the holders of the run token
 *      (F143-FR-018): whether processes outside the run's own registry
 *      carry the token in their environment.
 *   2. `parallel.worker-caches` — the option state `worker-caches=shared`
 *      (F143-FR-009): the runtime promises no port, so a worker cache
 *      state other than `shared` is refused before the first worker.
 *   3. `store.configuration-hash` — the configuration of the store
 *      against its recorded hash (F143-FR-004), the same comparison every
 *      door of `git.ts` makes before a process, reported before a run
 *      needs it.
 *
 * All three READ and never write, make no paid call, read no secret
 * value, start no process and keep to the guarantees of §G.7. Like the
 * git check they are NOT launch-blocking by default: with parallel units
 * off (the default, and the state under the `parity` profile) no check
 * of this feature is needed, so `lb` is set only through
 * `{ parallelUnitsOn: true }`.
 * ================================================================== */

/**
 * The observation of the run-token-holders check, as the run's process
 * reader hands it over. `holders` are the processes found carrying the
 * token; `known` marks the ones the process registry of the run owns.
 * The check itself never reads a process table: that reader is a port of
 * the run, injected at `probe` time (the check reads and never writes).
 */
export type RunTokenHoldersObservation = {
  /** True where a process reader was given at all. */
  readonly observable: boolean;
  /** One row per process found holding the token. */
  readonly holders: ReadonlyArray<{ readonly pid: number; readonly known: boolean }>;
};

/** The empty observation: nothing was observed, so nothing is claimed. */
export const RUN_TOKEN_HOLDERS_UNOBSERVED: RunTokenHoldersObservation = Object.freeze({
  observable: false,
  holders: Object.freeze([]),
});

/**
 * Read the observation back out of whatever the registry handed the rule.
 * Anything that is not the shape above reads as "not observable".
 */
export function readRunTokenHoldersObservation(observed: unknown): RunTokenHoldersObservation {
  if (typeof observed !== "object" || observed === null) return RUN_TOKEN_HOLDERS_UNOBSERVED;
  const o = observed as Partial<RunTokenHoldersObservation>;
  if (o.observable !== true || !Array.isArray(o.holders)) return RUN_TOKEN_HOLDERS_UNOBSERVED;
  const holders = o.holders
    .filter(
      (h): h is { pid: number; known: boolean } =>
        typeof h === "object" && h !== null && typeof (h as { pid?: unknown }).pid === "number",
    )
    .map((h) => Object.freeze({ pid: h.pid, known: h.known === true }));
  return Object.freeze({ observable: true, holders: Object.freeze(holders) });
}

/**
 * Severity of the run-token-holders check: `fail` where a holder the
 * registry does not own carries the token (F143-FR-018), `warn` where no
 * process reader was given, `ok` otherwise — including where there are no
 * holders at all, which is the ordinary state before a group starts.
 */
export function runTokenHoldersSeverity(observed: unknown): Severity {
  const o = readRunTokenHoldersObservation(observed);
  if (!o.observable) return "warn";
  return o.holders.some((h) => !h.known) ? "fail" : "ok";
}

/** The stable dotted id of the check. Ids are never renamed (§G.7). */
export const RUN_TOKEN_HOLDERS_CHECK_ID = "parallel.run-token.holders" as const;

/** The group of the check, of row 134 of annex X §X.6. */
export const RUN_TOKEN_HOLDERS_CHECK_GROUP = "run" as const;

/** The order of the check among the checks of this package. */
export const RUN_TOKEN_HOLDERS_CHECK_ORDER = 110 as const;

/** The message template of the check, within the cap of 200 bytes (§G.7). */
export const RUN_TOKEN_HOLDERS_CHECK_MESSAGE_TEMPLATE =
  "the run token {state}; every holder must be a process the registry owns" as const;

/** The fix the finding offers. */
export const RUN_TOKEN_HOLDERS_CHECK_FIX_HINT =
  "end the holders the registry does not own, after the identity check (F143-FR-018)" as const;

/** The state the message template names, for one observation. */
export function runTokenHoldersState(observed: unknown): string {
  const o = readRunTokenHoldersObservation(observed);
  if (!o.observable) return "could not be observed (no process reader was given)";
  const unknown = o.holders.filter((h) => !h.known);
  if (unknown.length === 0) {
    return `is held by ${String(o.holders.length)} registered process(es)`;
  }
  return `is held by ${String(unknown.length)} process(es) the registry does not own`;
}

/**
 * The doctor check for the holders of the run token (F143-FR-018). The
 * probe takes the observation from the injected probes — the key is the
 * id of the check — or from `injected["run-token-holders"]`; with no
 * reader given it reports that the fact was not observable.
 */
export function runTokenHoldersDoctorCheck(
  options: { readonly parallelUnitsOn?: boolean } = {},
): DoctorCheck {
  return Object.freeze({
    id: RUN_TOKEN_HOLDERS_CHECK_ID,
    lb: options.parallelUnitsOn === true,
    order: RUN_TOKEN_HOLDERS_CHECK_ORDER,
    severityRule: runTokenHoldersSeverity,
    probe(injected: Readonly<Record<string, unknown>>): Promise<unknown> {
      const given = injected[RUN_TOKEN_HOLDERS_CHECK_ID] ?? injected["run-token-holders"];
      return Promise.resolve(given === undefined ? RUN_TOKEN_HOLDERS_UNOBSERVED : given);
    },
    messageTemplate: RUN_TOKEN_HOLDERS_CHECK_MESSAGE_TEMPLATE,
    fixHint: RUN_TOKEN_HOLDERS_CHECK_FIX_HINT,
  });
}

/* ------------------------------------------------------------------ *
 * 2. `worker-caches=shared` (F143-FR-009).
 * ------------------------------------------------------------------ */

/** The stable dotted id of the check. Ids are never renamed (§G.7). */
export const WORKER_CACHES_CHECK_ID = "parallel.worker-caches" as const;

/** The group of the check, of row 134 of annex X §X.6. */
export const WORKER_CACHES_CHECK_GROUP = "config" as const;

/** The only state of `worker-caches` the runtime accepts. */
export const WORKER_CACHES_REQUIRED = "shared" as const;

/** The order of the check among the checks of this package. */
export const WORKER_CACHES_CHECK_ORDER = 120 as const;

/** The message template of the check, within the cap of 200 bytes (§G.7). */
export const WORKER_CACHES_CHECK_MESSAGE_TEMPLATE =
  "worker-caches {state}; parallel units run only with worker-caches=shared" as const;

/** The fix the finding offers. */
export const WORKER_CACHES_CHECK_FIX_HINT =
  "set worker-caches=shared, or leave parallel units off (F143-FR-009)" as const;

/**
 * Read the `worker-caches` state out of whatever the registry handed the
 * rule: the value itself, or a record carrying it at `worker-caches`.
 * The empty string means "not set".
 */
export function workerCachesStateOf(observed: unknown): string {
  if (typeof observed === "string") return observed;
  if (typeof observed === "object" && observed !== null) {
    const v = (observed as Record<string, unknown>)["worker-caches"];
    if (typeof v === "string") return v;
    const s = (observed as Record<string, unknown>)["state"];
    if (typeof s === "string") return s;
  }
  return "";
}

/**
 * Severity of the `worker-caches` check: `ok` where the state is
 * `shared`, `fail` where it is set to anything else, `warn` where it is
 * not set at all (the option is off by default, and an unset value is a
 * set-up gap rather than a refusal).
 */
export function workerCachesSeverity(observed: unknown): Severity {
  const state = workerCachesStateOf(observed);
  if (state === "") return "warn";
  return state === WORKER_CACHES_REQUIRED ? "ok" : "fail";
}

/** The state the message template names, for one observation. */
export function workerCachesStateLabel(observed: unknown): string {
  const state = workerCachesStateOf(observed);
  if (state === "") return "is not set";
  return `is ${state}`;
}

/**
 * The doctor check for the `worker-caches` state (F143-FR-009). The
 * probe takes the state from the injected probes — the key is the id of
 * the check — or from `injected["worker-caches"]`; with nothing injected
 * it reports the state as not set.
 */
export function workerCachesDoctorCheck(
  options: { readonly parallelUnitsOn?: boolean } = {},
): DoctorCheck {
  return Object.freeze({
    id: WORKER_CACHES_CHECK_ID,
    lb: options.parallelUnitsOn === true,
    order: WORKER_CACHES_CHECK_ORDER,
    severityRule: workerCachesSeverity,
    probe(injected: Readonly<Record<string, unknown>>): Promise<unknown> {
      const given = injected[WORKER_CACHES_CHECK_ID] ?? injected["worker-caches"];
      return Promise.resolve(given === undefined ? "" : given);
    },
    messageTemplate: WORKER_CACHES_CHECK_MESSAGE_TEMPLATE,
    fixHint: WORKER_CACHES_CHECK_FIX_HINT,
  });
}

/* ------------------------------------------------------------------ *
 * 3. the configuration hash of the store (F143-FR-004).
 * ------------------------------------------------------------------ */

/** The stable dotted id of the check. Ids are never renamed (§G.7). */
export const STORE_CONFIGURATION_HASH_CHECK_ID = "store.configuration-hash" as const;

/** The group of the check, of row 134 of annex X §X.6. */
export const STORE_CONFIGURATION_HASH_CHECK_GROUP = "config" as const;

/** The order of the check among the checks of this package. */
export const STORE_CONFIGURATION_HASH_CHECK_ORDER = 130 as const;

/** The message template of the check, within the cap of 200 bytes (§G.7). */
export const STORE_CONFIGURATION_HASH_CHECK_MESSAGE_TEMPLATE =
  "the store configuration {state}; no repository process runs on a changed configuration" as const;

/** The fix the finding offers. */
export const STORE_CONFIGURATION_HASH_CHECK_FIX_HINT =
  "restore the store configuration, or record the new one deliberately (F143-FR-004)" as const;

/** What the probe of the check observes, without naming any path. */
export type StoreConfigurationHashObservation = {
  /** The hash recorded beside the store, or the empty string. */
  readonly recorded: string;
  /** The hash of the configuration as it is on disk now, or the empty string. */
  readonly found: string;
  /** False only where a hash was recorded and the two differ. */
  readonly equal: boolean;
  /** False where nothing was compared — no store, or nothing recorded. */
  readonly compared: boolean;
};

/**
 * Severity of the store-configuration-hash check: `fail` where the
 * configuration differs from its recorded hash, `warn` where nothing was
 * recorded yet or no store was given, `ok` where the two agree.
 */
export function storeConfigurationHashSeverity(observed: unknown): Severity {
  const o = observed as Partial<StoreConfigurationHashObservation> | null;
  if (typeof observed !== "object" || observed === null || o?.compared !== true) return "warn";
  return o.equal === true ? "ok" : "fail";
}

/** The state the message template names, for one observation. */
export function storeConfigurationHashState(observed: unknown): string {
  const o = observed as Partial<StoreConfigurationHashObservation> | null;
  if (typeof observed !== "object" || observed === null || o?.compared !== true) {
    return "was not compared (no recorded hash)";
  }
  return o.equal === true ? "matches its recorded hash" : "does not match its recorded hash";
}

/**
 * Observe the configuration of the store against its recorded hash,
 * through the functions of `git.ts` — the same comparison every door
 * makes before a process (F143-FR-004). The check reads two files and
 * starts no process.
 */
export function observeStoreConfigurationHash(
  places: StorePlaces,
): StoreConfigurationHashObservation {
  const recorded = recordedStoreConfigurationHash(places);
  const found = storeConfigurationHash(places);
  return Object.freeze({
    recorded,
    found,
    equal: recorded === "" || recorded === found,
    compared: recorded !== "",
  });
}

/**
 * The doctor check for the hash of the store configuration (F143-FR-004).
 * The probe takes the observation from the injected probes — the key is
 * the id of the check — or computes it from `injected["tree-store-places"]`;
 * with no store given it reports that nothing was compared.
 */
export function storeConfigurationHashDoctorCheck(
  options: { readonly parallelUnitsOn?: boolean } = {},
): DoctorCheck {
  return Object.freeze({
    id: STORE_CONFIGURATION_HASH_CHECK_ID,
    lb: options.parallelUnitsOn === true,
    order: STORE_CONFIGURATION_HASH_CHECK_ORDER,
    severityRule: storeConfigurationHashSeverity,
    probe(injected: Readonly<Record<string, unknown>>): Promise<unknown> {
      const given = injected[STORE_CONFIGURATION_HASH_CHECK_ID];
      if (given !== undefined) return Promise.resolve(given);
      const places = injected["tree-store-places"];
      if (typeof places !== "object" || places === null) {
        return Promise.resolve(
          Object.freeze({ recorded: "", found: "", equal: false, compared: false }),
        );
      }
      return Promise.resolve(observeStoreConfigurationHash(places as StorePlaces));
    },
    messageTemplate: STORE_CONFIGURATION_HASH_CHECK_MESSAGE_TEMPLATE,
    fixHint: STORE_CONFIGURATION_HASH_CHECK_FIX_HINT,
  });
}

/* ------------------------------------------------------------------ *
 * Registration of the feature's checks.
 * ------------------------------------------------------------------ */

/** The state the message template names, for one observation. */
export function stateOf(observed: unknown): string {
  const o = readObservation(observed);
  if (!o.present) return `is not usable (${o.reason})`;
  if (o.version === "") return `reported no version (${o.reason})`;
  return meetsTheGitFloor(o.version)
    ? `is ${o.version}, at or above the floor`
    : `is ${o.version}, below the floor`;
}

/** The finding one check makes of one observation, with the cap applied. */
export function findingOf(check: DoctorCheck, observed: unknown): DoctorFinding {
  return Object.freeze({
    id: check.id,
    severity: check.severityRule(observed),
    lb: check.lb,
    message: check.messageTemplate
      .replace("{state}", stateOf(observed))
      .slice(0, MESSAGE_TEMPLATE_CAP_BYTES),
    fix: check.fixHint,
    // The version of a local executable is not a secret, and no path is shown.
    evidence: `floor ${GIT_FLOOR} from ${GIT_FLOOR_SOURCE}`,
  });
}

/* ------------------------------------------------------------------ *
 * Registration.
 * ------------------------------------------------------------------ */

/**
 * What this module needs of the registry: the registration call of §G.7, and
 * nothing more — `run` belongs to the consumer, not to a package that only
 * contributes a check. The two members are PICKED OUT OF THE CONTRACT'S OWN
 * `DoctorRegistry` rather than copied, so this package cannot drift from
 * `specstride.doctor/1` without the compiler saying so.
 */
export type DoctorCheckRegistry = Pick<DoctorRegistry, "register" | "registered">;

/**
 * ADD THE CHECK TO THE DOCTOR CHECK REGISTRY (T005). The registration call
 * itself lives in `@specstride/kernel` (§G.7, Wave 1); this package hands it
 * the check and never keeps a registry of its own. Registering twice adds the
 * check once, because ids are unique and never renamed.
 */
export function registerGitDoctorChecks(
  registry: DoctorCheckRegistry,
  options: { readonly parallelUnitsOn?: boolean; readonly executable?: string } = {},
): readonly DoctorCheck[] {
  const already = registry.registered().some((c) => c.id === GIT_CHECK_ID);
  if (!already) registry.register(gitDoctorCheck(options));
  return registry.registered().filter((c) => c.id === GIT_CHECK_ID);
}

/** Every check this package registers, in `order`. */
export function checksOfThisPackage(
  options: { readonly parallelUnitsOn?: boolean } = {},
): readonly DoctorCheck[] {
  return Object.freeze(
    [
      gitDoctorCheck(options),
      runTokenHoldersDoctorCheck(options),
      workerCachesDoctorCheck(options),
      storeConfigurationHashDoctorCheck(options),
    ].sort((a, b) => a.order - b.order),
  );
}

/**
 * T069 — REGISTER THE CHECKS OF THE FEATURE. The four checks of this
 * package, handed to the registry once each: the git check of T005, and
 * the three checks of the feature — the holders of the run token,
 * `worker-caches=shared` and the hash of the store configuration. With
 * `parallelUnitsOn` all four are launch-blocking; without it none is.
 */
export function registerTheDoctorChecksOfTheFeature(
  registry: DoctorCheckRegistry,
  options: { readonly parallelUnitsOn?: boolean; readonly executable?: string } = {},
): readonly DoctorCheck[] {
  const ids = new Set(checksOfThisPackage(options).map((c) => c.id));
  for (const check of checksOfThisPackage(options)) {
    if (!registry.registered().some((c) => c.id === check.id)) registry.register(check);
  }
  return registry.registered().filter((c) => ids.has(c.id));
}

/**
 * T007 — where this package starts a process. The check reads the version
 * through it; no other file of the package names `node:child_process`.
 */
export const THE_ONE_PLACE_THAT_STARTS_GIT = THE_ONE_PLACE;
