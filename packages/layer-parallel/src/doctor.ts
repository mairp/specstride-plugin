/**
 * T104 — the doctor checks of feature 142, registered through EP-14
 * (`specstride.doctor/1`, annex G §G.7, F100-FR-189; the registration call of
 * F100-FR-234 lives in `@specstride/kernel`).
 *
 * Three families, which are the three the task names:
 *
 *  1. **The plan with the option on** (F142-FR-017, PU-98). `printThePlan` is
 *     the one printer; the doctor passes the printer name `doctor` and prints
 *     nothing at all with the option off, which is F142-FR-005.
 *  2. **The resources it cannot check** (F142-FR-015, PU-37). A phase may name
 *     an exclusive resource — a port, a lab bench — whose capacity no
 *     configuration states. Such a resource is *named* and never assumed free;
 *     `doctorLinesForResourcesItCannotCheck` of `admission.ts` is the one
 *     place that wording lives.
 *  3. **The breach invariants** (F142-FR-071). The five conditions of a breach
 *     of gate integrity are checked on the event file of every run "by the
 *     doctor and in the build"; one check per condition, so that the doctor
 *     names *which* invariant broke and an id is never reused for two
 *     invariants.
 *
 * What this module may and may not do:
 *
 *  - It is in `@specstride/layer-parallel`, which `mayImport` limits to
 *    `@specstride/contracts` and `@specstride/kernel`, so it cannot call
 *    `breaches()` of `packages/core/src/parallel/breach.ts`. The engine runs
 *    that check and hands the result in as an **injected probe**, which is
 *    exactly the shape §G.7 gives a probe. The five conditions are written out
 *    here so the ids are stable; `test/doctor.test.ts` compares them with
 *    `BREACH_CONDITIONS` of the core module so the two cannot drift.
 *  - "A check reads and never writes" (§G.7, the guarantees of an
 *    implementation). Every probe here is a pure read of its injected context:
 *    no file, no process, no paid call, no secret.
 *  - A missing probe is never read as "nothing is wrong". Where the context
 *    does not carry what a check needs, the check is `warn` and says it was
 *    not run — the same rule `objectsNotSearched` of the path-leak audit
 *    follows.
 */
import {
  MESSAGE_TEMPLATE_CAP_BYTES,
  SEVERITY_WHEN_UNKNOWN,
  launchChecks,
} from "@specstride/contracts/ep/doctor";
import type {
  DoctorCheck,
  DoctorFinding,
  DoctorRunInput,
  Severity,
} from "@specstride/contracts/ep/doctor";
import type { DoctorRegistration } from "@specstride/contracts/ep/kernel-services";

import { doctorLinesForResourcesItCannotCheck } from "./admission.ts";
import type { AdmissionInputs } from "./admission.ts";
import { printThePlan } from "./plan.ts";
import type { ParallelPlan } from "./types.ts";
import { optionIsOn } from "./register.ts";
import type { UnitsConfiguration } from "./register.ts";

/* ================================================================== *
 * 1. The families and the ids.
 * ================================================================== */

/** The three families of checks this feature registers (T104). */
export const DOCTOR_CHECK_FAMILIES = Object.freeze([
  "plan",
  "resources",
  "breach-invariants",
] as const);
export type DoctorCheckFamily = (typeof DOCTOR_CHECK_FAMILIES)[number];

/** Every id of this feature is below this prefix; ids are never renamed (§G.7). */
export const DOCTOR_CHECK_ID_PREFIX = "parallel." as const;

/** The id of the check that prints the plan (F142-FR-017). */
export const PLAN_CHECK_ID = "parallel.plan" as const;

/** The id of the check that names the resources it cannot check (F142-FR-015). */
export const RESOURCES_CHECK_ID = "parallel.resources" as const;

/**
 * The five conditions of F142-FR-071, each with the id of its check and its
 * ordinal in the requirement. The wording of `condition` is the wording of
 * `BREACH_CONDITIONS` in `packages/core/src/parallel/breach.ts`; the layer may
 * not import that module, so `test/doctor.test.ts` compares the two.
 */
export const BREACH_INVARIANTS = Object.freeze([
  Object.freeze({
    ordinal: 1 as const,
    id: "parallel.breach.applied-without-audit" as const,
    condition: "a delta applied that did not pass the audits",
  }),
  Object.freeze({
    ordinal: 2 as const,
    id: "parallel.breach.workspace-differs-from-the-integrated-tree" as const,
    condition: "a workspace after the application that differs from the integrated tree",
  }),
  Object.freeze({
    ordinal: 3 as const,
    id: "parallel.breach.unaudited-path-in-the-integrated-tree" as const,
    condition: "an integrated tree that holds a path or an object of no audited delta",
  }),
  Object.freeze({
    ordinal: 4 as const,
    id: "parallel.breach.kept-while-a-worker-process-lived" as const,
    condition:
      "a kept unit of work for a merge check that ran while a process of a worker was known to live",
  }),
  Object.freeze({
    ordinal: 5 as const,
    id: "parallel.breach.withheld-field-in-a-critic-input" as const,
    condition: "an input of a critic-class call that holds a withheld field",
  }),
] as const);
export type BreachInvariant = (typeof BREACH_INVARIANTS)[number];

/** F142-FR-071 — who checks the five conditions, on the event file of every run. */
export const BREACH_INVARIANTS_CHECKED_BY = Object.freeze(["the doctor", "the build"] as const);

/**
 * No check of this feature is launch-blocking.
 *
 * `lb` is the launch subset (F100-FR-189): the checks a launch refuses on. The
 * option is off by default, a failed precondition of it is a **fallback and
 * never an error** (F142-FR-002), and the breach invariants are read off the
 * event file of a run that has already happened. None of the three families
 * can therefore refuse a launch, and a run with the option off must not be
 * touched by them at all.
 */
export const NO_CHECK_OF_THIS_FEATURE_IS_LAUNCH_BLOCKING = true as const;

/* ================================================================== *
 * 2. What the doctor injects.
 * ================================================================== */

/** One breach as the engine reports it to the doctor (F142-FR-071). */
export type ReportedBreach = {
  readonly ordinal: 1 | 2 | 3 | 4 | 5;
  readonly detail?: string;
  readonly seq?: number;
};

/**
 * The context the doctor injects for the checks of this feature. Every field
 * is optional: a doctor run of a workspace with no parallel plan, or with the
 * option off, carries none of them, and each check says so rather than
 * reporting `ok`.
 */
export type ParallelDoctorContext = {
  /** The value of `loop.parallel.units` and the ranks it was read from. */
  readonly configuration?: UnitsConfiguration;
  /** The plan at launch, or the stored plan of the run (F142-FR-017). */
  readonly plan?: ParallelPlan;
  /** What admission was given, for the resources of the phase (F142-FR-015). */
  readonly admission?: AdmissionInputs;
  /**
   * The breaches the engine found on the event file with the five checks of
   * `packages/core/src/parallel/breach.ts`. `undefined` means the event file
   * was not read; an empty list means it was read and held none.
   */
  readonly breaches?: readonly ReportedBreach[];
};

/** Read the context out of the injected record of §G.7. */
export function contextOf(injected: Readonly<Record<string, unknown>>): ParallelDoctorContext {
  const parallel = injected["parallel"];
  return (
    typeof parallel === "object" && parallel !== null ? parallel : injected
  ) as ParallelDoctorContext;
}

/* ================================================================== *
 * 3. What each probe observes.
 * ================================================================== */

/** What the probe of `parallel.plan` observes. */
export type PlanObservation = {
  readonly optionOn: boolean;
  /** The lines `printThePlan` gave; empty with the option off (F142-FR-005). */
  readonly lines: readonly string[];
  /** `false` where the option is on and no plan was injected. */
  readonly planPresent: boolean;
};

/** What the probe of `parallel.resources` observes. */
export type ResourcesObservation = {
  readonly optionOn: boolean;
  /** One line per resource whose capacity no configuration states. */
  readonly lines: readonly string[];
  /** `false` where no admission input was injected at all. */
  readonly admissionPresent: boolean;
};

/** What the probe of one breach invariant observes. */
export type BreachObservation = {
  readonly ordinal: 1 | 2 | 3 | 4 | 5;
  /** `false` where the event file was not read: "no hit" is not "checked". */
  readonly eventFileRead: boolean;
  readonly breaches: readonly ReportedBreach[];
};

/* ================================================================== *
 * 4. The checks.
 * ================================================================== */

/**
 * The plan the doctor prints, with the option on and never with it off.
 *
 * The option is not tested here a second time: `printThePlan` is the one gate
 * of F142-FR-005 and PU-98 and returns nothing at all with the option off, so
 * a second guard here would be a condition no test could ever reach — and an
 * unreachable guard is worse than none, because it reads as the rule while the
 * rule lives elsewhere.
 */
export function planObservation(context: ParallelDoctorContext): PlanObservation {
  const configuration = context.configuration ?? {};
  const on = optionIsOn(configuration);
  const lines =
    context.plan !== undefined ? printThePlan(context.plan, configuration, "doctor") : [];
  return Object.freeze({
    optionOn: on,
    lines: Object.freeze([...lines]),
    planPresent: context.plan !== undefined,
  });
}

/** F142-FR-017 — the plan, printed by the doctor with the option on. */
export const PLAN_CHECK: DoctorCheck = Object.freeze({
  id: PLAN_CHECK_ID,
  lb: false,
  order: 10,
  severityRule(observed: unknown): Severity {
    const o = observed as PlanObservation | undefined;
    if (o === undefined || typeof o !== "object") return SEVERITY_WHEN_UNKNOWN;
    // With the option off there is nothing to print and nothing is wrong.
    if (!o.optionOn) return "ok";
    // With the option on and no plan the doctor cannot print one: say so.
    return o.planPresent ? "info" : "warn";
  },
  probe(injected: Readonly<Record<string, unknown>>): Promise<unknown> {
    return Promise.resolve(planObservation(contextOf(injected)));
  },
  messageTemplate: "the parallel plan: {state}",
  fixHint:
    "set `loop.parallel.units` to `on` in user configuration to plan groups; the plan is printed only with the option on (F142-FR-017)",
});

/** The resources whose capacity no configuration states (F142-FR-015). */
export function resourcesObservation(context: ParallelDoctorContext): ResourcesObservation {
  const configuration = context.configuration ?? {};
  const on = optionIsOn(configuration);
  const lines =
    on && context.admission !== undefined
      ? doctorLinesForResourcesItCannotCheck(context.admission)
      : [];
  return Object.freeze({
    optionOn: on,
    lines: Object.freeze([...lines]),
    admissionPresent: context.admission !== undefined,
  });
}

/** F142-FR-015 — an exclusive resource without capacity is named, never assumed free. */
export const RESOURCES_CHECK: DoctorCheck = Object.freeze({
  id: RESOURCES_CHECK_ID,
  lb: false,
  order: 20,
  severityRule(observed: unknown): Severity {
    const o = observed as ResourcesObservation | undefined;
    if (o === undefined || typeof o !== "object") return SEVERITY_WHEN_UNKNOWN;
    if (!o.optionOn) return "ok";
    if (!o.admissionPresent) return "warn";
    return o.lines.length > 0 ? "warn" : "ok";
  },
  probe(injected: Readonly<Record<string, unknown>>): Promise<unknown> {
    return Promise.resolve(resourcesObservation(contextOf(injected)));
  },
  messageTemplate: "exclusive resources this run cannot check: {state}",
  fixHint:
    "state the capacity of the resource with `loop.parallel.resources.<name>.capacity` in user configuration, or let the phase run serially (F142-FR-015)",
});

/** The breaches of one condition the engine found on the event file. */
export function breachObservation(
  context: ParallelDoctorContext,
  ordinal: 1 | 2 | 3 | 4 | 5,
): BreachObservation {
  const read = context.breaches !== undefined;
  return Object.freeze({
    ordinal,
    eventFileRead: read,
    breaches: Object.freeze((context.breaches ?? []).filter((b) => b.ordinal === ordinal)),
  });
}

/**
 * One check per invariant of F142-FR-071. A breach is `fail`; an event file
 * that was not read is `warn` and never `ok`; a read file with no breach of
 * this condition is `ok`.
 */
export function breachCheckOf(invariant: BreachInvariant): DoctorCheck {
  return Object.freeze({
    id: invariant.id,
    lb: false,
    order: 30 + invariant.ordinal,
    severityRule(observed: unknown): Severity {
      const o = observed as BreachObservation | undefined;
      if (o === undefined || typeof o !== "object") return SEVERITY_WHEN_UNKNOWN;
      if (!o.eventFileRead) return "warn";
      return o.breaches.length > 0 ? "fail" : "ok";
    },
    probe(injected: Readonly<Record<string, unknown>>): Promise<unknown> {
      return Promise.resolve(breachObservation(contextOf(injected), invariant.ordinal));
    },
    messageTemplate: `breach invariant ${invariant.ordinal} of 5: {state}`,
    fixHint: `a breach of gate integrity: ${invariant.condition}. Switch \`loop.parallel.units\` off and report the run; a detected and refused act is an event and no breach (F142-FR-071)`,
  });
}

/** The five checks of the breach invariants, in the order of the requirement. */
export const BREACH_CHECKS: readonly DoctorCheck[] = Object.freeze(
  BREACH_INVARIANTS.map((invariant) => breachCheckOf(invariant)),
);

/* ================================================================== *
 * 5. Registration.
 * ================================================================== */

/** Every check this feature registers, in the order the doctor runs them. */
export const PARALLEL_DOCTOR_CHECKS: readonly DoctorCheck[] = Object.freeze([
  PLAN_CHECK,
  RESOURCES_CHECK,
  ...BREACH_CHECKS,
]);

/** The ids of those checks, which are never renamed (§G.7). */
export const PARALLEL_DOCTOR_CHECK_IDS: readonly string[] = Object.freeze(
  PARALLEL_DOCTOR_CHECKS.map((check) => check.id),
);

/**
 * T104 — register the checks of this feature with the registration call of the
 * kernel (F100-FR-234). A package registers its checks at load; the doctor
 * reads the registry. The call is idempotent: a check already registered under
 * its id is not registered twice, so a second composition root in one process
 * cannot double the findings.
 */
export function registerParallelDoctorChecks(
  registration: DoctorRegistration,
): readonly DoctorCheck[] {
  const already = new Set(registration.registered().map((check) => check.id));
  const added: DoctorCheck[] = [];
  for (const check of PARALLEL_DOCTOR_CHECKS) {
    if (already.has(check.id)) continue;
    registration.register(check);
    added.push(check);
  }
  return Object.freeze(added);
}

/** The launch subset of this feature's checks, which is empty (F100-FR-189). */
export function parallelLaunchChecks(): readonly DoctorCheck[] {
  return launchChecks(PARALLEL_DOCTOR_CHECKS);
}

/* ================================================================== *
 * 6. Running them, and the guards that keep the registration honest.
 * ================================================================== */

/** How an observation is written into the message of a finding. */
export function stateOf(observed: unknown): string {
  const o = observed as Partial<PlanObservation & ResourcesObservation & BreachObservation>;
  if (o !== null && typeof o === "object" && Array.isArray(o.lines)) {
    if (o.optionOn === false) return "the option is off: nothing to report";
    if (o.lines.length === 0) return "none";
    return `${o.lines.length} line(s)`;
  }
  if (o !== null && typeof o === "object" && Array.isArray(o.breaches)) {
    if (o.eventFileRead === false) return "the event file was not read: not checked";
    return o.breaches.length === 0 ? "no breach" : `${o.breaches.length} breach(es)`;
  }
  return String(observed);
}

/**
 * Run this feature's checks over an injected context and give the findings.
 * The doctor's own registry does the same for every registered check; this is
 * the same walk, so that the checks can be observed without an engine.
 */
export async function parallelDoctorFindings(
  input: DoctorRunInput,
): Promise<readonly DoctorFinding[]> {
  const out: DoctorFinding[] = [];
  for (const check of [...PARALLEL_DOCTOR_CHECKS].sort((a, b) => a.order - b.order)) {
    const observed = await check.probe(input.context);
    out.push(
      Object.freeze({
        id: check.id,
        severity: check.severityRule(observed),
        lb: check.lb,
        message: check.messageTemplate.replace("{state}", stateOf(observed)).slice(0, 200),
        fix: check.fixHint,
        evidence: "(redacted)",
      }),
    );
  }
  return Object.freeze(out);
}

/** Any id registered twice, or outside the prefix of this feature (§G.7). */
export function idsThatBreakTheRules(): readonly string[] {
  const seen = new Set<string>();
  const bad: string[] = [];
  for (const check of PARALLEL_DOCTOR_CHECKS) {
    if (seen.has(check.id)) bad.push(`${check.id}: registered twice`);
    seen.add(check.id);
    if (!check.id.startsWith(DOCTOR_CHECK_ID_PREFIX)) {
      bad.push(`${check.id}: outside the prefix \`${DOCTOR_CHECK_ID_PREFIX}\``);
    }
  }
  return Object.freeze(bad);
}

/** Any message template over the cap of 200 bytes (§G.7, Inputs). */
export function messageTemplatesOverTheCap(): readonly string[] {
  return Object.freeze(
    PARALLEL_DOCTOR_CHECKS.filter(
      (check) =>
        new TextEncoder().encode(check.messageTemplate).length > MESSAGE_TEMPLATE_CAP_BYTES,
    ).map((check) => check.id),
  );
}

/** The family a check belongs to, for the three the task names. */
export function familyOf(id: string): DoctorCheckFamily | null {
  if (id === PLAN_CHECK_ID) return "plan";
  if (id === RESOURCES_CHECK_ID) return "resources";
  if (BREACH_INVARIANTS.some((invariant) => invariant.id === id)) return "breach-invariants";
  return null;
}

/** A family the registration does not cover; empty where all three are covered. */
export function familiesNotRegistered(): readonly DoctorCheckFamily[] {
  const covered = new Set(PARALLEL_DOCTOR_CHECK_IDS.map((id) => familyOf(id)));
  return Object.freeze(DOCTOR_CHECK_FAMILIES.filter((family) => !covered.has(family)));
}
