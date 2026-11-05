/**
 * T029 — the builder of the argument lists of the Codex adapter
 * (F131-FR-008, F131-FR-009, F131-FR-010, F131-FR-011; data only, from
 * `data/argument-table.json`, copied from
 * `specs/131-adapter-codex/contracts/argument-table.json`).
 *
 * Two shapes of the proposer are implemented here; the critic shape of
 * form (a) is provided for the containment rule (no critic path ever
 * receives the allow-all flag) and is exercised by the later phases.
 *
 *   `parity`   exec, the allow-all flag, [--model M], the prompt as ONE
 *              positional argument; the output is raw text; no stream
 *              option, no session option, no memory flag, no stdin, and no
 *              flag that the Claude arm of the baseline passes.
 *   `default`  exec, the JSONL stream option, the sandbox mode
 *              `workspace-write`, approvals never (a configuration
 *              override; `unverified` until capture 2), the working
 *              directory stated, and the prompt on standard input — never
 *              in an argument list.
 *
 * The mode is stated on EVERY call and recorded on the plan the builder
 * returns. The sandbox of the harness that cannot start ends the pass with
 * the typed failure `capability_absent`: the adapter NEVER falls back to
 * the allow-all flag by itself (F131-FR-011); the only other route to the
 * flag is the opt-in to containment C0 in USER configuration (F131-FR-010).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The one flag of the harness that removes the sandbox AND the approvals. */
export const CODEX_ALLOW_ALL_FLAG = "--dangerously-bypass-approvals-and-sandbox";

/** The flags of the Claude arm of the baseline that MUST NOT be passed. */
export const FORBIDDEN_CLAUDE_FLAGS = [
  "--dangerously-skip-permissions",
  "--print",
  "--output-format",
  "--verbose",
  "--permission-mode",
] as const;

/** The sandbox mode of the default (contained) proposer pass. */
export const CODEX_DEFAULT_SANDBOX_MODE = "workspace-write" as const;

/** The sandbox mode of the critic of form (a). */
export const CODEX_READ_ONLY_SANDBOX_MODE = "read-only" as const;

/**
 * F131-FR-009 — how approvals are set to never: a configuration override
 * of the harness (`exec` shows no approval option in 0.153.4). Marked
 * `unverified` until capture 2 records the policy in force.
 */
export const CODEX_APPROVALS_OVERRIDE = Object.freeze({ approval_policy: "never" }) as Readonly<
  Record<string, string>
>;

/** The typed failure the harness port names for a missing capability. */
export const CAPABILITY_ABSENT = "capability_absent" as const;

/** Where an opt-in value may come from; only the user configuration counts. */
export const C0_OPT_IN_SOURCES = ["user-config", "environment", "flag", "project-config"] as const;
export type C0OptInSource = (typeof C0_OPT_IN_SOURCES)[number];

/** One observed value of the opt-in key `sandbox.level`, with its source. */
export type C0OptInValue = { readonly value: string; readonly source: C0OptInSource };

/** The profiles that change the invocation shape. */
export type CodexProfile = "parity" | "default";

/** `data/argument-table.json`, the shapes as data. */
export type CodexArgumentTable = {
  readonly schema: string;
  readonly verifiedOn: string;
  readonly pin: string;
  readonly checkedBy: string;
  readonly shapes: Readonly<Record<string, readonly string[]>>;
  readonly unverified: readonly string[];
};

let cachedTable: CodexArgumentTable | null = null;

/** The argument table of the adapter, read from the package's data. */
export function codexArgumentTable(): CodexArgumentTable {
  if (cachedTable === null) {
    cachedTable = JSON.parse(
      readFileSync(fileURLToPath(new URL("../data/argument-table.json", import.meta.url)), "utf8"),
    ) as CodexArgumentTable;
  }
  return cachedTable;
}

/**
 * F131-FR-010 — is the allow-all flag permitted for this pass? Only under
 * the `parity` profile, or where the consumer opted in to containment C0 in
 * USER configuration. The same value `C0` from the environment, from a flag
 * or from project configuration is treated as not given.
 */
export function allowAllPermitted(input: {
  readonly profile: CodexProfile;
  readonly c0OptInValues?: readonly C0OptInValue[];
}): boolean {
  if (input.profile === "parity") return true;
  for (const one of input.c0OptInValues ?? []) {
    if (one.source === "user-config" && one.value === "C0") return true;
  }
  return false;
}

/** What is recorded about the mode of one pass, per call. */
export type CodexModeRecord = {
  /** The sandbox mode in force, or `allow-all` where the flag is passed. */
  readonly sandboxMode: string;
  readonly approvals: "never";
  /** Whether the allow-all flag is on the list. */
  readonly allowAll: boolean;
  /** Why the flag is or is not on the list (parity, opt-in, contained). */
  readonly allowAllReason: string;
  /** The role the list is built for. */
  readonly role: "proposer" | "critic";
  readonly profile: CodexProfile;
  /** The stated mode of the call, recorded on every call (F131-FR-009). */
  readonly modeStated: true;
};

/** The plan of one invocation: the list, the prompt channel and the record. */
export type CodexInvocationPlan = {
  readonly args: readonly string[];
  /** Whether the prompt travels on standard input (never an argument). */
  readonly promptOnStdin: boolean;
  /** Whether the output is read as raw text (the `parity` form). */
  readonly rawTextOutput: boolean;
  /** The configuration overrides the call carries (approvals never). */
  readonly configOverrides: Readonly<Record<string, string>>;
  readonly record: CodexModeRecord;
};

export type ProposerArgumentInput = {
  readonly profile: CodexProfile;
  /** The prompt text; on stdin outside `parity`, one positional inside. */
  readonly prompt: string;
  readonly workdir: string;
  /** The model named by the run's configuration, or null. */
  readonly model?: string | null;
  /** Run without persisting session files (F131-FR-013). */
  readonly ephemeral?: boolean;
  /** Needed only outside a git repository. */
  readonly skipGitRepoCheck?: boolean;
  /** Every value of the opt-in key `sandbox.level` the run saw. */
  readonly c0OptInValues?: readonly C0OptInValue[];
  /** Whether the harness's sandbox could start on this machine. */
  readonly sandboxCanStart?: boolean;
};

/** The typed refusal when the sandbox cannot start and no opt-in exists. */
export class CapabilityAbsentError extends Error {
  public readonly typedFailure = CAPABILITY_ABSENT;
  public readonly capability = "sandbox";

  constructor(detail: string) {
    super(`capability_absent: the sandbox of codex cannot start (${detail})`);
    this.name = "CapabilityAbsentError";
  }
}

function assertNoForbiddenFlags(args: readonly string[]): void {
  for (const flag of FORBIDDEN_CLAUDE_FLAGS) {
    if (args.includes(flag)) {
      throw new Error(`the flag of the Claude arm of the baseline must not be passed: ${flag}`);
    }
  }
}

/**
 * F131-FR-008 — the `parity` shape: `exec`, the allow-all flag, `--model M`
 * only when a model was named, then the prompt as one positional argument,
 * in this order. Output raw text; no stdin, no session, no memory flag.
 */
export function parityProposerArgumentList(input: {
  readonly prompt: string;
  readonly model?: string | null;
}): readonly string[] {
  const args: string[] = ["exec", CODEX_ALLOW_ALL_FLAG];
  if (input.model) args.push("--model", input.model);
  args.push(input.prompt);
  assertNoForbiddenFlags(args);
  return args;
}

/**
 * F131-FR-009 — the default (contained) shape: `exec`, the JSONL stream
 * option, the sandbox mode `workspace-write`, the working directory stated,
 * the prompt on standard input. Approvals never is the configuration
 * override the plan records; the prompt is never an argument.
 */
export function defaultProposerArgumentList(input: {
  readonly workdir: string;
  readonly model?: string | null;
  readonly ephemeral?: boolean;
  readonly skipGitRepoCheck?: boolean;
  /** The consumer's own C0 opt-in: the flag replaces the sandbox mode. */
  readonly allowAll?: boolean;
}): readonly string[] {
  const args: string[] = ["exec"];
  if (input.allowAll === true) {
    args.push(CODEX_ALLOW_ALL_FLAG, "-C", input.workdir);
  } else {
    args.push("--json", "-s", CODEX_DEFAULT_SANDBOX_MODE, "-C", input.workdir);
  }
  if (input.model) args.push("-m", input.model);
  args.push("--ignore-user-config", "--ignore-rules");
  if (input.ephemeral === true) args.push("--ephemeral");
  if (input.skipGitRepoCheck === true) args.push("--skip-git-repo-check");
  args.push("-"); // the prompt arrives on standard input
  assertNoForbiddenFlags(args);
  return args;
}

/**
 * F131-FR-011 — build the plan of one proposer pass. Where the sandbox
 * cannot start and containment C0 was not opted in, in user configuration
 * only, the pass ends with the typed failure `capability_absent`: there is
 * NO fallback to the allow-all flag from the adapter itself.
 */
export function buildProposerPlan(input: ProposerArgumentInput): CodexInvocationPlan {
  const allowed = allowAllPermitted({
    profile: input.profile,
    c0OptInValues: input.c0OptInValues,
  });
  if (input.profile === "parity") {
    const args = parityProposerArgumentList({ prompt: input.prompt, model: input.model });
    return {
      args,
      promptOnStdin: false,
      rawTextOutput: true,
      configOverrides: {},
      record: {
        sandboxMode: "allow-all",
        approvals: "never",
        allowAll: true,
        allowAllReason: "the parity profile runs the pass as the baseline does (F131-FR-008)",
        role: "proposer",
        profile: input.profile,
        modeStated: true,
      },
    };
  }
  if (!allowed && input.sandboxCanStart === false) {
    // F131-FR-011: typed failure, the doctor says why, no fallback.
    throw new CapabilityAbsentError(
      "the mode workspace-write cannot start; opt in to C0 in the user configuration only, or repair the sandbox",
    );
  }
  const args = defaultProposerArgumentList({
    workdir: input.workdir,
    model: input.model,
    ephemeral: input.ephemeral,
    skipGitRepoCheck: input.skipGitRepoCheck,
    allowAll: allowed,
  });
  return {
    args,
    promptOnStdin: true,
    rawTextOutput: false,
    configOverrides: CODEX_APPROVALS_OVERRIDE,
    record: {
      sandboxMode: allowed ? "allow-all" : CODEX_DEFAULT_SANDBOX_MODE,
      approvals: "never",
      allowAll: allowed,
      allowAllReason: allowed
        ? "containment C0 opted in, in the user configuration only (F131-FR-010)"
        : "no opt-in: the pass runs contained (F131-FR-010)",
      role: "proposer",
      profile: input.profile,
      modeStated: true,
    },
  };
}

/**
 * F131-FR-010, F131-FR-016 — the critic shape of form (a): `read-only`,
 * ephemeral, configuration and rules ignored, the prompt on stdin. NO
 * critic path EVER receives the allow-all flag; the critic accepts no opt-in
 * at all, which is why the input type has none.
 */
export function buildCriticReadonlyPlan(input: {
  readonly workdir: string;
  readonly model: string;
}): CodexInvocationPlan {
  const args = [
    "exec",
    "--json",
    "-s",
    CODEX_READ_ONLY_SANDBOX_MODE,
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "-C",
    input.workdir,
    "-m",
    input.model,
    "-",
  ];
  assertNoForbiddenFlags(args);
  return {
    args,
    promptOnStdin: true,
    rawTextOutput: false,
    configOverrides: CODEX_APPROVALS_OVERRIDE,
    record: {
      sandboxMode: CODEX_READ_ONLY_SANDBOX_MODE,
      approvals: "never",
      allowAll: false,
      allowAllReason: "no critic path ever receives the allow-all flag (F131-FR-010)",
      role: "critic",
      profile: "default",
      modeStated: true,
    },
  };
}

/**
 * F131-FR-011 — the read-denial fact of the adapter, read from the state of
 * capture 3. Until the capture is made the fact is null: the adapter
 * reports null and the doctor says that the ceiling holds for writes.
 */
export function readDenialFact(
  capture3: {
    readonly status?: string;
    readonly denialFixture?: string | null;
  } | null,
): boolean | null {
  if (capture3 === null || capture3.status !== "verified") return null;
  return capture3.denialFixture !== null && capture3.denialFixture !== undefined;
}
