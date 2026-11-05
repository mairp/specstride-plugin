/**
 * T047 — the doctor checks of the detach strategy (F122-FR-003, F122-FR-041;
 * EP-14, annex G §G.7; annex F §F.6).
 *
 * §F.6 "Guarantees of the core" ends *the strategy in use is in the launch
 * record and in the doctor's output*, and F122-FR-003 asks the doctor to be
 * able to show *the id of the strategy and what the strategy survives*. So two
 * of the three checks below are reports: the id, and the survival the strategy
 * CLAIMS.
 *
 * The third is the one that matters, and it is the reason the other two are
 * not enough. F122-FR-041: *where the default strategy did not survive on a
 * host, or where a case is a skip, the doctor MUST say for that host that
 * survival of the end of a session is unverified.* A strategy's `describe`
 * cannot answer that — it is the same on every machine. The answer is a FACT
 * of the spike, pinned to a host and a date (`./spike-facts.json`), and the
 * check reads the facts and asks whether one of them was verified **on this
 * host**. Where none was, it says `unverified`, and `warn` is the severity:
 * `fail` would refuse every launch on a host whose spike has not been run,
 * and F122-FR-041 ends *no requirement of the product MUST depend on the
 * outcome of the spike*. A warning is what "we have not measured this here"
 * looks like.
 *
 * NONE OF THE THREE IS LAUNCH-BLOCKING. EP-14 guarantees the launch checks are
 * exactly the `lb` subset, so an `lb` check here would mean a launch is refused
 * on a host whose spike was skipped — which is the dependence F122-FR-041
 * forbids. The product still names `foreground` in the message of a refused
 * launch, and that is where the facts of the spike do reach a consumer
 * (F122-FR-005).
 */
import { hostname, release, type } from "node:os";
import {
  MESSAGE_TEMPLATE_CAP_BYTES,
  type DoctorCheck,
  type DoctorRegistry,
  type Severity,
} from "@specstride/contracts/ep/doctor";
import {
  DEFAULT_STRATEGY,
  STRATEGY_WITHOUT_DETACHING,
  SURVIVES_A_REBOOT_IN_WAVE_1,
  type StrategyDescription,
} from "@specstride/contracts/ep/detach";
import spikeFacts from "./spike-facts.json" with { type: "json" };
import { DETACH_STRATEGY_KEY } from "../detach/registry.ts";
import {
  SURVIVES as SPAWN_DETACHED_SURVIVES,
  STRATEGY_ID as SPAWN_DETACHED_ID,
} from "../detach/spawn-detached.ts";
import {
  STRATEGY_ID as FOREGROUND_ID,
  SURVIVES as FOREGROUND_SURVIVES,
} from "../detach/foreground.ts";

/** The requirements these checks carry. */
export const DETACH_CHECK_REQUIREMENTS = ["F122-FR-003", "F122-FR-041"] as const;

/**
 * The ids. *Ids are never renamed* (EP-14, `CORE_GUARANTEES`), and each carries
 * a HYPHEN in its middle segment, which is what makes a dotted literal a check
 * id and never a configuration key (§K.2 rule 1) — `runtime.detach.strategy`
 * IS a key (row 113 of annex X §X.7) and a check of that name would shadow it.
 */
export const DETACH_ID_CHECK_ID = "runtime.detach-strategy.id" as const;
export const DETACH_SURVIVES_CHECK_ID = "runtime.detach-strategy.survives" as const;
export const DETACH_SPIKE_CHECK_ID = "runtime.detach-strategy.session-end-survival" as const;

/** The three ids, in the order they are registered. */
export const DETACH_CHECK_IDS = [
  DETACH_ID_CHECK_ID,
  DETACH_SURVIVES_CHECK_ID,
  DETACH_SPIKE_CHECK_ID,
] as const;

/** Where in the doctor's order these three run, after the lock's five. */
export const DETACH_CHECK_FIRST_ORDER = 240 as const;

/** F122-FR-041 — none of the three refuses a launch; see the header. */
export const DETACH_CHECKS_THAT_BLOCK_A_LAUNCH: readonly string[] = Object.freeze([]);

/** The key the strategy in use arrives under in the injected probes. */
export const STRATEGY_PROBE_KEY = "detachStrategy" as const;
/** And the description, where a caller resolved the strategy already. */
export const DESCRIPTION_PROBE_KEY = "detachStrategyDescription" as const;
/** The host the facts are matched against; a test pins it. */
export const HOST_PROBE_KEY = "detachHost" as const;

/** The three closed members of what a strategy may survive (F122-FR-003). */
export const SURVIVAL_MEMBERS = ["parent-end", "session-end", "reboot"] as const;

/** F122-FR-003 — no Wave 1 strategy claims `reboot`. */
export const A_WAVE_1_STRATEGY_CLAIMS_REBOOT = SURVIVES_A_REBOOT_IN_WAVE_1;

/** The survival of a description, as the closed subset of the three members. */
export function survivalSubsetOf(description: StrategyDescription): readonly string[] {
  const out: string[] = [];
  if (description.survives.endOfTheParent) out.push("parent-end");
  if (description.survives.endOfTheHostSession) out.push("session-end");
  if (description.survives.reboot) out.push("reboot");
  return Object.freeze(out);
}

/**
 * The description of a strategy this package ships, by id. Each `survives` is
 * IMPORTED from the strategy itself and never written out again here: a second
 * copy of the claim would let the doctor tell a consumer something the strategy
 * does not claim, and a test could not tell the two apart.
 */
export const SHIPPED_DESCRIPTIONS: Readonly<Record<string, StrategyDescription>> = Object.freeze({
  [SPAWN_DETACHED_ID]: Object.freeze({ id: SPAWN_DETACHED_ID, survives: SPAWN_DETACHED_SURVIVES }),
  [FOREGROUND_ID]: Object.freeze({ id: FOREGROUND_ID, survives: FOREGROUND_SURVIVES }),
});

/* ------------------------------------------------------------------ *
 * F122-FR-041 — the facts of the spike, for THIS host.
 * ------------------------------------------------------------------ */

/** One fact of `./spike-facts.json`, as these checks read it. */
export type SpikeFact = {
  readonly id: string;
  readonly statement: string;
  readonly requirements: readonly string[];
  readonly status: string;
  readonly "verified-on": string | null;
  readonly pin?: {
    readonly os?: { readonly name?: string | null; readonly version?: string | null } | undefined;
    readonly host?: { readonly id?: string | null; readonly version?: string | null } | undefined;
  };
  readonly reason?: string;
};

/** The facts as the file holds them. */
export const FACTS: readonly SpikeFact[] = Object.freeze(
  (spikeFacts as { facts: SpikeFact[] }).facts,
);

/** The `doctor` block of the facts: what the spike's results tell the doctor. */
export const FACTS_DOCTOR = (
  spikeFacts as {
    doctor: {
      sessionEndSurvival: string;
      say: string;
      becauseOf: readonly string[];
      launchRefusalNamesStrategy: string;
      defaultStrategy: string;
      survives: readonly string[];
    };
  }
).doctor;

/** F122-FR-041 — the two statuses a fact can carry about this host. */
export const VERIFIED = "verified-local" as const;
export const UNVERIFIED = "unverified" as const;

/** F122-FR-041 — the requirement whose fact answers "survives a session end". */
export const SESSION_END_REQUIREMENT = "F122-FR-001" as const;

/** This host, as a fact's pin names one. */
export type Host = { readonly os: string; readonly osVersion: string; readonly name: string };

/** This machine. */
export function thisHost(): Host {
  return Object.freeze({ os: type(), osVersion: release(), name: hostname() });
}

/**
 * True where a fact was verified ON THIS HOST: its status says verified, it
 * carries a `verified-on` date, and its version pin matches this machine.
 *
 * The pin is the whole point of F122-FR-041 — *the results of the spike MUST
 * bind the product as facts with a `verified-on` date and a version pin*. A
 * fact verified on another machine says nothing about this one, so a pin that
 * does not match is as good as no fact at all, which is what makes the answer
 * `unverified` **for that host** and not merely `unverified` in general.
 *
 * WHICH FIELD IS MATCHED, and why only one. A fact's pin carries two names of
 * the operating system: `version`, which is the kernel release the spike read
 * from the machine, and `name`, which is the distribution. The kernel release
 * is what `release()` of the platform answers, so it is comparable; the
 * distribution name is not — this platform does not report it, and a fact that
 * read it from `/etc/os-release` would never equal anything a check could ask
 * for. So the version is MATCHED and the name is only REQUIRED TO BE THERE, so
 * that a fact without a pin cannot pass as a pinned one. A check that matched
 * both would answer `unverified` on the very host the spike was run on, which
 * is worse than a check that matches the field that can be read.
 */
export function factHoldsOnThisHost(fact: SpikeFact, host: Host = thisHost()): boolean {
  if (fact.status !== VERIFIED) return false;
  if (fact["verified-on"] === null || fact["verified-on"] === undefined) return false;
  const pinned = fact.pin?.os;
  if (pinned === undefined) return false;
  // A pin without a distribution name is not a pin (F122-FR-041).
  if (typeof pinned.name !== "string" || pinned.name.length === 0) return false;
  if (typeof pinned.version !== "string" || pinned.version.length === 0) return false;
  return pinned.version === host.osVersion;
}

/**
 * F122-FR-041 — the fact of survival of a session end for this host, or `null`
 * where this host has none.
 */
export function sessionEndFactFor(host: Host = thisHost()): SpikeFact | null {
  for (const fact of FACTS) {
    if (!fact.requirements.includes(SESSION_END_REQUIREMENT)) continue;
    if (factHoldsOnThisHost(fact, host)) return fact;
  }
  return null;
}

/** What a probe of these three checks observed. */
export type DetachProbe = {
  readonly strategyId: string;
  readonly description: StrategyDescription | null;
  readonly survives: readonly string[];
  readonly host: Host;
  /** F122-FR-041 — the fact for this host, or `null` where there is none. */
  readonly sessionEndFact: SpikeFact | null;
  /** `verified-local` or `unverified`, for this host. */
  readonly sessionEndSurvival: string;
};

/** Read the host out of the injected probes; this machine where none is given. */
export function hostFrom(injected: Readonly<Record<string, unknown>>): Host {
  const value = injected[HOST_PROBE_KEY] as Partial<Host> | undefined;
  if (value === undefined || typeof value.os !== "string" || typeof value.osVersion !== "string") {
    return thisHost();
  }
  return Object.freeze({
    os: value.os,
    osVersion: value.osVersion,
    name: typeof value.name === "string" ? value.name : hostname(),
  });
}

/** Take the one reading the three checks share. */
export function probeTheStrategy(injected: Readonly<Record<string, unknown>>): DetachProbe {
  const given = injected[STRATEGY_PROBE_KEY];
  const strategyId = typeof given === "string" && given.length > 0 ? given : DEFAULT_STRATEGY;
  const describedBy = injected[DESCRIPTION_PROBE_KEY] as StrategyDescription | undefined;
  const description = describedBy ?? SHIPPED_DESCRIPTIONS[strategyId] ?? null;
  const host = hostFrom(injected);
  const fact = sessionEndFactFor(host);
  return Object.freeze({
    strategyId,
    description,
    survives: description === null ? Object.freeze([]) : survivalSubsetOf(description),
    host,
    sessionEndFact: fact,
    // F122-FR-041 — with no fact for this host the answer is `unverified`,
    // whatever the strategy's own claim is.
    sessionEndSurvival: fact === null ? UNVERIFIED : VERIFIED,
  });
}

const reading = (observed: unknown): DetachProbe | null =>
  (observed as DetachProbe | undefined) ?? null;

/* ------------------------------------------------------------------ *
 * The three severities.
 * ------------------------------------------------------------------ */

/** The id in use. `info` where it is known, `warn` where no strategy answered. */
export function idSeverity(observed: unknown): Severity {
  const r = reading(observed);
  if (r === null) return "warn";
  return r.description === null ? "warn" : "info";
}

/**
 * What it survives. `info` where the strategy described itself; `warn` where it
 * did not, and `warn` too where a Wave 1 strategy claims `reboot`, which
 * F122-FR-003 forbids.
 */
export function survivesSeverity(observed: unknown): Severity {
  const r = reading(observed);
  if (r === null || r.description === null) return "warn";
  return r.survives.includes("reboot") ? "warn" : "info";
}

/**
 * F122-FR-041 — survival of the end of a session. `ok` only where a fact of the
 * spike was verified on THIS host; `warn` otherwise, and the evidence says
 * `unverified`.
 */
export function sessionEndSeverity(observed: unknown): Severity {
  const r = reading(observed);
  if (r === null) return "warn";
  return r.sessionEndSurvival === VERIFIED ? "ok" : "warn";
}

/* ------------------------------------------------------------------ *
 * The evidence of each finding.
 * ------------------------------------------------------------------ */

/** The id of the strategy in use, and the key that names it. */
export function idEvidence(observed: unknown): string {
  const r = reading(observed);
  if (r === null) return `no detach strategy was given to the check (\`${DETACH_STRATEGY_KEY}\`)`;
  return `strategy=${r.strategyId} key=${DETACH_STRATEGY_KEY} described=${r.description !== null}`;
}

/** What the strategy claims to survive, as the closed subset of the three. */
export function survivesEvidence(observed: unknown): string {
  const r = reading(observed);
  if (r === null || r.description === null) {
    return `the strategy did not describe itself, so what it survives is unknown`;
  }
  return (
    `strategy=${r.strategyId} survives=` +
    `${r.survives.length === 0 ? "(nothing)" : r.survives.join(",")} ` +
    `reboot=${r.survives.includes("reboot")}`
  );
}

/**
 * F122-FR-041 — the sentence for this host. Where there is no fact it is the
 * word `unverified`, the host it is unverified ON, and why.
 */
export function sessionEndEvidence(observed: unknown): string {
  const r = reading(observed);
  if (r === null) return `no detach strategy was given to the check`;
  if (r.sessionEndFact !== null) {
    return (
      `sessionEndSurvival=${VERIFIED} host=${r.host.os}/${r.host.osVersion} ` +
      `fact=${r.sessionEndFact.id} verified-on=${r.sessionEndFact["verified-on"]}`
    );
  }
  return (
    `sessionEndSurvival=${UNVERIFIED} host=${r.host.os}/${r.host.osVersion} ` +
    `strategy=${r.strategyId} because="${FACTS_DOCTOR.becauseOf.join("; ")}" ` +
    `next=${STRATEGY_WITHOUT_DETACHING}`
  );
}

/* ------------------------------------------------------------------ *
 * The checks.
 * ------------------------------------------------------------------ */

export const ID_MESSAGE_TEMPLATE =
  `the id of the detach strategy in use; the key \`${DETACH_STRATEGY_KEY}\` names it and an ` +
  `unknown id is a configuration error, exit 3 (F122-FR-002)`;

export const SURVIVES_MESSAGE_TEMPLATE =
  `what the detach strategy in use survives, as a subset of \`parent-end\`, \`session-end\`, ` +
  `\`reboot\`; no Wave 1 strategy claims a reboot (F122-FR-003)`;

export const SPIKE_MESSAGE_TEMPLATE =
  `whether survival of the end of a host session is verified on THIS host by a fact of the ` +
  `detach spike; without one it is unverified (F122-FR-041)`;

export const ID_FIX_HINT = `nothing to fix; set \`${DETACH_STRATEGY_KEY}\` to use another registered strategy`;

export const SURVIVES_FIX_HINT =
  `use \`${STRATEGY_WITHOUT_DETACHING}\` where the default does not survive what your host does ` +
  `to a process tree`;

export const SPIKE_FIX_HINT =
  `run the cases of the detach spike on this host (\`spikes/122-detach/run.js\`) and record the ` +
  `results, or use \`${STRATEGY_WITHOUT_DETACHING}\``;

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
    lb: DETACH_CHECKS_THAT_BLOCK_A_LAUNCH.includes(id),
    order,
    probe: (injected: Readonly<Record<string, unknown>>): Promise<unknown> =>
      Promise.resolve(probeTheStrategy(injected)),
    messageTemplate,
    fixHint,
  });
}

export const detachStrategyIdCheck: DoctorCheck = check(
  DETACH_ID_CHECK_ID,
  idSeverity,
  DETACH_CHECK_FIRST_ORDER,
  ID_MESSAGE_TEMPLATE,
  ID_FIX_HINT,
);

export const detachStrategySurvivesCheck: DoctorCheck = check(
  DETACH_SURVIVES_CHECK_ID,
  survivesSeverity,
  DETACH_CHECK_FIRST_ORDER + 1,
  SURVIVES_MESSAGE_TEMPLATE,
  SURVIVES_FIX_HINT,
);

export const detachSessionEndSurvivalCheck: DoctorCheck = check(
  DETACH_SPIKE_CHECK_ID,
  sessionEndSeverity,
  DETACH_CHECK_FIRST_ORDER + 2,
  SPIKE_MESSAGE_TEMPLATE,
  SPIKE_FIX_HINT,
);

/** The three checks, in the order they are registered. */
export const DETACH_CHECKS: readonly DoctorCheck[] = Object.freeze([
  detachStrategyIdCheck,
  detachStrategySurvivesCheck,
  detachSessionEndSurvivalCheck,
]);

/** The evidence of a check, by id. */
export const EVIDENCE_OF: Readonly<Record<string, (observed: unknown) => string>> = Object.freeze({
  [DETACH_ID_CHECK_ID]: idEvidence,
  [DETACH_SURVIVES_CHECK_ID]: survivesEvidence,
  [DETACH_SPIKE_CHECK_ID]: sessionEndEvidence,
});

// The cap of §G.7 is checked at load, so a template that grew past 200 bytes
// fails in a test run and never in a consumer's terminal.
for (const one of DETACH_CHECKS) {
  const bytes = Buffer.byteLength(one.messageTemplate, "utf8");
  if (bytes > MESSAGE_TEMPLATE_CAP_BYTES) {
    throw new Error(
      `the message template of the doctor check \`${one.id}\` is ${bytes} bytes and the cap ` +
        `of annex G §G.7 is ${MESSAGE_TEMPLATE_CAP_BYTES}`,
    );
  }
}

/** F122-FR-003, F122-FR-041 — register the three checks. */
export function registerDetachChecks(registry: DoctorRegistry): readonly DoctorCheck[] {
  for (const one of DETACH_CHECKS) registry.register(one);
  return DETACH_CHECKS;
}
