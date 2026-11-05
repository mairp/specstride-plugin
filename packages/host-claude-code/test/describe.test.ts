/**
 * T005 of `specs/113-host-claude-code/tasks.md` — `describe` declares the six
 * capabilities of annex H §H.1 with their values, and each absent one uses its
 * DECLARED FALLBACK (F113-FR-028); an unknown capability is IGNORED
 * (F113-FR-029).
 *
 * The fallbacks are never spelled out in a test either: they are read from
 * `@specstride/contracts/ep/host`, the machine-readable form of the table of
 * the annex, so that neither the module nor this test can drift from it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITIES,
  DOCTOR_SKILL_ID,
  HOST_SKILL_IDS,
  capabilityRows,
  fallbackOf,
} from "@specstride/contracts/ep/host";
import {
  CAPABILITY_DECLARATIONS,
  CAPABILITY_HOST_FACT,
  DESCRIPTION_CAP,
  EVENTS_NEVER_REGISTERED,
  HOST_HOOK_EVENTS,
  HOST_HOOK_EVENT_IDS,
  PACKAGING_FORM,
  SKILL_IDS,
  SKILL_NAMING_RULE,
  absentCapabilities,
  capabilitiesAreUnverified,
  declarationOf,
  describe,
  describeCapabilities,
  fallbackInUse,
  fallbacksInUse,
  ignoredCapabilities,
  isKnownCapability,
  presentCapabilities,
  valuesColumnOf,
} from "../src/describe/index.ts";
import { factOf } from "../src/host-facts.ts";

test("T005: the six capabilities of annex H §H.1 are declared, in the order of the annex", () => {
  assert.equal(CAPABILITY_DECLARATIONS.length, 6, "annex H §H.1 has six capabilities");
  assert.deepEqual(
    CAPABILITY_DECLARATIONS.map((d) => d.capability),
    [...CAPABILITIES],
  );
  // Every declaration carries the `Values` column of the annex, verbatim.
  for (const declaration of CAPABILITY_DECLARATIONS) {
    const row = capabilityRows.find((r) => r.capability === declaration.capability);
    assert.notEqual(row, undefined);
    assert.equal(declaration.values, row?.values);
    assert.equal(declaration.fallback, fallbackOf(declaration.capability));
    assert.match(declaration.requirement, /^F113-FR-028/);
    assert.equal(declaration.hostFact, CAPABILITY_HOST_FACT);
    assert.equal(declaration.pin, "claude-code@2.1.284");
  }
});

test("T005: the values of F113-FR-028 — hooks, statusSurface, evals native, model yes", () => {
  // `hooks` carries the events of F113-FR-021 to F113-FR-024.
  const hooks = declarationOf("hooks");
  assert.equal(hooks?.present, true);
  assert.deepEqual(hooks?.value, [
    "session-start",
    "prompt-submit",
    "guard-before-shell",
    "host-limit-event",
  ]);
  assert.deepEqual(
    HOST_HOOK_EVENTS.map((e) => e.requirement),
    ["F113-FR-021", "F113-FR-022", "F113-FR-023", "F113-FR-024"],
  );
  // F113-FR-025 — no host hook on stop and none after a tool use.
  assert.equal(HOST_HOOK_EVENTS.length, 4);
  for (const never of EVENTS_NEVER_REGISTERED) {
    assert.equal(HOST_HOOK_EVENT_IDS.includes(never), false);
  }

  assert.equal(declarationOf("statusSurface")?.present, true);
  assert.equal(declarationOf("evals")?.value, "native: the host's own suite runner");
  assert.equal(declarationOf("model")?.value, "yes");
  assert.deepEqual(presentCapabilities(), ["hooks", "statusSurface", "evals", "model"]);
});

test("T005: each absent capability uses its DECLARED fallback of annex H §H.1", () => {
  // `background`: rejected as the runtime, and the re-waking host hook is
  // unverified. `stateRootWritable`: unverified until the spike of 122 reports.
  assert.deepEqual(absentCapabilities(), ["background", "stateRootWritable"]);

  for (const capability of absentCapabilities()) {
    const declaration = declarationOf(capability);
    assert.equal(declaration?.present, false);
    assert.equal(declaration?.value, null, "an absent capability declares no value");
    assert.ok((declaration?.absentBecause ?? "").length > 0, "it records why it is absent");
    // The fallback in use is the one of the annex and of nothing else.
    assert.equal(fallbackInUse(capability), fallbackOf(capability));
  }
  assert.deepEqual(fallbacksInUse(), {
    background: fallbackOf("background"),
    stateRootWritable: fallbackOf("stateRootWritable"),
  });
  assert.equal(
    fallbackInUse("background"),
    "The budget of one supervision cycle per cycle",
    "the fallback of the annex, and the 150-token cycle of F113-FR-013",
  );
  assert.equal(
    fallbackInUse("stateRootWritable"),
    "A control root the host permits, set in user configuration",
  );
  // Asking for the fallback of a capability the host OFFERS is an error: a
  // fallback applies only to an absent capability.
  assert.throws(() => fallbackInUse("model"), /no fallback is in use/);
  assert.throws(() => valuesColumnOf("nonsense" as never), /holds no capability/);
});

test("T005: `describe` declares every one of the six, and the host's rendering", () => {
  const described = describe();
  assert.deepEqual(described.hooks, [...HOST_HOOK_EVENT_IDS]);
  assert.equal(
    described.statusSurface,
    "the host's status line, and the context of the four host hook events",
  );
  assert.equal(described.evals, "native: the host's own suite runner");
  assert.equal(described.model, true, "F113-FR-028: `model` (yes)");
  // The two absent ones are null / false, which is what makes the product use
  // the declared fallback.
  assert.equal(described.background, null);
  assert.equal(
    described.stateRootWritable,
    false,
    "F113-FR-028: `unverified` until the spike of feature 122 reports",
  );
  // The host's rendering of `contracts/host-package.md`.
  assert.equal(described.skillNaming.descriptionCap, DESCRIPTION_CAP);
  assert.equal(DESCRIPTION_CAP, 1536, "description cap 1,536 characters");
  assert.equal(described.skillNaming.rule, SKILL_NAMING_RULE);
  assert.equal(described.packagingForm, PACKAGING_FORM);
  assert.equal(PACKAGING_FORM, "plugin directory");
  // The three logical ids of skills the product has (F100-FR-194).
  assert.deepEqual(SKILL_IDS, [...HOST_SKILL_IDS, DOCTOR_SKILL_ID]);
});

test("T005: F113-FR-029 — an unknown capability in `describe` is IGNORED", () => {
  assert.equal(isKnownCapability("hooks"), true);
  assert.equal(isKnownCapability("telepathy"), false);
  assert.deepEqual(ignoredCapabilities(["hooks", "telepathy", "model", "mcp"]), [
    "telepathy",
    "mcp",
  ]);
  // Ignored, not an error, and not carried into the output.
  const asked = describeCapabilities(["telepathy", "model", "hooks"]);
  assert.deepEqual(
    asked.declared.map((d) => d.capability),
    ["model", "hooks"],
  );
  assert.deepEqual(asked.ignored, ["telepathy"]);
  assert.equal(declarationOf("telepathy"), undefined);
  // `describe` itself never fails for one, and its output holds no such key.
  assert.equal(Object.hasOwn(describe(), "telepathy"), false);
});

test("T005 (negative): no declaration claims the PAID capture of T001 was run", () => {
  assert.equal(capabilitiesAreUnverified(), true);
  const fact = factOf(CAPABILITY_HOST_FACT);
  assert.equal(fact?.status, "unverified");
  assert.equal(fact?.verifiedOn, null);
  assert.equal(fact?.unverifiedReason, "paid-probe");
  // The host's own spelling of the one event the capture would settle is not
  // guessed: it is `null`.
  const limit = HOST_HOOK_EVENTS.find((e) => e.id === "host-limit-event");
  assert.equal(limit?.hostSpelling, null);
});
