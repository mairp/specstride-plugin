/**
 * T058 — the doctor check that reports survivors (F122-FR-027; EP-14, annex
 * G §G.7).
 *
 * *`status` and the doctor read the survivors through the same operation and
 * report them; they end nothing.* So this check calls `reportSurvivors` of
 * `../procs/survivors.ts` — the same call `status` makes — and there is no
 * second reading of the process table here that could disagree with it.
 *
 * IT IS NOT LAUNCH-BLOCKING, and that is a decision, not an oversight. A
 * survivor is the one state the product clears by itself: F122-FR-027 says
 * *every engine start and every `resume` MUST call it and MUST end the
 * survivors*. Were the check `lb`, the doctor would refuse the very launch
 * that is about to end the survivor it is refusing for. The lock's own
 * `no-live-holder` check is `warn` for the same reason (T034), and the probe
 * check — which IS `lb` — already refuses a start where a dead owner has
 * survivors of class `owned`.
 *
 * A check reads and never writes (§G.7, "Guarantees of an implementation"),
 * and `reportSurvivors` has no signaller among its arguments, so this check
 * cannot end a process however it is called.
 */
import {
  MESSAGE_TEMPLATE_CAP_BYTES,
  type DoctorCheck,
  type DoctorRegistry,
  type Severity,
} from "@specstride/contracts/ep/doctor";
import {
  reportSurvivors,
  runTokenHashesOf,
  survivorLines,
  type Survivor,
} from "../procs/survivors.ts";
import type { ProcsPlace } from "../procs/registry.ts";

/** The requirement this check carries. */
export const SURVIVOR_CHECK_REQUIREMENTS = ["F122-FR-027"] as const;

/**
 * The id. A HYPHEN in the middle segment, by §K.2 rule 1: a segment of a
 * configuration key is lowerCamelCase or carries an underscore, so a hyphen
 * makes a dotted literal a check id and never a key (the finding CT-110-109
 * raised against the first lock ids, T034).
 */
export const SURVIVOR_CHECK_ID = "runtime.process-survivors.found" as const;

/** Where in the doctor's order it runs: after the five of the lock. */
export const SURVIVOR_CHECK_ORDER = 236 as const;

/** F122-FR-027 — the doctor reports survivors and ends nothing. */
export const SURVIVOR_CHECK_BLOCKS_A_LAUNCH = false as const;
export const SURVIVOR_CHECK_ENDS_NOTHING = true as const;

/** The keys the check reads its context out of the injected probes under. */
export const PROCS_PLACE_PROBE_KEY = "procsPlace" as const;
export const EXTRA_RUN_TOKEN_HASHES_PROBE_KEY = "runTokenHashes" as const;

/** One reading of the survivors, which is the whole of this check's evidence. */
export type SurvivorReading = {
  readonly place: ProcsPlace | null;
  readonly survivors: readonly Survivor[];
  readonly lines: readonly string[];
  /** Survivors that are live entries of class `adoptable`: adopted, not ended. */
  readonly adoptable: number;
  /** Survivors that an engine start or a `resume` would end. */
  readonly toBeEnded: number;
};

/** Read the place out of the injected probes. */
export function procsPlaceFrom(injected: Readonly<Record<string, unknown>>): ProcsPlace | null {
  const value = injected[PROCS_PLACE_PROBE_KEY] as Partial<ProcsPlace> | undefined;
  if (
    value === undefined ||
    typeof value.controlRoot !== "string" ||
    typeof value.featureSlug !== "string" ||
    typeof value.runId !== "string"
  ) {
    return null;
  }
  return Object.freeze({
    controlRoot: value.controlRoot,
    featureSlug: value.featureSlug,
    runId: value.runId,
  });
}

/** The hashes of earlier launches a caller hands in beside the records. */
export function extraHashesFrom(injected: Readonly<Record<string, unknown>>): readonly string[] {
  const value = injected[EXTRA_RUN_TOKEN_HASHES_PROBE_KEY];
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : [];
}

/** Take the one reading. */
export function readTheSurvivors(
  injected: Readonly<Record<string, unknown>>,
): Promise<SurvivorReading> {
  const place = procsPlaceFrom(injected);
  if (place === null) {
    return Promise.resolve(
      Object.freeze({
        place: null,
        survivors: Object.freeze([]),
        lines: Object.freeze([]),
        adoptable: 0,
        toBeEnded: 0,
      }),
    );
  }
  const hashes = runTokenHashesOf(place, extraHashesFrom(injected));
  const report = reportSurvivors(place, hashes);
  const adoptable = report.survivors.filter((one) => one.class === "adoptable").length;
  return Promise.resolve(
    Object.freeze({
      place,
      survivors: report.survivors,
      lines: report.lines,
      adoptable,
      toBeEnded: report.survivors.length - adoptable,
    }),
  );
}

const reading = (observed: unknown): SurvivorReading | null =>
  (observed as SurvivorReading | undefined) ?? null;

/**
 * `ok` where nothing survived; `info` where every survivor is an `adoptable`
 * job, which is the normal state of an accepted yield; `warn` where a
 * survivor would be ended by the next start — a thing the consumer should
 * know about, and never a `fail`, because the product clears it itself.
 */
export function survivorSeverity(observed: unknown): Severity {
  const r = reading(observed);
  if (r === null || r.place === null) return "warn";
  if (r.survivors.length === 0) return "ok";
  return r.toBeEnded > 0 ? "warn" : "info";
}

/** The evidence: one line per survivor, as `status` prints them. */
export function survivorEvidence(observed: unknown): string {
  const r = reading(observed);
  if (r === null || r.place === null) return "no run was given to the check";
  if (r.survivors.length === 0) return "no process of this run survives";
  return (
    `survivors=${r.survivors.length} adoptable=${r.adoptable} toBeEnded=${r.toBeEnded}: ` +
    survivorLines(r.survivors).join("; ")
  );
}

export const SURVIVOR_MESSAGE_TEMPLATE =
  `processes of this run hold its run token and outlived it; the next engine start or ` +
  `\`resume\` ends each one that is not an adoptable job (F122-FR-027)`;

export const SURVIVOR_FIX_HINT =
  `run \`resume\`: it ends every survivor that is not an adoptable job, after the identity ` +
  `check, before any pass starts`;

/** F122-FR-027 — the check itself. */
export const survivorCheck: DoctorCheck = Object.freeze({
  id: SURVIVOR_CHECK_ID,
  severityRule: survivorSeverity,
  lb: SURVIVOR_CHECK_BLOCKS_A_LAUNCH,
  order: SURVIVOR_CHECK_ORDER,
  probe: readTheSurvivors,
  messageTemplate: SURVIVOR_MESSAGE_TEMPLATE,
  fixHint: SURVIVOR_FIX_HINT,
});

/** The checks of this module, in the order they are registered. */
export const SURVIVOR_CHECKS: readonly DoctorCheck[] = Object.freeze([survivorCheck]);

/** The evidence of a check, by id. */
export const EVIDENCE_OF: Readonly<Record<string, (observed: unknown) => string>> = Object.freeze({
  [SURVIVOR_CHECK_ID]: survivorEvidence,
});

// The cap of §G.7 is checked at load, so a template that grew past 200 bytes
// fails in a test run and never in a consumer's terminal.
for (const one of SURVIVOR_CHECKS) {
  const bytes = Buffer.byteLength(one.messageTemplate, "utf8");
  if (bytes > MESSAGE_TEMPLATE_CAP_BYTES) {
    throw new Error(
      `the message template of the doctor check \`${one.id}\` is ${bytes} bytes and the cap ` +
        `of annex G §G.7 is ${MESSAGE_TEMPLATE_CAP_BYTES}`,
    );
  }
}

/** F122-FR-027 — register the check that reports survivors. */
export function registerSurvivorChecks(registry: DoctorRegistry): readonly DoctorCheck[] {
  for (const one of SURVIVOR_CHECKS) registry.register(one);
  return SURVIVOR_CHECKS;
}
