#!/usr/bin/env node
// The executable shim of the Specstride plugin for Claude Code (T007 of
// specs/113-host-claude-code/tasks.md; F113-FR-018, F113-FR-019).
//
// GENERATED from packages/host-claude-code/src/shim/index.ts, which inlines
// every constant of annex H section H.1 and annex G sections G.1 and G.4. Do
// not edit this file: edit that module. A test holds the two against each
// other byte for byte.
//
// It finds the CLI in the order of F113-FR-018 — the explicit variable
// SPECSTRIDE_BIN of the consumer, the search path, the package the plugin was
// published with — calls specstride --protocol, compares the integer with the
// range it supports (1), and refuses a mismatch with ONE line that names
// the doctor. It FETCHES, INSTALLS AND UPDATES NOTHING.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const EXECUTABLE_VARIABLE = "SPECSTRIDE_BIN";
const EXECUTABLE_NAME = "specstride";
const PROTOCOL_FLAG = "--protocol";
const SUPPORTED_PROTOCOL_MIN = 1;
const SUPPORTED_PROTOCOL_MAX = 1;
const PROTOCOL_MISMATCH_EXIT_CODE = 4;
const CLI_NOT_FOUND_EXIT_CODE = 127;
const REFUSAL_PREFIX = "[SPECSTRIDE-REFUSE] action=protocol reason=protocol-mismatch";
const MISSING_CLI_LINE =
  '[SPECSTRIDE-REFUSE] action=resolve reason=cli-not-found check=host.cli-found install="npm install -g specstride@0.1.0" fix="specstride doctor"';
const SUPPORTED_RANGE = "1";
const PROTOCOL_CHECK = "host.protocol-supported";
const DOCTOR_COMMAND = "specstride doctor";
const SIGNAL_NUMBERS = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };

function isExecutable(candidate) {
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// The third step of F113-FR-018: the package the plugin was published with.
// The shim lies at <package>/plugin/bin/specstride, so the root is two
// directories above its own.
function publishedBin() {
  const root = path.resolve(import.meta.dirname, "..", "..");
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const bin = manifest.bin;
    const entry = typeof bin === "string" ? bin : bin && bin[EXECUTABLE_NAME];
    if (typeof entry !== "string" || entry === "") return null;
    return path.resolve(root, entry);
  } catch {
    return null;
  }
}

// F113-FR-018, in the order of the requirement.
function resolveExecutable() {
  const explicit = process.env[EXECUTABLE_VARIABLE];
  if (explicit && isExecutable(explicit)) return explicit;
  // The CLI the plugin carries comes before the search path, so that another
  // specstride on the machine can never answer for this version of the plugin.
  const bundled = path.resolve(import.meta.dirname, "..", "cli", "bin", EXECUTABLE_NAME);
  if (isExecutable(bundled)) return bundled;
  const entries = (process.env.PATH || "").split(":");
  for (const entry of entries) {
    const candidate = path.join(entry === "" ? "." : entry, EXECUTABLE_NAME);
    if (isExecutable(candidate)) return candidate;
  }
  const published = publishedBin();
  if (published && isExecutable(published)) return published;
  return null;
}

function readProtocol(stdout) {
  const text = String(stdout === undefined || stdout === null ? "" : stdout).trim();
  return /^\d+$/.test(text) ? Number.parseInt(text, 10) : null;
}

function refusalLine(found) {
  const seen = found === null ? "none" : String(found);
  return (
    REFUSAL_PREFIX +
    " found=" +
    seen +
    " supported=" +
    SUPPORTED_RANGE +
    " check=" +
    PROTOCOL_CHECK +
    " fix=" +
    JSON.stringify(DOCTOR_COMMAND)
  );
}

// One line, written with writeSync so that process.exit cannot truncate it.
function printOneLine(line) {
  fs.writeSync(1, line + "\n");
}

const executable = resolveExecutable();
if (executable === null) {
  // It reports through the doctor and prints the install command. It installs
  // nothing (F113-FR-018, threat T-46).
  printOneLine(MISSING_CLI_LINE);
  process.exit(CLI_NOT_FOUND_EXIT_CODE);
}

const probe = spawnSync(executable, [PROTOCOL_FLAG], { encoding: "utf8" });
const protocol = probe.status === 0 ? readProtocol(probe.stdout) : null;
if (protocol === null || protocol < SUPPORTED_PROTOCOL_MIN || protocol > SUPPORTED_PROTOCOL_MAX) {
  // One line, with the two integers, naming the doctor; exit 4.
  printOneLine(refusalLine(protocol));
  process.exit(PROTOCOL_MISMATCH_EXIT_CODE);
}

// The protocol matches. A differing package version alone is never a refusal
// (F113-FR-019): the doctor shows the difference and the run goes on.
const run = spawnSync(executable, process.argv.slice(2), { stdio: "inherit" });
if (run.status !== null && run.status !== undefined) process.exit(run.status);
// A run ended by a signal has no code of its own: 128+N, as exit 130 and 143
// are the two interruptions of this product (R3v C7). Anything else is an
// uncaught error, 70 (annex G section G.4).
const number = SIGNAL_NUMBERS[run.signal];
process.exit(number === undefined ? 70 : 128 + number);
