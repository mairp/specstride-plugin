/**
 * T098 — the command `harness verify` and its stored result (F109-FR-025).
 *
 * The command runs the conformance suite of the harness port on ONE harness of
 * the registry, live, only on request and inside a budget the consumer states.
 * Exit codes: 0 the suite passed, 2 it failed, 3 a usage error or an unknown
 * harness. Without a stated budget the command refuses (exit 3, CQ-063: the
 * budget is an argument of the command — a number of model calls and a time
 * limit for the harness, plus a spending cap for a harness of the cost class
 * `metered`).
 *
 * The result is stored as the record `specstride.harness-verify/1` at the
 * logical name `user:harness-verify:<id>`, physically
 * `<user-state>/harness-verify/<id>.json`, with EXACTLY the field names the
 * owner of the schema (feature 146, feature 100 annex B §B.20) lists:
 *
 *   schema, harness, version, descriptorHash, at, outcome, cases, budget
 *
 * No field is written under another name. A stored result stops counting when
 * the version of the harness or the hash of the descriptor changes.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalRecordHash } from "@specstride/kernel";

/** The schema id of the stored result (the owner's name, annex B §B.20). */
export const VERIFICATION_SCHEMA_ID = "specstride.harness-verify/1" as const;

/**
 * The fields of the record, in the owner's order. EXACTLY these eight: no
 * field under another name is written (F109-FR-025).
 */
export const VERIFICATION_FIELDS = [
  "schema",
  "harness",
  "version",
  "descriptorHash",
  "at",
  "outcome",
  "cases",
  "budget",
] as const;
export type VerificationField = (typeof VERIFICATION_FIELDS)[number];

/** The exit codes of the command. */
export const VERIFY_EXIT_OK = 0 as const;
export const VERIFY_EXIT_FAILED = 2 as const;
export const VERIFY_EXIT_USAGE = 3 as const;

/** The physical path of the logical name `user:harness-verify:<id>`. */
export const VERIFICATION_DIR = "harness-verify" as const;

/** The budget the consumer states on the command line (CQ-063). */
export type VerifyBudget = {
  /** A number of model calls the verification may spend. */
  readonly modelCalls: number;
  /** A time limit for the harness, in seconds. */
  readonly timeLimitSeconds: number;
  /** A spending cap, in addition, for a harness of the cost class `metered`. */
  readonly spendCap?: number;
};

/** A usage error of the command: exit 3. */
export class VerifyUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerifyUsageError";
  }
}

/** Read the budget from the command line. A missing budget is a refusal. */
export function parseBudget(input: unknown): VerifyBudget {
  if (typeof input !== "object" || input === null) {
    throw new VerifyUsageError(
      "harness verify refuses to run without a stated budget (a number of model calls and a time limit, in seconds)",
    );
  }
  const raw = input as Record<string, unknown>;
  const modelCalls = raw.modelCalls;
  const timeLimitSeconds = raw.timeLimitSeconds ?? raw.timeLimit ?? raw.time;
  if (typeof modelCalls !== "number" || !Number.isFinite(modelCalls) || modelCalls < 0) {
    throw new VerifyUsageError(
      "the budget needs a number of model calls (`--model-calls N`); without it the command refuses",
    );
  }
  if (
    typeof timeLimitSeconds !== "number" ||
    !Number.isFinite(timeLimitSeconds) ||
    timeLimitSeconds <= 0
  ) {
    throw new VerifyUsageError(
      "the budget needs a time limit in seconds (`--time-limit-seconds N`); without it the command refuses",
    );
  }
  const budget: { modelCalls: number; timeLimitSeconds: number; spendCap?: number } = {
    modelCalls,
    timeLimitSeconds,
  };
  if (typeof raw.spendCap === "number" && Number.isFinite(raw.spendCap)) {
    budget.spendCap = raw.spendCap;
  }
  return budget;
}

/** One case of the suite, as the record lists it. */
export type VerificationCase = {
  readonly id: string;
  readonly outcome: "passed" | "failed";
};

/** The stored result: exactly the eight fields of the owner. */
export type HarnessVerificationRecord = {
  readonly schema: typeof VERIFICATION_SCHEMA_ID;
  readonly harness: string;
  /** The version of the harness at the verification, or `null` where it states none. */
  readonly version: string | null;
  /** The hash of the harness descriptor, by the canonical hasher. */
  readonly descriptorHash: string;
  /** The date of the verification run. */
  readonly at: string;
  /** `passed` or `failed`. */
  readonly outcome: "passed" | "failed";
  /** Per case of the suite: id and outcome. */
  readonly cases: readonly VerificationCase[];
  /** The stated budget and what was used. */
  readonly budget: {
    readonly stated: VerifyBudget;
    readonly used: { readonly modelCalls: number; readonly seconds: number };
  };
};

/**
 * The hash of a harness descriptor, by the canonical hasher of the kernel
 * (annex X §X.5) — the same hash a run records for the descriptor.
 */
export function descriptorHashOf(descriptor: unknown): string {
  return canonicalRecordHash(descriptor);
}

/**
 * Validate a record against the schema of its owner
 * (`urn:specstride:schema:specstride.harness-verify/1`, the file
 * `specs/146-harness-discovery/contracts/schemas/harness-verify-result.schema.json`).
 * That schema requires the field `schema` to carry the constant and allows the
 * other fields of the owner; this feature additionally writes no field outside
 * the owner's list, so the writer-side check pins the eight names exactly.
 */
export function validateVerificationRecord(
  record: unknown,
): { ok: true; record: HarnessVerificationRecord } | { ok: false; errors: readonly string[] } {
  const errors: string[] = [];
  if (typeof record !== "object" || record === null) {
    return { ok: false, errors: ["the record is not an object"] };
  }
  const raw = record as Record<string, unknown>;
  if (raw.schema !== VERIFICATION_SCHEMA_ID) {
    errors.push(`the field \`schema\` must carry the constant "${VERIFICATION_SCHEMA_ID}"`);
  }
  const known = new Set<string>(VERIFICATION_FIELDS);
  for (const name of Object.keys(raw)) {
    if (!known.has(name)) {
      errors.push(`the field \`${name}\` is not a field of the owner of the schema`);
    }
  }
  for (const name of VERIFICATION_FIELDS) {
    if (!(name in raw)) {
      errors.push(`the field \`${name}\` of the owner is missing`);
    }
  }
  if (raw.outcome !== "passed" && raw.outcome !== "failed") {
    errors.push("the field `outcome` is neither `passed` nor `failed`");
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, record: record as HarnessVerificationRecord };
}

/**
 * Whether a stored verification still counts: it counts while the version of
 * the harness AND the hash of the descriptor are the ones it recorded. A
 * change of either ends the validity (F109-FR-025).
 */
export function verificationHolds(
  record: HarnessVerificationRecord,
  current: { readonly version: string | null; readonly descriptorHash: string },
): boolean {
  return record.version === current.version && record.descriptorHash === current.descriptorHash;
}

/** The physical path of `user:harness-verify:<id>` under a user state root. */
export function verificationPath(userState: string, harness: string): string {
  return join(userState, VERIFICATION_DIR, `${harness}.json`);
}

/** Store the result at `user:harness-verify:<id>`; returns the path written. */
export async function storeVerification(
  userState: string,
  record: HarnessVerificationRecord,
): Promise<string> {
  const validated = validateVerificationRecord(record);
  if (!validated.ok) {
    throw new Error(
      `refusing to store an invalid verification record: ${validated.errors.join("; ")}`,
    );
  }
  const path = verificationPath(userState, record.harness);
  await mkdir(join(userState, VERIFICATION_DIR), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return path;
}

/** Read a stored result back. */
export async function readVerification(path: string): Promise<HarnessVerificationRecord | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as HarnessVerificationRecord;
  } catch {
    return null;
  }
}

/** What the runner of the suite reports to the command. */
export type SuiteRun = {
  readonly cases: readonly { readonly id: string; readonly passed: boolean }[];
  readonly used: { readonly modelCalls: number; readonly seconds: number };
};

export type VerifyOptions = {
  readonly harness: string;
  /** Whether the harness is known in the registry; an unknown one exits 3. */
  readonly knownHarness: boolean;
  readonly descriptor: unknown;
  /** The version of the harness, or `null` where it states none. */
  readonly version: string | null;
  /** The date of the run (the caller's clock; the core reads no platform clock). */
  readonly at: string;
  /** The budget as the consumer stated it, unparsed. */
  readonly budget: unknown;
  /** Runs the conformance suite on the harness, live. */
  readonly runSuite: () => Promise<SuiteRun>;
};

/** The outcome of one run of the command. */
export type VerifyOutcome = {
  readonly exitCode: typeof VERIFY_EXIT_OK | typeof VERIFY_EXIT_FAILED | typeof VERIFY_EXIT_USAGE;
  readonly record: HarnessVerificationRecord | null;
  readonly error?: string;
};

/**
 * Run `harness verify` (F109-FR-025). Refuses without a budget (exit 3) and
 * for an unknown harness (exit 3); exits 2 when a case of the suite failed or
 * the budget ran out; exits 0 and stores the result otherwise.
 */
export async function runHarnessVerify(options: VerifyOptions): Promise<VerifyOutcome> {
  if (!options.knownHarness) {
    return {
      exitCode: VERIFY_EXIT_USAGE,
      record: null,
      error: `unknown harness "${options.harness}"`,
    };
  }
  let budget: VerifyBudget;
  try {
    budget = parseBudget(options.budget);
  } catch (error) {
    return {
      exitCode: VERIFY_EXIT_USAGE,
      record: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const startedAt = Date.now();
  let run: SuiteRun;
  try {
    run = await options.runSuite();
  } catch (error) {
    run = {
      cases: [],
      used: { modelCalls: 0, seconds: (Date.now() - startedAt) / 1000 },
    };
    const failed: HarnessVerificationRecord = {
      schema: VERIFICATION_SCHEMA_ID,
      harness: options.harness,
      version: options.version,
      descriptorHash: descriptorHashOf(options.descriptor),
      at: options.at,
      outcome: "failed",
      cases: [],
      budget: { stated: budget, used: run.used },
    };
    void error;
    return { exitCode: VERIFY_EXIT_FAILED, record: failed };
  }

  const overModelCalls = run.used.modelCalls > budget.modelCalls;
  const overTime = run.used.seconds > budget.timeLimitSeconds;
  const anyFailed = run.cases.some((entry) => !entry.passed);
  const outcome: "passed" | "failed" =
    anyFailed || overModelCalls || overTime ? "failed" : "passed";

  const record: HarnessVerificationRecord = {
    schema: VERIFICATION_SCHEMA_ID,
    harness: options.harness,
    version: options.version,
    descriptorHash: descriptorHashOf(options.descriptor),
    at: options.at,
    outcome,
    cases: run.cases.map((entry) => ({
      id: entry.id,
      outcome: entry.passed ? ("passed" as const) : ("failed" as const),
    })),
    budget: { stated: budget, used: run.used },
  };
  return {
    exitCode: outcome === "passed" ? VERIFY_EXIT_OK : VERIFY_EXIT_FAILED,
    record,
  };
}
