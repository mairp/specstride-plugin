/**
 * T005 of `specs/113-host-claude-code/tasks.md` — `describe` of EP-01 for this
 * host: the six capabilities with their values and their fallbacks
 * (F113-FR-028, F113-FR-029).
 *
 * F113-FR-028: "`describe` MUST declare the six capabilities of annex H §H.1
 * with their values: `hooks` (the events of F113-FR-021 to F113-FR-024),
 * `statusSurface`, `background`, `evals` (native), `model` (yes),
 * `stateRootWritable` (`unverified` until the spike of feature 122 reports).
 * Each absent one MUST use its declared fallback."
 *
 * Two of the six are ABSENT here, and each uses the declared fallback of the
 * table of annex H §H.1 — which this module never spells out itself but reads
 * from `@specstride/contracts/ep/host`, the machine-readable form of that
 * table, so that a fallback cannot drift from the annex:
 *
 *  - `background`: the host's own background job mode is considered and
 *    rejected as the runtime (F113-FR-032, R3v C1), and the one remaining
 *    candidate for "a primitive that re-invokes the host when a command exits"
 *    is the re-waking host hook, whose lifetime and re-arming are a fact the
 *    PAID capture of T001 would settle and which is `unverified`
 *    (`../host-facts.ts`, row `re-waking-host-hook-lifetime`). While it is
 *    unverified the capability is declared absent and the fallback applies.
 *  - `stateRootWritable`: `unverified` until the spike of feature 122 reports
 *    (F113-FR-028, in those words).
 *
 * The four present ones carry a value. Nothing here claims a capture that was
 * not run: the host's own spelling of the four host hook events, and the six
 * capabilities "as the host reports them", stay `unverified` with the pin
 * `claude-code@2.1.284` (F113-FR-035).
 *
 * This module runs in the BUILD, not on the consumer's machine, so it may
 * import `@specstride/contracts`; `src/shim/` may not.
 */
import {
  CAPABILITIES,
  DOCTOR_SKILL_ID,
  HOST_SKILL_IDS,
  capabilityRows,
  fallbackOf,
  unknownCapabilityIsIgnored,
} from "@specstride/contracts/ep/host";
import type { HostCapability, HostDescription } from "@specstride/contracts/ep/host";
import { HOST_NAME, HOST_PIN, factOf } from "../host-facts.ts";

/* -------------------------------------------------------------------------
 * The host's rendering, as `contracts/host-package.md` gives it
 * ---------------------------------------------------------------------- */

/**
 * The naming rule of skills of this host: a skill is a directory whose name is
 * the skill's name, lower case with hyphens, and every skill of this plugin
 * carries the product's prefix so that two plugins do not collide. It is the
 * rule `renderEntry` of `../render/index.ts` applies.
 */
export const SKILL_NAMING_RULE =
  "lower-case letters, digits and hyphens; one directory per skill, " +
  "named after the skill, holding `SKILL.md`; every skill of this plugin " +
  "carries the prefix `specstride-`";

/** The cap of a skill description for this host, in characters. */
export const DESCRIPTION_CAP = 1536 as const;

/** The packaging form of this host: a plugin directory. */
export const PACKAGING_FORM = "plugin directory" as const;

/* -------------------------------------------------------------------------
 * The four host hook events the `hooks` capability names
 * ---------------------------------------------------------------------- */

/** One host hook event this plugin registers (F113-FR-021 to F113-FR-024). */
export type HostHookEvent = {
  /** The id of the event in the product's words; it is the value `hooks` carries. */
  readonly id: string;
  /** What the shim of the event prints. */
  readonly prints: string;
  /** The requirement that specifies the event. */
  readonly requirement: string;
  /**
   * The host's own spelling of the event, where documentation gives it, else
   * `null`. A spelling is a HOST fact: it is `unverified` with the pin until
   * the live capture of T001 has been run (F113-FR-035).
   */
  readonly hostSpelling: string | null;
};

/**
 * The four events of F113-FR-021 to F113-FR-024, in the order of the
 * requirements: session start, prompt submission, the guardrail before a shell
 * command, and a limit event the host observes. F113-FR-025 registers NO event
 * on stop and none after a tool use that injects context, so the list is four
 * and not six.
 */
export const HOST_HOOK_EVENTS: readonly HostHookEvent[] = Object.freeze([
  Object.freeze({
    id: "session-start",
    prints: "one status line with `validUntil`, or nothing when no run exists",
    requirement: "F113-FR-021",
    hostSpelling: "SessionStart",
  }),
  Object.freeze({
    id: "prompt-submit",
    prints: "nothing unless the state or the phase changed since the last injection, then one line",
    requirement: "F113-FR-022",
    hostSpelling: "UserPromptSubmit",
  }),
  Object.freeze({
    id: "guard-before-shell",
    prints: "one line that denies, where a launch check would refuse",
    requirement: "F113-FR-023",
    hostSpelling: "PreToolUse",
  }),
  Object.freeze({
    id: "host-limit-event",
    prints:
      "nothing: it writes an inbox request of type `host-event` through the CLI and injects " +
      "no context",
    requirement: "F113-FR-024",
    hostSpelling: null,
  }),
]);

/** The ids of the four events: the value the capability `hooks` carries. */
export const HOST_HOOK_EVENT_IDS: readonly string[] = Object.freeze(
  HOST_HOOK_EVENTS.map((e) => e.id),
);

/** F113-FR-025 — the two events this plugin registers no host hook on. */
export const EVENTS_NEVER_REGISTERED: readonly string[] = Object.freeze([
  "stop",
  "after-tool-use-that-injects-context",
]);

/* -------------------------------------------------------------------------
 * The six capability declarations
 * ---------------------------------------------------------------------- */

/**
 * One capability declaration (data-model.md, "Capability declaration": each
 * with value and fallback).
 */
export type CapabilityDeclaration = {
  /** The capability, one of the six of annex H §H.1. */
  readonly capability: HostCapability;
  /** The `Values` column of the table of the annex, verbatim. */
  readonly values: string;
  /** True where this host offers the capability; false where it is absent. */
  readonly present: boolean;
  /**
   * The value this host declares, or `null` where the capability is absent.
   * `hooks` carries the ids of the four events of F113-FR-021 to F113-FR-024.
   */
  readonly value: string | readonly string[] | null;
  /** The declared fallback of annex H §H.1, which applies while it is absent. */
  readonly fallback: string;
  /** Why the capability is absent, or `null` where it is present. */
  readonly absentBecause: string | null;
  /** The requirement that fixes the declaration. */
  readonly requirement: string;
  /**
   * The row of the verification record (`../host-facts.ts`) the declaration
   * rests on, where one does. Every capability of this host rests on the row
   * `six-capabilities-of-the-host`, which the PAID capture of T001 would
   * settle and which is `unverified`.
   */
  readonly hostFact: string;
  /** The version pin of the host fact (F113-FR-035). */
  readonly pin: string;
};

/** The `Values` column of the table of annex H §H.1 for a capability. */
export function valuesColumnOf(capability: HostCapability): string {
  const row = capabilityRows.find((r) => r.capability === capability);
  if (row === undefined) {
    throw new Error(`annex H §H.1 holds no capability \`${capability}\``);
  }
  return row.values;
}

/** The row of the verification record every capability declaration rests on. */
export const CAPABILITY_HOST_FACT = "six-capabilities-of-the-host" as const;

function declare(
  capability: HostCapability,
  present: boolean,
  value: string | readonly string[] | null,
  absentBecause: string | null,
  requirement: string,
): CapabilityDeclaration {
  return Object.freeze({
    capability,
    values: valuesColumnOf(capability),
    present,
    value: Array.isArray(value) ? Object.freeze([...value]) : value,
    // Never spelled out here: read from the table of annex H §H.1.
    fallback: fallbackOf(capability),
    absentBecause,
    requirement,
    hostFact: CAPABILITY_HOST_FACT,
    pin: HOST_PIN,
  });
}

/**
 * The six capabilities of annex H §H.1 as this host declares them, in the
 * order of the table of the annex (F113-FR-028). Four are present and two are
 * absent; each absent one carries the declared fallback of the annex.
 */
export const CAPABILITY_DECLARATIONS: readonly CapabilityDeclaration[] = Object.freeze([
  declare(
    "hooks",
    true,
    HOST_HOOK_EVENT_IDS,
    null,
    "F113-FR-028 (the events of F113-FR-021 to F113-FR-024)",
  ),
  declare(
    "statusSurface",
    true,
    "the host's status line, and the context of the four host hook events",
    null,
    "F113-FR-028",
  ),
  declare(
    "background",
    false,
    null,
    "The host's own background job mode is considered and rejected as the runtime " +
      "(F113-FR-032, R3v C1), and the lifetime and re-arming of the one re-waking host hook " +
      "that could re-invoke the host is a fact of the PAID capture of T001 and is " +
      "`unverified`. While it is unverified the capability is absent and the declared " +
      "fallback applies (F113-FR-013: every supervision cycle costs at most 150 tokens).",
    "F113-FR-028",
  ),
  declare("evals", true, "native: the host's own suite runner", null, "F113-FR-028 (native)"),
  declare("model", true, "yes", null, "F113-FR-028 (yes)"),
  declare(
    "stateRootWritable",
    false,
    null,
    "`unverified` until the spike of feature 122 reports (F113-FR-028, in those words). " +
      "The declaration claims nothing the spike has not reported, so the capability is " +
      "absent and the declared fallback applies.",
    "F113-FR-028",
  ),
]);

/** The declaration of a capability, or `undefined` for a name outside the six. */
export function declarationOf(capability: string): CapabilityDeclaration | undefined {
  return CAPABILITY_DECLARATIONS.find((d) => d.capability === capability);
}

/** The capabilities this host offers, in the order of the annex. */
export function presentCapabilities(): readonly HostCapability[] {
  return Object.freeze(CAPABILITY_DECLARATIONS.filter((d) => d.present).map((d) => d.capability));
}

/** The capabilities that are absent here; each uses its declared fallback. */
export function absentCapabilities(): readonly HostCapability[] {
  return Object.freeze(CAPABILITY_DECLARATIONS.filter((d) => !d.present).map((d) => d.capability));
}

/**
 * The declared fallback of a capability that is absent (F113-FR-028: "Each
 * absent one MUST use its declared fallback"). It is the fallback of the table
 * of annex H §H.1 and of no other source. A capability this host offers has no
 * fallback to use, and asking for one is an error of the caller.
 */
export function fallbackInUse(capability: HostCapability): string {
  const declaration = declarationOf(capability);
  if (declaration === undefined) {
    throw new Error(`annex H §H.1 holds no capability \`${capability}\``);
  }
  if (declaration.present) {
    throw new Error(
      `the capability \`${capability}\` is declared by ${HOST_NAME}, so no fallback is in ` +
        `use; the declared fallback of annex H §H.1 applies only to an absent capability ` +
        `(F113-FR-028)`,
    );
  }
  return declaration.fallback;
}

/** The fallbacks in use here, keyed by the absent capability. */
export function fallbacksInUse(): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const declaration of CAPABILITY_DECLARATIONS) {
    if (!declaration.present) out[declaration.capability] = declaration.fallback;
  }
  return Object.freeze(out);
}

/* -------------------------------------------------------------------------
 * F113-FR-029 — an unknown capability is ignored
 * ---------------------------------------------------------------------- */

/** True for one of the six capabilities of annex H §H.1. */
export function isKnownCapability(name: string): name is HostCapability {
  return (CAPABILITIES as readonly string[]).includes(name);
}

/**
 * F113-FR-029: "An unknown capability in `describe` MUST be ignored." The
 * names outside the six of annex H §H.1, in the order they were given. They
 * are IGNORED: `describe` neither fails nor carries them into its output.
 */
export function ignoredCapabilities(names: readonly string[]): readonly string[] {
  return Object.freeze(names.filter((name) => unknownCapabilityIsIgnored(name)));
}

/**
 * The declarations for the capabilities a caller asks about, with every
 * unknown name ignored (F113-FR-029). The result names what was ignored, so
 * that "ignored" is observable without being an error.
 */
export function describeCapabilities(names: readonly string[]): {
  readonly declared: readonly CapabilityDeclaration[];
  readonly ignored: readonly string[];
} {
  const declared: CapabilityDeclaration[] = [];
  for (const name of names) {
    const declaration = declarationOf(name);
    if (declaration !== undefined) declared.push(declaration);
  }
  return Object.freeze({
    declared: Object.freeze(declared),
    ignored: ignoredCapabilities(names),
  });
}

/* -------------------------------------------------------------------------
 * `describe`
 * ---------------------------------------------------------------------- */

function valueOrNull(capability: HostCapability): string | null {
  const declaration = declarationOf(capability);
  if (declaration === undefined || !declaration.present) return null;
  return typeof declaration.value === "string" ? declaration.value : null;
}

/**
 * `describe` of EP-01 for this host (F113-FR-028). Every one of the six
 * capabilities of annex H §H.1 is declared; an absent one is `null` (or
 * `false` for the two that the port types as a boolean), which is what makes
 * the product use the declared fallback of the annex — `fallbacksInUse()`
 * names the fallback of each.
 *
 * `stateRootWritable` is `false` because it is `unverified` until the spike of
 * feature 122 reports (F113-FR-028): the declaration claims no write the spike
 * has not reported.
 */
export function describe(): HostDescription {
  const hooks = declarationOf("hooks");
  return Object.freeze({
    skillNaming: Object.freeze({ rule: SKILL_NAMING_RULE, descriptionCap: DESCRIPTION_CAP }),
    hooks: hooks !== undefined && hooks.present ? Object.freeze([...HOST_HOOK_EVENT_IDS]) : null,
    background: valueOrNull("background"),
    statusSurface: valueOrNull("statusSurface"),
    evals: valueOrNull("evals"),
    packagingForm: PACKAGING_FORM,
    stateRootWritable: declarationOf("stateRootWritable")?.present === true,
    model: declarationOf("model")?.present === true,
  });
}

/* -------------------------------------------------------------------------
 * What `describe` does NOT claim
 * ---------------------------------------------------------------------- */

/**
 * The logical ids of the skills of the product, for a reader of `describe`:
 * the two host skills of F100-FR-194 and the doctor skill. The host's own
 * SPELLING of each is `renderEntry` of `../render/index.ts`; `describe`
 * carries only the naming rule.
 */
export const SKILL_IDS: readonly string[] = Object.freeze([...HOST_SKILL_IDS, DOCTOR_SKILL_ID]);

/**
 * True while the PAID capture of T001 has not settled the capabilities of this
 * host: the row `six-capabilities-of-the-host` of the verification record is
 * `unverified`, so every declaration above rests on documentation and the pin
 * (F113-FR-035). A declaration must never claim a capture that was not run.
 */
export function capabilitiesAreUnverified(): boolean {
  return factOf(CAPABILITY_HOST_FACT)?.status === "unverified";
}
