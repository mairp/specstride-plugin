/**
 * T016, T017 and T018 of `specs/113-host-claude-code/tasks.md` — the host hook
 * CONFIGURATION of this plugin, the four thin shell shims, the push-alert way
 * and the silence inside a child of a run (F113-FR-020 to F113-FR-027).
 *
 * The four events are the ones `describe` already declares (`./describe/`,
 * T005): session start, prompt submission, the guardrail before a shell
 * command, and a limit event the host observes. F113-FR-025 registers NO host
 * hook on stop and none after a tool use that injects context, and
 * `NEVER_REGISTERED_HOST_SPELLINGS` names the host's spelling of each of those
 * two so that their ABSENCE from the configuration is observable.
 *
 * The plugin directory is a BUILD OUTPUT (plan.md, "Structure Decision"), and
 * CT-100-130 allows only `.ts` and `.json` among a package's shipped files, so
 * no shim is committed: `writePluginHooks()` emits them, exactly as
 * `renderShim()` emits the executable shim of T007.
 *
 * How F113-FR-020 is read here, because the requirement has two clauses:
 * "Host hooks MUST be thin shims that print a file the runtime precomputed, OR
 * a line the CLI prints. A host hook MUST NOT start the runtime platform, the
 * status shim MUST NOT depend on a start of the runtime platform". The two
 * STATUS shims take the first clause: they read one precomputed file and start
 * no interpreter at all (`startsTheRuntimePlatform` is false and
 * `invokesTheCli` is false for both). The guardrail and the limit-event shim
 * take the second clause, which F113-FR-023 and F113-FR-024 require of them in
 * so many words ("MUST have the CLI evaluate the launch checks", "MUST be
 * written through the CLI"): they start no interpreter of their own either, and
 * the one process they start is the plugin's own `bin` shim of T007.
 *
 * This module runs in the BUILD, so it may import `@specstride/contracts`
 * (rule RF-113-01 forbids that only under `src/shim/`). Every name, every
 * logical name, every exit code and every environment variable below is READ
 * from the contracts package, never written twice.
 */
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { commandCodeRow } from "@specstride/contracts/codes/commands";
import { environmentAliases } from "@specstride/contracts/envelope/config-validate";
import { LOGICAL_NAMES, holdsLogicalName, rowOf } from "@specstride/contracts/ids/logical-names";
import {
  STATUS_LINE_NAME,
  resolveStatusLine,
} from "@specstride/contracts/ids/logical-names-amendments";
import { VALID_UNTIL_NONE } from "@specstride/contracts/state/handshake";
import { keysOfTheStatusLine } from "@specstride/contracts";
import type { HostArtifact } from "@specstride/contracts/ep/host";
import { EVENTS_NEVER_REGISTERED, HOST_HOOK_EVENTS } from "./describe/index.ts";
import { HOST_PIN, factOf, type HostFact } from "./host-facts.ts";
import { SHIM_FILE_NAME } from "./shim/index.ts";

/* -------------------------------------------------------------------------
 * Where the hooks of the plugin lie, and the one line they read
 * ---------------------------------------------------------------------- */

/** The directory of the plugin the host hook shims and their configuration lie in. */
export const HOOKS_DIRECTORY = "hooks" as const;

/** The file of the host hook configuration inside the plugin directory. */
export const HOOK_CONFIG_PATH = `${HOOKS_DIRECTORY}/hooks.json` as const;

/** The file that records the push-alert way of T017 inside the plugin directory. */
export const PUSH_ALERT_PATH = `${HOOKS_DIRECTORY}/push-alert.json` as const;

/**
 * The logical name of the precomputed status line the status shim finds the
 * line through (F113-FR-021, T016). It comes from the table of annex B §B.5
 * and is never spelled out here.
 */
export const STATUS_LINE_LOGICAL_NAME = STATUS_LINE_NAME;

/**
 * The place of that line UNDER THE CONTROL ROOT, taken from the resolver of
 * annex B §B.5 rather than written by hand: its place depends on the real path
 * of the workspace only, so a shell shim finds it without starting the product
 * (F100-FR-229, `STATUS_LINE_RULE`).
 */
export const STATUS_LINE_UNDER_CONTROL_ROOT = resolveStatusLine({ "<control>": "" }).replace(
  /^\/+/,
  "",
);

/** The variable that names the control root (`state.dir`, the alias table of annex X §X.8). */
export const CONTROL_ROOT_VARIABLE = "SPECSTRIDE_STATE_DIR" as const;

/**
 * The line a shim prints when the precomputed line is past its `validUntil`:
 * "A line past `validUntil` MUST say that the state is unknown"
 * (F113-FR-021). It follows the product-line grammar of annex G §G.3, and
 * `EXPIRED_STATUS_LINE` of annex F §F.5 is what it says.
 */
export const STATE_UNKNOWN_LINE = "[SPECSTRIDE-STATE] st=unknown reason=stale" as const;

/** The value of `validUntil` for a run that rests and has no lease (annex F §F.5). */
export const VALID_UNTIL_WITHOUT_A_LEASE = VALID_UNTIL_NONE;

/**
 * The two keys of the status line the shims compare, row 248 of annex X §X.6
 * (`st` and `ph`): F113-FR-022 prints "unless the state or the phase changed".
 * They are read from the closed set, so a renamed key fails the build.
 */
export const COMPARED_STATUS_KEYS = Object.freeze(["st", "ph"] as const);

/** The key of the status line that carries the validity (row 248). */
export const VALID_UNTIL_KEY = "validUntil" as const;

function assertStatusKeys(): void {
  for (const key of [...COMPARED_STATUS_KEYS, VALID_UNTIL_KEY]) {
    if (!keysOfTheStatusLine.has(key)) {
      throw new Error(`row 248 of annex X §X.6 holds no key \`${key}\` of the status line`);
    }
  }
}

assertStatusKeys();

/* -------------------------------------------------------------------------
 * T018 / F113-FR-027 — silent inside a child of a run
 * ---------------------------------------------------------------------- */

/**
 * F113-FR-027 — "A Tier 1 child of a run MUST NOT load this plugin's host
 * hooks. Its customizations are switched off by the harness adapter, and as a
 * second guard a host hook MUST print nothing when it runs inside a child of a
 * run."
 */
export const CUSTOMIZATIONS_ARE_SWITCHED_OFF_BY = "the harness adapter" as const;

/** The silence of the shims is the SECOND guard, never the first (F113-FR-027). */
export const SILENCE_IS_THE_SECOND_GUARD = true as const;

/** Every shim of this plugin is silent inside a child of a run (T018). */
export const SILENT_INSIDE_A_CHILD_OF_A_RUN = true as const;

/**
 * How a shim knows it runs inside a child of a run: the event context of the
 * run (annex C §C.10) is handed to every process the runtime starts, and the
 * alias table of annex X §X.8 names it. The four names are READ from that
 * table, so a renamed variable fails the build rather than silently making
 * every shim speak inside a child.
 */
export const CHILD_OF_A_RUN_VARIABLES: readonly string[] = (() => {
  const row = environmentAliases.find((alias) => alias.variables.includes("SPECSTRIDE_RUN_ID"));
  if (row === undefined) {
    throw new Error(
      "the alias table of annex X §X.8 names no row with `SPECSTRIDE_RUN_ID`, so a shim cannot " +
        "tell that it runs inside a child of a run (F113-FR-027)",
    );
  }
  return Object.freeze([...row.variables]);
})();

/** The row of the alias table the guard rests on, as the annex writes it. */
export const CHILD_OF_A_RUN_ROW: string =
  environmentAliases.find((alias) => alias.variables.includes("SPECSTRIDE_RUN_ID"))?.asIs ?? "";

/**
 * The host fact of a Tier 1 child, which the PAID capture of T001 would settle
 * and which is `unverified`: while it is, the silence of the shims is what the
 * declared fallback promises.
 */
export const CHILD_OF_A_RUN_FACT = "tier-1-child" as const;

/** True inside a child of a run: any name of the event context is set and non-empty. */
export function insideAChildOfARun(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return CHILD_OF_A_RUN_VARIABLES.some((name) => {
    const value = environment[name];
    return value !== undefined && value !== "";
  });
}

/** The lines of a shim that make it silent inside a child of a run (T018). */
export function silenceGuardLines(): readonly string[] {
  const tests = CHILD_OF_A_RUN_VARIABLES.map((name) => `[ -n "\${${name}:-}" ]`).join(" || ");
  return Object.freeze([
    `# F113-FR-027 (T018) — SILENT inside a child of a run. ${CUSTOMIZATIONS_ARE_SWITCHED_OFF_BY}`,
    "# switches the customizations off; this is the second guard. The names are the event",
    `# context of the run, annex C §C.10, as the alias table of annex X §X.8 hands it to every`,
    "# process the runtime starts.",
    `if ${tests}; then`,
    "  exit 0",
    "fi",
  ]);
}

/* -------------------------------------------------------------------------
 * The marker of the last injected state (state of the HOST)
 * ---------------------------------------------------------------------- */

/**
 * The marker of the last injected state (F113-FR-021). It is state of the
 * HOST, as the marker of F113-FR-016 is: no run and no command of the product
 * reads it, annex B §B.5 holds no logical name for it, and a missing or
 * damaged marker causes ONLY that one more line is printed.
 */
export const STATE_MARKER_FILE = "last-injected-state" as const;
export const STATE_MARKER_IS_STATE_OF_THE_HOST = true as const;
export const NO_COMMAND_OF_THE_PRODUCT_READS_THE_STATE_MARKER = true as const;

/**
 * The variable the host names its plugin data directory with. Its name is a
 * HOST fact: the row `session-start-on-resume-and-compact` of the verification
 * record is `unverified` until the PAID capture of T001 has been run, so the
 * shim reads the variable where the host sets it and falls back to a per-user
 * state directory otherwise — which is likewise outside the repository and
 * outside the three roots (data-model.md, "Host marker").
 */
export const MARKER_DIRECTORY_VARIABLE = "CLAUDE_PLUGIN_DATA_DIR" as const;
export const MARKER_DIRECTORY_FACT = "session-start-on-resume-and-compact" as const;
export const MARKER_DIRECTORY_FALLBACK =
  "${XDG_STATE_HOME:-${HOME:-}/.local/state}/specstride/host-claude-code" as const;

/** The shape a readable marker has: the two compared keys of the status line. */
export function markerSignature(state: string, phase: string): string {
  return `${COMPARED_STATUS_KEYS[0]}=${state} ${COMPARED_STATUS_KEYS[1]}=${phase}`;
}

/** What the marker of the host can be when a shim looks at it (data-model.md). */
export const STATE_MARKER_STATES = ["readable", "absent", "damaged"] as const;
export type StateMarkerState = (typeof STATE_MARKER_STATES)[number];

/**
 * F113-FR-021 — a missing or damaged marker MUST cause ONLY that one more line
 * is printed. So an unreadable marker is treated as "nothing was injected
 * yet", which makes the next injection print, and nothing else changes.
 */
export function markerIsReadable(content: string | null): boolean {
  return content !== null && new RegExp(`^${COMPARED_STATUS_KEYS[0]}=`).test(content.trim());
}

/** F113-FR-021 — nothing else changes when the marker is missing or damaged. */
export function stateMarkerFailureChangesAnythingElse(_marker: StateMarkerState): boolean {
  return false;
}

/**
 * True where annex B §B.5 holds a logical name for the marker. It is computed
 * over the table, not asserted: no row of the layout names this file, which is
 * what makes the marker state of the host (F100-FR-053, reported).
 */
export function stateMarkerHasALogicalName(): boolean {
  return LOGICAL_NAMES.some((name) => {
    const row = rowOf(name);
    return row !== undefined && row.path.includes(STATE_MARKER_FILE);
  });
}

/* -------------------------------------------------------------------------
 * T017 / F113-FR-026 — the push alert
 * ---------------------------------------------------------------------- */

/** The two ways a push alert could be delivered (R3v C2, plan.md "Push alert"). */
export const PUSH_ALERT_WAYS = ["monitor", "re-waking-host-hook"] as const;
export type PushAlertWay = (typeof PUSH_ALERT_WAYS)[number];

/**
 * F113-FR-026 — the MONITOR is the primary way. The other way, a re-waking
 * host hook, is allowed only with both conditions of the requirement, and its
 * lifetime and re-arming are a fact of the PAID capture of T001.
 */
export const PRIMARY_PUSH_ALERT_WAY: PushAlertWay = PUSH_ALERT_WAYS[0];

/** The host's monitor, as the `statusSurface` capability of `describe` names it. */
export const MONITOR_IS_THE_HOST_SURFACE = "the host's status line (its monitor)" as const;

/** F113-FR-026 — the two conditions a re-waking host hook would have to meet. */
export const RE_WAKING_HOOK_CONDITIONS: readonly string[] = Object.freeze([
  "an explicit long time limit",
  "re-arming after it fires",
]);

/** The row of the verification record T017 may change the way from (T001). */
export const PUSH_ALERT_FACT = "re-waking-host-hook-lifetime" as const;

/** The task that would settle it; it is PAID and is never run by this specification. */
export const PUSH_ALERT_CHANGES_FROM = "T001" as const;

/** F113-FR-026 — no run and no alert of `status` or the digest depends on the push alert. */
export const NOTHING_DEPENDS_ON_THE_PUSH_ALERT = true as const;
export const ALERTS_THAT_DO_NOT_DEPEND: readonly string[] = Object.freeze([
  "a run",
  "`status`",
  "the digest",
]);

/** What a capture of T001 would report about the re-waking host hook. */
export type PushAlertCapture = {
  /** The row of the verification record, which carries `verified` or `unverified`. */
  readonly fact: HostFact | undefined;
  /** True where the capture reports that an explicit long time limit can be set. */
  readonly longTimeLimit?: boolean;
  /** True where the capture reports that the hook re-arms after it fires. */
  readonly reArmsAfterItFires?: boolean;
};

/**
 * T017 — the way of the push alert. The monitor is the primary way, and the
 * way is changed from the result of T001 ONLY WHEN THAT TASK HAS BEEN RUN:
 * while the row `re-waking-host-hook-lifetime` is `unverified`, a capture that
 * claims both conditions changes nothing, because there is no capture to claim
 * them. Both conditions of F113-FR-026 must hold before the other way is used.
 */
export function pushAlertWay(capture?: PushAlertCapture): PushAlertWay {
  const fact = capture?.fact ?? factOf(PUSH_ALERT_FACT);
  if (fact === undefined || fact.status !== "verified") return PRIMARY_PUSH_ALERT_WAY;
  if (capture?.longTimeLimit !== true || capture?.reArmsAfterItFires !== true) {
    return PRIMARY_PUSH_ALERT_WAY;
  }
  return PUSH_ALERT_WAYS[1];
}

/** True while the way may not be changed, because T001 has not been run. */
export function pushAlertWayIsFixedByTheUnrunCapture(): boolean {
  return factOf(PUSH_ALERT_FACT)?.status !== "verified";
}

/** The record of the push-alert way that the build writes beside the shims. */
export function pushAlertRecord(): Readonly<Record<string, unknown>> {
  const fact = factOf(PUSH_ALERT_FACT);
  return Object.freeze({
    requirement: "F113-FR-026",
    task: "T017",
    ways: [...PUSH_ALERT_WAYS],
    primary: pushAlertWay(),
    surface: MONITOR_IS_THE_HOST_SURFACE,
    alternative: Object.freeze({
      way: PUSH_ALERT_WAYS[1],
      conditions: [...RE_WAKING_HOOK_CONDITIONS],
      registered: false,
      changeFrom: PUSH_ALERT_CHANGES_FROM,
      fact: PUSH_ALERT_FACT,
      factStatus: fact?.status ?? "unverified",
      pin: HOST_PIN,
      fallback: fact?.fallback ?? "",
    }),
    nothingDependsOnIt: NOTHING_DEPENDS_ON_THE_PUSH_ALERT,
    dependsOn: [],
    whatDoesNotDependOnIt: [...ALERTS_THAT_DO_NOT_DEPEND],
  });
}

/* -------------------------------------------------------------------------
 * F113-FR-023 — the guardrail, and F113-FR-024 — the limit event
 * ---------------------------------------------------------------------- */

/** The CLI of the plugin: the executable shim of T007, inside the plugin directory. */
export const PLUGIN_ROOT_VARIABLE = "CLAUDE_PLUGIN_ROOT" as const;
export const CLI_INSIDE_THE_PLUGIN = `bin/${SHIM_FILE_NAME}` as const;

/**
 * F113-FR-023 — the guardrail has the CLI evaluate the launch checks WITHOUT
 * launching. Annex G §G.4 lists no command that evaluates them without
 * launching, which the spec records as a gap of feature 100 (clarification of
 * 2026-09-29, F100-FR-189); the mode that withholds the launch is the one the
 * annex does give, so the guardrail calls `launch` in the mode `dry-run`.
 */
export const GUARDRAIL_ARGUMENTS: readonly string[] = Object.freeze([
  "launch",
  "--mode",
  "dry-run",
]);

/** The exit code of `launch` that means refused (annex G §G.4, read from the table). */
export const LAUNCH_REFUSED_CODE: number = (() => {
  const row = commandCodeRow("launch");
  if (row === undefined || !row.numbers.includes(4)) {
    throw new Error("annex G §G.4 gives no refusal code 4 for `launch` (F113-FR-023)");
  }
  return 4;
})();

/** The one line the guardrail denies with when the CLI printed no line of its own. */
export const GUARDRAIL_DENY_LINE =
  "[SPECSTRIDE-REFUSE] action=launch reason=launch-check-would-refuse" as const;

/** The prefix of a refusal line of the product (annex G §G.3). */
export const REFUSE_PREFIX = "[SPECSTRIDE-REFUSE]" as const;

/** That prefix as a basic regular expression, for the `sed` of the guardrail shim. */
const REFUSE_SED = REFUSE_PREFIX.replace("[", "\\[").replace("]", "\\]");

/**
 * The exit code the host reads as "deny" from a guardrail hook. It is a HOST
 * fact and is `unverified` with the pin: the row `host-hook-numeric-limits` of
 * the verification record carries the facts of the host hook events. Nothing
 * of a run depends on it (F113-FR-020), so the declared fallback — the CLI
 * refuses the same checks itself — covers a host that reads it differently.
 */
export const DENY_EXIT_CODE = 2 as const;

/** F113-FR-023 — the guardrail is defence in depth; the CLI refuses the same checks. */
export const GUARDRAIL_IS_DEFENCE_IN_DEPTH = true as const;

/** F113-FR-023 — the comment MUST NOT override the guardrail, so no comment is passed. */
export const COMMENT_OVERRIDES_THE_GUARDRAIL = false as const;

/**
 * The guardrail passes NONE of the proposed command's arguments to the CLI:
 * the text of a host event is outside text and is DATA, never argv (the
 * constitution, principle III; threats T-09 and T-12). The CLI refuses the
 * same checks with the real arguments when the command actually runs, which is
 * what makes the guardrail defence in depth and not the gate itself.
 */
export const THE_PROPOSED_ARGUMENTS_ARE_PASSED = false as const;

/** The command words of a shell command that launches a run, for the guardrail's match. */
export const LAUNCHING_COMMANDS: readonly string[] = Object.freeze([
  "specstride launch",
  "specstride run",
  "specstride pipeline run",
]);

/** The logical name of the inbox of host events (annex B §B.5 and §B.11). */
export const HOST_EVENTS_INBOX_NAME = "inbox:host-events:<launchId>" as const;

/** The type of the inbox request a limit event becomes (row 21 of annex X §X.6). */
export const HOST_EVENT_REQUEST_TYPE = "host-event" as const;

/**
 * F113-FR-024 — "The host hook MUST NOT write the inbox itself". The layout of
 * annex B §B.5 says the same in its own column, and it is READ here rather
 * than asserted: the writer of the inbox of host events is the CLI on behalf
 * of a host.
 */
export const HOST_EVENTS_INBOX_WRITER: string = (() => {
  if (!holdsLogicalName(HOST_EVENTS_INBOX_NAME)) {
    throw new Error(`annex B §B.5 holds no logical name \`${HOST_EVENTS_INBOX_NAME}\``);
  }
  return rowOf(HOST_EVENTS_INBOX_NAME)?.writer ?? "";
})();

/** F113-FR-024 — the shim writes no inbox file; the CLI does, on behalf of the host. */
export const THE_SHIM_WRITES_THE_INBOX = false as const;

/** F113-FR-024 — the limit-event hook injects no context: it prints nothing. */
export const THE_LIMIT_EVENT_HOOK_INJECTS_CONTEXT = false as const;

/** The command of the CLI that writes a host event (annex G §G.4, read from the table). */
export const HOST_EVENT_COMMAND: readonly string[] = (() => {
  const row = commandCodeRow("host event");
  if (row === undefined) {
    throw new Error("annex G §G.4 holds no command `host event` (F113-FR-024)");
  }
  return Object.freeze(row.commands[0]?.split(" ") ?? []);
})();

/** The two flags the shim hands the command: the `kind` and the redacted `data`. */
export const HOST_EVENT_KIND_FLAG = "--kind" as const;
export const HOST_EVENT_DATA_FLAG = "--data" as const;

/**
 * The fields of a limit event of the host that pass REDACTION, besides the
 * kind. The fields of the host's limit events are a fact of the PAID capture
 * of T001 (`host-limit-events`), so the list is an ALLOW-LIST: a field that is
 * not named here never leaves the host, and neither does a value that carries
 * anything but the safe characters of `REDACTED_VALUE_PATTERN`.
 */
export const HOST_EVENT_ALLOWED_FIELDS: readonly string[] = Object.freeze([
  "limit",
  "resetsAt",
  "retryAfter",
  "scope",
]);

/** The characters a redacted value may carry; everything else is dropped. */
export const REDACTED_VALUE_PATTERN = "[A-Za-z0-9:._+-]*" as const;

/** The characters a kind may carry. */
export const KIND_PATTERN = "[A-Za-z0-9._-]*" as const;

function firstMatch(text: string, field: string, characters: string): string {
  const pattern = new RegExp(`"${field}"[ ]*:[ ]*"?(${characters})"?`);
  return pattern.exec(text)?.[1] ?? "";
}

/**
 * The redaction of F113-FR-024, as TypeScript: the `kind` and the allow-listed
 * fields with safe values, and nothing else. The shim performs the same
 * extraction with `sed`, and a test holds the two against each other by
 * reading the arguments a stub CLI recorded.
 */
export function redactHostEvent(event: string): {
  readonly kind: string;
  readonly data: string;
} {
  const kind = firstMatch(event, "kind", KIND_PATTERN);
  const pairs: string[] = [];
  for (const field of HOST_EVENT_ALLOWED_FIELDS) {
    const value = firstMatch(event, field, REDACTED_VALUE_PATTERN);
    if (value !== "") pairs.push(`"${field}":"${value}"`);
  }
  return Object.freeze({ kind, data: `{${pairs.join(",")}}` });
}

/* -------------------------------------------------------------------------
 * F113-FR-025 — the events this plugin registers NO host hook on
 * ---------------------------------------------------------------------- */

/**
 * The host's spelling of the two events of F113-FR-025. They are named ONLY so
 * that their absence from the configuration is observable: the plugin
 * registers no host hook on stop and none after a tool use that injects
 * context.
 */
export const NEVER_REGISTERED_HOST_SPELLINGS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    stop: Object.freeze(["Stop", "SubagentStop"]),
    "after-tool-use-that-injects-context": Object.freeze(["PostToolUse"]),
  });

/** Every host spelling the configuration must not hold (F113-FR-025). */
export const NEVER_REGISTERED_SPELLINGS: readonly string[] = Object.freeze(
  EVENTS_NEVER_REGISTERED.flatMap((id) => [...(NEVER_REGISTERED_HOST_SPELLINGS[id] ?? [])]),
);

/* -------------------------------------------------------------------------
 * The four shims
 * ---------------------------------------------------------------------- */

/** The ids of the four events, in the order of F113-FR-021 to F113-FR-024. */
export const HOOK_EVENT_IDS: readonly string[] = Object.freeze(HOST_HOOK_EVENTS.map((e) => e.id));

/** The two events whose shim prints the precomputed status line. */
export const STATUS_EVENT_IDS: readonly string[] = Object.freeze([
  "session-start",
  "prompt-submit",
]);

/** The path of the shim of an event inside the plugin directory. */
export function hookShimPath(eventId: string): string {
  if (!HOOK_EVENT_IDS.includes(eventId)) {
    throw new Error(`this plugin registers no host hook event \`${eventId}\` (F113-FR-025)`);
  }
  return `${HOOKS_DIRECTORY}/${eventId}.sh`;
}

/**
 * The host's own spelling of the tool the guardrail stands before: a shell
 * command (F113-FR-023). It is a HOST fact, `unverified` with the pin until
 * the PAID capture of T001 has been run; where the host matches differently,
 * the hook simply never fires and the CLI refuses the same checks itself.
 */
export const HOOK_MATCHERS: Readonly<Record<string, string>> = Object.freeze({
  "guard-before-shell": "Bash",
});

/**
 * The time limit of each event, in seconds, declared EXPLICITLY: "a host hook
 * MUST keep to its time limit" (F113-FR-020). The numeric limits of the host's
 * own events are a fact of the PAID capture of T001
 * (`host-hook-numeric-limits`), so the plugin states its own and nothing of a
 * run depends on a hook that the host cuts short.
 */
export const HOOK_TIME_LIMIT_SECONDS: Readonly<Record<string, number>> = Object.freeze({
  "session-start": 5,
  "prompt-submit": 5,
  "guard-before-shell": 10,
  "host-limit-event": 10,
});

function header(eventId: string, requirement: string, what: string): readonly string[] {
  return Object.freeze([
    "#!/bin/sh",
    `# ${eventId} — thin host hook shim of the Specstride plugin (F113-FR-020, ${requirement}).`,
    `# ${what}`,
    "set -u",
    "",
    ...silenceGuardLines(),
    "",
  ]);
}

/** The lines that read the standard input of the event, where the host hands one. */
function readTheEventLines(): readonly string[] {
  return Object.freeze([
    "# The host hands the event on standard input. Outside text is DATA: it is matched,",
    "# never expanded into a command (the constitution, principle III; threats T-09, T-12).",
    'event=""',
    "if [ ! -t 0 ]; then",
    '  event="$(cat 2>/dev/null)" || event=""',
    "fi",
  ]);
}

function markerLines(): readonly string[] {
  return Object.freeze([
    `# The marker of the last injected state (F113-FR-021). It is state of the HOST, in the`,
    `# host's plugin data directory: no run and no command of the product reads it, annex B`,
    "# §B.5 holds no logical name for it, and when it is missing or damaged ONE more line is",
    "# printed and nothing else changes.",
    `marker_dir="\${${MARKER_DIRECTORY_VARIABLE}:-${MARKER_DIRECTORY_FALLBACK}}"`,
    `marker="$marker_dir/${STATE_MARKER_FILE}"`,
    'last=""',
    'if [ -f "$marker" ]; then',
    '  last="$(cat "$marker" 2>/dev/null)" || last=""',
    "fi",
    'case "$last" in',
    `  ${COMPARED_STATUS_KEYS[0]}=*) ;;`,
    '  *) last="" ;;',
    "esac",
  ]);
}

function writeTheMarkerLines(): readonly string[] {
  return Object.freeze([
    "# Best effort: a marker that cannot be written costs one more line and nothing else",
    "# (F113-FR-021; the constitution, principle V).",
    'mkdir -p "$marker_dir" 2>/dev/null || :',
    'printf \'%s\\n\' "$signature" > "$marker" 2>/dev/null || :',
    "exit 0",
  ]);
}

/**
 * The shim of a status event: it reads the ONE precomputed file the logical
 * name `workspace:current:status-line` points at and prints at most one line.
 * It starts no interpreter, runs no command of the product and reads no other
 * state of the product (F113-FR-020, F113-FR-021, F113-FR-022).
 */
function statusShimLines(eventId: string): readonly string[] {
  const requirement = eventId === "session-start" ? "F113-FR-021" : "F113-FR-022";
  const guard =
    eventId === "session-start"
      ? [
          "# F113-FR-021 — after a COMPACTION the line is printed again only if the state",
          "# changed since the last injection. A fresh start always prints.",
          "compaction=0",
          'case "$event" in',
          "  *'\"source\"'*compact*) compaction=1 ;;",
          "esac",
          'if [ "$compaction" = 1 ] && [ "$signature" = "$last" ]; then',
          "  exit 0",
          "fi",
        ]
      : [
          "# F113-FR-022 — nothing is printed unless the state or the phase changed since the",
          "# last injection, and then ONE line.",
          'if [ "$signature" = "$last" ]; then',
          "  exit 0",
          "fi",
        ];
  return Object.freeze([
    ...header(
      eventId,
      requirement,
      `It prints the precomputed line of \`${STATUS_LINE_LOGICAL_NAME}\` and nothing else: no` +
        " interpreter is started, no command of the product is run, and nothing is printed when" +
        " no run exists.",
    ),
    ...readTheEventLines(),
    "",
    `# The line is found through \`${STATUS_LINE_LOGICAL_NAME}\` of annex B §B.5, whose place`,
    "# depends on the real path of the workspace only, so a shell shim finds it without",
    "# starting the product (F100-FR-229).",
    `root="\${${CONTROL_ROOT_VARIABLE}:-}"`,
    'if [ -z "$root" ]; then exit 0; fi',
    `line="$root/${STATUS_LINE_UNDER_CONTROL_ROOT}"`,
    'if [ ! -f "$line" ]; then exit 0; fi',
    'text="$(cat "$line" 2>/dev/null)" || exit 0',
    'if [ -z "$text" ]; then exit 0; fi',
    "",
    `# \`${VALID_UNTIL_KEY}=\` is a key of the status line (row 248 of annex X §X.6). Past it,`,
    `# the state is unknown (F113-FR-021); \`${VALID_UNTIL_WITHOUT_A_LEASE}\` is a run that`,
    "# rests and has no lease (annex F §F.5).",
    `valid_until="$(printf '%s\\n' "$text" | tr ' ' '\\n' | sed -n 's/^${VALID_UNTIL_KEY}=//p' | sed -n '1p')"`,
    "stale=0",
    `if [ -n "$valid_until" ] && [ "$valid_until" != "${VALID_UNTIL_WITHOUT_A_LEASE}" ]; then`,
    '  case "$valid_until" in',
    "    *[!0-9]*)",
    `      NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"`,
    `      FIRST="$(printf '%s\\n%s\\n' "$valid_until" "$NOW" | LC_ALL=C sort | sed -n '1p')"`,
    '      if [ "$FIRST" = "$valid_until" ] && [ "$valid_until" != "$NOW" ]; then stale=1; fi',
    "      ;;",
    "    *)",
    `      NOW_EPOCH="$(date -u '+%s')"`,
    '      if [ "$valid_until" -lt "$NOW_EPOCH" ]; then stale=1; fi',
    "      ;;",
    "  esac",
    "fi",
    'if [ "$stale" = 1 ]; then',
    `  text='${STATE_UNKNOWN_LINE}'`,
    "fi",
    "",
    `# The two keys the shims compare: \`${COMPARED_STATUS_KEYS[0]}\` and`,
    `# \`${COMPARED_STATUS_KEYS[1]}\` (row 248 of annex X §X.6).`,
    `state="$(printf '%s\\n' "$text" | tr ' ' '\\n' | sed -n 's/^${COMPARED_STATUS_KEYS[0]}=//p' | sed -n '1p')"`,
    `phase="$(printf '%s\\n' "$text" | tr ' ' '\\n' | sed -n 's/^${COMPARED_STATUS_KEYS[1]}=//p' | sed -n '1p')"`,
    `signature="${COMPARED_STATUS_KEYS[0]}=$state ${COMPARED_STATUS_KEYS[1]}=$phase"`,
    "",
    ...markerLines(),
    "",
    ...guard,
    "",
    "# ONE line, and it is the line the runtime precomputed.",
    "printf '%s\\n' \"$text\"",
    ...writeTheMarkerLines(),
    "",
  ]);
}

/** The lines that find the plugin's own `bin` shim, or give up silently. */
function findTheCliLines(): readonly string[] {
  return Object.freeze([
    "# The CLI is reached through the plugin's own shim (T007), which resolves the executable",
    "# and checks the protocol. Where it is not there, the hook is silent: no run depends on a",
    "# host hook (F113-FR-020).",
    `if [ -z "\${${PLUGIN_ROOT_VARIABLE}:-}" ]; then exit 0; fi`,
    `cli="$${PLUGIN_ROOT_VARIABLE}/${CLI_INSIDE_THE_PLUGIN}"`,
    'if [ ! -x "$cli" ]; then exit 0; fi',
  ]);
}

/** The guardrail shim of F113-FR-023. */
function guardrailShimLines(): readonly string[] {
  const argv = GUARDRAIL_ARGUMENTS.map((a) => `"${a}"`).join(" ");
  return Object.freeze([
    ...header(
      "guard-before-shell",
      "F113-FR-023",
      "Before a shell command that launches a run it has the CLI evaluate the launch checks" +
        " WITHOUT launching, and denies with one line where a launch check would refuse. It is" +
        " defence in depth: the CLI refuses the same checks itself.",
    ),
    ...readTheEventLines(),
    "",
    "# Only a shell command that launches a run is guarded.",
    'case "$event" in',
    `  ${LAUNCHING_COMMANDS.map((c) => `*'${c}'*`).join("|")}) ;;`,
    "  *) exit 0 ;;",
    "esac",
    "",
    ...findTheCliLines(),
    "",
    "# No argument of the proposed command and no comment is passed: outside text is data,",
    "# never argv, and the comment MUST NOT override the guardrail (F113-FR-023).",
    `out="$("$cli" ${argv} 2>&1)"`,
    "code=$?",
    `deny="$(printf '%s\\n' "$out" | sed -n 's/^\\(${REFUSE_SED}.*\\)$/\\1/p' | sed -n '1p')"`,
    `if [ -n "$deny" ]; then`,
    "  # ONE line, the CLI's own.",
    "  printf '%s\\n' \"$deny\" >&2",
    `  exit ${DENY_EXIT_CODE}`,
    "fi",
    `if [ "$code" = ${LAUNCH_REFUSED_CODE} ]; then`,
    `  printf '%s\\n' '${GUARDRAIL_DENY_LINE}' >&2`,
    `  exit ${DENY_EXIT_CODE}`,
    "fi",
    "exit 0",
    "",
  ]);
}

/** The limit-event shim of F113-FR-024. */
function limitEventShimLines(): readonly string[] {
  const command = HOST_EVENT_COMMAND.map((word) => `"${word}"`).join(" ");
  return Object.freeze([
    ...header(
      "host-limit-event",
      "F113-FR-024",
      `It writes the event THROUGH THE CLI as an inbox request of type` +
        ` \`${HOST_EVENT_REQUEST_TYPE}\` (\`${HOST_EVENTS_INBOX_NAME}\`), with its kind and` +
        " redacted data. It writes no inbox file itself and injects NO context: it prints" +
        " nothing at all.",
    ),
    ...readTheEventLines(),
    'if [ -z "$event" ]; then exit 0; fi',
    "",
    "# The kind, and then the ALLOW-LISTED fields with safe values only: redaction keeps",
    "# everything else inside the host (F113-FR-024).",
    `kind="$(printf '%s\\n' "$event" | sed -n 's/.*"kind"[ ]*:[ ]*"\\{0,1\\}\\(${KIND_PATTERN}\\)"\\{0,1\\}.*/\\1/p' | sed -n '1p')"`,
    'if [ -z "$kind" ]; then exit 0; fi',
    'data=""',
    `for field in ${HOST_EVENT_ALLOWED_FIELDS.join(" ")}; do`,
    `  value="$(printf '%s\\n' "$event" | sed -n "s/.*\\"$field\\"[ ]*:[ ]*\\"\\{0,1\\}\\(${REDACTED_VALUE_PATTERN}\\)\\"\\{0,1\\}.*/\\\\1/p" | sed -n '1p')"`,
    '  if [ -n "$value" ]; then',
    '    if [ -n "$data" ]; then data="$data,"; fi',
    '    data="$data\\"$field\\":\\"$value\\""',
    "  fi",
    "done",
    "",
    ...findTheCliLines(),
    "",
    "# The CLI writes the inbox on behalf of the host. Nothing is printed: no context is",
    "# injected, and a failure of the call costs nothing of the run.",
    `"$cli" ${command} ${HOST_EVENT_KIND_FLAG} "$kind" ${HOST_EVENT_DATA_FLAG} "{$data}" >/dev/null 2>&1 || :`,
    "exit 0",
    "",
  ]);
}

/** The thin shell shim of one of the four events (T016). */
export function hookShimScript(eventId: string): string {
  if (STATUS_EVENT_IDS.includes(eventId)) return statusShimLines(eventId).join("\n");
  if (eventId === "guard-before-shell") return guardrailShimLines().join("\n");
  if (eventId === "host-limit-event") return limitEventShimLines().join("\n");
  throw new Error(`this plugin registers no host hook event \`${eventId}\` (F113-FR-025)`);
}

/** The artifact of one shim. */
export function hookShimArtifact(eventId: string): HostArtifact {
  const content = hookShimScript(eventId);
  return Object.freeze({
    path: hookShimPath(eventId),
    bytes: Buffer.byteLength(content, "utf8"),
    content,
  });
}

/* -------------------------------------------------------------------------
 * What a shim starts, and what it does not (F113-FR-020)
 * ---------------------------------------------------------------------- */

/** The executing lines of a script: the comments carry prose, not behaviour. */
export function executingCode(script: string): string {
  return script
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

/** The interpreters a shim must never start itself (plan.md: no Node start). */
export const INTERPRETERS = Object.freeze(["node", "npx", "npm", "bun", "deno", "python"]);

/**
 * F113-FR-020 — true where the script starts the runtime platform ITSELF. No
 * shim of this plugin does: the two status shims start no process at all, and
 * the other two start the plugin's own `bin` shim, which is the second clause
 * of the requirement ("or a line the CLI prints").
 */
export function startsTheRuntimePlatform(script: string): boolean {
  const code = executingCode(script);
  return INTERPRETERS.some((name) => new RegExp(`\\b${name}\\b`).test(code));
}

/** True where the script invokes the CLI through the plugin's own shim of T007. */
export function invokesTheCli(script: string): boolean {
  return executingCode(script).includes(SHIM_FILE_NAME);
}

/** F113-FR-020 — no run may depend on a host hook; every shim is best effort. */
export const NO_RUN_DEPENDS_ON_A_HOST_HOOK = true as const;

/* -------------------------------------------------------------------------
 * The host hook configuration (T016)
 * ---------------------------------------------------------------------- */

/** One registered event of the configuration. */
export type RegisteredHook = {
  /** The id of the event in the product's words. */
  readonly id: string;
  /** The host's own spelling, which is what the configuration is keyed by. */
  readonly hostSpelling: string;
  /** The command the host runs: the shim, under the plugin's root. */
  readonly command: string;
  /** The explicit time limit of the hook, in seconds (F113-FR-020). */
  readonly timeout: number;
  /** The host's matcher, where the event takes one (the guardrail, F113-FR-023). */
  readonly matcher: string | null;
  /** The requirement the event comes from. */
  readonly requirement: string;
};

/** The events of F113-FR-021 to F113-FR-024 whose host spelling is known. */
export function registeredHooks(): readonly RegisteredHook[] {
  return Object.freeze(
    HOST_HOOK_EVENTS.filter((event) => event.hostSpelling !== null).map((event) =>
      Object.freeze({
        id: event.id,
        hostSpelling: event.hostSpelling as string,
        command: `\${${PLUGIN_ROOT_VARIABLE}}/${hookShimPath(event.id)}`,
        timeout: HOOK_TIME_LIMIT_SECONDS[event.id] ?? 5,
        matcher: HOOK_MATCHERS[event.id] ?? null,
        requirement: event.requirement,
      }),
    ),
  );
}

/**
 * The events whose shim the build emits but whose host spelling is NOT known:
 * the limit event of F113-FR-024. Its spelling is a fact of the PAID capture
 * of T001 (`host-limit-events`) and is `unverified`, so it is not registered
 * and the declared fallback applies — an event the host does not offer is
 * simply never written, and the run's harness quota comes from its adapter.
 */
export function unregisteredHooks(): readonly string[] {
  return Object.freeze(
    HOST_HOOK_EVENTS.filter((event) => event.hostSpelling === null).map((event) => event.id),
  );
}

/** The host's own hook configuration, in the host's format (T016). */
export function hookConfiguration(): Readonly<Record<string, unknown>> {
  const hooks: Record<string, unknown> = {};
  for (const hook of registeredHooks()) {
    const entry: Record<string, unknown> = {
      hooks: [Object.freeze({ type: "command", command: hook.command, timeout: hook.timeout })],
    };
    if (hook.matcher !== null) entry.matcher = hook.matcher;
    hooks[hook.hostSpelling] = [Object.freeze(entry)];
  }
  return Object.freeze({ hooks: Object.freeze(hooks) });
}

/** The host spellings the configuration registers a hook on. */
export function registeredSpellings(): readonly string[] {
  return Object.freeze(Object.keys((hookConfiguration() as { hooks: object }).hooks));
}

/** F113-FR-025 — true where this plugin registers a host hook on a spelling. */
export function registersAHookOn(hostSpelling: string): boolean {
  return registeredSpellings().includes(hostSpelling);
}

/** The record of what the configuration does NOT register, and why (T016, T017). */
export function hookRecord(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    requirements: [
      "F113-FR-020",
      "F113-FR-021",
      "F113-FR-022",
      "F113-FR-023",
      "F113-FR-024",
      "F113-FR-025",
      "F113-FR-026",
      "F113-FR-027",
    ],
    task: "T016",
    events: registeredHooks().map((hook) =>
      Object.freeze({
        id: hook.id,
        hostSpelling: hook.hostSpelling,
        requirement: hook.requirement,
      }),
    ),
    notRegistered: Object.freeze({
      becauseTheSpellingIsUnverified: [...unregisteredHooks()],
      byRequirement: Object.freeze({
        requirement: "F113-FR-025",
        events: [...EVENTS_NEVER_REGISTERED],
        hostSpellings: [...NEVER_REGISTERED_SPELLINGS],
      }),
    }),
    statusLine: Object.freeze({
      logicalName: STATUS_LINE_LOGICAL_NAME,
      underTheControlRoot: STATUS_LINE_UNDER_CONTROL_ROOT,
      variable: CONTROL_ROOT_VARIABLE,
    }),
    marker: Object.freeze({
      file: STATE_MARKER_FILE,
      stateOfTheHost: STATE_MARKER_IS_STATE_OF_THE_HOST,
      hasALogicalName: stateMarkerHasALogicalName(),
      variable: MARKER_DIRECTORY_VARIABLE,
      fact: MARKER_DIRECTORY_FACT,
    }),
    silentInsideAChildOfARun: Object.freeze({
      requirement: "F113-FR-027",
      task: "T018",
      variables: [...CHILD_OF_A_RUN_VARIABLES],
      secondGuard: SILENCE_IS_THE_SECOND_GUARD,
      firstGuard: CUSTOMIZATIONS_ARE_SWITCHED_OFF_BY,
    }),
    noRunDependsOnAHostHook: NO_RUN_DEPENDS_ON_A_HOST_HOOK,
  });
}

/* -------------------------------------------------------------------------
 * The build step: the configuration and the shims become files
 * ---------------------------------------------------------------------- */

/** The file that records what the configuration does not register. */
export const HOOK_RECORD_PATH = `${HOOKS_DIRECTORY}/specstride-hooks.json` as const;

/** The mode of a shim: the host executes it. */
export const SHIM_MODE = 0o755 as const;
/** The mode of a file the host only reads. */
export const FILE_MODE = 0o644 as const;

/** Every artifact of the hooks: the configuration, the two records, the four shims. */
export function renderHooks(): readonly HostArtifact[] {
  const json = (value: Readonly<Record<string, unknown>>): string =>
    `${JSON.stringify(value, null, 2)}\n`;
  const artifacts: HostArtifact[] = [
    Object.freeze({
      path: HOOK_CONFIG_PATH,
      bytes: Buffer.byteLength(json(hookConfiguration()), "utf8"),
      content: json(hookConfiguration()),
    }),
    Object.freeze({
      path: HOOK_RECORD_PATH,
      bytes: Buffer.byteLength(json(hookRecord()), "utf8"),
      content: json(hookRecord()),
    }),
    Object.freeze({
      path: PUSH_ALERT_PATH,
      bytes: Buffer.byteLength(json(pushAlertRecord()), "utf8"),
      content: json(pushAlertRecord()),
    }),
  ];
  for (const id of HOOK_EVENT_IDS) artifacts.push(hookShimArtifact(id));
  return Object.freeze(artifacts);
}

/** One file as the build wrote it into the plugin directory. */
export type WrittenHook = {
  /** The path inside the plugin directory, with `/` as the separator. */
  readonly path: string;
  /** The bytes the file measures. */
  readonly bytes: number;
  /** The SHA-256 of its content, in lower-case hexadecimal. */
  readonly sha256: string;
  /** True where the host executes the file. */
  readonly executable: boolean;
};

/** The content hash of a written file, which a test reads back from disk. */
export function hookContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * The build step of T016 to T018: it writes the host hook configuration, the
 * two records and the four shims into a plugin directory and returns what it
 * wrote, each with its content hash. The plugin directory is a BUILD OUTPUT
 * and lies inside the published package (plan.md, "Structure Decision"), so
 * the build writes it and the repository does not carry it.
 */
export function writePluginHooks(pluginDirectory: string): readonly WrittenHook[] {
  return Object.freeze(
    renderHooks().map((artifact) => {
      const file = join(pluginDirectory, artifact.path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, artifact.content, "utf8");
      const executable = artifact.path.endsWith(".sh");
      chmodSync(file, executable ? SHIM_MODE : FILE_MODE);
      return Object.freeze({
        path: artifact.path,
        bytes: artifact.bytes,
        sha256: hookContentHash(artifact.content),
        executable: (statSync(file).mode & 0o111) !== 0,
      });
    }),
  );
}
