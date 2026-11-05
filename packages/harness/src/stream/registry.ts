/**
 * T005 — the one registry from `stream.format` to a stream reader
 * (F126-FR-001, F126-FR-007, F126-FR-039).
 *
 * A row is validated on registration: the name rules, the alias rules, the
 * capability reason, the capability signals against the closed set row 170
 * in the canonical order, the canonical tool vocabulary of row 176, and the
 * option combination `synthInit` with an initial record. Every refusal names
 * the fault. No code of this feature tests a harness name: the differences
 * between harnesses are the data of the row (F126-FR-039).
 */
import {
  canonicalToolNames,
  streamSignals,
  signalOrRefuse,
  type StreamSignal,
} from "./closed-sets.ts";
import { ClaudeStreamReader } from "./claude-reader.ts";
import { TextStreamReader } from "./text-reader.ts";

/** A reader the registry resolves to: code, or a mapping read as data. */
export type RowReader =
  | { readonly type: "code"; readonly start: () => unknown }
  | {
      readonly type: "mapping";
      readonly selector: string;
      readonly fields: Readonly<Record<string, string>>;
      readonly usage?: Readonly<Record<string, string>> | undefined;
      readonly tolerate?: readonly string[] | undefined;
      readonly dialect?: string | undefined;
      /**
       * The framing the mapping is read over (F126-FR-040): absent, one line
       * is one JSON document; `sse`, the server-sent-event framing of code.
       */
      readonly framing?: "sse" | undefined;
    };

/** The options of a format row, each with its default (F126-FR-001). */
export type RowOptions = {
  readonly hasInitRecord?: boolean | undefined;
  readonly synthInit?: boolean | undefined;
  readonly synthTerminal?: boolean | undefined;
  readonly noActivity?: boolean | undefined;
  readonly trackTerminal?: boolean | undefined;
  readonly terminalDecides?: boolean | undefined;
  readonly listedAsIs?: boolean | undefined;
};

/** A row of the registry, as F126-FR-001 holds it. */
export type StreamFormatRow = {
  readonly name: string;
  readonly aliases?: readonly string[] | undefined;
  readonly reason: string;
  readonly signals?: readonly string[] | undefined;
  /** Tool names the row names; each must be inside row 176. */
  readonly tools?: readonly string[] | undefined;
  readonly reader: RowReader;
} & RowOptions;

/** A row with every default applied. */
export type ResolvedRow = {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly reason: string;
  readonly signals: readonly StreamSignal[];
  readonly hasInitRecord: boolean;
  readonly synthInit: boolean;
  readonly synthTerminal: boolean;
  readonly noActivity: boolean;
  readonly trackTerminal: boolean;
  readonly terminalDecides: boolean;
  readonly listedAsIs: boolean;
  readonly reader: RowReader;
};

/**
 * The default capability signals (F126-FR-001): the members of the closed
 * set row 170 themselves, so no second list of members is written here.
 */
export const DEFAULT_SIGNALS: readonly StreamSignal[] = streamSignals.members;

/** The canonical order of the signals is the order of the row's members. */
const SIGNAL_ORDER: readonly string[] = streamSignals.members;

/** The refusal of a registration. The message names the fault. */
export class RegistryRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryRefusedError";
  }
}

/** A name or alias: lower-case letters, digits, hyphens; at least 2 chars. */
const NAME_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;

/** True for a name that satisfies the shape rules of F126-FR-001. */
export function isValidFormatName(name: string): boolean {
  return name.length >= 2 && NAME_PATTERN.test(name);
}

/** Check one name or alias; the message names the fault. */
function checkName(name: string, what: string): void {
  if (!isValidFormatName(name)) {
    throw new RegistryRefusedError(
      `invalid ${what} '${name}': must match lower-case letters, digits and hyphens, ` +
        `start with a letter, end with a letter or digit and hold at least two characters`,
    );
  }
}

/** Apply the defaults and validate the signals of a row, in order. */
function resolveRow(row: StreamFormatRow): ResolvedRow {
  checkName(row.name, "format name");
  const aliases = row.aliases ?? [];
  for (const alias of aliases) checkName(alias, "alias");
  if (row.reason.trim().length === 0) {
    throw new RegistryRefusedError(`empty capability reason on format '${row.name}'`);
  }
  const signals: StreamSignal[] = [];
  for (const signal of row.signals ?? DEFAULT_SIGNALS) {
    try {
      signals.push(signalOrRefuse(signal));
    } catch (err) {
      throw new RegistryRefusedError(
        `capability signal '${signal}' on format '${row.name}' is outside the closed set ` +
          `of the stream signals: ${(err as Error).message}`,
      );
    }
  }
  if (signals.length === 0) {
    throw new RegistryRefusedError(`empty capability list on format '${row.name}'`);
  }
  const seen = new Set<string>();
  let previous = -1;
  for (const signal of signals) {
    if (seen.has(signal)) {
      throw new RegistryRefusedError(
        `repeating capability signal '${signal}' on format '${row.name}'`,
      );
    }
    seen.add(signal);
    const at = SIGNAL_ORDER.indexOf(signal);
    if (at < previous) {
      throw new RegistryRefusedError(
        `capability list of format '${row.name}' is out of order: '${signal}' precedes its ` +
          `position in ${SIGNAL_ORDER.join(",")}`,
      );
    }
    previous = at;
  }
  for (const tool of row.tools ?? []) {
    if (!canonicalToolNames.has(tool)) {
      throw new RegistryRefusedError(
        `tool name '${tool}' on format '${row.name}' is outside the canonical vocabulary ` +
          `(${canonicalToolNames.members.join(", ")})`,
      );
    }
  }
  const hasInitRecord = row.hasInitRecord ?? true;
  const synthInit = row.synthInit ?? false;
  if (synthInit && hasInitRecord) {
    throw new RegistryRefusedError(
      `format '${row.name}' declares synthInit together with an initial record ` +
        `(hasInitRecord ${String(hasInitRecord)})`,
    );
  }
  return {
    name: row.name,
    aliases,
    reason: row.reason,
    signals,
    hasInitRecord,
    synthInit,
    synthTerminal: row.synthTerminal ?? false,
    noActivity: row.noActivity ?? false,
    trackTerminal: row.trackTerminal ?? false,
    terminalDecides: row.terminalDecides ?? false,
    listedAsIs: row.listedAsIs ?? false,
    reader: row.reader,
  };
}

/** The one registry of the seam (F126-FR-001). */
export class StreamFormatRegistry {
  /** By canonical name, in registration order. */
  private readonly byName = new Map<string, ResolvedRow>();

  /** Every alias, to the canonical name of its row. */
  private readonly byAlias = new Map<string, string>();

  /** Register one row; refuses with a message that names the fault. */
  register(row: StreamFormatRow): ResolvedRow {
    const resolved = resolveRow(row);
    if (this.byName.has(resolved.name)) {
      throw new RegistryRefusedError(`format name '${resolved.name}' is registered twice`);
    }
    for (const alias of resolved.aliases) {
      const holder = this.byAlias.get(alias) ?? (this.byName.has(alias) ? alias : undefined);
      if (holder !== undefined) {
        throw new RegistryRefusedError(
          `alias '${alias}' is already held by '${holder}' (refused on format '${resolved.name}')`,
        );
      }
    }
    this.byName.set(resolved.name, resolved);
    for (const alias of resolved.aliases) this.byAlias.set(alias, resolved.name);
    return resolved;
  }

  /** Resolve a canonical name or an alias; unknown resolves to nothing. */
  resolve(name: string): ResolvedRow | undefined {
    const direct = this.byName.get(name);
    if (direct !== undefined) return direct;
    const canonical = this.byAlias.get(name);
    return canonical === undefined ? undefined : this.byName.get(canonical);
  }

  /** True where the value is a canonical name or an alias of a row. */
  knows(name: string): boolean {
    return this.resolve(name) !== undefined;
  }

  /** The canonical names, one per row, in registration order. */
  names(): readonly string[] {
    return [...this.byName.keys()];
  }

  /** The rows the `parity` profile lists: those that set `listedAsIs`. */
  listedAsIs(): readonly ResolvedRow[] {
    return [...this.byName.values()].filter((row) => row.listedAsIs);
  }
}

/** The `claude` row: the recorded JSONL stream of Claude Code, as-is. */
const CLAUDE_ROW: StreamFormatRow = {
  name: "claude",
  aliases: ["claude-stream-json"],
  reason: "the recorded stream-json of Claude Code: init, text, tool, usage and terminal records",
  listedAsIs: true,
  reader: { type: "code", start: () => new ClaudeStreamReader() },
};

/** The `text` row: plain output; the seam synthesizes init and terminal. */
const TEXT_ROW: StreamFormatRow = {
  name: "text",
  reason: "plain output: every line is a text block; init and terminal are synthesized",
  signals: ["text", "result"],
  hasInitRecord: false,
  synthInit: true,
  synthTerminal: true,
  reader: { type: "code", start: () => new TextStreamReader() },
};

/**
 * An SSE data row (F126-FR-040): the framing is code, the records are a
 * mapping over the document of one event. Both rows declare `synthTerminal`
 * and the signals `init,text,result` (no tool: a call of these kinds carries
 * none), and a cost of null, since neither stream reports one. `sse-openai`
 * declares `hasInitRecord` false and `synthInit`; `sse-anthropic` keeps
 * `hasInitRecord` true.
 */
function sseRow(
  name: string,
  reason: string,
  options: RowOptions & { readonly extraFields?: Readonly<Record<string, string>> },
): StreamFormatRow {
  const { extraFields, ...rowOptions } = options;
  return {
    name,
    reason,
    signals: ["init", "text", "result"],
    synthTerminal: true,
    ...rowOptions,
    reader: {
      type: "mapping",
      // The framing is the only code (F126-FR-040); the fields are data.
      framing: "sse",
      selector: "data",
      fields: {
        text: "choices.0.delta.content",
        "text.text": "delta.text",
        "terminal.stopReason": "stop_reason",
        "terminal.status": "status",
        "error.message": "error.message",
        "error.code": "error.code",
        ...extraFields,
      },
      usage: {
        inputTokens: "usage.input_tokens",
        outputTokens: "usage.output_tokens",
        usageId: "id",
      },
      tolerate: ["missing_usage"],
    },
  };
}

/**
 * The `prime-v3` row (F126-FR-001): the JSONL reader with the dialect of
 * prime. The reader itself and the dialect table are feature 138's; the name
 * stays registered here so the row of the baseline resolves.
 */
const PRIME_V3_ROW: StreamFormatRow = {
  name: "prime-v3",
  reason: "the JSONL stream of prime, schema version 3, with the dialect of prime (feature 138)",
  listedAsIs: true,
  reader: { type: "code", start: () => undefined },
};

/**
 * The registry this feature registers (F126-FR-007): `claude`, `text`,
 * `sse-openai` and `sse-anthropic`, plus `prime-v3` of F126-FR-001. The rows
 * `jsonl` and the reader of `prime-v3` are feature 138's and register here
 * through `register` when that feature is present.
 */
export function defaultStreamRegistry(): StreamFormatRegistry {
  const registry = new StreamFormatRegistry();
  registry.register(CLAUDE_ROW);
  registry.register(PRIME_V3_ROW);
  registry.register(TEXT_ROW);
  registry.register(
    sseRow(
      "sse-openai",
      "server-sent events in the OpenAI chat framing: one text record per content block, no tool call",
      { hasInitRecord: false, synthInit: true },
    ),
  );
  registry.register(
    sseRow(
      "sse-anthropic",
      "server-sent events in the Anthropic messages framing: one text record per content block, no tool call",
      { hasInitRecord: true, extraFields: { "init.model": "message.model", text: "delta.text" } },
    ),
  );
  return registry;
}
