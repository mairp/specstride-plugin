/**
 * T076 — a starter that calls `startDetached` and then ends.
 *
 * F100-FR-234 requires that the status record *exists when the process that
 * started it has ended*. A test cannot show that from inside its own process:
 * the test process does not end. So the test runs THIS file as a process of its
 * own. It calls `startDetached`, writes down the identity it got, and exits at
 * once. The test then waits for this process to be gone and only afterwards
 * waits for the status record, which is the independent read path the
 * requirement asks for.
 */
import { renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startProcessDetached } from "../../src/proc/primitive.ts";

const ENTRY = fileURLToPath(import.meta.url);

/** What the starter writes down before it ends. */
export type StarterRecord = {
  readonly kind: "specstride.kernel.test.starter/1";
  /** The process id of the starter itself, which the test waits to be gone. */
  readonly starterPid: number;
  /** The identity `startDetached` returned: the waiter's. */
  readonly pid: number;
  readonly pgid: number;
  readonly startedAtMs: number;
  /** Milliseconds since the epoch at which the starter was about to end. */
  readonly endingAtMs: number;
};

function argOf(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

async function run(argv: readonly string[]): Promise<void> {
  const separator = argv.indexOf("--");
  const flags = argv.slice(0, separator < 0 ? argv.length : separator);
  const command = separator < 0 ? [] : argv.slice(separator + 1);
  const statusFile = argOf(flags, "--status");
  const outPath = argOf(flags, "--out");
  const stdoutFile = argOf(flags, "--stdout");
  const stderrFile = argOf(flags, "--stderr");
  if (statusFile === undefined || outPath === undefined || command.length === 0) {
    process.stderr.write("detached-starter: --status <file> --out <file> -- <command...>\n");
    process.exit(2);
  }

  const started = await startProcessDetached({
    argv: command,
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? "" },
    statusFile,
    stdoutFile,
    stderrFile,
  });

  const record: StarterRecord = {
    kind: "specstride.kernel.test.starter/1",
    starterPid: process.pid,
    pid: started.pid,
    pgid: started.pgid,
    startedAtMs: started.startedAtMs,
    endingAtMs: Date.now(),
  };
  const temporary = `${outPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, outPath);

  // And now the starter ends, while the command it started runs on.
  process.exit(0);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === ENTRY) {
  await run(process.argv.slice(2));
}
