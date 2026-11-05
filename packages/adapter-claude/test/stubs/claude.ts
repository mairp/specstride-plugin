#!/usr/bin/env node
/**
 * The Claude harness stub of the parity tests (feature 141, §O.3, proposer
 * stub named after the as-is command of the harness).
 *
 * §O.3 rules it obeys: no clock and no randomness (it writes no time and no
 * nonce); no model call, no credential read and no network; the same stub
 * serves any side; one transcript record per invocation; a scenario is
 * data.
 *
 * The observer passes the directory of the recording in the environment
 * variable `CLAUDE_STUB_RECORD_DIR`; the stub appends one JSON line to
 * `record.jsonl` there with the surfaces the parity oracle compares:
 *
 *   { "argv": [...], "cwd": "...", "pgid": N, "envNames": [...],
 *     "env": {name: value, ...}, "stdinFile": {"variable": name, "path":
 *     p, "exists": bool, "content": "..."} | null, "stdin": "..." }
 *
 * Without the variable it still exits 0 and records nothing.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readSync } from "node:fs";

function readStdinSync() {
  const chunks: Buffer[] = [];
  for (;;) {
    const chunk = Buffer.alloc(65536);
    let read = 0;
    try {
      read = readSync(0, chunk, 0, chunk.length, 0);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "EAGAIN") break;
      if (code === "EINTR") continue;
      break;
    }
    if (read <= 0) break;
    chunks.push(chunk.subarray(0, read));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function processGroupId(): number | null {
  const getpgid = (process as { getpgid?: (pid: number) => number }).getpgid;
  if (typeof getpgid === "function") {
    try {
      return getpgid(process.pid);
    } catch {
      /* fall through */
    }
  }
  return null;
}

const variable = process.env.SPECSTRIDE_STDIN_FILE ?? null;
const stdinFile =
  variable !== null
    ? {
        variable: "SPECSTRIDE_STDIN_FILE",
        path: variable,
        exists: existsSync(variable),
        content: existsSync(variable) ? readFileSync(variable, "utf8") : null,
      }
    : null;

const record = {
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  pgid: processGroupId(),
  envNames: Object.keys(process.env).sort(),
  env: { ...process.env },
  stdinFile,
  stdin: readStdinSync(),
};

const dir = process.env.CLAUDE_STUB_RECORD_DIR;
if (dir) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(`${dir}/record.jsonl`, `${JSON.stringify(record)}\n`);
}
process.exit(0);
