/**
 * T045 — the generic harness adapter for the kind `cli` (F109-FR-016).
 *
 * The adapter starts the harness with the argument list of the descriptor
 * and with NOTHING added. It never guesses a flag that suppresses
 * permission prompts: a descriptor that declares no permission mechanism,
 * and does not declare that none exists, does not qualify as proposer. The
 * prompt is handed over by standard input where the descriptor allows it,
 * else by a file, else as an argument with the size limit of the
 * descriptor — a prompt above the limit is refused BEFORE the harness
 * starts. The files the descriptor names are written before the call and
 * removed after it. A critic of the first form runs in an empty temporary
 * directory, which is removed after the call.
 */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { placeholderOutsideClosedSet, type RawDescriptor } from "../descriptor/loader.ts";
import { isLoopbackAddress } from "./loopback.ts";

export { isLoopbackAddress };

/** The roles the kind `cli` can serve. */
export type CliRole = "proposer" | "critic";

/** How the prompt reaches the harness, as the descriptor declares it. */
export type CliPromptForm = "stdin" | "file" | "arg";

/** The permission mechanisms a descriptor may declare (never guessed here). */
export type CliPermission = "none" | "flag" | "config" | "prompt";

/** Why the adapter refused to start the harness. */
export type CliRefusalReason =
  | "role-not-served"
  | "permission-undeclared"
  | "prompt-too-large"
  | "prompt-form-undeclared"
  | "placeholder-outside-closed-set"
  | "no-argument-list";

export type CliRefusal = {
  readonly ok: false;
  readonly reason: CliRefusalReason;
  readonly message: string;
};

/** A file the descriptor names: written before the call, removed after. */
export type CliFile = {
  /** The path the file is written to. */
  readonly path: string;
  readonly content: string;
};

/** One start of the harness, built entirely from the descriptor. */
export type CliInvocation = {
  readonly ok: true;
  /** The resolved command (the executable of the descriptor). */
  readonly command: string;
  /** The argument list of the descriptor, placeholders substituted. */
  readonly args: readonly string[];
  /** The prompt by standard input, where the descriptor says `stdin`. */
  readonly stdin: string | null;
  /** The working directory of the call. */
  readonly cwd: string;
  /** Files written before the call; removed by `cleanupCliInvocation`. */
  readonly files: readonly CliFile[];
  /** Files to remove after the call (the written ones, prompt file included). */
  readonly cleanupFiles: readonly string[];
  /** Directories to remove after the call (a first-form critic's empty dir). */
  readonly cleanupDirs: readonly string[];
};

export type CliRoleCall = {
  /** Whether the descriptor lets the prompt travel by stdin, file or argument. */
  readonly prompt?: CliPromptForm;
  /** The size limit of the prompt as an argument, in bytes (F109-FR-016). */
  readonly promptLimitBytes?: number;
  /**
   * The permission mechanism the harness has, or `"none"` where the
   * descriptor declares that none exists. Absent: nothing is declared, and
   * the adapter refuses the proposer role rather than guess a flag.
   */
  readonly permission?: CliPermission;
  /** The argument list; the only source of arguments (F109-FR-016). */
  readonly args?: readonly string[];
  /** The working directory of the call; `{workdir}` by default. */
  readonly cwd?: string;
  /** Files to write before the call, keyed by the `{file:<name>}` name. */
  readonly files?: Readonly<Record<string, string>>;
};

/** The default limit of a prompt handed over as an argument. */
export const DEFAULT_PROMPT_LIMIT_BYTES: number = 128 * 1024;

const PROMPT_FORMS: readonly CliPromptForm[] = ["stdin", "file", "arg"];
const PERMISSIONS: readonly CliPermission[] = ["none", "flag", "config", "prompt"];

export type CliCallInput = {
  readonly role: CliRole;
  readonly prompt: string;
  /** The working directory of the consumer's call. */
  readonly workdir: string;
  readonly model?: string;
  readonly sessionId?: string;
  /** A critic of the first form runs in an empty temporary directory. */
  readonly firstFormCritic?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function substitute(text: string, values: Readonly<Record<string, string>>): string | null {
  let out = "";
  let index = 0;
  for (const match of text.matchAll(/\{[^{}]*\}/g)) {
    const token = match[0];
    const start = match.index ?? 0;
    out += text.slice(index, start);
    index = start + token.length;
    const value = values[token];
    if (value === undefined) {
      if (placeholderOutsideClosedSet(token) !== null) {
        return null; // a placeholder the closed set does not hold
      }
      out += token; // a member of the set this call fills with nothing
      continue;
    }
    out += value;
  }
  out += text.slice(index);
  return out;
}

/**
 * F109-FR-016 — build one start of the harness from the descriptor alone.
 * Every refusal happens here, before any process is started.
 */
export function buildCliInvocation(
  descriptor: RawDescriptor,
  command: string,
  input: CliCallInput,
): CliInvocation | CliRefusal {
  const refuse = (reason: CliRefusalReason, message: string): CliRefusal => ({
    ok: false,
    reason,
    message,
  });

  const roles = descriptor.roles;
  const roleRecord = isRecord(roles) ? (roles as Record<string, unknown>)[input.role] : undefined;
  if (!isRecord(roleRecord) || roleRecord.supported !== true) {
    return refuse("role-not-served", `the descriptor does not serve the role \`${input.role}\``);
  }

  const invoke = descriptor.invoke;
  const call = isRecord(invoke) ? (invoke as Record<string, unknown>)[input.role] : undefined;
  if (!isRecord(call)) {
    return refuse(
      "no-argument-list",
      `the descriptor declares no invocation for \`${input.role}\``,
    );
  }
  const roleCall = call as unknown as CliRoleCall;

  // No guessed flag: the permission mechanism must be declared, even as
  // "none"; an undeclared one refuses the proposer before the start.
  if (roleCall.permission === undefined || !PERMISSIONS.includes(roleCall.permission)) {
    return refuse(
      "permission-undeclared",
      "the descriptor declares no permission mechanism and does not declare that none exists; " +
        "no flag is guessed, so the harness does not qualify as proposer",
    );
  }

  const args = roleCall.args;
  if (args === undefined || !Array.isArray(args) || args.length === 0) {
    return refuse("no-argument-list", "the descriptor declares no argument list for the role");
  }

  const promptForm = roleCall.prompt;
  if (promptForm === undefined || !PROMPT_FORMS.includes(promptForm)) {
    return refuse(
      "prompt-form-undeclared",
      "the descriptor declares no way to hand the prompt over (stdin, file or bounded argument)",
    );
  }
  const limit = roleCall.promptLimitBytes ?? DEFAULT_PROMPT_LIMIT_BYTES;
  if (promptForm === "arg" && Buffer.byteLength(input.prompt, "utf8") > limit) {
    return refuse(
      "prompt-too-large",
      `the prompt is ${Buffer.byteLength(input.prompt, "utf8")} bytes, above the limit of ${limit} the descriptor declares; refused before the harness starts`,
    );
  }

  // The working directory: a first-form critic gets an empty temporary
  // directory, which `cleanupCliInvocation` removes after the call.
  const cleanupDirs: string[] = [];
  const cleanupFiles: string[] = [];
  let cwd: string;
  if (input.firstFormCritic === true) {
    cwd = "<created at write time: an empty temporary directory>";
  } else {
    const declared = typeof roleCall.cwd === "string" ? roleCall.cwd : "{workdir}";
    const substituted = substitute(declared, {
      "{workdir}": resolve(input.workdir),
      "{model}": input.model ?? "",
      "{sessionId}": input.sessionId ?? "",
    });
    if (substituted === null) {
      return refuse(
        "placeholder-outside-closed-set",
        "the working directory carries a placeholder outside the closed set",
      );
    }
    cwd = substituted;
  }

  const files: CliFile[] = [];
  // A first-form critic's files are written into the temporary directory
  // once `materialiseFirstFormDirectory` has created it.
  const fileBase = input.firstFormCritic === true ? "" : resolve(input.workdir);
  const declaredFiles = isRecord(call.files) ? (call.files as Record<string, unknown>) : {};
  const fileValues: Record<string, string> = {};
  for (const [name, content] of Object.entries(declaredFiles)) {
    if (typeof content !== "string") {
      return refuse("no-argument-list", `the file \`${name}\` of the descriptor is not text`);
    }
    const path = join(fileBase, name);
    files.push({ path, content });
    cleanupFiles.push(path);
    fileValues[`{file:${name}}`] = path;
  }

  // The prompt: stdin, a file, or a bounded argument.
  let stdin: string | null = null;
  const promptValues: Record<string, string> = {
    "{workdir}": resolve(input.workdir),
    "{model}": input.model ?? "",
    "{sessionId}": input.sessionId ?? "",
    ...fileValues,
  };
  if (promptForm === "stdin") {
    stdin = input.prompt;
  } else if (promptForm === "file") {
    const promptPath = join(fileBase, ".specstride-prompt");
    files.push({ path: promptPath, content: input.prompt });
    cleanupFiles.push(promptPath);
    promptValues["{promptFile}"] = promptPath;
  } else {
    promptValues["{prompt}"] = input.prompt;
  }

  const finalArgs: string[] = [];
  for (const argument of args) {
    const substituted = substitute(argument, promptValues);
    if (substituted === null) {
      return refuse(
        "placeholder-outside-closed-set",
        `the argument ${JSON.stringify(argument)} carries a placeholder outside the closed set of seven`,
      );
    }
    finalArgs.push(substituted);
  }

  return {
    ok: true,
    command,
    args: finalArgs,
    stdin,
    cwd,
    files,
    cleanupFiles,
    cleanupDirs,
  };
}

/**
 * The real temporary directory of a first-form critic: created at the
 * moment of the write, empty, removed after the call.
 */
export async function materialiseFirstFormDirectory(
  invocation: CliInvocation | CliRefusal,
): Promise<CliInvocation | CliRefusal> {
  if (
    !invocation.ok ||
    invocation.cwd !== "<created at write time: an empty temporary directory>"
  ) {
    return invocation;
  }
  const dir = await mkdtemp(join(tmpdir(), "specstride-critic-"));
  const files = invocation.files.map((file) => ({
    ...file,
    path: join(dir, file.path),
  }));
  return {
    ...invocation,
    cwd: dir,
    files,
    cleanupFiles: files.map((file) => file.path),
    cleanupDirs: [dir],
  };
}

/**
 * F109-FR-016 — write the files the descriptor names, before the call.
 */
export async function writeCliFiles(invocation: CliInvocation): Promise<void> {
  await mkdir(invocation.cwd, { recursive: true });
  for (const file of invocation.files) {
    await mkdir(resolve(file.path, ".."), { recursive: true });
    await writeFile(file.path, file.content, "utf8");
  }
}

/**
 * F109-FR-016 — remove what the call left: the files the descriptor named,
 * the prompt file, and the empty temporary directory of a first-form critic.
 */
export async function cleanupCliInvocation(invocation: CliInvocation): Promise<void> {
  for (const path of invocation.cleanupFiles) {
    if (existsSync(path)) await rm(path, { force: true });
  }
  for (const dir of invocation.cleanupDirs) {
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  }
}

export type CliRunResult = {
  readonly pid: number;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * Run one built invocation: the argument list of the descriptor and nothing
 * added, the prompt by standard input where the descriptor says so. The
 * caller builds the environment through the allow-list and the switches and
 * hands it in; nothing is added here either.
 */
export function runCliInvocation(
  invocation: CliInvocation,
  environment: Readonly<Record<string, string>>,
): Promise<CliRunResult> {
  return new Promise((resolveRun) => {
    const child = spawn(invocation.command, [...invocation.args], {
      cwd: invocation.cwd,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => err.push(chunk));
    if (invocation.stdin !== null) {
      child.stdin?.end(invocation.stdin, "utf8");
    } else {
      child.stdin?.end();
    }
    child.on("error", (error: Error) => {
      resolveRun({
        pid: child.pid ?? -1,
        exitCode: null,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: `${Buffer.concat(err).toString("utf8")}${error.message}`,
      });
    });
    child.on("close", (code: number | null) => {
      resolveRun({
        pid: child.pid ?? -1,
        exitCode: code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

/**
 * Read back what the fake binary recorded (used by the conformance suite
 * and the tests of this adapter to observe the argument list, the standard
 * input, the environment, the working directory and the process group).
 */
export async function readRecordedCalls(recordDir: string): Promise<
  readonly {
    argv: readonly string[];
    cwd: string;
    pid: number;
    pgid: number | null;
    env: Readonly<Record<string, string>>;
    stdin: string;
  }[]
> {
  const path = join(recordDir, "record.jsonl");
  if (!existsSync(path)) return [];
  const text = await readFile(path, "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(
      (line) =>
        JSON.parse(line) as {
          argv: readonly string[];
          cwd: string;
          pid: number;
          pgid: number | null;
          env: Readonly<Record<string, string>>;
          stdin: string;
        },
    );
}
