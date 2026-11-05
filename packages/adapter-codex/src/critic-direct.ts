/**
 * T049 / T045–T048 — the critic of form (b), the direct call (F131-FR-025
 * to F131-FR-031, F131-FR-038; C-061, C-066).
 *
 * The plan holds that form (b) has no client here: the call goes through the
 * generic `openai-chat` endpoint client of `@specstride/harness`
 * (`completeOpenaiChat`), driven by the data of `data/descriptor.json`
 * (`endpoint`, `models`, `auth.scheme`) and `data/window-table.json`. This
 * module is the thin wrapper around that client which the requirements of
 * this feature add:
 *
 * | What | Requirement |
 * |---|---|
 * | settings: address (default `https://api.openai.com/v1`, alias `OPENAI_BASE_URL`), key reference `OPENAI_API_KEY`, model (default `gpt-5`, alias `SPECSTRIDE_CODEX_CRITIC_MODEL`) | F131-FR-026, F131-FR-027, F131-FR-028 |
 * | the empty-key error, raised before any request | F131-FR-027 (CQ-187: under `parity` a failed critic call, not a halt) |
 * | the window under `parity`: the as-is table, 128,000 for an unlisted model | F131-FR-029 (DV-106) |
 * | the window outside `parity`: declared > endpoint > adapter table, smaller wins, an unknown model does not qualify | F131-FR-030 (both forms) |
 * | the budget cap: estimate from the prompt, the output limit and the dated prices; refusal `quota_exhausted` / `budget_cap`; a cap without prices is refused; null is no cap | F131-FR-031 |
 * | the output limit, outside `parity` only | F131-FR-025, F131-FR-031 |
 */
import { completeOpenaiChat } from "@specstride/harness";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The default base address of the direct call (F131-FR-026). */
export const DEFAULT_BASE_URL = "https://api.openai.com/v1" as const;

/** The path of the chat call, appended after the trailing slash is removed. */
export const CHAT_PATH = "/chat/completions" as const;

/** The as-is alias of the base address setting (F131-FR-026). */
export const BASE_URL_ALIAS = "OPENAI_BASE_URL" as const;

/** The as-is secret reference of the key of form (b) (F131-FR-027). */
export const KEY_REFERENCE = "OPENAI_API_KEY" as const;

/** The as-is text of the empty-key error, raised before any request. */
export const MISSING_KEY_MESSAGE = "this critic path needs OPENAI_API_KEY" as const;

/** The default model of the critic (F131-FR-028). */
export const MODEL_DEFAULT = "gpt-5" as const;

/** The as-is alias of the model of the critic (F131-FR-028). */
export const MODEL_ALIAS = "SPECSTRIDE_CODEX_CRITIC_MODEL" as const;

/** The fallback window under `parity` only (F131-FR-029, DV-106). */
export const PARITY_FALLBACK_TOKENS = 128_000 as const;

/** The typed failure of an estimate over the remaining cap (F131-FR-031). */
export const CAP_FAILURE = "quota_exhausted" as const;

/** The quota class of the budget cap (F131-FR-031). */
export const CAP_QUOTA_CLASS = "budget_cap" as const;

/** The refusal of a configured critic on a model with no known window (F131-FR-030). */
export const WINDOW_REFUSAL = "critic_config" as const;

/** The refusal of a cap that has no prices to estimate from (F131-FR-031). */
export const CAP_WITHOUT_PRICES_REFUSAL = "budget_cap_without_prices" as const;

/** The window table as data: model id to tokens, provenance `adapter`, dated. */
export type WindowTable = {
  readonly models: Readonly<Record<string, number>>;
  readonly parityFallback: number;
};

/** The dated prices the estimate is computed from (F131-FR-031). */
export type CriticPrices = {
  readonly currency: string;
  readonly input: number;
  readonly output: number;
  readonly asOf: string;
};

/** The resolved settings of one direct call. */
export type CriticDirectSettings = {
  readonly baseUrl: string;
  readonly key: string;
  readonly model: string;
  /** The as-is variable each value came from, or `default`. */
  readonly sources: { readonly baseUrl: string; readonly key: string; readonly model: string };
};

type Env = Readonly<Record<string, string | undefined>>;

/** The package directory, for reading the window table as data. */
const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Reads `data/window-table.json` of this adapter. */
export function loadWindowTable(): WindowTable {
  const raw = JSON.parse(
    readFileSync(join(PACKAGE, "data", "window-table.json"), "utf8"),
  ) as WindowTable;
  return raw;
}

/**
 * F131-FR-026, F131-FR-027, F131-FR-028 — the settings of one direct call:
 * the address from the alias `OPENAI_BASE_URL` or the default, the key from
 * the reference `OPENAI_API_KEY`, the model from the alias
 * `SPECSTRIDE_CODEX_CRITIC_MODEL` or the descriptor default `gpt-5`.
 */
export function resolveCriticDirectSettings(
  env: Env,
  overrides?: {
    readonly baseUrl?: string | null;
    readonly key?: string | null;
    readonly model?: string | null;
  },
): CriticDirectSettings {
  const baseUrl = overrides?.baseUrl ?? env[BASE_URL_ALIAS] ?? DEFAULT_BASE_URL;
  const key = overrides?.key ?? env[KEY_REFERENCE] ?? "";
  const model = overrides?.model ?? env[MODEL_ALIAS] ?? MODEL_DEFAULT;
  return {
    baseUrl,
    key,
    model,
    sources: {
      baseUrl: overrides?.baseUrl ? "caller" : env[BASE_URL_ALIAS] ? BASE_URL_ALIAS : "default",
      key: env[KEY_REFERENCE] ? KEY_REFERENCE : "unset",
      model: overrides?.model
        ? "caller"
        : env[MODEL_ALIAS]
          ? MODEL_ALIAS
          : `default ${MODEL_DEFAULT}`,
    },
  };
}

/** One resolved window: the tokens in force and the source they came from. */
export type ResolvedWindow = {
  readonly tokens: number;
  readonly source: "declared" | "endpoint" | "adapter" | "parity-fallback";
} | null;

/**
 * F131-FR-030 — the order of the window sources outside `parity`: the
 * consumer's declaration; the model-list endpoint, where it reports a window;
 * the table of this adapter. Where a declared and an effective window differ,
 * the smaller wins. Under `parity` (F131-FR-029): the as-is table, then the
 * fallback of 128,000, and an explicit declaration always wins.
 *
 * Returns null where the model does not qualify: outside `parity` a model
 * with no known window and no declaration gets NO window (no fallback), for
 * either form — it does not qualify for an automatic pick, and a consumer
 * who configured a critic on it is refused.
 */
export function resolveCriticWindow(input: {
  readonly model: string;
  readonly profile: "parity" | "default";
  readonly declared?: number | null;
  readonly endpointWindow?: number | null;
  readonly table: WindowTable;
}): ResolvedWindow {
  const declared = input.declared ?? null;
  if (input.profile === "parity") {
    const listed = input.table.models[input.model];
    if (declared !== null) {
      return { tokens: declared, source: "declared" };
    }
    if (listed !== undefined) {
      return { tokens: listed, source: "adapter" };
    }
    return { tokens: input.table.parityFallback, source: "parity-fallback" };
  }
  const effective = input.endpointWindow ?? input.table.models[input.model] ?? null;
  if (declared !== null && effective !== null) {
    return {
      tokens: Math.min(declared, effective),
      source: declared <= effective ? "declared" : "endpoint",
    };
  }
  if (declared !== null) return { tokens: declared, source: "declared" };
  if (effective !== null) {
    return { tokens: effective, source: input.endpointWindow != null ? "endpoint" : "adapter" };
  }
  return null; // no known window: the model does not qualify (no fallback)
}

/**
 * F131-FR-031 — the estimate of one call, from the size of the prompt (4
 * bytes to a token, the same rule the classifier uses), the output limit if
 * one is sent, and the dated prices of the descriptor.
 */
export function estimateCallCost(input: {
  readonly prompt: string;
  readonly outputLimit?: number | null;
  readonly prices: CriticPrices;
}): { readonly inputTokens: number; readonly outputTokens: number; readonly cost: number } {
  const inputTokens = Math.ceil(input.prompt.length / 4);
  const outputTokens = input.outputLimit ?? inputTokens; // unbounded: as much again
  const cost =
    (inputTokens / 1_000_000) * input.prices.input +
    (outputTokens / 1_000_000) * input.prices.output;
  return { inputTokens, outputTokens, cost };
}

/** What the cap check returns where the call may go out, or the refusal. */
export type CapDecision =
  | { readonly allowed: true; readonly estimate: ReturnType<typeof estimateCallCost> }
  | {
      readonly allowed: false;
      readonly reason: typeof CAP_FAILURE | typeof CAP_WITHOUT_PRICES_REFUSAL;
      readonly quotaClass?: typeof CAP_QUOTA_CLASS;
      readonly message: string;
    };

/**
 * F131-FR-031 — the cap decision for one call. A cap of null is no cap. A cap
 * with no prices to estimate from is refused. An estimate over the remaining
 * cap is refused with the typed failure `quota_exhausted`, class
 * `budget_cap`, and the call is never sent.
 */
export function decideBudgetCap(input: {
  readonly cap: number | null;
  readonly prompt: string;
  readonly outputLimit?: number | null;
  readonly prices?: CriticPrices | null;
}): CapDecision {
  if (input.cap === null) {
    return {
      allowed: true,
      estimate: { inputTokens: 0, outputTokens: 0, cost: 0 },
    };
  }
  if (input.prices === null || input.prices === undefined) {
    return {
      allowed: false,
      reason: CAP_WITHOUT_PRICES_REFUSAL,
      message:
        "the budget cap cannot be honoured: the descriptor states no prices to estimate from",
    };
  }
  const estimate = estimateCallCost({
    prompt: input.prompt,
    outputLimit: input.outputLimit,
    prices: input.prices,
  });
  if (estimate.cost > input.cap) {
    return {
      allowed: false,
      reason: CAP_FAILURE,
      quotaClass: CAP_QUOTA_CLASS,
      message: `the estimate ${estimate.cost} exceeds the remaining cap ${input.cap}`,
    };
  }
  return { allowed: true, estimate };
}

/** The record of one direct call: the surfaces state and events read. */
export type CriticDirectRecord = {
  readonly form: "direct-call";
  readonly announced: true;
  readonly transport: "direct-call";
  readonly endpointKind: "openai-chat";
  readonly baseUrl: string;
  readonly model: string;
  readonly window: { readonly tokens: number; readonly source: string } | null;
  readonly profile: "parity" | "default";
  readonly outputLimit: number | null;
  readonly cap: number | null;
  readonly provider: string;
};

/** The outcome of one direct call. */
export type CriticDirectOutcome =
  | { readonly ok: true; readonly reply: string; readonly record: CriticDirectRecord }
  | {
      readonly ok: false;
      /** `missing-key`, `window`, `cap` or the transport failure of the client. */
      readonly reason: string;
      readonly message: string;
      readonly quotaClass?: string;
      readonly record: CriticDirectRecord;
    };

/**
 * F131-FR-025 — one call through the generic `openai-chat` client: one user
 * message that holds the prompt, a bearer key, the model. Under `parity` no
 * output limit is sent; outside it, the caller's limit is sent. The key
 * reaches the request only as the bearer credential — never an argument
 * list, event, log, prompt or record.
 *
 * The empty-key error is raised HERE, before any request is sent; under the
 * `parity` profile the caller scores it as it scores a failed critic call
 * (CQ-187). A model with no known window (outside `parity`) is refused before
 * the call, and so is a cap that cannot be honoured.
 */
export async function callCriticDirect(input: {
  readonly settings: CriticDirectSettings;
  readonly prompt: string;
  readonly profile: "parity" | "default";
  readonly table: WindowTable;
  readonly declaredWindow?: number | null;
  readonly endpointWindow?: number | null;
  readonly outputLimit?: number | null;
  readonly cap?: number | null;
  readonly prices?: CriticPrices | null;
}): Promise<CriticDirectOutcome> {
  // The empty-key error comes before everything: no request is built or sent.
  if (input.settings.key === "") {
    return {
      ok: false,
      reason: "missing-key",
      message: MISSING_KEY_MESSAGE,
      record: blankRecord(input),
    };
  }
  const window = resolveCriticWindow({
    model: input.settings.model,
    profile: input.profile,
    declared: input.declaredWindow ?? null,
    endpointWindow: input.endpointWindow ?? null,
    table: input.table,
  });
  if (window === null) {
    return {
      ok: false,
      reason: WINDOW_REFUSAL,
      message: `the model ${input.settings.model} has no known context window and no declared one; it does not qualify as the critic (F131-FR-030)`,
      record: blankRecord(input),
    };
  }
  const cap = decideBudgetCap({
    cap: input.cap ?? null,
    prompt: input.prompt,
    outputLimit: input.outputLimit ?? null,
    prices: input.prices ?? null,
  });
  if (!cap.allowed) {
    return {
      ok: false,
      reason: cap.reason,
      message: cap.message,
      quotaClass: cap.quotaClass,
      record: blankRecord(input, window),
    };
  }
  // The descriptor the client reads: the data of this adapter, with the live
  // address of the call. The provider of form (b) comes from the host.
  const descriptor: Parameters<typeof completeOpenaiChat>[0] = {
    provider: { id: "openai" },
    auth: { scheme: "bearer" },
    endpoint: { baseUrl: input.settings.baseUrl, chatPath: CHAT_PATH },
    models: { default: input.settings.model },
  };
  const outcome = await completeOpenaiChat(descriptor, {
    prompt: input.prompt,
    model: input.settings.model,
    credential: input.settings.key,
    maxOutputTokens: input.profile === "parity" ? undefined : (input.outputLimit ?? undefined),
  });
  const record: CriticDirectRecord = {
    form: "direct-call",
    announced: true,
    transport: "direct-call",
    endpointKind: "openai-chat",
    baseUrl: input.settings.baseUrl,
    model: input.settings.model,
    window: { tokens: window.tokens, source: window.source },
    profile: input.profile,
    outputLimit: input.profile === "parity" ? null : (input.outputLimit ?? null),
    cap: input.cap ?? null,
    provider: "openai",
  };
  if (!outcome.ok) {
    // An empty choice list (or any reply without content) fails the call: no
    // reply is produced from an empty list of choices (FX-06). The text names
    // the address, so the failure is attributable to the endpoint.
    return {
      ok: false,
      reason: outcome.reason,
      message: `${outcome.message} (at ${input.settings.baseUrl}${CHAT_PATH})`,
      record,
    };
  }
  return { ok: true, reply: outcome.reply, record };
}

function blankRecord(
  input: { readonly settings: CriticDirectSettings; readonly profile: "parity" | "default" },
  window?: { readonly tokens: number; readonly source: string },
): CriticDirectRecord {
  return {
    form: "direct-call",
    announced: true,
    transport: "direct-call",
    endpointKind: "openai-chat",
    baseUrl: input.settings.baseUrl,
    model: input.settings.model,
    window: window ?? null,
    profile: input.profile,
    outputLimit: null,
    cap: null,
    provider: "openai",
  };
}
