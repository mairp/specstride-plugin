/**
 * T043 — form (a) of the critic: the harness under its own read-only sandbox
 * (F131-FR-016 to F131-FR-024).
 *
 * The pieces, in the order a call meets them:
 *
 *   - the withheld-paths check (F131-FR-018): the record of feature 100
 *     annex C §C.4 is read before anything starts; every path under `moved`
 *     (the proposer's notebook, handoff and outbox) MUST be outside the
 *     working tree and `deny` MUST hold the five locations. The adapter
 *     refuses to start otherwise, and never moves, reads or deletes the
 *     moved files itself — the restoration is the runtime's.
 *   - the read-denial probe (F131-FR-019): a model-free probe that plants a
 *     file at each `deny` location and reads it under the same sandbox
 *     settings. Confirmed only where every read is refused.
 *   - the invocation (F131-FR-016): `read-only`, ephemeral, configuration
 *     and rules ignored, the network off for the commands the model runs,
 *     in the working tree, the prompt on standard input, no allow-all flag
 *     ever, and the time limit of a critic-class call at which the process
 *     and every process of its group are ended.
 *   - the proof (F131-FR-020, F131-FR-021): five facts with the source of
 *     each, the session-proof case of F100-FR-230 named, and the refusals
 *     `critic_not_toolless` (engine exit 3, stop reason `critic_config`)
 *     where the proof fails; an automatically picked critic is passed over
 *     with an announcement.
 *   - the reply (F131-FR-022): the final message of the stream, and no
 *     verdict where the exit code is not 0, the turn failed or no final
 *     message exists.
 *   - the form (F131-FR-024): form (a) at auth tier 1, form (b) at tier 2
 *     and under `parity`; announced at launch, recorded per call.
 *
 * The exception and its residual risk (F131-FR-023) are stated here and are
 * reported by `capabilities`, the descriptor and the doctor.
 */

import { spawn } from "node:child_process";
import { buildCriticReadonlyPlan, CODEX_READ_ONLY_SANDBOX_MODE } from "./arguments.ts";
import { firstRecordSessionId, parseJsonlStream } from "./session.ts";

/** The typed refusal of a configured critic that cannot prove it is tool-less. */
export const CRITIC_NOT_TOOLLESS = "critic_not_toolless" as const;

/** The engine exit code that halts the run on `critic_config`. */
export const CRITIC_CONFIG_EXIT = 3 as const;

/** The stop reason the engine records when the run halts. */
export const CRITIC_CONFIG_STOP_REASON = "critic_config" as const;

/** The time limit of a critic-class call at the baseline (annex X §X.8). */
export const CRITIC_TIME_LIMIT_MS_DEFAULT = 300_000 as const;

/** The network setting of every call of form (a): off for the model's commands. */
export const CRITIC_NETWORK_SETTING = "off" as const;

/**
 * The five locations `deny` MUST hold (feature 100, annex C §C.4): the
 * workspace part, the control plane, the event stream, the worker root and
 * the tree store.
 */
export const DENY_LOCATIONS = [
  "workspace-part",
  "control-plane",
  "event-stream",
  "worker-root",
  "tree-store",
] as const;
export type DenyLocation = (typeof DENY_LOCATIONS)[number];

/**
 * The session proof of this harness: case (2) of F100-FR-230 — the harness
 * gives the id itself, and the id of the first record equals no session id
 * of any pass of the run (F131-FR-021). The call record names this case.
 */
export const SESSION_PROOF_CASE = "F100-FR-230 case 2" as const;

/**
 * F131-FR-023 — form (a) is a stated exception to Principles III and IX,
 * limited to reading project files; the owner accepted the risk (ruling
 * 57a; threat T-48).
 */
export const FORM_A_EXCEPTION =
  "form (a), the harness under its own read-only sandbox, is a stated exception to Principles III and IX, limited to reading project files" as const;

/** F131-FR-023 — the residual risk, and the ruling that accepted it. */
export const FORM_A_RESIDUAL_RISK =
  "residual risk: repository text reaches this critic without passing the grounding snapshot (owner ruling 57a; threat T-48)" as const;

/** The two forms of the critic of this harness (F131-FR-024). */
export type CriticForm = "readonly-sandbox" | "direct-call";

/* ------------------------------------------------------------------ *
 * The withheld paths (F131-FR-018)
 * ------------------------------------------------------------------ */

/** The record of withheld paths of feature 100, annex C §C.4. */
export type WithheldPathsRecord = {
  readonly deny: readonly string[];
  readonly moved: readonly string[];
  readonly confirmed?: boolean | null;
};

export type WithheldPathsCheck = {
  readonly ok: boolean;
  /** Each problem names the path or the missing location, never a value. */
  readonly problems: readonly string[];
};

/**
 * F131-FR-018 — judge the record: every path under `moved` must be OUTSIDE
 * the working tree, and `deny` must hold all five locations. The adapter
 * never touches the moved files; it only reads the record and the tree.
 */
export function withheldPathsCheck(
  record: WithheldPathsRecord,
  workdir: string,
): WithheldPathsCheck {
  const problems: string[] = [];
  for (const location of DENY_LOCATIONS) {
    if (!record.deny.includes(location)) problems.push(`deny lacks the location ${location}`);
  }
  for (const moved of record.moved) {
    if (insideTree(moved, workdir)) {
      problems.push(`the moved path ${moved} is inside the working tree`);
    }
  }
  return { ok: problems.length === 0, problems };
}

function insideTree(path: string, workdir: string): boolean {
  const norm = path.replace(/\/+$/, "");
  if (norm === workdir) return true;
  return norm.startsWith(workdir.endsWith("/") ? workdir : `${workdir}/`);
}

/** The typed refusal to start a call of form (a) on an unsafe tree. */
export class WithheldPathsError extends Error {
  public readonly typedFailure = "withheld_paths_unsafe" as const;
  public readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`withheld_paths_unsafe: form (a) refuses to start (${problems.join("; ")})`);
    this.name = "WithheldPathsError";
    this.problems = problems;
  }
}

/** F131-FR-018 — refuse to start unless the record and the tree are safe. */
export function assertWithheldPaths(record: WithheldPathsRecord, workdir: string): void {
  const check = withheldPathsCheck(record, workdir);
  if (!check.ok) throw new WithheldPathsError(check.problems);
}

/* ------------------------------------------------------------------ *
 * The read-denial probe (F131-FR-019)
 * ------------------------------------------------------------------ */

/** One location the probe planted a file at, and what the read did. */
export type DenialProbeLocation = {
  readonly location: DenyLocation;
  /** Whether a file could be planted at the location at all. */
  readonly planted: boolean;
  /** Whether the read under the same sandbox settings succeeded. */
  readonly readSucceeded: boolean;
};

export type DenialProbeResult = {
  readonly confirmed: boolean;
  readonly locations: readonly DenialProbeLocation[];
  /** Why the probe came out unconfirmed, where it did. */
  readonly reason: string | null;
};

/**
 * F131-FR-019 — the read-denial probe: a file is planted at each `deny`
 * location and read under the SAME sandbox settings, with no model call.
 * `confirmed` is true only where the probe could run, every location was
 * planted and every read was refused. A read that succeeds, or a probe
 * that cannot run, leaves `confirmed` false and form (a) unused.
 */
export function readDenialProbe(input: {
  readonly record: WithheldPathsRecord;
  /** Whether the probe could be run at all on this machine. */
  readonly runnable: boolean;
  /** The per-location result of the reads under the sandbox settings. */
  readonly reads: readonly DenialProbeLocation[];
}): DenialProbeResult {
  if (!input.runnable) {
    return {
      confirmed: false,
      locations: input.reads,
      reason: "the probe could not be run on this machine",
    };
  }
  const byLocation = new Map(input.reads.map((one) => [one.location, one]));
  const locations: DenialProbeLocation[] = DENY_LOCATIONS.map((location) => {
    const found = byLocation.get(location);
    return found ?? { location, planted: false, readSucceeded: true };
  });
  const notPlanted = locations.filter((one) => !one.planted);
  if (notPlanted.length > 0) {
    return {
      confirmed: false,
      locations,
      reason: `no file could be planted at: ${notPlanted.map((one) => one.location).join(", ")}`,
    };
  }
  const read = locations.filter((one) => one.readSucceeded);
  if (read.length > 0) {
    return {
      confirmed: false,
      locations,
      reason: `a read succeeded at: ${read.map((one) => one.location).join(", ")}`,
    };
  }
  return { confirmed: true, locations, reason: null };
}

/* ------------------------------------------------------------------ *
 * The invocation (F131-FR-016)
 * ------------------------------------------------------------------ */

/** The plan of one call of form (a), with the rules the call keeps. */
export type FormAInvocation = {
  readonly args: readonly string[];
  readonly promptOnStdin: true;
  readonly sandboxMode: typeof CODEX_READ_ONLY_SANDBOX_MODE;
  readonly networkSetting: typeof CRITIC_NETWORK_SETTING;
  readonly ephemeral: true;
  readonly allowAll: false;
  /** The time limit of a critic-class call, in milliseconds. */
  readonly timeLimitMs: number;
  /** The call runs in its own process group, ended whole at the limit. */
  readonly processGroup: true;
  readonly memorySwitches: { readonly memory: "off"; readonly customisations: "off" };
};

/**
 * F131-FR-016 — build the invocation of form (a). No critic path ever
 * receives the allow-all flag; the critic accepts no containment opt-in.
 */
export function buildFormAInvocation(input: {
  readonly workdir: string;
  readonly model: string;
  readonly timeLimitMs?: number;
}): FormAInvocation {
  const plan = buildCriticReadonlyPlan({ workdir: input.workdir, model: input.model });
  if (plan.record.allowAll !== false || plan.record.sandboxMode !== CODEX_READ_ONLY_SANDBOX_MODE) {
    throw new Error("the critic of form (a) must run read-only and never allow-all");
  }
  return {
    args: plan.args,
    promptOnStdin: true,
    sandboxMode: CODEX_READ_ONLY_SANDBOX_MODE,
    networkSetting: CRITIC_NETWORK_SETTING,
    ephemeral: true,
    allowAll: false,
    timeLimitMs: input.timeLimitMs ?? CRITIC_TIME_LIMIT_MS_DEFAULT,
    processGroup: true,
    memorySwitches: { memory: "off", customisations: "off" },
  };
}

/**
 * F131-FR-016 — end the process and every process of its group. A group id
 * that is not an integer above one is refused: the caller of a group signal
 * must name a real group of its own child.
 */
export function endProcessGroup(pgid: number): { ended: boolean; refused: string | null } {
  if (!Number.isInteger(pgid) || pgid <= 1) {
    return { ended: false, refused: `the group id ${pgid} is not an integer above one` };
  }
  try {
    process.kill(-pgid, "SIGKILL");
    return { ended: true, refused: null };
  } catch {
    return { ended: false, refused: `the group ${pgid} could not be signalled` };
  }
}

/** What one call of form (a) observed about its own process. */
export type FormACallResult = {
  readonly exitCode: number | null;
  readonly streamText: string;
  readonly stderr: string;
  /** True where the time limit ended the process group. */
  readonly timedOut: boolean;
  readonly pgid: number | null;
};

/**
 * F131-FR-016 — run one call of form (a): the prompt on standard input, the
 * JSONL stream on standard output, the child in its own process group, and
 * the time limit that ends the process AND every process of its group.
 */
export function runFormACall(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly prompt: string;
  readonly cwd: string;
  readonly timeLimitMs: number;
  readonly env?: Readonly<Record<string, string>>;
}): Promise<FormACallResult> {
  return new Promise((resolve) => {
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: input.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true, // the child leads its own process group
    });
    let streamText = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    child.stdout.on("data", (chunk: Buffer) => {
      streamText += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) endProcessGroup(child.pid);
    }, input.timeLimitMs);
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, streamText, stderr, timedOut, pgid: child.pid ?? null });
    };
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
    child.stdin.on("error", () => {
      // a child that closed its standard input early is not a write failure
    });
    child.stdin.end(input.prompt, "utf8");
  });
}

/* ------------------------------------------------------------------ *
 * The proof (F131-FR-020, F131-FR-021)
 * ------------------------------------------------------------------ */

/** Where each fact of the call record came from (F131-FR-020). */
export type ProofFactSource =
  "stream-first-record" | "adapter-invocation-record" | "read-denial-probe";

/** One fact of the call record: its value and its source. */
export type ProofFact<T> = {
  readonly value: T;
  readonly source: ProofFactSource;
};

/** The call record of form (a) (the data model's "call record of form (a)"). */
export type FormACallRecord = {
  readonly form: CriticForm;
  readonly sandboxMode: ProofFact<string>;
  readonly networkSetting: ProofFact<string>;
  readonly ephemeral: ProofFact<boolean>;
  readonly sessionId: ProofFact<string | null>;
  readonly confirmed: ProofFact<boolean>;
  /** The session proof case this harness takes (F100-FR-230, case 2). */
  readonly sessionProofCase: typeof SESSION_PROOF_CASE;
  /** The form was announced at launch (F131-FR-024). */
  readonly announced: true;
};

/**
 * F131-FR-020 — assemble the call record. A fact the first record of the
 * stream states comes from it; every other fact comes from the adapter's
 * own record of the invocation, and the source says which. The session id
 * is the id of the FIRST record of the stream, or null where the stream
 * carries none.
 */
export function buildFormACallRecord(input: {
  readonly invocation: FormAInvocation;
  readonly streamText: string;
  readonly probe: DenialProbeResult;
  /** The sandbox mode the first record states, where it states one. */
  readonly streamStatesSandboxMode?: string | null;
  readonly networkFromStream?: string | null;
  readonly ephemeralFromStream?: boolean | null;
}): FormACallRecord {
  const pairs = parseJsonlStream(input.streamText);
  const sessionId = firstRecordSessionId(pairs);
  const stated = input.streamStatesSandboxMode ?? null;
  return {
    form: "readonly-sandbox",
    sandboxMode:
      stated !== null
        ? { value: stated, source: "stream-first-record" }
        : { value: input.invocation.sandboxMode, source: "adapter-invocation-record" },
    networkSetting:
      input.networkFromStream != null
        ? { value: input.networkFromStream, source: "stream-first-record" }
        : { value: input.invocation.networkSetting, source: "adapter-invocation-record" },
    ephemeral:
      input.ephemeralFromStream != null
        ? { value: input.ephemeralFromStream, source: "stream-first-record" }
        : { value: input.invocation.ephemeral, source: "adapter-invocation-record" },
    sessionId: { value: sessionId, source: "stream-first-record" },
    confirmed: { value: input.probe.confirmed, source: "read-denial-probe" },
    sessionProofCase: SESSION_PROOF_CASE,
    announced: true,
  };
}

/** The outcome of the proof of one call of form (a). */
export type FormAProof =
  | { readonly ok: true; readonly record: FormACallRecord }
  | {
      readonly ok: false;
      readonly refusal: typeof CRITIC_NOT_TOOLLESS;
      readonly engineExit: typeof CRITIC_CONFIG_EXIT;
      readonly stopReason: typeof CRITIC_CONFIG_STOP_REASON;
      readonly problems: readonly string[];
    };

/**
 * F131-FR-020, F131-FR-021 — the proof. Every one of the five facts must be
 * present and right, and the session id must equal no session id that any
 * pass of the run used. A proof that fails refuses a configured critic with
 * `critic_not_toolless` (engine exit 3, stop reason `critic_config`).
 */
export function proofOfFormA(input: {
  readonly record: FormACallRecord;
  /** Every session id a pass of the run used, earlier attempts included. */
  readonly passSessionIds: readonly string[];
}): FormAProof {
  const problems: string[] = [];
  if (input.record.sandboxMode.value !== CODEX_READ_ONLY_SANDBOX_MODE) {
    problems.push(`the sandbox mode is ${input.record.sandboxMode.value}, not read-only`);
  }
  if (input.record.networkSetting.value !== CRITIC_NETWORK_SETTING) {
    problems.push(`the network setting is ${input.record.networkSetting.value}, not off`);
  }
  if (input.record.ephemeral.value !== true) {
    problems.push("the session is not ephemeral");
  }
  if (input.record.confirmed.value !== true) {
    problems.push("the read denial is not confirmed");
  }
  const sessionId = input.record.sessionId.value;
  if (sessionId === null || sessionId === "") {
    problems.push("the record carries no session id");
  } else if (input.passSessionIds.includes(sessionId)) {
    problems.push("the session id equals one a pass of the run used");
  }
  if (problems.length > 0) {
    return {
      ok: false,
      refusal: CRITIC_NOT_TOOLLESS,
      engineExit: CRITIC_CONFIG_EXIT,
      stopReason: CRITIC_CONFIG_STOP_REASON,
      problems,
    };
  }
  return { ok: true, record: input.record };
}

/* ------------------------------------------------------------------ *
 * The critic order (F131-FR-019, F131-FR-020; F100-FR-230)
 * ------------------------------------------------------------------ */

/** What passing one candidate of the critic order over looks like. */
export type CriticOrderPassOver = {
  readonly passedOver: string;
  readonly next: string | null;
  /** The announcement, raised where an automatically picked critic moves on. */
  readonly announcement: string;
};

/**
 * F131-FR-019, F131-FR-020 — pass the failed candidate over for the next
 * one of the critic order, announced and recorded.
 */
export function passOverCritic(order: readonly string[], failed: string): CriticOrderPassOver {
  const index = order.indexOf(failed);
  const next = index >= 0 ? (order[index + 1] ?? null) : null;
  return {
    passedOver: failed,
    next,
    announcement: `critic candidate "${failed}" is passed over (${CRITIC_NOT_TOOLLESS}); the critic order moves on to "${next ?? "nothing"}"`,
  };
}

/* ------------------------------------------------------------------ *
 * The reply (F131-FR-022)
 * ------------------------------------------------------------------ */

/**
 * F131-FR-022 — build the prompt: the grounding snapshot and, where one
 * exists, the fact block, bound to the nonce of the call. Nothing beyond
 * what the calling convention needs is added.
 */
export function buildCriticPrompt(input: {
  readonly snapshot: string;
  readonly factBlock?: string | null;
  readonly nonce: string;
  readonly question: string;
}): string {
  const parts = [`critic-call nonce: ${input.nonce}`, "grounding snapshot:", input.snapshot];
  if (input.factBlock !== null && input.factBlock !== undefined) {
    parts.push("fact block:", input.factBlock);
  }
  parts.push(input.question);
  return `${parts.join("\n")}\n`;
}

/**
 * F131-FR-022 — the final message of the stream: the last `item.completed`
 * record whose item is an agent message. The text of a tool or a command is
 * never read as the reply.
 */
export function finalMessageOfStream(streamText: string): string | null {
  let message: string | null = null;
  for (const [, record] of parseJsonlStream(streamText)) {
    if (record["type"] !== "item.completed") continue;
    const item = record["item"];
    if (typeof item !== "object" || item === null) continue;
    const kind = (item as Record<string, unknown>)["type"];
    if (kind !== "agent_message") continue;
    const text = (item as Record<string, unknown>)["text"];
    if (typeof text === "string") message = text;
  }
  return message;
}

/** The verdict of one call, or the reason there is none (F131-FR-022). */
export type CriticVerdict = {
  /** The final message where the call gives a verdict; null where not. */
  readonly verdict: string | null;
  readonly nonce: string;
  readonly reason: "final-message" | "non-zero-exit" | "failed-turn" | "no-final-message";
};

/**
 * F131-FR-022 — bind the reply to the nonce of the call. A process that
 * exits with a code other than 0, a stream that shows a failed turn, or a
 * stream with no final message gives NO verdict and is reported as a failed
 * critic-class call.
 */
export function criticVerdict(input: {
  readonly exitCode: number | null;
  readonly streamText: string;
  readonly nonce: string;
}): CriticVerdict {
  if (input.exitCode !== 0) {
    return { verdict: null, nonce: input.nonce, reason: "non-zero-exit" };
  }
  for (const [, record] of parseJsonlStream(input.streamText)) {
    if (record["type"] === "turn.failed") {
      return { verdict: null, nonce: input.nonce, reason: "failed-turn" };
    }
  }
  const message = finalMessageOfStream(input.streamText);
  if (message === null) {
    return { verdict: null, nonce: input.nonce, reason: "no-final-message" };
  }
  return { verdict: message, nonce: input.nonce, reason: "final-message" };
}

/* ------------------------------------------------------------------ *
 * The refusals the mode itself provides (F131-FR-017, F131-SC-001)
 * ------------------------------------------------------------------ */

/** One seeded attempt the critic makes from inside the sandbox. */
export type SeededAttempt = {
  readonly kind: "write" | "network";
  readonly target: string;
};

export type SeededAttemptOutcome = {
  readonly attempt: SeededAttempt;
  readonly refused: boolean;
  readonly by: "sandbox-mode" | "network-setting";
};

/**
 * F131-FR-017 — judge a seeded attempt against the mode the call ran
 * under. A write under `read-only` is refused by the sandbox mode; a
 * network attempt is refused by the network setting, which is off on every
 * call. The live probe of F131-FR-038 observes the same refusals on the
 * real harness; here the fake binary carries the mode on every call.
 */
export function seededAttemptOutcome(
  attempt: SeededAttempt,
  call: { readonly sandboxMode: string; readonly networkSetting: string },
): SeededAttemptOutcome {
  if (attempt.kind === "write") {
    return {
      attempt,
      refused: call.sandboxMode === CODEX_READ_ONLY_SANDBOX_MODE,
      by: "sandbox-mode",
    };
  }
  return {
    attempt,
    refused: call.networkSetting === CRITIC_NETWORK_SETTING,
    by: "network-setting",
  };
}

/* ------------------------------------------------------------------ *
 * The form (F131-FR-024)
 * ------------------------------------------------------------------ */

/**
 * F131-FR-024 — the form by auth tier: form (a) where the credential is the
 * consumer's login (tier 1), form (b) where it is an API key (tier 2). Under
 * the `parity` profile the critic is form (b).
 */
export function chooseCriticForm(input: {
  readonly authTier: 1 | 2;
  readonly profile: "parity" | "default";
}): CriticForm {
  if (input.profile === "parity") return "direct-call";
  return input.authTier === 1 ? "readonly-sandbox" : "direct-call";
}

/** The announcement of the form in use, raised at launch (F131-FR-024). */
export function announceCriticForm(form: CriticForm): string {
  const stated =
    form === "readonly-sandbox"
      ? "form (a): the harness under its own read-only sandbox in the working tree"
      : "form (b): a direct call to the provider's API with a key";
  return `codex critic form in use: ${stated}`;
}

/* ------------------------------------------------------------------ *
 * The exception and its residual risk (F131-FR-023)
 * ------------------------------------------------------------------ */

/** What `capabilities`, the descriptor and the doctor state for form (a). */
export function formARiskStatement(): {
  readonly form: "readonly-sandbox";
  readonly exception: typeof FORM_A_EXCEPTION;
  readonly residualRisk: typeof FORM_A_RESIDUAL_RISK;
  readonly ruling: "57a";
  readonly threat: "T-48";
} {
  return {
    form: "readonly-sandbox",
    exception: FORM_A_EXCEPTION,
    residualRisk: FORM_A_RESIDUAL_RISK,
    ruling: "57a",
    threat: "T-48",
  };
}
