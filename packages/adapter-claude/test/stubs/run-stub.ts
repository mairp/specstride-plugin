/**
 * The runner of the parity tests: it starts the Claude stub of §O.3 as the
 * baseline's oracle observes it — in a process group of its own, with the
 * environment and the argument list the adapter built — and reads back the
 * one transcript record the stub appended.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STUB_DIR = path.dirname(fileURLToPath(import.meta.url));

export type StubInvocation = {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly pgid: number | null;
  readonly envNames: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly stdinFile: {
    readonly variable: string;
    readonly path: string;
    readonly exists: boolean;
    readonly content: string | null;
  } | null;
  readonly stdin: string;
};

/** Spawns the stub with the given argv and env; resolves its one record. */
export function runStub(input: {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly recordDir: string;
  readonly cwd?: string;
}): Promise<StubInvocation> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(STUB_DIR, "claude.ts"), ...input.argv], {
      env: { ...input.env, CLAUDE_STUB_RECORD_DIR: input.recordDir },
      cwd: input.cwd,
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`the stub ended with exit ${code}`));
        return;
      }
      try {
        const lines = readFileSync(`${input.recordDir}/record.jsonl`, "utf8").trim().split("\n");
        resolve(JSON.parse(lines.at(-1)!) as StubInvocation);
      } catch (error) {
        reject(error as Error);
      }
    });
  });
}
