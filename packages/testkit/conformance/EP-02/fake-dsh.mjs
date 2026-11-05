#!/usr/bin/env node
/**
 * The fake `dsh` binary of the harness port suite (EP-02), feature 130 (T009).
 *
 * It is the dsh-shaped observed side of the conformance suite: it behaves the
 * way the harness behaves at the pin `0.1.0-rc.8` as far as the port sees it —
 * the whole prompt arrives as arguments (the critic's prompt in chunks after
 * `--`), nothing is read from standard input, the final reply is printed as
 * plain text on standard output, error lines go to standard error or to
 * standard output with exit 1, and it answers the installer call of the plugin
 * request protocol.
 *
 * Recording. Everything the caller gave is recorded, one JSON line per call,
 * appended to `record.jsonl` in the directory named by
 * `FAKE_DSH_RECORD_DIR` (the same record form as `fake-binary.mjs`):
 *
 *   { "argv": [...], "cwd": "...", "pgid": N, "pid": N,
 *     "env": {name: value, ...}, "stdin": "..." }
 *
 * A record line is flushed before anything is played, so an observation is
 * durable even when the script ends the process. The record carries the
 * argument list (the prompt as one positional argument, or in chunks for the
 * critic), the standard input (expected to be closed: the empty string), the
 * environment, the working directory and the process group — the six things
 * F109-FR-042 asserts for every operation, plus what §O.3 of feature 141
 * names for the dsh stub: the content of the settings file of the home it was
 * given (`DSH_HOME`), and the content of the patch file it was given.
 *
 * Play. The environment variable `FAKE_DSH_SCRIPT` holds a JSON array of
 * steps, played in order, one step per call; the last step repeats:
 *
 *   {"text": "..."}        print the final reply on standard output, exit 0
 *   {"stdout": "..."}      print on standard output
 *   {"stderr": "..."}      print on standard error
 *   {"error": "..."}       print one `dsh: ...` error line on standard error
 *                          and exit 1 (the as-is error form)
 *   {"exit": N}            end with exit code N
 *   {"signal": "SIGKILL"}  end by a signal to itself
 *   {"hang": ms}           stop reacting (0 or negative: forever, until the
 *                          caller ends the process)
 *   {"install": true}      act as the plugin installer: exit 0
 *   {"installFail": N}     act as the installer that fails with exit N
 *   {"installHang": true}  act as the installer that never returns
 *
 * Without a script the binary prints nothing and exits 0.
 *
 * Tool ids. The introspection the coverage check needs is answered from a
 * configurable set: the environment variable `FAKE_DSH_TOOL_IDS` holds a JSON
 * array of tool ids (default: the 18 of `critic-patch.json` at the pin). A
 * call whose arguments ask for the composed configuration (`--dump-config`,
 * or `--dump-default-config`) prints, on standard output, one JSON document:
 *
 *   { "version": "0.1.0-rc.8", "profile": "<value of --profile>",
 *     "toolIds": [...], "telemetry": "<DSH_TELEMETRY_MODE or null>",
 *     "traceparent": "<TRACEPARENT or null>",
 *     "settings": <parsed settings file of DSH_HOME or null>,
 *     "patch": <parsed --patch file or null>,
 *     "permissionMode": "<DSH_PERMISSION_MODE or null>" }
 *
 * `--version` prints `0.1.0-rc.8` — or the version in `FAKE_DSH_VERSION`, so
 * the suite can prove that a version other than the pin refuses the critic
 * role.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readSync } from "node:fs";

/** The version the real binary at the pin states; `FAKE_DSH_VERSION` overrides. */
const PIN_VERSION = "0.1.0-rc.8";

/** The default set of tool ids: the 18 of `critic-patch.json` at the pin. */
const DEFAULT_TOOL_IDS = [
  "tool-bash",
  "tool-pwsh",
  "tool-jobs",
  "tool-fs",
  "tool-fs-search",
  "tool-skill",
  "tool-subagent-control",
  "tool-subagent-list-agents",
  "tool-subagent",
  "tool-subagent-fork",
  "tool-subagent-report",
  "tool-workflow",
  "tool-goal",
  "tool-ralph",
  "tool-str-replace-editor",
  "tool-web",
  "tool-todo",
  "user-questions",
];

function readStdinSync() {
  // dsh takes no standard input in its headless profile; the suite proves the
  // closed stream by handing the binary a pipe it never reads from. Read to
  // end of stream anyway, so a caller that piped something is not left blocked.
  const chunks = [];
  for (;;) {
    const chunk = Buffer.alloc(65536);
    let read = 0;
    try {
      read = readSync(0, chunk, 0, chunk.length);
    } catch (error) {
      if (error && error.code === "EAGAIN") break;
      if (error && error.code === "EINTR") continue;
      break;
    }
    if (read <= 0) break;
    chunks.push(chunk.subarray(0, read));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function processGroupId() {
  if (typeof process.getpgid === "function") {
    try {
      return process.getpgid(process.pid);
    } catch {
      /* fall through to /proc */
    }
  }
  try {
    const stat = readFileSync("/proc/self/stat", "utf8");
    const after = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return Number(after[2]);
  } catch {
    return null;
  }
}

function argvValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null;
}

function readJsonOrNull(path) {
  if (path === null || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { unreadable: path };
  }
}

function record(argv, stdin) {
  const dir = process.env.FAKE_DSH_RECORD_DIR;
  if (!dir) return;
  const home = process.env.DSH_HOME ?? null;
  const settings = home === null ? null : readJsonOrNull(`${home}/settings.yaml`);
  const patchPath = argvValue(argv, "--patch");
  const line = {
    argv,
    cwd: process.cwd(),
    pid: process.pid,
    pgid: processGroupId(),
    env: { ...process.env },
    stdin,
    // What §O.3 names for the dsh stub, beyond the common record.
    home,
    settings,
    patch: patchPath === null ? null : readJsonOrNull(patchPath),
    permissionMode: process.env.DSH_PERMISSION_MODE ?? null,
    at: new Date().toISOString(),
  };
  mkdirSync(dir, { recursive: true });
  appendFileSync(`${dir}/record.jsonl`, `${JSON.stringify(line)}\n`);
}

function introspect(argv) {
  const profileFlag = argv.indexOf("--profile");
  process.stdout.write(
    `${JSON.stringify({
      version: process.env.FAKE_DSH_VERSION ?? PIN_VERSION,
      profile: profileFlag >= 0 ? argv[profileFlag + 1] : null,
      toolIds: JSON.parse(process.env.FAKE_DSH_TOOL_IDS ?? "null") ?? DEFAULT_TOOL_IDS,
      telemetry: process.env.DSH_TELEMETRY_MODE ?? null,
      traceparent: process.env.TRACEPARENT ?? null,
      permissionMode: process.env.DSH_PERMISSION_MODE ?? null,
      settings: readJsonOrNull(
        process.env.DSH_HOME === undefined ? null : `${process.env.DSH_HOME}/settings.yaml`,
      ),
      patch: readJsonOrNull(argvValue(argv, "--patch")),
    })}\n`,
  );
  process.exitCode = 0;
}

function play() {
  const raw = process.env.FAKE_DSH_SCRIPT;
  if (!raw) {
    process.exitCode = 0;
    return;
  }
  const steps = JSON.parse(raw);
  // One step per call; the counter lives outside the working directory only in
  // the sense the suite gives it: the caller hands one script per call, and
  // the last step repeats for every further call.
  const index = Number(process.env.FAKE_DSH_STEP ?? "0");
  const step = steps[Math.min(index, steps.length - 1)] ?? {};
  if (process.env.FAKE_DSH_STEP !== undefined) {
    process.env.FAKE_DSH_STEP = String(index + 1);
  }
  if (step.installHang !== undefined) return; // never returns
  if (step.install !== undefined) process.exitCode = 0;
  else if (step.installFail !== undefined) process.exitCode = Number(step.installFail);
  if (step.text !== undefined) process.stdout.write(step.text);
  if (step.stdout !== undefined) process.stdout.write(step.stdout);
  if (step.stderr !== undefined) process.stderr.write(step.stderr);
  if (step.error !== undefined) {
    process.stderr.write(`dsh: ${step.error}\n`);
    process.exitCode = 1;
    return;
  }
  if (step.hang !== undefined) {
    const ms = Number(step.hang);
    if (!Number.isFinite(ms) || ms <= 0) {
      setInterval(() => {}, 1 << 30); // forever: the caller ends us
      return;
    }
    setTimeout(() => {}, ms);
    return;
  }
  if (step.signal !== undefined) {
    process.kill(process.pid, step.signal);
    return;
  }
  if (step.exit !== undefined) {
    process.exit(Number(step.exit));
  }
}

const argv = process.argv.slice(2);
const stdin = readStdinSync();
record(argv, stdin);

if (argv.includes("--version")) {
  process.stdout.write(`${process.env.FAKE_DSH_VERSION ?? PIN_VERSION}\n`);
  process.exitCode = 0;
} else if (argv.includes("--dump-config") || argv.includes("--dump-default-config")) {
  introspect(argv);
} else {
  play();
}
