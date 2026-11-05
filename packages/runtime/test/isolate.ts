/**
 * Runs the runtime tests in their own PID namespace when they run as root on Linux.
 *
 * These tests signal process groups. A wrong group id (0, 1 or -1) sent as root on the
 * host kills every process, Proxmox's watchdog-mux with them, and the host resets
 * (2026-10-02, five resets). Inside the namespace, `kill -1` reaches only the processes
 * of this run. SPECSTRIDE_TEST_NO_ISOLATE=1 skips the namespace; never set it as root on
 * a shared host.
 *
 * Usage: node test/isolate.ts <command> [args...]
 */
import { spawnSync } from "node:child_process";

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

const [command, args] = wanted
  ? ["unshare", ["--fork", "--pid", "--mount-proc", "--kill-child", "--", ...argv]]
  : [argv[0], argv.slice(1)];

const result = spawnSync(command, args, {
  stdio: "inherit",
  env: wanted ? { ...process.env, SPECSTRIDE_TEST_ISOLATED: "1" } : process.env,
});

if (result.error) {
  const why = wanted
    ? "refusing to run the runtime tests as root without unshare(1)"
    : "cannot start";
  process.stderr.write(`isolate.ts: ${why}: ${result.error.message}\n`);
  process.exit(2);
}
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 1);
