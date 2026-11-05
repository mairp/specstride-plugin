/**
 * T104 — the doctor checks of feature 142 are registered: the plan with the
 * option on, the resources it cannot check, the breach invariants
 * (`packages/layer-parallel/src/doctor.ts`).
 *
 * The three families are judged through an independent read path wherever one
 * exists:
 *
 *  - the wording of the five breach invariants is compared with
 *    `BREACH_CONDITIONS` of `packages/core/src/parallel/breach.ts`, which the
 *    layer may not import, so the two cannot drift;
 *  - the shape of a check and of a finding is compared with EP-14
 *    (`@specstride/contracts/ep/doctor`) and with the record of §G.7
 *    (`@specstride/contracts/records/doctor-findings`), not with this module's
 *    own idea of them;
 *  - the registration is observed on a `DoctorRegistration` double of the kind
 *    the kernel offers, by reading `registered()` back.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  MESSAGE_TEMPLATE_CAP_BYTES,
  SEVERITIES,
  launchChecks,
} from "@specstride/contracts/ep/doctor";
import type { DoctorCheck } from "@specstride/contracts/ep/doctor";
import { summaryOf } from "@specstride/contracts/records/doctor-findings";

import {
  BREACH_CHECKS,
  BREACH_INVARIANTS,
  BREACH_INVARIANTS_CHECKED_BY,
  DOCTOR_CHECK_FAMILIES,
  DOCTOR_CHECK_ID_PREFIX,
  NO_CHECK_OF_THIS_FEATURE_IS_LAUNCH_BLOCKING,
  PARALLEL_DOCTOR_CHECKS,
  PARALLEL_DOCTOR_CHECK_IDS,
  PLAN_CHECK,
  PLAN_CHECK_ID,
  RESOURCES_CHECK,
  RESOURCES_CHECK_ID,
  breachObservation,
  familiesNotRegistered,
  familyOf,
  idsThatBreakTheRules,
  messageTemplatesOverTheCap,
  parallelDoctorFindings,
  parallelLaunchChecks,
  planObservation,
  registerParallelDoctorChecks,
  resourcesObservation,
} from "../src/doctor.ts";
import { capacityKeyOf, planAtLaunch, scopesOf } from "../src/index.ts";
import type { AdmissionInputs, TaskAsReadAtLaunch } from "../src/index.ts";
import { BREACH_CONDITIONS, CHECKED_BY, CONDITIONS_ADDED } from "../../core/src/parallel/breach.ts";

/* ------------------------------------------------------------------ *
 * A plan to print, and a hasher of the test's own.
 * ------------------------------------------------------------------ */

const TASKS: readonly TaskAsReadAtLaunch[] = Object.freeze([
  Object.freeze({ id: "T1", phase: 8, marked: true, text: "the reader in src/reader/" }),
  Object.freeze({ id: "T2", phase: 8, marked: true, text: "the writer in src/writer/" }),
]);

const ADMISSION: AdmissionInputs = Object.freeze({
  workers: 2,
  scopes: scopesOf(TASKS.map((task) => ({ id: task.id, text: task.text }))),
  innerCheckSet: Object.freeze(["typecheck", "test"]),
  adoptableJobsAlive: 0,
  containment: "C2" as const,
});

const hasher = Object.freeze({
  canonicalRecordText: (record: unknown) => JSON.stringify(record),
  canonicalRecordHash: (record: unknown) => `h-${JSON.stringify(record).length}`,
});

const PLAN = planAtLaunch({ runId: "run-142-104", tasks: TASKS, admission: ADMISSION }, hasher);

const ON = Object.freeze({ userConfiguration: "on" });
const OFF = Object.freeze({});

/** An admission whose exclusive resource has less capacity than the group needs. */
const ADMISSION_WITH_A_RESOURCE: AdmissionInputs = Object.freeze({
  ...ADMISSION,
  exclusiveResources: Object.freeze([Object.freeze({ name: "port-5432", capacity: 1 })]),
});

/** A `DoctorRegistration` of the shape the kernel offers (F100-FR-234). */
function registrationDouble(): {
  register(check: DoctorCheck): void;
  registered(): readonly DoctorCheck[];
} {
  const held: DoctorCheck[] = [];
  return {
    register(check: DoctorCheck): void {
      held.push(check);
    },
    registered(): readonly DoctorCheck[] {
      return Object.freeze([...held]);
    },
  };
}

/* ------------------------------------------------------------------ *
 * The registration itself
 * ------------------------------------------------------------------ */

test("T104: the three families the task names are all registered", () => {
  assert.deepEqual([...DOCTOR_CHECK_FAMILIES], ["plan", "resources", "breach-invariants"]);
  assert.deepEqual([...familiesNotRegistered()], [], "every family has at least one check");
  assert.equal(familyOf(PLAN_CHECK_ID), "plan");
  assert.equal(familyOf(RESOURCES_CHECK_ID), "resources");
  for (const invariant of BREACH_INVARIANTS) {
    assert.equal(familyOf(invariant.id), "breach-invariants");
  }
  assert.equal(familyOf("parallel.not-a-check"), null);
  // Two plus five: the plan, the resources, and one check per invariant.
  assert.equal(PARALLEL_DOCTOR_CHECKS.length, 7);
});

test("T104: registering puts every check in the registry, once", () => {
  const registry = registrationDouble();
  assert.deepEqual([...registry.registered()], []);

  const added = registerParallelDoctorChecks(registry);
  assert.equal(added.length, 7);
  assert.deepEqual(
    registry.registered().map((c) => c.id),
    [...PARALLEL_DOCTOR_CHECK_IDS],
    "the registry holds exactly the ids of this feature, in order",
  );

  // Idempotent: a second composition root in one process doubles nothing.
  const again = registerParallelDoctorChecks(registry);
  assert.deepEqual([...again], [], "a check already registered is not registered twice");
  assert.equal(registry.registered().length, 7);
});

test("T104: every check keeps the rules of §G.7 for an id, a template and `lb`", () => {
  assert.deepEqual([...idsThatBreakTheRules()], [], "ids are unique and under the prefix");
  assert.deepEqual([...messageTemplatesOverTheCap()], [], "no template is over the cap");
  assert.equal(MESSAGE_TEMPLATE_CAP_BYTES, 200);
  for (const check of PARALLEL_DOCTOR_CHECKS) {
    assert.ok(check.id.startsWith(DOCTOR_CHECK_ID_PREFIX), `${check.id} is under the prefix`);
    assert.equal(typeof check.order, "number");
    assert.ok(check.fixHint.length > 0, `${check.id} has a fix hint`);
    assert.equal(check.lb, false, `${check.id} is not launch-blocking`);
  }
  // The orders are distinct, so the walk of the doctor is deterministic.
  const orders = PARALLEL_DOCTOR_CHECKS.map((c) => c.order);
  assert.equal(new Set(orders).size, orders.length);
  // The launch subset is empty, and that is the statement of the module.
  assert.equal(NO_CHECK_OF_THIS_FEATURE_IS_LAUNCH_BLOCKING, true);
  assert.deepEqual([...parallelLaunchChecks()], []);
  assert.deepEqual([...launchChecks(PARALLEL_DOCTOR_CHECKS)], []);
});

/* ------------------------------------------------------------------ *
 * Family 1 — the plan with the option on
 * ------------------------------------------------------------------ */

test("T104: the plan check prints the plan with the option on", async () => {
  const observed = (await PLAN_CHECK.probe({
    parallel: { configuration: ON, plan: PLAN },
  })) as { optionOn: boolean; lines: readonly string[]; planPresent: boolean };
  assert.equal(observed.optionOn, true);
  assert.equal(observed.planPresent, true);
  assert.ok(observed.lines.length > 0, "the doctor prints the plan");
  assert.ok(
    observed.lines[0]?.includes("parallel plan (doctor)"),
    "the printer names itself as the doctor",
  );
  assert.ok(
    observed.lines.some((l) => l.includes("group 1: T1, T2")),
    "the group of the plan is printed",
  );
  assert.ok(
    observed.lines.some((l) => l.includes("expected saving")),
    "the statement of the expected saving closes the print (F142-FR-073)",
  );
  assert.equal(PLAN_CHECK.severityRule(observed), "info");
});

test("T104: with the option off the doctor prints no plan at all (F142-FR-005)", async () => {
  const observed = (await PLAN_CHECK.probe({
    parallel: { configuration: OFF, plan: PLAN },
  })) as { optionOn: boolean; lines: readonly string[] };
  assert.equal(observed.optionOn, false);
  assert.deepEqual([...observed.lines], [], "nothing is printed with the option off");
  assert.equal(PLAN_CHECK.severityRule(observed), "ok");
  // The `parity` profile is the same state, whatever a rank said.
  const underParity = planObservation({
    configuration: { profile: "parity", flag: "on" },
    plan: PLAN,
  });
  assert.equal(underParity.optionOn, false);
  assert.deepEqual([...underParity.lines], []);
});

test("T104: the option on with no plan injected is a warning, never `ok`", () => {
  const observed = planObservation({ configuration: ON });
  assert.equal(observed.planPresent, false);
  assert.deepEqual([...observed.lines], []);
  assert.equal(PLAN_CHECK.severityRule(observed), "warn");
  assert.equal(PLAN_CHECK.severityRule(undefined), "warn", "an unknown observation is `warn`");
});

/* ------------------------------------------------------------------ *
 * Family 2 — the resources it cannot check
 * ------------------------------------------------------------------ */

test("T104: the resources check names a resource whose capacity is unstated", async () => {
  const observed = (await RESOURCES_CHECK.probe({
    parallel: {
      configuration: ON,
      admission: { ...ADMISSION, exclusiveResources: [{ name: "port-5432", capacity: 1 }] },
    },
  })) as { lines: readonly string[] };
  assert.equal(observed.lines.length, 1);
  assert.ok(observed.lines[0]?.includes("port-5432"), "the resource is named");
  assert.ok(
    observed.lines[0]?.includes(capacityKeyOf("port-5432")),
    "the line names the key that would give it a capacity",
  );
  assert.equal(RESOURCES_CHECK.severityRule(observed), "warn");
});

test("T104: a resource with capacity for the group is `ok`, and no admission is `warn`", () => {
  const enough = resourcesObservation({
    configuration: ON,
    admission: { ...ADMISSION, exclusiveResources: [{ name: "port-5432", capacity: 2 }] },
  });
  assert.deepEqual([...enough.lines], []);
  assert.equal(RESOURCES_CHECK.severityRule(enough), "ok");

  const none = resourcesObservation({ configuration: ON });
  assert.equal(none.admissionPresent, false);
  assert.equal(RESOURCES_CHECK.severityRule(none), "warn", "nothing read is not nothing wrong");

  // The off case uses an admission that *would* produce a line, so that the
  // silence is the option's doing and not an empty input's.
  const on = resourcesObservation({ configuration: ON, admission: ADMISSION_WITH_A_RESOURCE });
  assert.equal(on.lines.length, 1, "the same input does produce a line with the option on");
  const off = resourcesObservation({ configuration: OFF, admission: ADMISSION_WITH_A_RESOURCE });
  assert.equal(off.optionOn, false);
  assert.deepEqual([...off.lines], [], "with the option off the check says nothing");
  assert.equal(RESOURCES_CHECK.severityRule(off), "ok");
});

/* ------------------------------------------------------------------ *
 * Family 3 — the breach invariants
 * ------------------------------------------------------------------ */

test("T104: the five invariants are the five conditions of the core module, in order", () => {
  assert.equal(BREACH_INVARIANTS.length, CONDITIONS_ADDED);
  assert.equal(BREACH_INVARIANTS.length, 5);
  assert.deepEqual(
    BREACH_INVARIANTS.map((i) => i.condition),
    [...BREACH_CONDITIONS],
    "the wording of the layer and of packages/core/src/parallel/breach.ts is the same",
  );
  assert.deepEqual(
    BREACH_INVARIANTS.map((i) => i.ordinal),
    [1, 2, 3, 4, 5],
  );
  // F142-FR-071 names the two readers of the conditions; both modules say so.
  assert.deepEqual([...BREACH_INVARIANTS_CHECKED_BY], [...CHECKED_BY]);
  assert.deepEqual([...BREACH_INVARIANTS_CHECKED_BY], ["the doctor", "the build"]);
  assert.equal(BREACH_CHECKS.length, 5);
  assert.equal(new Set(BREACH_CHECKS.map((c) => c.id)).size, 5, "one id per invariant");
});

test("T104: a breach is `fail`, a read file with none is `ok`, an unread file is `warn`", async () => {
  for (const invariant of BREACH_INVARIANTS) {
    const check = BREACH_CHECKS.find((c) => c.id === invariant.id);
    assert.ok(check !== undefined);

    const found = (await check.probe({
      parallel: { breaches: [{ ordinal: invariant.ordinal, detail: "seeded" }] },
    })) as { breaches: readonly unknown[] };
    assert.equal(found.breaches.length, 1);
    assert.equal(check.severityRule(found), "fail", `${invariant.id} fails on its own breach`);

    const clean = (await check.probe({ parallel: { breaches: [] } })) as unknown;
    assert.equal(check.severityRule(clean), "ok");

    const notRead = (await check.probe({ parallel: {} })) as { eventFileRead: boolean };
    assert.equal(notRead.eventFileRead, false);
    assert.equal(check.severityRule(notRead), "warn", "an unread event file is never `ok`");

    assert.ok(
      check.fixHint.includes(invariant.condition),
      "the fix hint states which invariant broke",
    );
  }
});

test("T104: a breach of one condition does not make another condition fail", () => {
  const context = { breaches: [{ ordinal: 3 as const, detail: "an unaudited path" }] };
  for (const invariant of BREACH_INVARIANTS) {
    const observed = breachObservation(context, invariant.ordinal);
    const check = BREACH_CHECKS.find((c) => c.id === invariant.id);
    assert.ok(check !== undefined);
    assert.equal(
      check.severityRule(observed),
      invariant.ordinal === 3 ? "fail" : "ok",
      `${invariant.id} reads only its own condition`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * The findings the doctor reports
 * ------------------------------------------------------------------ */

test("T104: the findings are findings of §G.7, with a severity of the closed set", async () => {
  const findings = await parallelDoctorFindings({
    context: {
      parallel: {
        configuration: ON,
        plan: PLAN,
        admission: { ...ADMISSION, exclusiveResources: [{ name: "bench", capacity: 1 }] },
        breaches: [{ ordinal: 5, detail: "a withheld field reached a critic" }],
      },
    },
    flags: {},
  });
  assert.equal(findings.length, 7);
  for (const finding of findings) {
    assert.ok((SEVERITIES as readonly string[]).includes(finding.severity));
    assert.ok(finding.message.length > 0 && finding.message.length <= 200);
    assert.equal(finding.lb, false);
    assert.equal(finding.evidence, "(redacted)", "the evidence of a finding is redacted");
  }
  const by = new Map(findings.map((f) => [f.id, f]));
  assert.equal(by.get(PLAN_CHECK_ID)?.severity, "info");
  assert.equal(by.get(RESOURCES_CHECK_ID)?.severity, "warn");
  assert.equal(by.get("parallel.breach.withheld-field-in-a-critic-input")?.severity, "fail");
  assert.equal(by.get("parallel.breach.applied-without-audit")?.severity, "ok");
  // The summary of §G.7 counts them.
  const summary = summaryOf([...findings]);
  assert.equal(summary.fail, 1);
  assert.equal(summary.warn, 1);
  assert.equal(summary.info, 1);
  assert.equal(summary.ok, 4);
});

test("T104: with the option off every finding of this feature is quiet", async () => {
  const findings = await parallelDoctorFindings({
    context: {
      parallel: {
        configuration: OFF,
        plan: PLAN,
        admission: ADMISSION_WITH_A_RESOURCE,
        breaches: [],
      },
    },
    flags: {},
  });
  assert.deepEqual(
    findings.map((f) => f.severity),
    ["ok", "ok", "ok", "ok", "ok", "ok", "ok"],
    "a run with the option off is untouched by the checks of this feature",
  );
  const planFinding = findings.find((f) => f.id === PLAN_CHECK_ID);
  assert.ok(planFinding?.message.includes("the option is off"));
});
