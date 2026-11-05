/**
 * Runs a test command in its own PID namespace when it runs as root on Linux.
 *
 * Tests of this repository start and signal process groups. A wrong group id (0, 1 or
 * -1) sent as root on the host kills every process, Proxmox's watchdog-mux with them,
 * and the host resets (2026-10-02). Inside the namespace, `kill -1` reaches only the
 * processes of this run. A nested call (a workspace script under the root `npm test`)
 * runs in the namespace already. SPECSTRIDE_TEST_NO_ISOLATE=1 skips the namespace;
 * never set it as root on a shared host.
 *
 * Usage: node <path>/tests/isolate.ts <command> [args...]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const argv = process.argv.slice(2);
if (argv.length === 0) {
  process.stderr.write("isolate.ts: no command given\n");
  process.exit(2);
}

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const wanted =
  process.platform === "linux" &&
  isRoot &&
  !process.env.SPECSTRIDE_TEST_NO_ISOLATE &&
  !process.env.SPECSTRIDE_TEST_ISOLATED;

// The first process of a PID namespace is its init: orphans are re-parented to it and
// stay zombies until it reaps them. A test runner as PID 1 does not reap, so a process
// group a test ended can still look alive to `kill(-group, 0)`. tini reaps; without it
// the command is PID 1 itself.
const reaper = ["/usr/bin/tini", "/usr/sbin/tini", "/sbin/tini"].find((path) => existsSync(path));
const init = reaper === undefined ? [] : [reaper, "-s", "--"];

const [command, args] = wanted
  ? ["unshare", ["--fork", "--pid", "--mount-proc", "--kill-child", "--", ...init, ...argv]]
  : [argv[0], argv.slice(1)];

const result = spawnSync(command, args, {
  stdio: "inherit",
  env: wanted ? { ...process.env, SPECSTRIDE_TEST_ISOLATED: "1" } : process.env,
});

if (result.error) {
  const why = wanted ? "refusing to run the tests as root without unshare(1)" : "cannot start";
  process.stderr.write(`isolate.ts: ${why}: ${result.error.message}\n`);
  process.exit(2);
}
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 1);
