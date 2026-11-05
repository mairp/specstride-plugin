/**
 * T001 — the verification record of the host facts of this plugin
 * (F113-FR-035: every host fact carries a `verified-on` date and a version
 * pin, or is `unverified` with the check that would settle it).
 *
 * T001 of `specs/113-host-claude-code/tasks.md` is a **PAID** live capture on
 * Claude Code 2.1.284: it makes model calls, a person starts it and the run is
 * logged. Under the owner's ruling of 2026-09-30 the paid part is NEVER run
 * and NEVER faked by this specification. The hermetic part, which runs on
 * Linux and calls no model, is this record: the thirteen facts the capture
 * would settle, each `unverified` with its reason, its pin, the declared
 * fallback that applies while it is unverified, and the requirements whose
 * facts it carries.
 *
 * T001 is a precondition of no test and of no other task: until the capture
 * has been run the facts stay `unverified` and `fallback` of each row is what
 * the plugin does (tasks.md, T001; plan.md, the design point "Push alert").
 *
 * The six capability facts take their fallback from
 * `@specstride/contracts/ep/host`, the machine-readable form of the table of
 * annex H §H.1, so the record and the annex cannot drift. The import is a
 * BUILD-time import of the one package this one may import (package graph:
 * `"@specstride/contracts (at build time only)"`); no module under
 * `src/shim/` imports anything, which the rule file
 * `tools/import-boundary/rules/113-host-claude-code-build-time-only.json`
 * enforces.
 */
import { CAPABILITIES, fallbackOf } from "@specstride/contracts/ep/host";

/** The host the facts are about, and the version they are pinned to (F113-FR-035). */
export const HOST_NAME = "Claude Code" as const;
export const HOST_VERSION_PIN = "2.1.284" as const;
/** The pin as the record writes it in every row. */
export const HOST_PIN = `${"claude-code"}@${HOST_VERSION_PIN}` as const;

/** The status of a host fact: settled by a capture, or still open. */
export const FACT_STATUSES = ["verified", "unverified"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

/** Why a fact is `unverified`; `paid-probe` is the one reason T001 uses. */
export const UNVERIFIED_REASONS = ["paid-probe", "documentation-only", "macos", "detach"] as const;
export type UnverifiedReason = (typeof UNVERIFIED_REASONS)[number];

/**
 * The one reason of T001, as prose: the owner's ruling of 2026-09-30. It is
 * written once and cited by every row, so no row can soften it.
 */
export const PAID_PROBE_REASON =
  "PAID live capture on Claude Code 2.1.284: it makes model calls, a person starts it and " +
  "the run is logged. Under the owner's ruling of 2026-09-30 a paid probe is never run and " +
  "never faked by this specification, so the fact stays `unverified` and the declared " +
  "fallback applies (tasks.md T001; assumption CQ-188).";

/** One row of the verification record (data-model.md, "Capability declaration"; F113-FR-035). */
export type HostFact = {
  /** The id of the fact inside this record. */
  readonly id: string;
  /** The fact the capture would settle, as T001 names it. */
  readonly fact: string;
  /** The version pin the fact is recorded against (F113-FR-035). */
  readonly pin: string;
  /** `verified` or `unverified`. */
  readonly status: FactStatus;
  /** The date of the capture, or `null` while the fact is `unverified`. */
  readonly verifiedOn: string | null;
  /** Why the fact is `unverified`; `undefined` once it is verified. */
  readonly unverifiedReason?: UnverifiedReason;
  /** The reason as prose, for the record and for the doctor. */
  readonly reason: string;
  /** What the plugin does while the fact is `unverified` (tasks.md, T001). */
  readonly fallback: string;
  /** The requirements whose facts this row carries (tasks.md, T001, "verifies the facts of"). */
  readonly requirements: readonly string[];
};

/** A row as `unverified` for the one reason of T001: the paid probe. */
function paid(
  id: string,
  fact: string,
  fallback: string,
  requirements: readonly string[],
): HostFact {
  return Object.freeze({
    id,
    fact,
    pin: HOST_PIN,
    status: "unverified" as const,
    verifiedOn: null,
    unverifiedReason: "paid-probe" as const,
    reason: PAID_PROBE_REASON,
    fallback,
    requirements: Object.freeze([...requirements]),
  });
}

/**
 * The thirteen facts of T001, in the order T001 names them. Every row is
 * `unverified`: no row of this record may claim a capture that was not run.
 */
export const HOST_FACTS: readonly HostFact[] = Object.freeze([
  paid(
    "re-waking-host-hook-lifetime",
    "the lifetime and the re-arming of a re-waking host hook",
    "The host's monitor is the primary way of a push alert, and no run and no alert of " +
      '`status` or the digest depends on it (plan.md, the design point "Push alert"; R3v C2).',
    ["F113-FR-026"],
  ),
  paid(
    "host-hook-search-path-for-bin",
    "the search path of host hooks for `bin`",
    "The shim resolves the CLI itself, in the order explicit variable, search path, the " +
      "package the plugin was published with, and fetches, installs and updates nothing.",
    ["F113-FR-018"],
  ),
  paid(
    "host-hook-numeric-limits",
    "the numeric limits of host hook events",
    "The shims read one precomputed file and print one line; nothing of a run depends on a " +
      "host hook, so a limit the host enforces costs no correctness.",
    ["F113-FR-021", "F113-FR-024"],
  ),
  paid(
    "session-start-on-resume-and-compact",
    "the firing of session start on resume and on compaction",
    "The shim compares the marker of the last injected state in the host's plugin data " +
      "directory and prints only when the state changed; a missing or damaged marker causes " +
      "one more line and nothing else.",
    ["F113-FR-021"],
  ),
  paid(
    "host-limit-events",
    "the host limit events",
    "A limit event the host observes is written through the CLI as an inbox request of type " +
      "`host-event`; an event the host does not offer is simply never written, and the run's " +
      "harness quota comes from its adapter.",
    ["F113-FR-024"],
  ),
  paid(
    "tier-1-child",
    "a Tier 1 child: whether the plugin's host hooks load in it",
    "The harness adapter switches the customizations off, and as a second guard every shim " +
      "prints nothing when it runs inside a child of a run.",
    ["F113-FR-027"],
  ),
  paid(
    "background-session-isolation",
    "the isolation setting of background sessions",
    "The host's own background job mode is rejected as the runtime; the doctor warns when it " +
      "isolates the working tree.",
    ["F113-FR-032"],
  ),
  paid(
    "manifest-options-version-floor",
    "the version floor of the `options` field of the manifest",
    "The specification uses no user-configuration `options` field, so no version floor above " +
      "the pinned host version is claimed (R3v P31; clarification of 2026-09-29).",
    ["F113-FR-030"],
  ),
  paid(
    "marketplace-entry-exact-version",
    "whether a marketplace entry can pin one exact version",
    "The marketplace entry and the documentation name the exact package and the exact " +
      "version and no range; where the host cannot pin it, the documentation names the " +
      "version and the release check of F100-FR-236 still covers the plugin directory.",
    ["F113-FR-042"],
  ),
  paid(
    "plugin-entry-npm-source-and-version-rule",
    "the npm source and the version rule of a plugin entry",
    "One published package holds the plugin directory with an explicit plugin version equal " +
      "to the package version; a marketplace cannot itself come from npm (documentation " +
      "only, R3v P26).",
    ["F113-FR-030", "F113-FR-042"],
  ),
  paid(
    "first-audience-notice",
    "the first audience notice: when `distributed` first shows",
    'The skill tells the consumer once and never sets the key; the marker of "once" is ' +
      "state of the host, and a missing or damaged marker causes only that the notice is " +
      "printed once more.",
    ["F113-FR-016"],
  ),
  paid(
    "six-capabilities-of-the-host",
    "the six capabilities of the host, as the host reports them",
    `Each absent capability uses its declared fallback of annex H §H.1: ${CAPABILITIES.map(
      (c) => `\`${c}\` → ${fallbackOf(c)}`,
    ).join("; ")}.`,
    ["F113-FR-028"],
  ),
  paid(
    "run-ended-by-a-usage-limit",
    "a run ended by a usage limit",
    "A run ended by a usage limit and an interrupted run are reported as not scored and never " +
      "count as a score failure; exit 130 and 143 are interruptions.",
    ["F113-FR-039"],
  ),
]);

/** The ids of the thirteen facts, in the order of T001. */
export const HOST_FACT_IDS: readonly string[] = Object.freeze(HOST_FACTS.map((f) => f.id));

/** The eleven requirements T001 carries the facts of ("verifies the facts of"). */
export const REQUIREMENTS_OF_T001: readonly string[] = Object.freeze([
  "F113-FR-016",
  "F113-FR-018",
  "F113-FR-021",
  "F113-FR-024",
  "F113-FR-026",
  "F113-FR-027",
  "F113-FR-028",
  "F113-FR-030",
  "F113-FR-032",
  "F113-FR-039",
  "F113-FR-042",
]);

/** The row of a fact id, or `undefined`. */
export function factOf(id: string): HostFact | undefined {
  return HOST_FACTS.find((f) => f.id === id);
}

/** The rows that are still `unverified`; while T001 is unrun, that is every row. */
export function unverifiedFacts(): readonly HostFact[] {
  return Object.freeze(HOST_FACTS.filter((f) => f.status === "unverified"));
}

/** True while the paid capture of T001 has not been run: no row is `verified`. */
export function liveCaptureIsUnrun(): boolean {
  return HOST_FACTS.every((f) => f.status === "unverified");
}

/** The fallback that applies while a fact is `unverified` (tasks.md, T001). */
export function fallbackWhileUnverified(id: string): string {
  const fact = factOf(id);
  if (fact === undefined) {
    throw new Error(`the verification record of feature 113 holds no host fact \`${id}\``);
  }
  return fact.fallback;
}

/* -------------------------------------------------------------------------
 * F113-FR-035 — the three other classes of `unverified`
 * ---------------------------------------------------------------------- */

/**
 * F113-FR-035 names three classes of fact that are `unverified` for a reason
 * that is NOT the paid probe of T001: "A fact that rests on DOCUMENTATION
 * ONLY, all MACOS behaviour and DETACH SURVIVAL inside a host session are
 * `unverified`." `UNVERIFIED_REASONS` already carries their three reasons;
 * these are the rows, written here so that the whole record of the plugin is
 * one list and every row of it carries a `verified-on` cell and a pin.
 *
 * The rows are not facts of T001: `HOST_FACTS` stays the thirteen of T001,
 * and `EVERY_HOST_FACT` below is the record F113-FR-035 is about.
 */
export const DOCUMENTATION_ONLY_REASON =
  "The fact rests on the host's documentation only; no capture of this repository observed " +
  "it. F113-FR-035 therefore records it as `unverified`, and the plugin takes the path that " +
  "holds either way.";

/** The reason of every macOS row: Linux is the validated platform of Wave 1. */
export const MACOS_REASON =
  'Every statement about macOS is `unverified` (spec.md, "Constraints"; decision 12, ' +
  "ruling 67). The macOS runner run of the startup check is task T032, which the owner's " +
  "ruling of 2026-09-30 leaves out of band: it is never run and never faked here.";

/** The reason of the detach row: it needs a live host session. */
export const DETACH_REASON =
  "Survival of a detached run inside a host session can be observed on a LIVE host only. " +
  "F113-FR-034 therefore reports the case as a skip with its reason everywhere else, never " +
  "as a pass (Principle XVII); whether it survives is the spike of feature 122.";

/** A row as `unverified` for one of the three other reasons of F113-FR-035. */
function declared(
  id: string,
  fact: string,
  unverifiedReason: UnverifiedReason,
  reason: string,
  fallback: string,
  requirements: readonly string[],
): HostFact {
  return Object.freeze({
    id,
    fact,
    pin: HOST_PIN,
    status: "unverified" as const,
    verifiedOn: null,
    unverifiedReason,
    reason,
    fallback,
    requirements: Object.freeze([...requirements]),
  });
}

/**
 * The rows of the three other classes of F113-FR-035, in the order the
 * requirement names the classes: documentation only, macOS, detach survival.
 */
export const DECLARED_FACTS: readonly HostFact[] = Object.freeze([
  declared(
    "host-plugin-validate-command",
    "the host CLI's own strict validation of a plugin directory (`claude plugin validate`) " +
      "and its reporting command (`claude plugin details`)",
    "documentation-only",
    DOCUMENTATION_ONLY_REASON,
    "The build runs its OWN strict validation of the plugin directory, which needs no host " +
      "CLI; where the host CLI is on the search path the build runs it as well, and where it " +
      "is absent that one step is a skip with its reason and never a pass (Principle XVII).",
    ["F113-FR-030"],
  ),
  declared(
    "marketplace-cannot-come-from-npm",
    "that a marketplace cannot itself come from npm, while a plugin ENTRY inside it can name " +
      "an npm source (R3v P26)",
    "documentation-only",
    DOCUMENTATION_ONLY_REASON,
    "The build writes the marketplace entry as a FILE of the plugin directory, with the npm " +
      "source naming the exact package and the exact version and no range; where the entry is " +
      "hosted is outside this package, and no step of the build publishes a marketplace.",
    ["F113-FR-030", "F113-FR-042"],
  ),
  declared(
    "macos-startup-check",
    "the startup check of the context-cost build on a macOS runner",
    "macos",
    MACOS_REASON,
    "Linux is the platform every check of this repository runs on; the macOS result is " +
      "recorded as `unverified` until a macOS runner has passed it (T032).",
    ["F113-FR-035", "F113-FR-037"],
  ),
  declared(
    "detach-survival-inside-a-host-session",
    "survival of a detached run after the host session ends",
    "detach",
    DETACH_REASON,
    "The conformance suite reports the case as a SKIP with its reason; no target of the " +
      "suite is a live host, and no other case of the suite depends on it.",
    ["F113-FR-034", "F113-FR-035"],
  ),
]);

/** The ids of the four declared rows, in the order of F113-FR-035. */
export const DECLARED_FACT_IDS: readonly string[] = Object.freeze(DECLARED_FACTS.map((f) => f.id));

/**
 * F113-FR-035 — EVERY host fact in the plugin: the thirteen of T001 and the
 * four rows of the three other classes. Every row carries a `verified-on`
 * cell and a version pin.
 */
export const EVERY_HOST_FACT: readonly HostFact[] = Object.freeze([
  ...HOST_FACTS,
  ...DECLARED_FACTS,
]);

/** The row of any fact id of the whole record, or `undefined`. */
export function everyFactOf(id: string): HostFact | undefined {
  return EVERY_HOST_FACT.find((f) => f.id === id);
}

/**
 * F113-FR-035 — true when every row of the whole record carries a pin and
 * either a `verified-on` date or the reason it is `unverified`. A row that
 * claims neither fails this, which is what CT-113-135 reads.
 */
export function everyFactIsRecorded(): boolean {
  return EVERY_HOST_FACT.every(
    (f) =>
      f.pin === HOST_PIN &&
      ((f.status === "verified" && typeof f.verifiedOn === "string" && f.verifiedOn !== "") ||
        (f.status === "unverified" &&
          f.verifiedOn === null &&
          f.unverifiedReason !== undefined &&
          f.reason.length > 0)),
  );
}

/** The rows of one reason, for a reader of the record (F113-FR-035). */
export function factsByReason(reason: UnverifiedReason): readonly HostFact[] {
  return Object.freeze(EVERY_HOST_FACT.filter((f) => f.unverifiedReason === reason));
}
