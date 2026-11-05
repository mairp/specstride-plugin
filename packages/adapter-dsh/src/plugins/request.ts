/**
 * T057 — the plugin request processor (F130-FR-031, F130-FR-032).
 *
 * The processor is kept as an entry of the adapter, with the flags
 * `--request` and `--archive-dir` (both required), `--allowlist`,
 * `--dsh-bin` (default `dsh`), `--profile` (default `headless`) and
 * `--timeout` (default 600), each defaulting to its setting of F130-FR-033.
 * On ANY request error it prints `dsh plugin request: <cause>` on standard
 * error and exits 2; otherwise it prints the JSON result on standard output
 * and exits 0. With no request file it prints `{"plugins": [], "status":
 * "none"}` and exits 0. Installs are serialised by an EXCLUSIVE lock held for
 * the whole processing of one request, at the logical name
 * `harness:dsh:install-lock`. On success it writes a receipt of the schema
 * `specstride-dsh-plugin-install/v1` with the fields `status`, `profile`,
 * `plugins`, `reason`, `requested_at`, `completed_at` and `request_archive`,
 * and archives the request beside it (F130-FR-033, install.ts runs the
 * installer). The request is read as a CLAIM: after the pass has exited, as
 * a regular file, without following links, and its content is never
 * evaluated.
 */
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { runInstaller, installerArgv, INSTALLER_TIMEOUT_DEFAULT_SEC } from "./install.ts";

/** The as-is schema id of a request (F130-FR-032). */
export const REQUEST_SCHEMA_ID = "specstride-dsh-plugin-request/v1" as const;

/** The as-is schema id of a receipt (F130-FR-031). */
export const RECEIPT_SCHEMA_ID = "specstride-dsh-plugin-install/v1" as const;

/** The logical name of the request file the proposer writes (F130-FR-033). */
export const REQUEST_LOGICAL_NAME = "harness:dsh:plugin-request" as const;

/** The logical name of the archive directory (F130-FR-033). */
export const ARCHIVE_LOGICAL_NAME = "harness:dsh:plugin-installs" as const;

/** The logical name of the exclusive install lock (F130-FR-031). */
export const LOCK_LOGICAL_NAME = "harness:dsh:install-lock" as const;

/** The component the messages and the paths name (F130-FR-031). */
export const PLUGIN_COMPONENT = "plugin-requests" as const;

/** The first line of every request error on standard error (F130-FR-031). */
export const REQUEST_ERROR_PREFIX = "dsh plugin request:" as const;

/** The largest request file, in bytes (F130-FR-032). */
export const REQUEST_MAX_BYTES = 16384 as const;

/** The largest `reason`, in bytes (F130-FR-032). */
export const REASON_MAX_BYTES = 2048 as const;

/** The bounds of the `plugins` array (F130-FR-032). */
export const PLUGIN_MIN_ITEMS = 1 as const;
export const PLUGIN_MAX_ITEMS = 8 as const;

/** The exact `package@semver` form: optional scope, pre-release and build. */
const EXACT_SPEC_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*@(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Whether one string is an exact `package@semver` spec (F130-FR-032). */
export function isExactSpec(spec: string): boolean {
  return EXACT_SPEC_PATTERN.test(spec);
}

/** The flags of the processor, as F130-FR-031 states them. */
export const PROCESSOR_FLAGS = Object.freeze({
  request: "--request",
  archiveDir: "--archive-dir",
  allowlist: "--allowlist",
  dshBin: "--dsh-bin",
  profile: "--profile",
  timeout: "--timeout",
} as const);

/** The parsed arguments of one processor run, with the defaults applied. */
export type ProcessorArgs = {
  readonly request: string | null;
  readonly archiveDir: string | null;
  /** The comma-separated allowlist, exactly as given (null where absent). */
  readonly allowlist: string | null;
  readonly dshBin: string;
  readonly profile: string;
  readonly timeoutSec: number;
};

/** The defaults of F130-FR-031, each the setting of F130-FR-033. */
export const PROCESSOR_DEFAULTS = Object.freeze({
  dshBin: "dsh",
  profile: "headless",
  timeoutSec: INSTALLER_TIMEOUT_DEFAULT_SEC,
} as const);

/**
 * Parses the argument list of the processor (F130-FR-031): the two required
 * flags, the allowlist, and the three flags with their defaults.
 */
export function parseProcessorArgv(argv: readonly string[]): ProcessorArgs {
  const parsed = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag !== undefined && value !== undefined) parsed.set(flag, value);
  }
  const timeoutRaw = parsed.get(PROCESSOR_FLAGS.timeout);
  return {
    request: parsed.get(PROCESSOR_FLAGS.request) ?? null,
    archiveDir: parsed.get(PROCESSOR_FLAGS.archiveDir) ?? null,
    allowlist: parsed.get(PROCESSOR_FLAGS.allowlist) ?? null,
    dshBin: parsed.get(PROCESSOR_FLAGS.dshBin) ?? PROCESSOR_DEFAULTS.dshBin,
    profile: parsed.get(PROCESSOR_FLAGS.profile) ?? PROCESSOR_DEFAULTS.profile,
    timeoutSec:
      timeoutRaw !== undefined && timeoutRaw !== "" && Number.isFinite(Number(timeoutRaw))
        ? Number(timeoutRaw)
        : PROCESSOR_DEFAULTS.timeoutSec,
  };
}

/** A validated request, read as a claim. */
export type PluginRequest = {
  readonly contract: typeof REQUEST_SCHEMA_ID;
  readonly plugins: readonly string[];
  readonly reason: string;
};

/** The outcome of reading and validating one request file. */
export type RequestRead =
  | { readonly ok: true; readonly request: PluginRequest }
  | { readonly ok: false; readonly cause: string };

/**
 * Reads one request as a CLAIM (F130-FR-032): a regular file, not a link, of
 * at most 16,384 bytes; keys exactly `contract`, `plugins` and `reason`; the
 * contract id; 1 to 8 unique exact specs; a non-empty reason of at most
 * 2,048 bytes. The content is never evaluated — it is data, not code.
 */
export function readRequestClaim(path: string): RequestRead {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    return { ok: false, cause: "request is not readable" };
  }
  if (stats.isSymbolicLink()) return { ok: false, cause: "request is a symbolic link" };
  if (!stats.isFile()) return { ok: false, cause: "request is not a regular file" };
  if (stats.size > REQUEST_MAX_BYTES) {
    return { ok: false, cause: `request is larger than ${REQUEST_MAX_BYTES} bytes` };
  }
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { ok: false, cause: "request is not valid JSON" };
  }
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    return { ok: false, cause: "request is not a JSON object" };
  }
  const record = document as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = ["contract", "plugins", "reason"];
  for (const key of keys) {
    if (!expected.includes(key)) return { ok: false, cause: `request has unexpected key ${key}` };
  }
  for (const key of expected) {
    if (!(key in record)) return { ok: false, cause: `request is missing key ${key}` };
  }
  if (record["contract"] !== REQUEST_SCHEMA_ID) {
    return { ok: false, cause: `request contract is not ${REQUEST_SCHEMA_ID}` };
  }
  const plugins = record["plugins"];
  if (!Array.isArray(plugins) || plugins.some((p) => typeof p !== "string")) {
    return { ok: false, cause: "plugins must be an array of strings" };
  }
  const specs = plugins as string[];
  if (
    specs.length < PLUGIN_MIN_ITEMS ||
    specs.length > PLUGIN_MAX_ITEMS ||
    new Set(specs).size !== specs.length ||
    specs.some((spec) => !isExactSpec(spec))
  ) {
    return { ok: false, cause: "plugins must hold 1 to 8 unique exact package@semver specs" };
  }
  const reason = record["reason"];
  if (
    typeof reason !== "string" ||
    reason.trim() === "" ||
    Buffer.byteLength(reason, "utf8") > REASON_MAX_BYTES
  ) {
    return {
      ok: false,
      cause: `reason must be a non-empty string of at most ${REASON_MAX_BYTES} bytes`,
    };
  }
  return {
    ok: true,
    request: { contract: REQUEST_SCHEMA_ID, plugins: specs, reason },
  };
}

/**
 * Splits a comma-separated allowlist and checks every entry (F130-FR-032):
 * an entry that is not an exact `package@semver` spec refuses the WHOLE
 * allowlist.
 */
export function parseAllowlist(
  raw: string | null | undefined,
):
  | { readonly ok: true; readonly allowlist: readonly string[] }
  | { readonly ok: false; readonly cause: string } {
  if (raw === null || raw === undefined || raw.trim() === "") return { ok: true, allowlist: [] };
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  for (const entry of entries) {
    if (!isExactSpec(entry)) {
      return { ok: false, cause: `allowlist entry ${entry} is not an exact package@semver spec` };
    }
  }
  return { ok: true, allowlist: entries };
}

/** Whether the allowlist admits every requested plugin, LITERALLY. */
export function allowlistAdmits(
  allowlist: readonly string[],
  plugins: readonly string[],
): { readonly ok: true } | { readonly ok: false; readonly cause: string } {
  for (const plugin of plugins) {
    if (!allowlist.includes(plugin)) {
      return { ok: false, cause: `plugin ${plugin} is not in the allowlist` };
    }
  }
  return { ok: true };
}

/** The receipt of one install, of the schema of F130-FR-031. */
export type InstallReceipt = {
  readonly contract: typeof RECEIPT_SCHEMA_ID;
  readonly status: "installed";
  readonly profile: string;
  readonly plugins: readonly string[];
  readonly reason: string;
  readonly requested_at: string;
  readonly completed_at: string;
  readonly request_archive: string;
};

/** One processor outcome, as the pass loop consumes it. */
export type ProcessorResult = {
  readonly exit: 0 | 2;
  readonly stdout: string;
  readonly stderr: string;
  /** The parsed JSON result on the success arm, else null. */
  readonly result: Record<string, unknown> | null;
};

/** Renders the one error line of F130-FR-031. */
export function requestErrorLine(cause: string): string {
  return `${REQUEST_ERROR_PREFIX} ${cause}`;
}

/** The UTC stamp of an archive pair: `YYYYMMDDThhmmssZ`. */
export function utcStamp(now: Date = new Date()): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** Writes a file atomically: a temporary file, then a rename onto the name. */
function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

/** The input of `processPluginRequest`. */
export type ProcessInput = {
  readonly args: ProcessorArgs;
  /** The environment handed to the installer (record dir, script steps). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly now?: Date;
};

/**
 * Processes one request (F130-FR-031, F130-FR-032, F130-FR-033): read as a
 * claim, validated against the allowlist, serialised by the exclusive lock,
 * installed through the fixed argument list of install.ts with the
 * configured time limit, receipt and archive written atomically. Every error
 * arm is the one line and exit 2; the success arm is the JSON result and
 * exit 0.
 */
export function processPluginRequest(input: ProcessInput): ProcessorResult {
  const { args } = input;
  if (args.request === null) {
    return fail("--request is required");
  }
  if (args.archiveDir === null) {
    return fail("--archive-dir is required");
  }
  if (!existsSync(args.request)) {
    return none();
  }

  const allowlist = parseAllowlist(args.allowlist);
  if (!allowlist.ok) return fail(allowlist.cause);

  const claim = readRequestClaim(args.request);
  if (!claim.ok) return fail(claim.cause);

  const admitted = allowlistAdmits(allowlist.allowlist, claim.request.plugins);
  if (!admitted.ok) return fail(admitted.cause);

  const requestedAt = (input.now ?? new Date()).toISOString();

  // The exclusive lock, held for the WHOLE processing of one request
  // (F130-FR-031): a second processor refuses while this one holds it.
  mkdirSync(args.archiveDir, { recursive: true });
  const lockPath = join(args.archiveDir, "install-lock");
  let lockFd: number;
  try {
    lockFd = openSync(lockPath, "wx");
  } catch {
    return fail(`another install holds ${LOCK_LOGICAL_NAME}`);
  }
  try {
    const stamp = utcStamp(input.now);
    const installer = installerArgv({
      bin: args.dshBin,
      profile: args.profile,
      plugins: claim.request.plugins,
    });
    const run = runInstaller({
      argv: installer,
      timeoutSec: args.timeoutSec,
      env: input.env,
      cwd: input.cwd,
    });
    if (!run.ok) return fail(run.cause);

    const completedAt = new Date().toISOString();
    const archiveLogical = `${ARCHIVE_LOGICAL_NAME}/${stamp}.request.json`;
    writeAtomic(
      join(args.archiveDir, `${stamp}.request.json`),
      JSON.stringify(claim.request, null, 2),
    );
    const receipt: InstallReceipt = {
      contract: RECEIPT_SCHEMA_ID,
      status: "installed",
      profile: args.profile,
      plugins: claim.request.plugins,
      reason: claim.request.reason,
      requested_at: requestedAt,
      completed_at: completedAt,
      request_archive: archiveLogical,
    };
    writeAtomic(join(args.archiveDir, `${stamp}.receipt.json`), JSON.stringify(receipt, null, 2));
    const result = {
      status: "installed",
      profile: args.profile,
      plugins: claim.request.plugins,
      receipt: join(args.archiveDir, `${stamp}.receipt.json`),
      request_archive: archiveLogical,
    };
    return { exit: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "", result };
  } finally {
    closeSync(lockFd);
    rmSync(lockPath, { force: true });
  }
}

/** The none arm: no request file, `{"plugins": [], "status": "none"}`, exit 0. */
function none(): ProcessorResult {
  return {
    exit: 0,
    stdout: `{"plugins": [], "status": "none"}\n`,
    stderr: "",
    result: { plugins: [], status: "none" },
  };
}

/** The error arm: the one line on standard error, exit 2. */
function fail(cause: string): ProcessorResult {
  const line = requestErrorLine(cause);
  return { exit: 2, stdout: "", stderr: `${line}\n`, result: null };
}

/**
 * Runs the processor as a command (F130-FR-031): the flags of
 * `parseProcessorArgv`, the one error line and exit 2, or the JSON result
 * and exit 0. This is the entry the pass loop calls in-process; the exit
 * codes and the streams are its contract.
 */
export function runPluginProcessor(
  argv: readonly string[],
  options: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly cwd?: string;
    readonly now?: Date;
  } = {},
): ProcessorResult {
  return processPluginRequest({ args: parseProcessorArgv(argv), ...options });
}

/** A convenience for tests: the installer argv the processor will use. */
export { installerArgv };
