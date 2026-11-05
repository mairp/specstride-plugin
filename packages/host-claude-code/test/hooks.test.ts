/**
 * T016, T017 and T018 of `specs/113-host-claude-code/tasks.md` — the host hook
 * configuration, the four thin shims, the push-alert way and the silence
 * inside a child of a run.
 *
 * Two things are proved here.
 *
 *  1. The configuration and the records say what F113-FR-020 to F113-FR-027
 *     require, and every name they rest on is READ from `@specstride/contracts`
 *     (the logical name of the status line, the writer of the inbox of host
 *     events, the keys of the status line, the refusal code of `launch`, the
 *     event context of a run).
 *  2. The BUILD OUTPUT is durable and independently readable:
 *     `writePluginHooks()` writes the seven files into a plugin directory, and
 *     this test reads them BACK FROM DISK, hashes them and checks their mode
 *     bits — the return value of the call is never the proof.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandCodeRow } from "@specstride/contracts/codes/commands";
import { rowOf } from "@specstride/contracts/ids/logical-names";
import { STATUS_LINE_NAME } from "@specstride/contracts/ids/logical-names-amendments";
import { VALID_UNTIL_NONE } from "@specstride/contracts/state/handshake";
import { inboxRequestTypes, keysOfTheStatusLine } from "@specstride/contracts";
import {
  CHILD_OF_A_RUN_VARIABLES,
  COMPARED_STATUS_KEYS,
  CUSTOMIZATIONS_ARE_SWITCHED_OFF_BY,
  DENY_EXIT_CODE,
  GUARDRAIL_ARGUMENTS,
  HOOK_CONFIG_PATH,
  HOOK_EVENT_IDS,
  HOOK_RECORD_PATH,
  HOOK_TIME_LIMIT_SECONDS,
  HOST_EVENTS_INBOX_NAME,
  HOST_EVENTS_INBOX_WRITER,
  HOST_EVENT_ALLOWED_FIELDS,
  HOST_EVENT_COMMAND,
  HOST_EVENT_REQUEST_TYPE,
  LAUNCH_REFUSED_CODE,
  NEVER_REGISTERED_SPELLINGS,
  NOTHING_DEPENDS_ON_THE_PUSH_ALERT,
  NO_RUN_DEPENDS_ON_A_HOST_HOOK,
  PRIMARY_PUSH_ALERT_WAY,
  PUSH_ALERT_FACT,
  PUSH_ALERT_PATH,
  PUSH_ALERT_WAYS,
  RE_WAKING_HOOK_CONDITIONS,
  SILENCE_IS_THE_SECOND_GUARD,
  STATE_MARKER_FILE,
  STATUS_EVENT_IDS,
  STATUS_LINE_LOGICAL_NAME,
  STATUS_LINE_UNDER_CONTROL_ROOT,
  THE_LIMIT_EVENT_HOOK_INJECTS_CONTEXT,
  THE_PROPOSED_ARGUMENTS_ARE_PASSED,
  THE_SHIM_WRITES_THE_INBOX,
  hookConfiguration,
  hookContentHash,
  hookShimPath,
  hookShimScript,
  insideAChildOfARun,
  invokesTheCli,
  markerIsReadable,
  pushAlertWay,
  pushAlertWayIsFixedByTheUnrunCapture,
  redactHostEvent,
  registeredHooks,
  registersAHookOn,
  renderHooks,
  startsTheRuntimePlatform,
  stateMarkerFailureChangesAnythingElse,
  stateMarkerHasALogicalName,
  unregisteredHooks,
  writePluginHooks,
} from "../src/hooks.ts";
import { factOf } from "../src/host-facts.ts";
import { SHIM_FILE_NAME } from "../src/shim/index.ts";
import { renderStatusHooks } from "../src/render/index.ts";

/* ------------------------------------------------- T016: the configuration */

test("T016: the configuration registers the four events of F113-FR-021 to F113-FR-024", () => {
  // The four events come from `describe` (T005) and are not listed again here.
  assert.deepEqual(HOOK_EVENT_IDS, [
    "session-start",
    "prompt-submit",
    "guard-before-shell",
    "host-limit-event",
  ]);
  const registered = registeredHooks();
  // Three host spellings are documented; the limit event's is a fact of the
  // PAID capture of T001, so it is not registered and its fallback applies.
  assert.deepEqual(
    registered.map((hook) => hook.hostSpelling),
    ["SessionStart", "UserPromptSubmit", "PreToolUse"],
  );
  assert.deepEqual(unregisteredHooks(), ["host-limit-event"]);
  assert.equal(factOf("host-limit-events")?.status, "unverified");

  // F113-FR-020 — every hook declares an EXPLICIT time limit.
  const config = hookConfiguration() as {
    hooks: Record<string, [{ matcher?: string; hooks: [{ command: string; timeout: number }] }]>;
  };
  for (const hook of registered) {
    const entry = config.hooks[hook.hostSpelling]?.[0];
    assert.ok(entry, `the configuration registers \`${hook.hostSpelling}\``);
    assert.equal(entry.hooks[0].timeout, HOOK_TIME_LIMIT_SECONDS[hook.id]);
    assert.ok(entry.hooks[0].timeout > 0, "an explicit time limit (F113-FR-020)");
    assert.equal(entry.hooks[0].command, `\${CLAUDE_PLUGIN_ROOT}/${hookShimPath(hook.id)}`);
  }
  // The guardrail stands before a SHELL command, so it carries the matcher.
  assert.equal(config.hooks.PreToolUse?.[0].matcher, "Bash");
});

test("T016: the status shim finds the line through `workspace:current:status-line`", () => {
  // The one input is the LOGICAL NAME of annex B §B.5, read from the table.
  assert.equal(STATUS_LINE_LOGICAL_NAME, STATUS_LINE_NAME);
  assert.equal(STATUS_LINE_LOGICAL_NAME, "workspace:current:status-line");
  // Its place under the control root comes from the resolver, not from prose.
  assert.equal(STATUS_LINE_UNDER_CONTROL_ROOT, "status.line");
  for (const eventId of STATUS_EVENT_IDS) {
    const script = hookShimScript(eventId);
    assert.match(script, /workspace:current:status-line/);
    // `$root/` is used for exactly one file: the precomputed status line.
    const uses = [...script.matchAll(/\$root\/(\S+)"/g)].map((m) => m[1]);
    assert.deepEqual(uses, [STATUS_LINE_UNDER_CONTROL_ROOT]);
  }
  // The two keys the shims compare are keys of the status line (row 248).
  for (const key of COMPARED_STATUS_KEYS) assert.ok(keysOfTheStatusLine.has(key));
  // A run that rests and has no lease is never stale.
  assert.equal(VALID_UNTIL_NONE, "none");
});

test("T016: `renderStatusHooks` of EP-01 returns the same bytes the build writes", () => {
  const fromEp = renderStatusHooks(STATUS_LINE_LOGICAL_NAME);
  const fromBuild = renderHooks().filter((artifact) =>
    STATUS_EVENT_IDS.some((id) => artifact.path === hookShimPath(id)),
  );
  assert.deepEqual(fromEp, fromBuild);
});

test("T016: F113-FR-025 — no host hook on stop and none after a tool use", () => {
  assert.deepEqual(NEVER_REGISTERED_SPELLINGS, ["Stop", "SubagentStop", "PostToolUse"]);
  for (const spelling of NEVER_REGISTERED_SPELLINGS) {
    assert.equal(registersAHookOn(spelling), false, `no host hook on \`${spelling}\``);
  }
  // And there is no shim to register either.
  for (const id of ["stop", "after-tool-use-that-injects-context"]) {
    assert.throws(() => hookShimScript(id), /registers no host hook event/);
  }
});

test("T016: F113-FR-020 — the shims are thin", () => {
  for (const id of HOOK_EVENT_IDS) {
    const script = hookShimScript(id);
    assert.match(script, /^#!\/bin\/sh\n/, "a shell shim");
    // No shim starts an interpreter of its own.
    assert.equal(startsTheRuntimePlatform(script), false, `\`${id}\` starts no interpreter`);
  }
  // The two status shims reach the CLI nowhere: they read one precomputed file.
  for (const id of STATUS_EVENT_IDS) assert.equal(invokesTheCli(hookShimScript(id)), false);
  // The other two reach it ONLY through the plugin's own shim of T007, which is
  // the second clause of F113-FR-020 ("or a line the CLI prints").
  for (const id of ["guard-before-shell", "host-limit-event"]) {
    assert.equal(invokesTheCli(hookShimScript(id)), true);
    assert.match(hookShimScript(id), new RegExp(`bin/${SHIM_FILE_NAME.replace(".", "\\.")}`));
  }
  assert.equal(NO_RUN_DEPENDS_ON_A_HOST_HOOK, true);
});

/* ---------------------------------------- T016: the marker, state of the host */

test("T016: the marker of the last injected state is state of the HOST", () => {
  // Annex B §B.5 holds no logical name for it — computed over the table.
  assert.equal(stateMarkerHasALogicalName(), false);
  assert.equal(STATE_MARKER_FILE, "last-injected-state");
  // A marker that cannot be read is treated as nothing injected yet, which
  // makes ONE more line print and changes nothing else (F113-FR-021).
  assert.equal(markerIsReadable(null), false);
  assert.equal(markerIsReadable("garbage"), false);
  assert.equal(markerIsReadable("st=running ph=3"), true);
  for (const state of ["readable", "absent", "damaged"] as const) {
    assert.equal(stateMarkerFailureChangesAnythingElse(state), false);
  }
});

/* ------------------------------------------- T016: the guardrail and the event */

test("T016: F113-FR-023 — the guardrail evaluates the launch checks without launching", () => {
  assert.deepEqual([...GUARDRAIL_ARGUMENTS], ["launch", "--mode", "dry-run"]);
  // The refusal code is the one annex G §G.4 gives `launch`.
  assert.equal(LAUNCH_REFUSED_CODE, 4);
  assert.ok(commandCodeRow("launch")?.numbers.includes(LAUNCH_REFUSED_CODE));
  // The comment cannot override the guardrail, so no comment and no argument of
  // the proposed command is passed: outside text is data, never argv.
  assert.equal(THE_PROPOSED_ARGUMENTS_ARE_PASSED, false);
  assert.equal(hookShimScript("guard-before-shell").includes("--comment"), false);
  assert.ok(DENY_EXIT_CODE > 0);
});

test("T016: F113-FR-024 — the limit event is written through the CLI, redacted", () => {
  // The command is the row of annex G §G.4, and the type is the closed set.
  assert.deepEqual([...HOST_EVENT_COMMAND], ["host", "event"]);
  assert.ok(inboxRequestTypes.has(HOST_EVENT_REQUEST_TYPE));
  // The layout of annex B §B.5 names the writer, and it is not the host hook.
  assert.equal(HOST_EVENTS_INBOX_WRITER, "CLI on behalf of a host");
  assert.equal(rowOf(HOST_EVENTS_INBOX_NAME)?.writer, HOST_EVENTS_INBOX_WRITER);
  assert.equal(THE_SHIM_WRITES_THE_INBOX, false);
  assert.equal(THE_LIMIT_EVENT_HOOK_INJECTS_CONTEXT, false);

  // Redaction: the kind and the allow-listed fields with safe values, nothing
  // else. Free prose and anything with a space never leaves the host.
  const event = JSON.stringify({
    kind: "usage-limit",
    limit: "5h",
    resetsAt: "2026-10-01T12:00:00Z",
    message: "a secret sentence",
    token: "sk-abcdef",
  });
  const redacted = redactHostEvent(event);
  assert.equal(redacted.kind, "usage-limit");
  assert.equal(redacted.data, '{"limit":"5h","resetsAt":"2026-10-01T12:00:00Z"}');
  for (const dropped of ["message", "secret", "token", "sk-abcdef"]) {
    assert.equal(redacted.data.includes(dropped), false, `\`${dropped}\` is redacted`);
  }
  assert.deepEqual([...HOST_EVENT_ALLOWED_FIELDS], ["limit", "resetsAt", "retryAfter", "scope"]);
});

/* ----------------------------------------------- T017: the push alert */

test("T017: the monitor is the primary way, and only a run capture may change it", () => {
  assert.deepEqual([...PUSH_ALERT_WAYS], ["monitor", "re-waking-host-hook"]);
  assert.equal(PRIMARY_PUSH_ALERT_WAY, "monitor");
  assert.equal(pushAlertWay(), "monitor");
  // The capture of T001 has NOT been run, so the way may not be changed.
  assert.equal(pushAlertWayIsFixedByTheUnrunCapture(), true);
  const unrun = factOf(PUSH_ALERT_FACT);
  assert.equal(unrun?.status, "unverified");
  // A claim without a capture changes nothing: the negative case.
  assert.equal(
    pushAlertWay({ fact: unrun, longTimeLimit: true, reArmsAfterItFires: true }),
    "monitor",
  );
  // Once the capture HAS been run, both conditions of F113-FR-026 must hold.
  const captured = { ...(unrun as object), status: "verified" as const, verifiedOn: "2026-10-02" };
  assert.equal(
    pushAlertWay({ fact: captured as never, longTimeLimit: true, reArmsAfterItFires: true }),
    "re-waking-host-hook",
  );
  assert.equal(pushAlertWay({ fact: captured as never, longTimeLimit: true }), "monitor");
  assert.equal(pushAlertWay({ fact: captured as never, reArmsAfterItFires: true }), "monitor");
  assert.deepEqual(
    [...RE_WAKING_HOOK_CONDITIONS],
    ["an explicit long time limit", "re-arming after it fires"],
  );
  assert.equal(NOTHING_DEPENDS_ON_THE_PUSH_ALERT, true);
});

/* ----------------------------------------------- T018: inside a child of a run */

test("T018: a shim is silent inside a child of a run", () => {
  // The names are the event context of a run, read from the alias table.
  assert.deepEqual(
    [...CHILD_OF_A_RUN_VARIABLES],
    ["SPECSTRIDE_EVENTS", "SPECSTRIDE_RUN_ID", "SPECSTRIDE_TASK", "SPECSTRIDE_TRACE_ID"],
  );
  assert.equal(insideAChildOfARun({}), false);
  assert.equal(insideAChildOfARun({ SPECSTRIDE_RUN_ID: "" }), false);
  for (const name of CHILD_OF_A_RUN_VARIABLES) {
    assert.equal(insideAChildOfARun({ [name]: "R1" }), true, `\`${name}\` marks a child`);
  }
  // Every shim carries the guard, and it is the SECOND guard.
  for (const id of HOOK_EVENT_IDS) {
    const script = hookShimScript(id);
    for (const name of CHILD_OF_A_RUN_VARIABLES) assert.match(script, new RegExp(name));
  }
  assert.equal(SILENCE_IS_THE_SECOND_GUARD, true);
  assert.equal(CUSTOMIZATIONS_ARE_SWITCHED_OFF_BY, "the harness adapter");
});

/* ------------------------------------- The build output, read back from disk */

test("T016 to T018: the build writes the configuration and the shims", () => {
  const directory = mkdtempSync(join(tmpdir(), "specstride-hooks-"));
  const written = writePluginHooks(directory);
  // The witness is the TREE, not the return value: every file is read back.
  assert.deepEqual(readdirSync(join(directory, "hooks")).sort(), [
    "guard-before-shell.sh",
    "hooks.json",
    "host-limit-event.sh",
    "prompt-submit.sh",
    "push-alert.json",
    "session-start.sh",
    "specstride-hooks.json",
  ]);
  for (const file of written) {
    const onDisk = readFileSync(join(directory, file.path), "utf8");
    assert.equal(
      hookContentHash(onDisk),
      file.sha256,
      `${file.path} is the bytes that were hashed`,
    );
    assert.equal(Buffer.byteLength(onDisk, "utf8"), file.bytes);
    const executable = (statSync(join(directory, file.path)).mode & 0o111) !== 0;
    assert.equal(executable, file.path.endsWith(".sh"), `${file.path}: the host executes a shim`);
    assert.equal(executable, file.executable);
  }
  // The records on disk say what T016 and T017 decided.
  const record = JSON.parse(readFileSync(join(directory, HOOK_RECORD_PATH), "utf8")) as {
    notRegistered: { byRequirement: { hostSpellings: string[] } };
    marker: { hasALogicalName: boolean };
  };
  assert.deepEqual(record.notRegistered.byRequirement.hostSpellings, [
    ...NEVER_REGISTERED_SPELLINGS,
  ]);
  assert.equal(record.marker.hasALogicalName, false);
  const alert = JSON.parse(readFileSync(join(directory, PUSH_ALERT_PATH), "utf8")) as {
    primary: string;
    alternative: { registered: boolean; factStatus: string };
    dependsOn: string[];
  };
  assert.equal(alert.primary, "monitor");
  assert.equal(alert.alternative.registered, false);
  assert.equal(alert.alternative.factStatus, "unverified");
  assert.deepEqual(alert.dependsOn, []);
  // The host's own configuration holds no spelling of F113-FR-025.
  const config = readFileSync(join(directory, HOOK_CONFIG_PATH), "utf8");
  for (const spelling of NEVER_REGISTERED_SPELLINGS) {
    assert.equal(config.includes(`"${spelling}"`), false);
  }
});
