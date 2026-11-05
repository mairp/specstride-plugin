/**
 * T034 — the doctor checks of the lock: the holder, the result of the probe,
 * a lock without a live holder, the provider, and the cause where the
 * liveness endpoint cannot be created (F122-FR-016, F122-FR-019,
 * F122-FR-021; EP-14, annex G §G.7; R16 F8).
 *
 * Five checks over ONE probe. They share a single reading of the lock,
 * because five readings taken a moment apart could disagree with each other
 * and a consumer would be shown a lock that is at once held and free. The
 * probe is taken once per run of the doctor and every check reads it.
 *
 * WHICH OF THEM BLOCK A LAUNCH. EP-14 guarantees that *the launch checks are
 * exactly the `lb` subset, so the doctor and a launch cannot disagree*. So
 * `lb` here is not a judgement about how bad a finding is; it is the question
 * "would a launch be refused for this?", and the answer is read from the same
 * code the start reads it from:
 *
 *   - the PROVIDER check is `lb`: F122-FR-019 refuses the launch.
 *   - the ENDPOINT check is `lb`: F122-FR-021 makes `acquire` give `unknown`,
 *     and an unknown lock refuses the launch.
 *   - the PROBE check is `lb`: every result that counts as held refuses a
 *     start, and `countsAsHeld` is the lock's own function, not a copy.
 *   - the HOLDER check is NOT `lb`: it reports WHO holds a lock, which is
 *     information a consumer wants and never a reason to refuse on its own —
 *     the probe check already refuses for the same lock.
 *   - the NO-LIVE-HOLDER check is NOT `lb`: a lock whose holder is gone is
 *     exactly the lock that `resume` may reclaim (F122-FR-015). Were it
 *     launch-blocking, the doctor would refuse the one case the product knows
 *     how to clear by itself.
 */
import {
  MESSAGE_TEMPLATE_CAP_BYTES,
  type DoctorCheck,
  type DoctorRegistry,
  type Severity,
} from "@specstride/contracts/ep/doctor";
import type { ProbeResult } from "@specstride/contracts/ep/lock";
import { SHIPPED_PROVIDER_ID, SHIPPED_PROVIDER_VERSION } from "../lock/directory-lock.ts";
import { endpointPlaceOf, type EndpointFailure } from "../lock/liveness.ts";
import { LOCK_LOGICAL_NAME, type LockPlace } from "../lock/paths.ts";
import {
  ACQUIRED_AT_FIELD,
  countsAsHeld,
  probeLock,
  type LockOwnerRecord,
  type ProbeOutcome,
} from "../lock/probe.ts";
import {
  PROVIDER_MISMATCH,
  providerIsTheRecordedOne,
  readWorkspaceRecordOf,
  recordedProviderOf,
  workspaceIdentityOf,
  type ProviderIdentity,
} from "../lock/workspace-record.ts";

/** The requirements these checks carry. */
export const LOCK_CHECK_REQUIREMENTS = ["F122-FR-016", "F122-FR-019", "F122-FR-021"] as const;

/**
 * Ids are never renamed (EP-14, `CORE_GUARANTEES`), so these five are fixed.
 *
 * Each carries a HYPHEN in its middle segment, and that is a rule and not a
 * taste: §K.2 rule 1 says a segment of a configuration key is lowerCamelCase
 * or carries an underscore, so a hyphen in a segment makes a dotted literal a
 * check id and never a key. An id of the form `runtime` dot `lock` dot a
 * plain word would read as a configuration key that the catalogue of feature
 * 110 lacks — and one of those, the provider, IS a key (row 115 of annex X
 * §X.7), which a check of the same name would then shadow.
 */
export const LOCK_HOLDER_CHECK_ID = "runtime.workspace-lock.holder" as const;
export const LOCK_PROBE_CHECK_ID = "runtime.workspace-lock.probe" as const;
export const LOCK_NO_LIVE_HOLDER_CHECK_ID = "runtime.workspace-lock.no-live-holder" as const;
export const LOCK_PROVIDER_CHECK_ID = "runtime.workspace-lock.provider" as const;
export const LOCK_ENDPOINT_CHECK_ID = "runtime.workspace-lock.liveness-endpoint" as const;

/** The five ids, in the order they are registered. */
export const LOCK_CHECK_IDS = [
  LOCK_HOLDER_CHECK_ID,
  LOCK_PROBE_CHECK_ID,
  LOCK_NO_LIVE_HOLDER_CHECK_ID,
  LOCK_PROVIDER_CHECK_ID,
  LOCK_ENDPOINT_CHECK_ID,
] as const;

/** Where in the doctor's order these five run, after the control root. */
export const LOCK_CHECK_FIRST_ORDER = 230 as const;

/** Which of the five are launch-blocking; the reasoning is in the header. */
export const LOCK_CHECKS_THAT_BLOCK_A_LAUNCH: readonly string[] = Object.freeze([
  LOCK_PROBE_CHECK_ID,
  LOCK_PROVIDER_CHECK_ID,
  LOCK_ENDPOINT_CHECK_ID,
]);

/** The keys the checks read the context out of the injected probes under. */
export const LOCK_PLACE_PROBE_KEY = "lockPlace" as const;
export const CONFIGURED_PROVIDER_PROBE_KEY = "configuredLockProvider" as const;
export const RUNTIME_DIRECTORY_PROBE_KEY = "runtimeDirectory" as const;

/** One reading of the lock, shared by all five checks. */
export type LockProbeReading = {
  readonly place: LockPlace | null;
  readonly outcome: ProbeOutcome | null;
  readonly holder: LockOwnerRecord | null;
  readonly configured: ProviderIdentity;
  readonly recorded: ProviderIdentity | null;
  readonly providerMatches: boolean;
  readonly endpointFailure: EndpointFailure | null;
  readonly endpointCause: string | null;
  readonly endpointPath: string | null;
};

/** Read the place out of the injected probes. */
export function lockPlaceFrom(injected: Readonly<Record<string, unknown>>): LockPlace | null {
  const value = injected[LOCK_PLACE_PROBE_KEY] as Partial<LockPlace> | undefined;
  if (
    value === undefined ||
    typeof value.controlRoot !== "string" ||
    typeof value.workspaceRealPath !== "string"
  ) {
    return null;
  }
  return Object.freeze({
    controlRoot: value.controlRoot,
    workspaceRealPath: value.workspaceRealPath,
  });
}

/** Read the configured provider; the shipped one where none is named. */
export function configuredProviderFrom(
  injected: Readonly<Record<string, unknown>>,
): ProviderIdentity {
  const value = injected[CONFIGURED_PROVIDER_PROBE_KEY] as Partial<ProviderIdentity> | undefined;
  return Object.freeze({
    id: typeof value?.id === "string" ? value.id : SHIPPED_PROVIDER_ID,
    version: typeof value?.version === "string" ? value.version : SHIPPED_PROVIDER_VERSION,
  });
}

/** Take the one reading the five checks share. */
export async function probeTheLock(
  injected: Readonly<Record<string, unknown>>,
): Promise<LockProbeReading> {
  const place = lockPlaceFrom(injected);
  const configured = configuredProviderFrom(injected);
  if (place === null) {
    return Object.freeze({
      place: null,
      outcome: null,
      holder: null,
      configured,
      recorded: null,
      providerMatches: true,
      endpointFailure: null,
      endpointCause: null,
      endpointPath: null,
    });
  }
  const outcome = await probeLock(place);
  const record = readWorkspaceRecordOf(place);
  const runtimeDirectory = injected[RUNTIME_DIRECTORY_PROBE_KEY];
  // F122-FR-021 — the cause is asked of the same function the provider uses,
  // so the doctor cannot name a cause the provider would not have met.
  const endpoint = endpointPlaceOf(workspaceIdentityOf(place.workspaceRealPath), {
    ...(typeof runtimeDirectory === "string" ? { runtimeDirectory } : {}),
  });
  return Object.freeze({
    place,
    outcome,
    holder: outcome.reading.owner,
    configured,
    recorded: record.present ? recordedProviderOf(record.record) : null,
    providerMatches: providerIsTheRecordedOne(place, configured),
    endpointFailure: endpoint.ok ? null : endpoint.failure,
    endpointCause: endpoint.ok ? null : endpoint.cause,
    endpointPath: endpoint.path,
  });
}

const reading = (observed: unknown): LockProbeReading | null =>
  (observed as LockProbeReading | undefined) ?? null;

/* ------------------------------------------------------------------ *
 * The five severities.
 * ------------------------------------------------------------------ */

/**
 * The holder. `info` where a lock is held by someone a consumer can see,
 * `ok` where there is none, `warn` where the lock is there and its owner
 * record cannot be read — "we could not look" is never `ok` (§G.7).
 */
export function holderSeverity(observed: unknown): Severity {
  const r = reading(observed);
  if (r?.outcome == null) return "warn";
  if (r.outcome.result === "free") return "ok";
  return r.holder === null ? "warn" : "info";
}

/** The result of the probe. `fail` for every result that counts as held. */
export function probeSeverity(observed: unknown): Severity {
  const r = reading(observed);
  if (r?.outcome == null) return "warn";
  return countsAsHeld(r.outcome.result) ? "fail" : "ok";
}

/**
 * A lock without a live holder: the probe says `stale-owner-dead`, or says
 * `owner-dead-group-alive` — the owner is gone in both, and the second has
 * survivors to end first. `warn`, never `fail`: this is the one state the
 * product can clear by itself, with `reclaim` (F122-FR-015).
 */
export function noLiveHolderSeverity(observed: unknown): Severity {
  const r = reading(observed);
  if (r?.outcome == null) return "warn";
  const result: ProbeResult = r.outcome.result;
  return result === "stale-owner-dead" || result === "owner-dead-group-alive" ? "warn" : "ok";
}

/** F122-FR-019 — a configured provider that differs from the recorded one. */
export function providerSeverity(observed: unknown): Severity {
  const r = reading(observed);
  if (r == null || r.place === null) return "warn";
  return r.providerMatches ? "ok" : "fail";
}

/** F122-FR-021 — the endpoint cannot be created. */
export function endpointSeverity(observed: unknown): Severity {
  const r = reading(observed);
  if (r == null || r.place === null) return "warn";
  return r.endpointFailure === null ? "ok" : "fail";
}

/* ------------------------------------------------------------------ *
 * The evidence of each finding.
 * ------------------------------------------------------------------ */

/**
 * F122-FR-016 — *the refusal and the doctor finding MUST name the logical
 * name of the lock and the host name, the launch and the time of the owner
 * record.* This line is that sentence.
 */
export function holderEvidence(observed: unknown): string {
  const r = reading(observed);
  if (r?.outcome == null) return `no workspace was given to the check (\`${LOCK_LOGICAL_NAME}\`)`;
  if (r.outcome.result === "free") return `${LOCK_LOGICAL_NAME} is free`;
  if (r.holder === null) {
    return (
      `${LOCK_LOGICAL_NAME} exists and its owner record cannot be read ` +
      `(${r.outcome.reading.refusal ?? "no reason given"})`
    );
  }
  return (
    `${LOCK_LOGICAL_NAME} host=${r.holder.hostName} launch=${r.holder.launchId} ` +
    `acquiredAt=${r.holder[ACQUIRED_AT_FIELD] ?? "unknown"} pid=${r.holder.pid}`
  );
}

/** The result, the row of the decision table that gave it, and its `when`. */
export function probeEvidence(observed: unknown): string {
  const r = reading(observed);
  if (r?.outcome == null) return `no workspace was given to the check (\`${LOCK_LOGICAL_NAME}\`)`;
  return (
    `${LOCK_LOGICAL_NAME} probe=${r.outcome.result} row=${r.outcome.row} ` +
    `held=${countsAsHeld(r.outcome.result)} because="${r.outcome.because}"`
  );
}

/** What is left of a run whose owner is gone. */
export function noLiveHolderEvidence(observed: unknown): string {
  const r = reading(observed);
  if (r?.outcome == null) return `no workspace was given to the check (\`${LOCK_LOGICAL_NAME}\`)`;
  const survivors = r.outcome.observed.anOpenOwnedEntryPassesTheIdentityCheck;
  return (
    `${LOCK_LOGICAL_NAME} probe=${r.outcome.result} ownerIsDead=` +
    `${r.outcome.result === "stale-owner-dead" || r.outcome.result === "owner-dead-group-alive"} ` +
    `survivorsOfClassOwned=${survivors}`
  );
}

/** F122-FR-019 — the recorded provider against the configured one. */
export function providerEvidence(observed: unknown): string {
  const r = reading(observed);
  if (r == null || r.place === null) return `no workspace was given to the check`;
  const recorded =
    r.recorded === null ? "(none recorded yet)" : `${r.recorded.id}@${r.recorded.version}`;
  return `recorded=${recorded} configured=${r.configured.id}@${r.configured.version}`;
}

/** F122-FR-021 — the cause, exactly as the provider would have met it. */
export function endpointEvidence(observed: unknown): string {
  const r = reading(observed);
  if (r == null || r.place === null) return `no workspace was given to the check`;
  if (r.endpointFailure === null) {
    return `the liveness endpoint can be created at \`${r.endpointPath ?? "unknown"}\``;
  }
  return `failure=${r.endpointFailure} path=${r.endpointPath ?? "unknown"} cause=${r.endpointCause ?? ""}`;
}

/* ------------------------------------------------------------------ *
 * The checks.
 * ------------------------------------------------------------------ */

export const HOLDER_MESSAGE_TEMPLATE =
  `who holds \`${LOCK_LOGICAL_NAME}\`: the finding names the host, the launch and the time ` +
  `the lock was taken (F122-FR-016)`;

export const PROBE_MESSAGE_TEMPLATE =
  `the result of the probe of \`${LOCK_LOGICAL_NAME}\`; every result but \`free\` and ` +
  `\`stale-owner-dead\` counts as held and refuses a start (F122-FR-013)`;

export const NO_LIVE_HOLDER_MESSAGE_TEMPLATE =
  `\`${LOCK_LOGICAL_NAME}\` is held and its owner is gone; \`resume\` may reclaim it once no ` +
  `process it owned is left (F122-FR-015, F122-FR-017)`;

export const PROVIDER_MESSAGE_TEMPLATE =
  `the configured lock provider differs from the one recorded in \`workspace:record\`; two ` +
  `providers do not exclude each other, so the launch is refused (F122-FR-019)`;

export const ENDPOINT_MESSAGE_TEMPLATE =
  `the liveness endpoint of \`${LOCK_LOGICAL_NAME}\` cannot be created, so \`acquire\` gives ` +
  `\`unknown\`, which counts as held (F122-FR-021)`;

export const HOLDER_FIX_HINT = `nothing to fix where the holder lives; end that run, or wait for it`;

export const PROBE_FIX_HINT = `wait for the run that holds the lock, or, where its owner is gone, run \`resume\` to reclaim`;

export const NO_LIVE_HOLDER_FIX_HINT =
  `run \`resume\`: a lock whose owner is dead and whose owned processes are gone is reclaimed ` +
  `by one atomic rename, and is never removed by hand`;

export const PROVIDER_FIX_HINT =
  `set \`runtime.lock.provider\` to the provider recorded in \`workspace:record\`, or use a ` +
  `fresh control root`;

export const ENDPOINT_FIX_HINT = `set a shorter per-user runtime directory (XDG_RUNTIME_DIR), or make it writable by you`;

function check(
  id: string,
  severityRule: (observed: unknown) => Severity,
  order: number,
  messageTemplate: string,
  fixHint: string,
): DoctorCheck {
  return Object.freeze({
    id,
    severityRule,
    lb: LOCK_CHECKS_THAT_BLOCK_A_LAUNCH.includes(id),
    order,
    probe: (injected: Readonly<Record<string, unknown>>): Promise<unknown> =>
      probeTheLock(injected),
    messageTemplate,
    fixHint,
  });
}

export const lockHolderCheck: DoctorCheck = check(
  LOCK_HOLDER_CHECK_ID,
  holderSeverity,
  LOCK_CHECK_FIRST_ORDER,
  HOLDER_MESSAGE_TEMPLATE,
  HOLDER_FIX_HINT,
);

export const lockProbeCheck: DoctorCheck = check(
  LOCK_PROBE_CHECK_ID,
  probeSeverity,
  LOCK_CHECK_FIRST_ORDER + 1,
  PROBE_MESSAGE_TEMPLATE,
  PROBE_FIX_HINT,
);

export const lockWithoutALiveHolderCheck: DoctorCheck = check(
  LOCK_NO_LIVE_HOLDER_CHECK_ID,
  noLiveHolderSeverity,
  LOCK_CHECK_FIRST_ORDER + 2,
  NO_LIVE_HOLDER_MESSAGE_TEMPLATE,
  NO_LIVE_HOLDER_FIX_HINT,
);

export const lockProviderCheck: DoctorCheck = check(
  LOCK_PROVIDER_CHECK_ID,
  providerSeverity,
  LOCK_CHECK_FIRST_ORDER + 3,
  PROVIDER_MESSAGE_TEMPLATE,
  PROVIDER_FIX_HINT,
);

export const livenessEndpointCheck: DoctorCheck = check(
  LOCK_ENDPOINT_CHECK_ID,
  endpointSeverity,
  LOCK_CHECK_FIRST_ORDER + 4,
  ENDPOINT_MESSAGE_TEMPLATE,
  ENDPOINT_FIX_HINT,
);

/** The five checks, in the order they are registered. */
export const LOCK_CHECKS: readonly DoctorCheck[] = Object.freeze([
  lockHolderCheck,
  lockProbeCheck,
  lockWithoutALiveHolderCheck,
  lockProviderCheck,
  livenessEndpointCheck,
]);

/** The evidence of a check, by id, so a caller need not pick the function. */
export const EVIDENCE_OF: Readonly<Record<string, (observed: unknown) => string>> = Object.freeze({
  [LOCK_HOLDER_CHECK_ID]: holderEvidence,
  [LOCK_PROBE_CHECK_ID]: probeEvidence,
  [LOCK_NO_LIVE_HOLDER_CHECK_ID]: noLiveHolderEvidence,
  [LOCK_PROVIDER_CHECK_ID]: providerEvidence,
  [LOCK_ENDPOINT_CHECK_ID]: endpointEvidence,
});

// The cap of §G.7 is checked at load, so a template that grew past 200 bytes
// fails in a test run and never in a consumer's terminal.
for (const one of LOCK_CHECKS) {
  const bytes = Buffer.byteLength(one.messageTemplate, "utf8");
  if (bytes > MESSAGE_TEMPLATE_CAP_BYTES) {
    throw new Error(
      `the message template of the doctor check \`${one.id}\` is ${bytes} bytes and the cap ` +
        `of annex G §G.7 is ${MESSAGE_TEMPLATE_CAP_BYTES}`,
    );
  }
}

/** The refusal a failing provider check leads to (closed set 212). */
export const PROVIDER_CHECK_REFUSAL = PROVIDER_MISMATCH;

/** F122-FR-016, F122-FR-019, F122-FR-021 — register the five checks. */
export function registerLockChecks(registry: DoctorRegistry): readonly DoctorCheck[] {
  for (const one of LOCK_CHECKS) registry.register(one);
  return LOCK_CHECKS;
}
