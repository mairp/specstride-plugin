/**
 * T018 — the digest: computed from the events, printed in the compatibility
 * lines (F123-FR-016).
 *
 * The digest is produced by the runtime from the events of the run and
 * printed verbatim by the host (R11 T-11). Its fields are the fields of the
 * `[DIGEST]` line of §R.2 — `state`, `exit`, `last-stage`, the optional
 * `child-exit`, `evidence` — bound together by the canonical hash of the
 * `pipeline.ended` event.
 */
import { contentHash } from "@specstride/kernel";
import type { PipelineEvent } from "../executor/events.ts";

/** The fields the digest line holds. */
export type DigestFields = {
  state: string;
  exit: number;
  lastStage: string | null;
  childExit: number | null;
  evidence: string | null;
};

/** The `[DIGEST]` line of §R.2; `None` is the literal for an absent value. */
export function compatibilityDigestLine(fields: DigestFields): string {
  const child = fields.childExit === null ? "" : ` child-exit=${fields.childExit}`;
  return `[DIGEST] state=${fields.state} exit=${fields.exit} last-stage=${fields.lastStage ?? "none"}${child} evidence=${fields.evidence ?? "none"}`;
}

/**
 * The digest value from the events: the canonical hash over the fields of the
 * last `pipeline.ended` event of the run. A run that wrote no such event —
 * a dry run — has the digest of its one `state=dry-run` line.
 */
export function digestFromEvents(events: readonly PipelineEvent[]): string {
  const ended = [...events].reverse().find((event) => event.name === "pipeline.ended");
  if (ended === undefined) {
    return contentHash(
      JSON.stringify({
        state: "dry-run",
        exit: 0,
        lastStage: null,
        childExit: null,
        evidence: null,
      }),
    );
  }
  return contentHash(
    JSON.stringify({
      state: ended.fields["state"],
      exit: ended.fields["exit"],
      lastStage: ended.fields["lastStage"] ?? null,
      childExit: ended.fields["childExit"] ?? null,
      evidence: ended.fields["evidence"] ?? null,
    }),
  );
}

/**
 * The keys of the product line `[SPECSTRIDE-DIGEST]`, in the order annex G
 * §G.3 fixes (F123-FR-043).
 */
export const DIGEST_PRODUCT_KEYS = [
  "run",
  "comment",
  "changed",
  "delegated",
  "critic",
  "fallback",
  "alerts",
] as const;

/** A value that is allowed on the product line: an identifier, a hash, a count or a closed-set member. */
export function digestProductValueAllowed(value: string): boolean {
  return value.length > 0 && !/[\s`$\\<>"]/.test(value);
}

/** The facts the product line may carry; every one is read from the events of the run. */
export type DigestProductFacts = {
  run: string;
  commentHash?: string | null;
  changed?: string | number | null;
  delegated?: string | number | null;
  critic?: string | null;
  fallback?: string | null;
  alerts?: number | string | null;
};

/** The inputs that keep the product line off: compatibility, a dry run, the `parity` profile. */
export type DigestProductGate = {
  mode?: "compatibility" | "default";
  dryRun?: boolean;
  parityProfile?: boolean;
};

/**
 * The product line `[SPECSTRIDE-DIGEST]` (F123-FR-043): the keys of annex G
 * §G.3 in their fixed order; a key without a fact is left out; a line that
 * would hold `run` only is not printed; the line is not printed in
 * compatibility output, in a dry run, or under the `parity` profile. No
 * value holds text from a run: a value that is not an identifier, a hash, a
 * count or a closed-set member is dropped as a key without a fact.
 */
export function specstrideDigestLine(
  facts: DigestProductFacts,
  gate: DigestProductGate = {},
): string | null {
  if ((gate.mode ?? "default") !== "default") return null;
  if (gate.dryRun === true) return null;
  if (gate.parityProfile === true) return null;
  const value = (raw: unknown): string | null => {
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
    if (typeof raw !== "string") return null;
    const text = raw.trim();
    return digestProductValueAllowed(text) ? text : null;
  };
  const pairs: string[] = [`run=${value(facts.run) ?? ""}`];
  const rest: Array<[string, unknown]> = [
    ["comment", facts.commentHash],
    ["changed", facts.changed],
    ["delegated", facts.delegated],
    ["critic", facts.critic],
    ["fallback", facts.fallback],
    ["alerts", facts.alerts],
  ];
  for (const [key, raw] of rest) {
    const text = value(raw);
    if (text !== null) pairs.push(`${key}=${text}`);
  }
  if (pairs.length === 1) return null; // `run` only: the line is not printed.
  return `[SPECSTRIDE-DIGEST] ${pairs.join(" ")}`;
}

/**
 * The product line from the events of the run: `run`, `comment`, `changed`
 * and `delegated` come from the fields `run`, `commentHash`, `changed` and
 * `delegated` of the newest `pipeline.started` of the run; `critic`,
 * `fallback` and `alerts` from the fields of the same name of the same
 * event, when the run holds them. The digest line stays the final line.
 */
export function specstrideDigestLineFromEvents(
  events: readonly PipelineEvent[],
  gate: DigestProductGate = {},
): string | null {
  const started = [...events].reverse().find((event) => event.name === "pipeline.started");
  const fields: Record<string, unknown> = started?.fields ?? {};
  return specstrideDigestLine(
    {
      run:
        typeof fields["run"] === "string"
          ? (fields["run"] as string)
          : String(fields["pipeline"] ?? ""),
      commentHash:
        typeof fields["commentHash"] === "string" ? (fields["commentHash"] as string) : null,
      changed: (fields["changed"] ?? null) as string | number | null,
      delegated: (fields["delegated"] ?? null) as string | number | null,
      critic: typeof fields["critic"] === "string" ? (fields["critic"] as string) : null,
      fallback: typeof fields["fallback"] === "string" ? (fields["fallback"] as string) : null,
      alerts: (fields["alerts"] ?? null) as number | string | null,
    },
    gate,
  );
}

/**
 * Parse a `[DIGEST]` line back into its fields: `state`, `exit`,
 * `last-stage`, an optional `child-exit` where `None` reads as absent, and
 * `evidence`. Returns null for a line that is not a digest line.
 */
export function parseDigestLine(text: string): DigestFields | null {
  if (!text.includes("[DIGEST]") && !text.includes("[SPECSTRIDE-DIGEST]")) return null;
  const body = text.slice(text.indexOf("]") + 1).trim();
  const parts = new Map<string, string>();
  for (const token of body.split(/\s+/)) {
    const equals = token.indexOf("=");
    if (equals <= 0) continue;
    parts.set(token.slice(0, equals), token.slice(equals + 1));
  }
  const state = parts.get("state");
  const exit = parts.get("exit");
  if (state === undefined || exit === undefined) return null;
  const childExit = parts.get("child-exit");
  return {
    state,
    exit: Number.parseInt(exit, 10),
    lastStage:
      parts.has("last-stage") && parts.get("last-stage") !== "none"
        ? (parts.get("last-stage") as string)
        : null,
    childExit:
      childExit === undefined || childExit === "None" ? null : Number.parseInt(childExit, 10),
    evidence:
      parts.has("evidence") && parts.get("evidence") !== "none"
        ? (parts.get("evidence") as string)
        : null,
  };
}
