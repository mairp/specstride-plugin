/**
 * T011 — the harness descriptor loader: validation, `origin` and the
 * precedence of sources (F109-FR-014).
 *
 * The descriptor schema is feature 100's, annex C §C.2, version 1. This
 * loader validates a raw descriptor when it is loaded, refuses what the
 * requirement names, sets `origin`, and resolves two sources that describe
 * the same id by whole-entry precedence (nothing is merged):
 *
 *   consumer-declared (`user`) > tested harness adapter (`adapter`) >
 *   bundled descriptor (`bundled`) > detected (`detected`).
 *
 * Every refusal gives a finding that names the descriptor and the reason, so
 * the doctor can carry it.
 */

/** The descriptor schema version this loader accepts (the accepted range). */
export const ACCEPTED_DESCRIPTOR_VERSIONS = [1] as const;

/** The provenance closed set (row 33 of annex X §X.6). */
export const CAPABILITY_PROVENANCE = ["declared", "probed", "adapter", "catalogue"] as const;

/** The origins the loader sets (closed set, row 35). */
export const DESCRIPTOR_ORIGINS = ["adapter", "bundled", "user", "detected"] as const;
export type DescriptorOrigin = (typeof DESCRIPTOR_ORIGINS)[number];

/** The precedence of sources, best first (F109-FR-014). */
export const SOURCE_PRECEDENCE: readonly DescriptorOrigin[] = Object.freeze([
  "user",
  "adapter",
  "bundled",
  "detected",
]);

/** The closed set "Placeholders of a descriptor" (row 32 of annex X §X.6). */
export const PLACEHOLDERS = [
  "{prompt}",
  "{promptFile}",
  "{workdir}",
  "{emptyTmp}",
  "{model}",
  "{sessionId}",
] as const;
/** The one parameterised placeholder of the set. */
export const FILE_PLACEHOLDER = /^`\{file:[a-zA-Z0-9._-]+\}`$|^\{file:[a-zA-Z0-9._-]+\}$/;

/** The top-level keys of annex C §C.2 that the loader knows. */
export const KNOWN_TOP_LEVEL_KEYS: readonly string[] = Object.freeze([
  "descriptorVersion",
  "id",
  "displayName",
  "kind",
  "provider",
  "origin",
  "detect",
  "auth",
  "endpoint",
  "models",
  "roles",
  "invoke",
  "stream",
  "continuation",
  "session",
  "tiers",
  "failures",
  "cost",
  "isolation",
  "containment",
  "memory",
  "telemetry",
  "concurrentSessions",
  "spendLimit",
  "transports",
  "versionRange",
  "verifiedOn",
]);

export type DescriptorFinding = {
  /** The descriptor the finding names: its id where one was read, else `?`. */
  readonly descriptor: string;
  readonly reason: string;
};

export type ValidatedDescriptor = {
  readonly ok: boolean;
  readonly findings: readonly DescriptorFinding[];
  readonly descriptor?: RawDescriptor & { readonly origin?: DescriptorOrigin };
};

/** A descriptor as it arrives from a source, before the loader sets `origin`. */
export type RawDescriptor = {
  readonly descriptorVersion?: unknown;
  readonly id?: unknown;
  readonly displayName?: unknown;
  readonly kind?: unknown;
  readonly provider?: unknown;
  readonly auth?: unknown;
  readonly invoke?: unknown;
  readonly stream?: unknown;
  readonly session?: unknown;
  readonly tiers?: unknown;
  readonly isolation?: unknown;
  readonly versionRange?: unknown;
  readonly verifiedOn?: unknown;
  readonly concurrentSessions?: unknown;
  readonly spendLimit?: unknown;
  readonly continuation?: unknown;
  readonly [key: string]: unknown;
};

/** The registries the open sets resolve through (F109-FR-014). */
export type OpenSetRegistries = {
  /** The registered kinds: `cli`, `openai-chat`, `anthropic-messages`, … */
  readonly kinds: readonly string[];
  /** The registered stream formats: `text`, `jsonl`, `sse-openai`, … */
  readonly streamFormats: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every `{…}` placeholder in `text` must be a member of the closed set of
 * seven (the six fixed names plus `{file:<name>}`). Returns the offending
 * token, or `null`.
 */
export function placeholderOutsideClosedSet(text: string): string | null {
  for (const match of text.matchAll(/\{[^{}]*\}/g)) {
    const token = match[0];
    if ((PLACEHOLDERS as readonly string[]).includes(token)) {
      continue;
    }
    if (/^\{file:[a-zA-Z0-9._-]+\}$/.test(token)) {
      continue;
    }
    return token;
  }
  return null;
}

function walkPlaceholders(value: unknown, visit: (text: string) => string | null): string | null {
  if (typeof value === "string") {
    return visit(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walkPlaceholders(item, visit);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      const found = walkPlaceholders(item, visit);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}

/**
 * F109-FR-014 — validate one raw descriptor. `registries` carries the open
 * sets of `kind` and `stream.format`; a value no registry entry matches
 * refuses the descriptor.
 */
export function validateDescriptor(
  raw: unknown,
  registries: OpenSetRegistries,
  origin: DescriptorOrigin,
): ValidatedDescriptor {
  const idRead = isRecord(raw) && typeof raw.id === "string" ? raw.id : "?";
  const findings: DescriptorFinding[] = [];
  const refuse = (reason: string): ValidatedDescriptor => ({
    ok: false,
    findings: [{ descriptor: idRead, reason }, ...findings],
  });

  if (!isRecord(raw)) {
    return {
      ok: false,
      findings: [{ descriptor: idRead, reason: "the descriptor is not a record" }],
    };
  }
  const descriptor = raw as RawDescriptor;

  // Unknown top-level keys refuse; keys under `x-` are ignored.
  for (const key of Object.keys(descriptor)) {
    if (key.startsWith("x-")) {
      continue;
    }
    if (!KNOWN_TOP_LEVEL_KEYS.includes(key)) {
      findings.push({
        descriptor: idRead,
        reason: `unknown top-level key \`${key}\``,
      });
    }
  }
  if (findings.length > 0) {
    return { ok: false, findings };
  }

  if (descriptor.descriptorVersion !== 1) {
    return refuse(
      `\`descriptorVersion\` ${JSON.stringify(descriptor.descriptorVersion)} is outside the accepted range ${JSON.stringify(ACCEPTED_DESCRIPTOR_VERSIONS)}`,
    );
  }
  if (typeof descriptor.id !== "string" || !/^[a-z0-9-]+$/.test(descriptor.id)) {
    return refuse("`id` is not lower-case text with digits and hyphens");
  }
  if (!registries.kinds.includes(descriptor.kind as string)) {
    return refuse(
      `\`kind\` ${JSON.stringify(descriptor.kind)} matches no entry of the kind registry`,
    );
  }
  const auth = descriptor.auth;
  if (isRecord(auth)) {
    const tierFinding = checkTiers(auth.tiers);
    if (tierFinding !== null) {
      return refuse(tierFinding);
    }
  }
  const stream = descriptor.stream;
  if (isRecord(stream)) {
    if (!registries.streamFormats.includes(stream.format as string)) {
      return refuse(
        `\`stream.format\` ${JSON.stringify(stream.format)} matches no entry of the stream-format registry`,
      );
    }
  }
  // `invoke` holds argument lists: a list of text, never shell text, and only
  // placeholders of the closed set of seven.
  const invoke = descriptor.invoke;
  if (invoke !== undefined) {
    if (!isRecord(invoke)) {
      return refuse("`invoke` is not a map from role to record");
    }
    for (const [role, call] of Object.entries(invoke)) {
      if (!isRecord(call)) {
        return refuse(`\`invoke.${role}\` is not a record`);
      }
      if (call.args !== undefined) {
        if (!Array.isArray(call.args) || call.args.some((a) => typeof a !== "string")) {
          return refuse(
            `\`invoke.${role}.args\` is not a list of text (an argument list written as shell text is refused)`,
          );
        }
      }
    }
    const bad = walkPlaceholders(invoke, placeholderOutsideClosedSet);
    if (bad !== null) {
      return refuse(`the placeholder \`${bad}\` is outside the closed set of seven`);
    }
  }
  return { ok: true, findings: [], descriptor: { ...descriptor, origin } };
}

/** Auth tiers: whole numbers, 1 or 2 only; 3 is refused (F109-FR-013). */
function checkTiers(tiers: unknown): string | null {
  if (tiers === undefined) {
    return null;
  }
  if (!Array.isArray(tiers)) {
    return "`auth.tiers` is not a list of whole numbers";
  }
  for (const tier of tiers) {
    if (tier === 3) {
      return "auth tier 3 is not a valid value of a descriptor (F109-FR-013)";
    }
    if (!Number.isInteger(tier) || (tier as number) < 1) {
      return `\`auth.tiers\` holds ${JSON.stringify(tier)}, which is not a whole number in 1 to 2`;
    }
  }
  return null;
}

/** A descriptor as a source carries it into the loader. */
export type DescriptorSourceInput = {
  readonly raw: unknown;
  readonly origin: DescriptorOrigin;
};

/** One loaded entry, with the origin the loader set. */
export type LoadedDescriptor = ValidatedDescriptor & {
  readonly descriptor: RawDescriptor & { readonly origin: DescriptorOrigin };
};

/** A source that described an id another source won, with the reason. */
export type LoserSource = {
  readonly id: string;
  readonly origin: DescriptorOrigin;
  readonly reason: string;
};

export type LoadedDescriptors = {
  readonly entries: readonly LoadedDescriptor[];
  readonly findings: readonly DescriptorFinding[];
  /** The entries that lost the precedence, each with the reason. */
  readonly losers: readonly LoserSource[];
};

/**
 * F109-FR-014 — load a set of descriptors from their sources: validate each,
 * refuse a duplicate id of one origin, and resolve two sources of one id by
 * the precedence (consumer-declared, tested adapter, bundled, detected). The
 * winner wins as a whole; nothing is merged. An entry that comes from a
 * descriptor of the consumer is never `tested`.
 */
export function loadDescriptors(
  sources: readonly DescriptorSourceInput[],
  registries: OpenSetRegistries,
): LoadedDescriptors {
  const findings: DescriptorFinding[] = [];
  const entries: LoadedDescriptor[] = [];
  const losers: LoserSource[] = [];
  const seenIdByOrigin = new Map<string, string>();

  for (const source of sources) {
    const validated = validateDescriptor(source.raw, registries, source.origin);
    findings.push(...validated.findings);
    if (!validated.ok || validated.descriptor === undefined) {
      continue;
    }
    const descriptor = validated.descriptor;
    const id = descriptor.id as string;

    // Two descriptors of one origin with one id refuse the later one.
    const duplicateKey = `${source.origin}\u0000${id}`;
    if (seenIdByOrigin.has(duplicateKey)) {
      findings.push({
        descriptor: id,
        reason: `another descriptor of the origin \`${source.origin}\` already holds the id \`${id}\``,
      });
      continue;
    }
    seenIdByOrigin.set(duplicateKey, id);

    // A consumer-declared entry is never tested: the tested fields are read
    // but do not make it one.
    const isConsumer = source.origin === "user";
    const entry: RawDescriptor & { readonly origin: DescriptorOrigin } = isConsumer
      ? { ...descriptor, origin: source.origin, tested: false }
      : { ...descriptor, origin: source.origin };

    // Precedence with what is loaded already: one entry wins as a whole.
    const existingIndex = entries.findIndex((e) => (e.descriptor.id as string) === id);
    if (existingIndex === -1) {
      entries.push({ ok: true, findings: [], descriptor: entry });
      continue;
    }
    const winner = entries[existingIndex] as LoadedDescriptor;
    const existingOrigin = winner.descriptor.origin;
    if (SOURCE_PRECEDENCE.indexOf(existingOrigin) <= SOURCE_PRECEDENCE.indexOf(source.origin)) {
      losers.push({
        id,
        origin: source.origin,
        reason: `the entry of the origin \`${existingOrigin}\` outranks \`${source.origin}\` in the precedence; nothing is merged`,
      });
    } else {
      entries[existingIndex] = { ok: true, findings: [], descriptor: entry };
      losers.push({
        id,
        origin: existingOrigin,
        reason: `the entry of the origin \`${source.origin}\` outranks \`${existingOrigin}\` in the precedence; nothing is merged`,
      });
    }
  }

  return { entries, findings, losers };
}
