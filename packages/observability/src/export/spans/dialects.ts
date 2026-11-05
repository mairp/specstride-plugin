/**
 * T074 — the optional attribute dialects of a span (F128-FR-033).
 *
 * F128-FR-033: *The option `telemetry.otel.dialects` MUST name optional sets
 * of attribute names for generative-model conventions: `specstride` (always
 * on), `genai` and `openinference`. An enabled dialect MUST add attributes to
 * a span and MUST never rename or drop a base attribute. Under `genai` the
 * attributes MUST be the token and model attributes of the generative-model
 * conventions, and under `openinference` the span kinds and the token count
 * attributes of that convention. An unknown dialect name MUST be a
 * configuration error. The attribute names of both dialects MUST be marked
 * `unverified`, since the conventions were reported as moved.*
 *
 * The names live here exactly as `data/export/dialects.md` records them, all
 * `unverified` (the public documents could not be consulted at the
 * verification pass; see that file). A dialect only ever ADDS: it reads facts
 * the span's base attributes already hold and writes its own names, and it
 * never writes over a name the base attributes carry.
 */

/** The key the dialect list is read from (the key list of feature 110). */
export const DIALECTS_SWITCH = "telemetry.otel.dialects" as const;

/** The dialect the specstride attributes are: always on, never a dialect name. */
export const ALWAYS_ON_DIALECT = "specstride" as const;

/** The known dialect names, in the order of the requirement. */
export const KNOWN_DIALECTS: readonly string[] = Object.freeze(["genai", "openinference"]);

export type Dialect = "genai" | "openinference";

/**
 * The attribute names of each dialect, exactly as `data/export/dialects.md`
 * records them. Every name is `unverified` (the conventions were reported as
 * moved); the table is the single copy the exporter holds.
 */
export const DIALECT_ATTRIBUTES: Readonly<Record<Dialect, Readonly<Record<string, string>>>> =
  Object.freeze({
    genai: Object.freeze({
      requestModel: "gen_ai.request.model",
      responseModel: "gen_ai.response.model",
      inputTokens: "gen_ai.usage.input_tokens",
      outputTokens: "gen_ai.usage.output_tokens",
    }),
    openinference: Object.freeze({
      spanKind: "openinference.span.kind",
      promptTokens: "llm.token_count.prompt",
      completionTokens: "llm.token_count.completion",
      totalTokens: "llm.token_count.total",
    }),
  });

/** The error an unknown dialect name raises: a configuration error. */
export class UnknownDialectError extends Error {
  /** The name that no dialect of the exporter answers to. */
  readonly dialect: string;

  constructor(unknown: string) {
    super(`unknown telemetry dialect: ${unknown} (known: ${KNOWN_DIALECTS.join(", ")})`);
    this.dialect = unknown;
  }
}

/**
 * Resolve the value of `telemetry.otel.dialects` into the enabled dialects.
 * Only the known names pass; anything else — a string that is not a dialect,
 * a number, an element of the array that is not a string — is a configuration
 * error (F128-FR-033). `undefined`/`null` mean the default: no dialect.
 */
export function resolveDialects(value: unknown): readonly Dialect[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new UnknownDialectError(String(value));
  }
  const out: Dialect[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !KNOWN_DIALECTS.includes(entry)) {
      throw new UnknownDialectError(String(entry));
    }
    if (!out.includes(entry as Dialect)) out.push(entry as Dialect);
  }
  return out;
}

/** The exporter's own base names the dialects read their facts from. */
const MODEL_FACTS: readonly string[] = Object.freeze(["model", "specstride.model"]);
const INPUT_TOKENS_FACT = "input_tokens";
const OUTPUT_TOKENS_FACT = "output_tokens";

/** The first fact of the span's base attributes that is present. */
function factOf(
  base: Record<string, string | number | boolean>,
  names: readonly string[],
): string | number | boolean | undefined {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(base, name)) return base[name];
  }
  return undefined;
}

/** The OpenInference span kind a span with a model carries. */
const OPENINFERENCE_LLM_KIND = "LLM";
/** The OpenInference span kind every other span carries. */
const OPENINFERENCE_CHAIN_KIND = "CHAIN";

/**
 * Apply the enabled dialects to the base attributes of one span. The base
 * record is read, never written; the result carries every base attribute
 * unchanged — a dialect name the base already holds keeps the BASE value —
 * followed by the dialect attributes derived from facts the base holds. A
 * fact that is absent contributes no attribute.
 */
export function applyDialects(
  base: Record<string, string | number | boolean>,
  dialects: readonly Dialect[],
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = { ...base };
  const model = factOf(base, MODEL_FACTS);
  const input = base[INPUT_TOKENS_FACT];
  const output = base[OUTPUT_TOKENS_FACT];
  const add = (name: string, value: string | number | boolean | undefined): void => {
    if (value === undefined) return;
    if (Object.prototype.hasOwnProperty.call(base, name)) return; // never over a base attribute
    out[name] = value;
  };
  for (const dialect of dialects) {
    if (dialect === "genai") {
      const names = DIALECT_ATTRIBUTES.genai;
      if (typeof model === "string") {
        add(names.requestModel!, model);
        add(names.responseModel!, model);
      }
      add(names.inputTokens!, input);
      add(names.outputTokens!, output);
    } else if (dialect === "openinference") {
      const names = DIALECT_ATTRIBUTES.openinference!;
      add(
        names.spanKind!,
        typeof model === "string" ? OPENINFERENCE_LLM_KIND : OPENINFERENCE_CHAIN_KIND,
      );
      const total =
        typeof input === "number" || typeof output === "number"
          ? (typeof input === "number" ? input : 0) + (typeof output === "number" ? output : 0)
          : undefined;
      add(names.promptTokens!, input);
      add(names.completionTokens!, output);
      add(names.totalTokens!, total);
    }
  }
  return out;
}
