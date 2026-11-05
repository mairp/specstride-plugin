/**
 * T061 — the checks of the doctor, registered as entries of the doctor
 * registry (F130-FR-005, F130-FR-006; EP-14, `specstride.doctor/1`).
 *
 * Every check READS and NEVER writes: it reads the detection record, the
 * state of the home, the coverage enumeration and the descriptor's own facts
 * — nothing else. No check makes a paid call: the only subprocesses the
 * checks may reach are the free `--version` probe and the free
 * `--dump-config` introspection, both of which run with STANDARD INPUT
 * CLOSED (`stdio: ["ignore", ...]`) and a TIME LIMIT, as the registration
 * rules demand. No check reads a secret value.
 *
 * The checks of F130-FR-005, in the order of the requirement:
 *   `dsh.executable`        executable found and its resolved path (lb for a role in use)
 *   `dsh.version`           version equal to the pin (lb for a role in use)
 *   `dsh.home`              the state of the home (exists, readable)      — warning
 *   `dsh.critic-coverage`   the coverage of F130-FR-024, critic role    — warning
 *   `dsh.trace-plugin`      the harness's own trace plugin captures
 *                           content while the product's capture is off  — warning
 *   `dsh.context-window`    the declared window against an override     — warning
 *   `dsh.terms`             the unknown terms of F130-FR-004            — warning
 *   `dsh.customisations`    each kind the adapter cannot switch off,
 *                           unless the consumer opted in (F130-FR-043)  — warning
 *   `dsh.native-memory`     the state of native memory (F130-FR-044)    — warning
 *   `dsh.critic-memory`     the refusal of F130-FR-045, critic role     — LAUNCH-BLOCKING
 *   `dsh.unverified-facts`  one line that lists the still-`unverified` facts
 *
 * F130-FR-006 is the dating audit: `dshDatedFacts()` lists every provider
 * fact and harness fact this adapter states, each WITH its `verified-on`
 * date and the pin, or marked `unverified` WITH the check that would settle
 * it; `dshFactDatingAudit()` returns the violations (there are none at this
 * feature, and CT-130-6 holds that line).
 *
 * Registration goes through the kernel call `registerDoctorCheck`
 * (F100-FR-189; annex G §G.7), so this module imports no doctor.
 */
import { registerDoctorCheck } from "@specstride/kernel";
import { DSH_PIN, DSH_VERIFIED_ON } from "../descriptor/data.ts";
import { CUSTOMISATION_KINDS } from "../descriptor/index.ts";
import { dshPinState, DSH_HOME_VARIABLE, type DshRole } from "../detect/index.ts";
import { CRITIC_NOT_TOOLLESS } from "../coverage/index.ts";
import { CRITIC_DEFAULT_WINDOW } from "../critic/window.ts";
import { DSH_TERMS_ROW } from "../descriptor/terms.ts";
import { resolveCustomisationStates, resolveMemoryState } from "../customisations/index.ts";
import { criticMemoryRefusal } from "../customisations/critic.ts";

/** The profile a check reads its rule from (F130-FR-043/044/045 name `parity`). */
export type DshDoctorProfile = "parity" | "strict";

/** The severities of a finding (the doctor's closed set, §G.7). */
export type DshDoctorSeverity = "ok" | "info" | "warn" | "fail";

/** One finding of one check of this adapter. */
export type DshDoctorFinding = {
  /** The stable dotted id of the check (ids are never renamed). */
  readonly id: string;
  readonly severity: DshDoctorSeverity;
  /** Launch-blocking: the launch checks are exactly the `lb` subset. */
  readonly lb: boolean;
  readonly message: string;
  /** The fix hint, filled with what the check observed. */
  readonly remedy: string;
};

/** What the customisation check states per kind (F130-FR-043: a closed set). */
export type CustomisationDoctorState = "off" | "absent" | "opted-in" | "not-switchable" | "as-is";

/** The state of native memory for one role (F130-FR-044: the same closed set). */
export type MemoryDoctorState = CustomisationDoctorState;

/** One still-`unverified` fact, with the check that would settle it (F130-FR-006). */
export type UnverifiedFact = {
  readonly fact: string;
  readonly settlesBy: string;
};

/**
 * Everything a check run reads. All of it is INJECTED: the probes read no
 * machine state of their own, so the same checks run on fixtures (F112-FR-001).
 */
export type DshDoctorObserved = {
  /** The role this harness is named for, or null when no role names it. */
  readonly role: DshRole | null;
  /** The resolved absolute path of the executable, null when not found. */
  readonly executablePath: string | null;
  /** The version `--version` printed, null when it did not answer. */
  readonly version: string | null;
  /** The state of the configuration home (F130-FR-005: exists, readable). */
  readonly homeExists: boolean;
  readonly homeReadable: boolean;
  /** The uncovered tool ids of the coverage check, null where it is not made. */
  readonly uncoveredToolIds: readonly string[] | null;
  /** Whether the harness's own trace plugin captures content; null unknown. */
  readonly tracePluginCapturesContent: boolean | null;
  /** Whether the product's own content capture is on. */
  readonly contentCaptureOn: boolean;
  /** The declared context window of the model, and the consumer's override. */
  readonly declaredContextWindow: number | null;
  readonly contextWindowOverride: number | null;
  /** Whether the terms of the provider are known (F130-FR-004: they are not). */
  readonly termsKnown: boolean;
  /** `harnesses.dsh.proposerCustomisations` read as `on` (user configuration). */
  readonly customisationsOptIn: boolean;
  /** `memory.native.proposer` read as `on` (user configuration). */
  readonly memoryOptIn: boolean;
  readonly profile: DshDoctorProfile;
  /** The still-`unverified` facts, for the one listing line. */
  readonly unverifiedFacts: readonly UnverifiedFact[];
};

/** The customisation states the check reports, per kind (F130-FR-043).
 *  T075 — delegated to the customisations module, the single implementation
 *  of the kinds and states (`src/customisations/index.ts`). */
export function dshCustomisationStates(observed: DshDoctorObserved): {
  readonly kind: (typeof CUSTOMISATION_KINDS)[number];
  readonly state: CustomisationDoctorState;
}[] {
  return resolveCustomisationStates({
    profile: observed.profile,
    customisationsOptIn: observed.customisationsOptIn,
    memoryOptIn: observed.memoryOptIn,
    capture: null,
  }).map((entry) => ({ kind: entry.kind, state: entry.state as CustomisationDoctorState }));
}

/** The state of native memory for the role in use (F130-FR-044); delegated. */
export function dshMemoryState(observed: DshDoctorObserved): MemoryDoctorState {
  return resolveMemoryState({
    profile: observed.profile,
    memoryOptIn: observed.memoryOptIn,
    role: observed.role === "critic" ? "critic" : "proposer",
    capture: null,
  });
}

/** Whether the critic role must be refused (F130-FR-045: `memory-not-off`). */
export function dshCriticMemoryRefusal(observed: DshDoctorObserved): {
  readonly refused: boolean;
  readonly reason: "memory-not-off";
} {
  const refusal = criticMemoryRefusal({
    profile: observed.profile,
    memoryOptIn: observed.memoryOptIn,
    customisationsOptIn: observed.customisationsOptIn,
    capture: null,
  });
  return { refused: refusal.refused, reason: refusal.reason };
}

/** The stable dotted ids of the checks of this adapter, in registration order. */
export const DSH_DOCTOR_CHECK_IDS = [
  "dsh.executable",
  "dsh.version",
  "dsh.home",
  "dsh.critic-coverage",
  "dsh.trace-plugin",
  "dsh.context-window",
  "dsh.terms",
  "dsh.customisations",
  "dsh.native-memory",
  "dsh.critic-memory",
  "dsh.unverified-facts",
] as const;
export type DshDoctorCheckId = (typeof DSH_DOCTOR_CHECK_IDS)[number];

const ROLE_WORD: Readonly<Record<DshRole, string>> = Object.freeze({
  proposer: "the proposer",
  critic: "the critic",
});

/** The order each check runs at (F130-FR-005 lists them in this order). */
const ORDER_OF: Readonly<Record<DshDoctorCheckId, number>> = Object.freeze({
  "dsh.executable": 10,
  "dsh.version": 20,
  "dsh.home": 30,
  "dsh.critic-coverage": 40,
  "dsh.trace-plugin": 50,
  "dsh.context-window": 60,
  "dsh.terms": 70,
  "dsh.customisations": 80,
  "dsh.native-memory": 90,
  "dsh.critic-memory": 100,
  "dsh.unverified-facts": 110,
});

/** The message template of each check, at most 200 bytes (§G.7). */
const MESSAGE_TEMPLATE_OF: Readonly<Record<DshDoctorCheckId, string>> = Object.freeze({
  "dsh.executable": "dsh executable <result>",
  "dsh.version": "dsh version <version> against the pin " + DSH_PIN,
  "dsh.home": "dsh home <state>",
  "dsh.critic-coverage": "critic tool coverage <result>",
  "dsh.trace-plugin": "dsh trace plugin captures <result>",
  "dsh.context-window": "dsh context window <result>",
  "dsh.terms": "dsh terms <state>",
  "dsh.customisations": "dsh customisations <state>",
  "dsh.native-memory": "dsh native memory <state>",
  "dsh.critic-memory": "dsh critic memory refusal <state>",
  "dsh.unverified-facts": "dsh facts unverified: <facts>",
});

/** The fix hint of each check. */
const FIX_HINT_OF: Readonly<Record<DshDoctorCheckId, string>> = Object.freeze({
  "dsh.executable": "install dsh or point the search path at it",
  "dsh.version": "install dsh at exactly the pin " + DSH_PIN,
  "dsh.home": "create the dsh home or fix the " + DSH_HOME_VARIABLE + " variable",
  "dsh.critic-coverage":
    "extend the deny list or refuse the critic role (" + CRITIC_NOT_TOOLLESS + ")",
  "dsh.trace-plugin": "turn the product's content capture on or remove the trace plugin",
  "dsh.context-window": "set the context window override to the model's real window",
  "dsh.terms": "record the terms of the provider before naming dsh",
  "dsh.customisations": "set harnesses.dsh.proposerCustomisations to on to opt in",
  "dsh.native-memory": "set memory.native.proposer to on to opt in, or show a capture",
  "dsh.critic-memory": "show a recorded capture that the memory is off or absent",
  "dsh.unverified-facts": "run the capture that settles each listed fact",
});

/**
 * F130-FR-005 — the findings of every check, from the injected observation.
 * PURE: no file is written, no process is started, no clock is read; the
 * subprocesses behind `executablePath`, `version` and `uncoveredToolIds` are
 * the caller's free probes, which close standard input and keep a time limit.
 */
export function dshDoctorFindings(observed: DshDoctorObserved): readonly DshDoctorFinding[] {
  const findings: DshDoctorFinding[] = [];
  const roleInUse = observed.role !== null;
  const lbForRole = roleInUse; // executable and version are launch-blocking for a role in use

  // dsh.executable — found, with its resolved path.
  findings.push(
    observed.executablePath === null
      ? {
          id: "dsh.executable",
          severity: roleInUse ? "fail" : "warn",
          lb: lbForRole,
          message: `dsh executable not found${roleInUse ? ` (named for ${ROLE_WORD[observed.role]})` : ""}`,
          remedy: FIX_HINT_OF["dsh.executable"],
        }
      : {
          id: "dsh.executable",
          severity: "ok",
          lb: false,
          message: `dsh executable found at ${observed.executablePath}`,
          remedy: FIX_HINT_OF["dsh.executable"],
        },
  );

  // dsh.version — equal to the exact pin.
  const pinState = dshPinState(observed.version, observed.role ?? "proposer");
  findings.push({
    id: "dsh.version",
    severity: pinState === "pin" ? "ok" : pinState === "fail" ? "fail" : "warn",
    lb: lbForRole && pinState !== "pin",
    message:
      observed.version === null
        ? `dsh version unknown; the pin is ${DSH_PIN} (verified-on ${DSH_VERIFIED_ON})`
        : `dsh version ${observed.version} against the pin ${DSH_PIN} (verified-on ${DSH_VERIFIED_ON}): ${pinState}`,
    remedy: FIX_HINT_OF["dsh.version"],
  });

  // dsh.home — exists and readable.
  findings.push({
    id: "dsh.home",
    severity: observed.homeExists ? (observed.homeReadable ? "ok" : "warn") : "warn",
    lb: false,
    message: observed.homeExists
      ? `dsh home exists and is ${observed.homeReadable ? "readable" : "NOT readable"}`
      : `dsh home does not exist (${DSH_HOME_VARIABLE} or the default)`,
    remedy: FIX_HINT_OF["dsh.home"],
  });

  // dsh.critic-coverage — the coverage of F130-FR-024, for a critic role.
  if (observed.role === "critic" && observed.uncoveredToolIds !== null) {
    const uncovered = observed.uncoveredToolIds;
    findings.push({
      id: "dsh.critic-coverage",
      severity: uncovered.length === 0 ? "ok" : "warn",
      lb: false, // the refusal itself is the critic call's, not the doctor's warning
      message:
        uncovered.length === 0
          ? "the critic patch covers every tool id the installed harness exposes"
          : `the critic patch does not cover ${uncovered.length} tool id(s): ${uncovered.join(", ")}`,
      remedy: FIX_HINT_OF["dsh.critic-coverage"],
    });
  }

  // dsh.trace-plugin — content capture by the harness's own plugin.
  if (observed.tracePluginCapturesContent !== null) {
    const captures = observed.tracePluginCapturesContent && !observed.contentCaptureOn;
    findings.push({
      id: "dsh.trace-plugin",
      severity: captures ? "warn" : "ok",
      lb: false,
      message: captures
        ? "the harness's own trace plugin captures content while the product's content capture is off"
        : "the harness's own trace plugin captures no content the product is not capturing",
      remedy: FIX_HINT_OF["dsh.trace-plugin"],
    });
  }

  // dsh.context-window — the declared window against an override.
  {
    const declared = observed.declaredContextWindow;
    const override = observed.contextWindowOverride;
    const mismatch = declared !== null && override !== null && declared !== override;
    const bareNameDefault = declared === null && override === null;
    findings.push({
      id: "dsh.context-window",
      severity: mismatch ? "warn" : "ok",
      lb: false,
      message: mismatch
        ? `the declared context window ${String(declared)} differs from the override ${String(override)}`
        : bareNameDefault
          ? `no window stated; the bare name gets the default ${String(CRITIC_DEFAULT_WINDOW)}`
          : `the context window and the override agree${declared === null ? "" : ` at ${String(declared)}`}`,
      remedy: FIX_HINT_OF["dsh.context-window"],
    });
  }

  // dsh.terms — the unknown terms of F130-FR-004.
  findings.push({
    id: "dsh.terms",
    severity: observed.termsKnown ? "ok" : "warn",
    lb: false,
    message: observed.termsKnown
      ? "the terms of the provider are known"
      : `the terms of the provider are unknown (${DSH_TERMS_ROW.launchStatement}); dsh is never a default and never picked`,
    remedy: FIX_HINT_OF["dsh.terms"],
  });

  // dsh.customisations — each kind the adapter cannot switch off (F130-FR-043).
  {
    const states = dshCustomisationStates(observed);
    const notSwitchable = states.filter((s) => s.state === "not-switchable").map((s) => s.kind);
    findings.push({
      id: "dsh.customisations",
      severity: notSwitchable.length === 0 ? "ok" : "warn",
      lb: false,
      message:
        notSwitchable.length === 0
          ? `every kind of customisation is ${states[0]?.state ?? "off"}`
          : `the adapter cannot switch off: ${notSwitchable.join(", ")} (state ${notSwitchable
              .map(() => "not-switchable")
              .join(", ")})`,
      remedy: FIX_HINT_OF["dsh.customisations"],
    });
  }

  // dsh.native-memory — the state of native memory (F130-FR-044).
  {
    const state = dshMemoryState(observed);
    findings.push({
      id: "dsh.native-memory",
      severity: state === "not-switchable" ? "warn" : "ok",
      lb: false,
      message: `native memory state: ${state}`,
      remedy: FIX_HINT_OF["dsh.native-memory"],
    });
  }

  // dsh.critic-memory — the refusal of F130-FR-045 is LAUNCH-BLOCKING.
  {
    const refusal = dshCriticMemoryRefusal(observed);
    const applies = observed.role === "critic" && refusal.refused;
    findings.push({
      id: "dsh.critic-memory",
      severity: applies ? "fail" : "ok",
      lb: applies,
      message: applies
        ? `the critic role is refused (${refusal.reason}): native memory is neither off nor shown absent`
        : `the critic role is not refused by native memory (${dshMemoryState(observed)})`,
      remedy: FIX_HINT_OF["dsh.critic-memory"],
    });
  }

  // dsh.unverified-facts — the one line that lists the still-unverified facts.
  findings.push({
    id: "dsh.unverified-facts",
    severity: observed.unverifiedFacts.length === 0 ? "ok" : "info",
    lb: false,
    message: dshUnverifiedFactLine(observed.unverifiedFacts),
    remedy: FIX_HINT_OF["dsh.unverified-facts"],
  });

  return findings;
}

/** The one line that lists the still-`unverified` facts (F130-FR-005, last check). */
export function dshUnverifiedFactLine(facts: readonly UnverifiedFact[]): string {
  if (facts.length === 0) return "no fact of the dsh adapter is unverified";
  return `unverified facts of dsh (${String(facts.length)}): ${facts
    .map((f) => `${f.fact} [settled by ${f.settlesBy}]`)
    .join("; ")}`;
}

/** The still-`unverified` facts of this adapter at this feature (F130-FR-006). */
export const DSH_UNVERIFIED_FACTS: readonly UnverifiedFact[] = Object.freeze([
  { fact: "the approval mode ask in a headless run (F130-FR-017)", settlesBy: "capture 1" },
  {
    fact: "the enforcement of the permission mode by the operating system (F130-FR-018)",
    settlesBy: "capture 2",
  },
  {
    fact: "the tool ids the pinned version exposes (F130-FR-023 to F130-FR-025)",
    settlesBy: "capture 3",
  },
  {
    fact: "the rejoining of task arguments and the accepted argument size (F130-FR-011)",
    settlesBy: "capture 4",
  },
  {
    fact: "the telemetry variable and its off value, and the limit message forms (F130-FR-038, F130-FR-040)",
    settlesBy: "capture 5",
  },
  {
    fact: "what the composed profile loads, and the native memory (F130-FR-003, F130-FR-043 to F130-FR-045)",
    settlesBy: "capture 6",
  },
  { fact: "the containment ceiling C1 (F130-FR-018)", settlesBy: "capture 2" },
]);

/** The default observation of a doctor run on this adapter, before detection. */
export function defaultDshDoctorObserved(
  overrides: Partial<DshDoctorObserved> = {},
): DshDoctorObserved {
  return {
    role: null,
    executablePath: null,
    version: null,
    homeExists: false,
    homeReadable: false,
    uncoveredToolIds: null,
    tracePluginCapturesContent: null, // capture 5
    contentCaptureOn: false,
    declaredContextWindow: null,
    contextWindowOverride: null,
    termsKnown: false, // F130-FR-004
    customisationsOptIn: false,
    memoryOptIn: false,
    profile: "strict",
    unverifiedFacts: DSH_UNVERIFIED_FACTS,
    ...overrides,
  };
}

/** One registered check of this adapter, in the doctor's own shape. */
export type DshDoctorCheck = {
  readonly id: DshDoctorCheckId;
  readonly severityRule: (finding: DshDoctorFinding) => DshDoctorSeverity;
  readonly lb: boolean;
  readonly order: number;
  readonly messageTemplate: string;
  readonly fixHint: string;
  /** Runs the check from an injected observation: pure, never a write. */
  probe(observed: DshDoctorObserved): DshDoctorFinding;
};

/**
 * The checks of this adapter, in registration order, built from one
 * observation (which decides the launch-blocking flags of the executable and
 * version checks for a role in use, and of the critic-memory check).
 */
export function dshDoctorChecks(observed: DshDoctorObserved): readonly DshDoctorCheck[] {
  const findings = dshDoctorFindings(observed);
  return DSH_DOCTOR_CHECK_IDS.map((id) => {
    const finding = findings.find((f) => f.id === id) ?? {
      id,
      severity: "ok" as const,
      lb: false,
      message: MESSAGE_TEMPLATE_OF[id],
      remedy: FIX_HINT_OF[id],
    };
    return {
      id,
      severityRule: (f: DshDoctorFinding) => f.severity,
      lb: finding.lb,
      order: ORDER_OF[id],
      messageTemplate: MESSAGE_TEMPLATE_OF[id],
      fixHint: FIX_HINT_OF[id],
      probe: (observedNow: DshDoctorObserved) =>
        dshDoctorFindings(observedNow).find((f) => f.id === id) ?? {
          id,
          severity: "ok" as const,
          lb: false,
          message: MESSAGE_TEMPLATE_OF[id],
          remedy: FIX_HINT_OF[id],
        },
    };
  });
}

/**
 * Registers the checks of this adapter with the kernel's doctor registry
 * (F100-FR-189). The probes receive the doctor's injected record and read the
 * observation out of its `dsh` key; where the caller gives none, the default
 * observation is used. Idempotent per id at the kernel surface.
 */
export function registerDshDoctorChecks(observed: DshDoctorObserved): readonly DshDoctorCheck[] {
  const checks = dshDoctorChecks(observed);
  for (const check of checks) {
    registerDoctorCheck({
      id: check.id,
      severityRule: (observedOfProbe: unknown) =>
        check.severityRule(
          check.probe(asObserved((observedOfProbe ?? {}) as Readonly<Record<string, unknown>>)),
        ),
      lb: check.lb,
      order: check.order,
      messageTemplate: check.messageTemplate,
      fixHint: check.fixHint,
      probe: async (injected: Readonly<Record<string, unknown>>) =>
        check.probe(asObserved(injected)),
    });
  }
  return checks;
}

/** Reads the observation out of an injected record (`dsh` key, or the record itself). */
function asObserved(injected: Readonly<Record<string, unknown>>): DshDoctorObserved {
  const nested = injected["dsh"];
  if (nested !== undefined && nested !== null && typeof nested === "object") {
    return { ...defaultDshDoctorObserved(), ...(nested as Partial<DshDoctorObserved>) };
  }
  return defaultDshDoctorObserved(injected as Partial<DshDoctorObserved>);
}

/**
 * F130-FR-006 — one dated fact of this adapter: either it carries the
 * `verified-on` date and the pin, or it is marked `unverified` with the
 * check that would settle it.
 */
export type DatedFact = {
  readonly fact: string;
  /** The pin the fact was verified at, where it is verified. */
  readonly pin?: string;
  /** The date of verification, where it is verified. */
  readonly verifiedOn?: string;
  /** `unverified` with the settling check, where it is not verified. */
  readonly status: "verified" | "unverified";
  readonly settlesBy?: string;
};

/** Audits a list of dated facts: the violations, empty when every fact is dated. */
export function dshFactDatingAudit(
  facts: readonly DatedFact[],
): readonly { readonly fact: string; readonly why: string }[] {
  return facts.flatMap((fact) => {
    const violations: { fact: string; why: string }[] = [];
    if (fact.status === "verified") {
      if (fact.verifiedOn === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(fact.verifiedOn)) {
        violations.push({ fact: fact.fact, why: "a verified fact carries no verified-on date" });
      }
      if (fact.pin === undefined) {
        violations.push({ fact: fact.fact, why: "a verified fact carries no version pin" });
      } else if (fact.pin !== DSH_PIN) {
        violations.push({ fact: fact.fact, why: `the pin is ${fact.pin}, not ${DSH_PIN}` });
      }
    } else if (fact.settlesBy === undefined || fact.settlesBy === "") {
      violations.push({
        fact: fact.fact,
        why: "an unverified fact names no check that would settle it",
      });
    }
    return violations;
  });
}

/**
 * Every provider fact and harness fact this adapter states, dated
 * (F130-FR-006): the descriptor's own facts carry the pin and the
 * `verified-on` date; everything a capture must settle stays `unverified`
 * with its capture.
 */
export function dshDatedFacts(): readonly DatedFact[] {
  const verified = (fact: string): DatedFact => ({
    fact,
    pin: DSH_PIN,
    verifiedOn: DSH_VERIFIED_ON,
    status: "verified",
  });
  const unverified = (fact: string, settlesBy: string): DatedFact => ({
    fact,
    status: "unverified",
    settlesBy,
  });
  return Object.freeze([
    // The descriptor's own facts: dated at the pin.
    verified(
      "the descriptor serves the roles proposer and critic, each with an optional qualifier provider/model",
    ),
    verified(
      "the kind is cli and the stream format outside parity is text; under parity no stream format is named",
    ),
    verified(
      "continuation is not supported: session.continuation none, every pass is a fresh session",
    ),
    verified("the usage source is none: the harness reports no usage"),
    verified(
      "the critic tool-less mechanism is a patch file (config), with read-only mode stated and no initial record claimed",
    ),
    verified(
      "dsh is never a default and never picked, for both roles, under every audience (terms unknown)",
    ),
    verified("the cost class is unknown"),
    verified(
      "the proposal never continues a session and never waits on a human (standard input closed)",
    ),
    verified("the real home is never written by a pass"),
    // What a capture must settle: unverified, with the capture that settles it.
    unverified("what the approval mode ask does headless (F130-FR-017)", "capture 1"),
    unverified(
      "whether the operating system enforces the permission mode; the containment ceiling C1 (F130-FR-018)",
      "capture 2",
    ),
    unverified("the tool ids the pinned version exposes (F130-FR-023 to F130-FR-025)", "capture 3"),
    unverified(
      "the rejoining of task arguments and the accepted argument size (F130-FR-011)",
      "capture 4",
    ),
    unverified(
      "the telemetry variable and its off value, and the limit message forms (F130-FR-038, F130-FR-040)",
      "capture 5",
    ),
    unverified(
      "what the composed profile loads into a call; whether a native memory exists and how it is switched (F130-FR-003, F130-FR-043, F130-FR-044, F130-FR-045)",
      "capture 6",
    ),
    unverified("every statement about macOS", "a capture on macOS"),
    // The capture of the owner's ruling of 2026-11-03 (CT-130-46): three
    // real `zai/glm-5.3-flash` headless sessions at once through `startPass`,
    // one configuration home, one login, three separate session stores.
    {
      fact: "several headless sessions run at once under one configuration home and one login, with separate session stores (three proven)",
      pin: DSH_PIN,
      verifiedOn: "2026-11-03",
      status: "verified",
    },
    unverified(
      "the process spending limit and the model-tier ladder",
      "a consumer configuration that states them",
    ),
  ]);
}
