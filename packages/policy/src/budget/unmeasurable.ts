/**
 * T070 — UNMEASURABLE SPEND (F127-FR-035).
 *
 * "Where a harness reports no cost, its spend cannot be measured." The
 * requirement then asks for four things, and each is an export here:
 *
 *  1. **the announcement says so for that role at launch** —
 *     `markUnmeasurable` sets the flag `spendUnmeasurable` of
 *     `./announce.ts`, so the line of the announcement is the one that module
 *     already owns (`SPEND_CANNOT_BE_MEASURED`), printed for that role alone;
 *  2. **the doctor says so** — `doctorFinding` gives the finding of §G.7, at
 *     the severity `warn` and not launch-blocking: a run on a harness with no
 *     cost report is allowed, it is only unmeasured;
 *  3. **an alert of kind `spend-unmeasurable` and level `warn`, written ONCE**
 *     — `raiseUnmeasurableAlert`, through the deduplication of `./alerts.ts`;
 *  4. **the ceilings `wallClock`, `phaseAttempts` and `calls` still apply, and
 *     a cost or token ceiling set on such a role is NOT reported as enforced**
 *     — `CEILINGS_THAT_STILL_APPLY`, `CEILINGS_NOT_ENFORCED` and
 *     `ceilingReport`.
 *
 * Why the last one matters: a consumer who sets `budget.role.proposer.costUsd`
 * on a harness that reports no cost would otherwise believe a cap is holding
 * when nothing can count against it. The report says the ceiling is SET and
 * NOT ENFORCED, which is the honest answer (R11 T-18).
 */
import { type DoctorFinding, type Severity } from "@specstride/contracts/ep/doctor";
import { type EmitOptions } from "../quota/events.ts";
import type { EventWriter, PolicyEvent } from "../quota/ports.ts";
import {
  type AlertKind,
  type AlertLevel,
  type AlertState,
  dedupeKeyOf,
  raiseFixedAlert,
} from "./alerts.ts";
import {
  SPEND_CANNOT_BE_MEASURED,
  announce,
  type AnnounceInput,
  type Announcement,
  type RoleAnnouncement,
} from "./announce.ts";
import { SOFT_DIMENSION, keyOf, type BudgetDimension, type Ceiling } from "./ceilings.ts";

/* ------------------------------------------------------------------ *
 * 1. When spend cannot be measured.
 * ------------------------------------------------------------------ */

/** The alert of F127-FR-035; row 205 of annex X §X.6. */
export const ALERT_KIND_SPEND_UNMEASURABLE: AlertKind = "spend-unmeasurable";

/** Its level, fixed by §Q.4: `warn` (F127-FR-035). */
export const SPEND_UNMEASURABLE_LEVEL: AlertLevel = "warn";

/** F127-FR-035 — the alert is written ONCE per role. */
export const WRITTEN_ONCE = true as const;

/** The deduplication key of the alert for a role (§Q.4, F127-FR-037). */
export function unmeasurableDedupeKey(role: string | null): string {
  return dedupeKeyOf({ kind: ALERT_KIND_SPEND_UNMEASURABLE, role, threshold: null });
}

/**
 * What a harness descriptor says about its usage source. A harness that
 * reports no cost is the case of F127-FR-035; one whose report carries token
 * counts but no money is still unmeasurable in `costUsd` terms.
 */
export type HarnessCostReport = {
  readonly harness: string;
  /** True where the harness reports a cost figure at all. */
  readonly reportsCost: boolean;
  /** True where it reports token counts. */
  readonly reportsTokens?: boolean | undefined;
  /** The value of the capability `usageSource` of EP-02, where it is known. */
  readonly usageSource?: string | null | undefined;
};

/** True where the harness reports no cost, so its spend cannot be measured. */
export function reportsNoCost(report: HarnessCostReport): boolean {
  return report.reportsCost !== true;
}

/* ------------------------------------------------------------------ *
 * 2. Which ceilings still apply.
 * ------------------------------------------------------------------ */

/**
 * F127-FR-035 — the three ceilings that STILL APPLY where spend cannot be
 * measured: they count time and events, which the engine observes itself and
 * never takes from the harness's cost report.
 */
export const CEILINGS_THAT_STILL_APPLY: readonly BudgetDimension[] = Object.freeze([
  "wallClock",
  "phaseAttempts",
  "calls",
]);

/**
 * F127-FR-035 — the two that are NOT reported as enforced: nothing can count
 * against them, so saying they are enforced would be untrue.
 */
export const CEILINGS_NOT_ENFORCED: readonly BudgetDimension[] = Object.freeze([
  "tokens",
  "costUsd",
]);

/** True where the ceiling still applies on an unmeasurable role. */
export function stillApplies(dimension: BudgetDimension | typeof SOFT_DIMENSION): boolean {
  return (CEILINGS_THAT_STILL_APPLY as readonly string[]).includes(dimension);
}

/** One line of the report of a ceiling on an unmeasurable role. */
export type CeilingReportLine = {
  readonly key: string;
  readonly dimension: BudgetDimension | typeof SOFT_DIMENSION;
  readonly role: string | null;
  /** True where the consumer set the ceiling at all. */
  readonly set: boolean;
  /** True where it is reported as enforced (F127-FR-035). */
  readonly reportedAsEnforced: boolean;
  readonly note: string | null;
};

/**
 * The report of the ceilings of a role whose spend cannot be measured
 * (F127-FR-035). `wallClock`, `phaseAttempts` and `calls` are enforced; a
 * `tokens`, `costUsd` or `softTokens` ceiling is SET and NOT reported as
 * enforced, with the reason in its note.
 */
export function ceilingReport(
  ceilings: readonly Ceiling[],
  options: { readonly harness?: string | undefined } = {},
): readonly CeilingReportLine[] {
  const of = options.harness === undefined ? "the harness" : `the harness ${options.harness}`;
  return Object.freeze(
    ceilings.map((ceiling) => {
      const applies = ceiling.dimension !== SOFT_DIMENSION && stillApplies(ceiling.dimension);
      return Object.freeze({
        key: keyOf(ceiling),
        dimension: ceiling.dimension,
        role: ceiling.scope === "role" ? (ceiling.role ?? null) : null,
        set: ceiling.limit !== undefined && ceiling.limit !== null,
        reportedAsEnforced: applies,
        note: applies
          ? null
          : `${of} reports no cost, so nothing counts against ${keyOf(ceiling)}; the ceiling ` +
            `is not reported as enforced (F127-FR-035)`,
      });
    }),
  );
}

/** The dimensions of a report that are enforced, and those that are not. */
export function enforcedAndNot(
  ceilings: readonly Ceiling[],
): Readonly<{ readonly enforced: readonly string[]; readonly notEnforced: readonly string[] }> {
  const lines = ceilingReport(ceilings);
  return Object.freeze({
    enforced: Object.freeze(lines.filter((line) => line.reportedAsEnforced).map((l) => l.key)),
    notEnforced: Object.freeze(
      lines.filter((line) => !line.reportedAsEnforced).map((line) => line.key),
    ),
  });
}

/* ------------------------------------------------------------------ *
 * 3. The announcement (F127-FR-035, F127-FR-041).
 * ------------------------------------------------------------------ */

/** The line the announcement prints for the role (F127-FR-035). */
export const ANNOUNCEMENT_LINE = SPEND_CANNOT_BE_MEASURED;

/** The line, as it reaches the consumer for one role. */
export function announcementLine(role: string): string {
  return `${role}: ${SPEND_CANNOT_BE_MEASURED}`;
}

/**
 * Mark the roles whose harness reports no cost, so the announcement of
 * `./announce.ts` says so for THAT ROLE at launch (F127-FR-035). A role whose
 * harness does report a cost is handed back unchanged.
 */
export function markUnmeasurable(
  roles: readonly RoleAnnouncement[],
  unmeasurableRoles: readonly string[],
): readonly RoleAnnouncement[] {
  const set = new Set(unmeasurableRoles);
  return Object.freeze(
    roles.map((role) =>
      set.has(role.role) ? Object.freeze({ ...role, spendUnmeasurable: true }) : role,
    ),
  );
}

/** The announcement with the unmeasurable roles marked (F127-FR-035). */
export function announceUnmeasurable(
  input: AnnounceInput,
  unmeasurableRoles: readonly string[],
): Announcement {
  return announce({ ...input, roles: markUnmeasurable(input.roles, unmeasurableRoles) });
}

/* ------------------------------------------------------------------ *
 * 4. The doctor (F127-FR-035, R11 T-18).
 * ------------------------------------------------------------------ */

/** The id of the doctor finding; ids are never renamed (§G.7). */
export const DOCTOR_CHECK_ID = "budget.spend-unmeasurable" as const;

/** Its severity: `warn`. A run with unmeasured spend is allowed (§G.7). */
export const DOCTOR_SEVERITY: Severity = "warn";

/** It is NOT launch-blocking: the run may go on unmeasured (§G.7). */
export const DOCTOR_IS_LAUNCH_BLOCKING = false as const;

/**
 * The doctor finding of F127-FR-035 — "the doctor MUST say so". The evidence
 * carries the harness and the role only, both of which are names of the
 * consumer's own configuration and no secret.
 */
export function doctorFinding(input: {
  readonly role: string;
  readonly harness: string;
  readonly ceilings?: readonly Ceiling[] | undefined;
}): DoctorFinding {
  const report = enforcedAndNot(input.ceilings ?? []);
  return Object.freeze({
    id: DOCTOR_CHECK_ID,
    severity: DOCTOR_SEVERITY,
    lb: DOCTOR_IS_LAUNCH_BLOCKING,
    message:
      `the harness ${input.harness} of the role ${input.role} reports no cost, so its spend ` +
      `cannot be measured; the wallClock, phaseAttempts and calls ceilings still apply`,
    fix:
      `set the ceilings loop.maxWallMin, budget.run.phaseAttempts or ` +
      `budget.role.${input.role}.calls, or pick a harness that reports its usage`,
    evidence:
      report.notEnforced.length === 0
        ? `role=${input.role} harness=${input.harness}`
        : `role=${input.role} harness=${input.harness} not-enforced=${report.notEnforced.join(",")}`,
  });
}

/* ------------------------------------------------------------------ *
 * 5. The whole handling.
 * ------------------------------------------------------------------ */

/** What `handleUnmeasurableSpend` is handed. */
export type UnmeasurableInput = {
  readonly role: string;
  readonly report: HarnessCostReport;
  readonly state: AlertState;
  readonly ceilings?: readonly Ceiling[] | undefined;
};

/** What `handleUnmeasurableSpend` answers. */
export type UnmeasurableOutcome = {
  /** True where the harness reports no cost (F127-FR-035). */
  readonly unmeasurable: boolean;
  /** The alert state after the raise; the key is marked fired. */
  readonly state: AlertState;
  /** The `alert` event, or null where it had already fired (written ONCE). */
  readonly alert: PolicyEvent | null;
  readonly level: AlertLevel | null;
  /** The line the announcement prints for the role. */
  readonly announcementLine: string | null;
  /** The doctor finding, or null where spend can be measured. */
  readonly finding: DoctorFinding | null;
  /** The report of the ceilings: which are enforced and which are not. */
  readonly ceilings: readonly CeilingReportLine[];
  readonly stillApply: readonly BudgetDimension[];
};

/**
 * The whole of F127-FR-035 for one role: the alert once, the announcement
 * line, the doctor finding, and the report of which ceilings still apply.
 *
 * A harness that DOES report a cost takes none of it: the outcome says
 * `unmeasurable: false` and nothing is written.
 */
export function handleUnmeasurableSpend(
  writer: EventWriter,
  input: UnmeasurableInput,
  options: EmitOptions = {},
): UnmeasurableOutcome {
  if (!reportsNoCost(input.report)) {
    return Object.freeze({
      unmeasurable: false,
      state: input.state,
      alert: null,
      level: null,
      announcementLine: null,
      finding: null,
      ceilings: Object.freeze([]),
      stillApply: CEILINGS_THAT_STILL_APPLY,
    });
  }
  const raised = raiseFixedAlert(
    writer,
    {
      kind: ALERT_KIND_SPEND_UNMEASURABLE,
      role: input.role,
      state: input.state,
      message:
        `the harness ${input.report.harness} of the role ${input.role} reports no cost; spend ` +
        `cannot be measured and the wallClock, phaseAttempts and calls ceilings still apply`,
    },
    options,
  );
  return Object.freeze({
    unmeasurable: true,
    state: raised.state,
    alert: raised.event,
    level: raised.level,
    announcementLine: announcementLine(input.role),
    finding: doctorFinding({
      role: input.role,
      harness: input.report.harness,
      ceilings: input.ceilings,
    }),
    ceilings: ceilingReport(input.ceilings ?? [], { harness: input.report.harness }),
    stillApply: CEILINGS_THAT_STILL_APPLY,
  });
}
