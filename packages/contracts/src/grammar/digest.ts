/**
 * T282 — the digest grammar and the rule of the `[LOOP]` line (annex G, §G.3;
 * F100-FR-179, F100-FR-180).
 *
 * A slice of T192: the labelled line of `lines.ts` is the form; this module is
 * the grammar of the two lines the engine and the pipeline entry print at the
 * end of a run.
 *
 *  - The digest is the FINAL line of every run of the pipeline entry. The
 *    runtime produces it from events; a host skill prints it verbatim. Its
 *    states come from `digestStates` of `data/line-grammar.json`.
 *  - The `[LOOP]` line stands before the digest, in default output only, and
 *    only when a loop layer is on or was switched off by rule with an
 *    announced reason. Its `parallel=` fields are printed only with parallel
 *    units on, `protection=` comes from the containment level, and it is never
 *    printed under the `parity` profile.
 */
import lineGrammar from "../../data/line-grammar.json" with { type: "json" };
import { formatLine, formatValue, parseLine, parsePairs, printPairs, family } from "./lines.ts";
import { protectionFor, type Protection } from "../ids/layout-rules.ts";

/** The section of annex G that owns both lines. */
export const ANNEX_SECTION = "annex G, §G.3" as const;

/* ------------------------------------------------------------------ *
 * F100-FR-180 — the digest.
 * ------------------------------------------------------------------ */

/** The label of the digest line (§G.3). */
export const DIGEST_LABEL = "DIGEST" as const;

/** The states of the digest: a closed set (§G.3). */
export const DIGEST_STATES: readonly string[] = Object.freeze([
  ...(lineGrammar as { digestStates: string[] }).digestStates,
]);
export type DigestState = "completed" | "failed" | "stopped" | "dry-run";

/** True where the value is one of the four states of the digest. */
export function isDigestState(value: string): value is DigestState {
  return DIGEST_STATES.includes(value);
}

/** The digest is the final line of every run of the pipeline entry. */
export const IS_THE_FINAL_LINE = true as const;

/** The runtime produces the digest from events (F100-FR-180). */
export const PRODUCED_FROM = "events" as const;
export const PRODUCED_BY = "the runtime" as const;

/** A host skill prints the digest verbatim (F100-FR-180). */
export const A_HOST_SKILL_PRINTS_IT_VERBATIM = true as const;

/** The keys of the digest body, in the order of §G.3. */
export const DIGEST_KEYS = ["state", "exit", "last-stage", "child-exit", "evidence"] as const;

/** The two keys `child-exit` is printed for: a failed or a stopped stage (§G.3). */
export const CHILD_EXIT_STATES: readonly DigestState[] = Object.freeze(["failed", "stopped"]);

/** The literal the digest prints where a value is absent (§G.3). */
export const NONE = "none" as const;

/** The digest of a run (§G.3). */
export type Digest = {
  readonly state: DigestState;
  readonly exit: number;
  /** The id of the last stage, or `null` for `none`. */
  readonly lastStage: string | null;
  /** The exit code of the stage child; printed only on a failed or stopped stage. */
  readonly childExit?: number | null | undefined;
  /** The path of the digest evidence, or `null` for `none`. */
  readonly evidence: string | null;
};

/**
 * F100-FR-180 — the digest line: `state=`, `exit=`, `last-stage=`, then
 * `child-exit=` only on a failed or stopped stage, then `evidence=`.
 */
export function formatDigest(digest: Digest): string {
  const pairs: (readonly [string, string | number | boolean | null])[] = [
    ["state", digest.state],
    ["exit", digest.exit],
    ["last-stage", digest.lastStage],
  ];
  if (CHILD_EXIT_STATES.includes(digest.state)) {
    pairs.push(["child-exit", digest.childExit ?? null]);
  }
  pairs.push(["evidence", digest.evidence]);
  return printPairs(DIGEST_LABEL, pairs);
}

/** Read a digest line back (§G.3). */
export function parseDigest(line: string): Digest {
  const parsed = parseLine(line);
  if (parsed.label !== DIGEST_LABEL) {
    throw new Error(`the line is no digest: its label is \`${parsed.label}\` (annex G, §G.3)`);
  }
  const pairs = new Map(parsePairs(parsed.body));
  const state = pairs.get("state") ?? "";
  if (!isDigestState(state)) {
    throw new Error(
      `the digest names the state "${state}", which is outside the closed set ` +
        `${DIGEST_STATES.join(", ")} (annex G, §G.3)`,
    );
  }
  const lastStage = pairs.get("last-stage") ?? NONE;
  const evidence = pairs.get("evidence") ?? NONE;
  const childExit = pairs.get("child-exit");
  return Object.freeze({
    state,
    exit: Number(pairs.get("exit") ?? 0),
    lastStage: lastStage === NONE ? null : lastStage,
    ...(childExit === undefined
      ? {}
      : { childExit: childExit === NONE ? null : Number(childExit) }),
    evidence: evidence === NONE ? null : evidence,
  });
}

/** True where the digest is the last line of the lines of a run (F100-FR-180). */
export function digestIsTheFinalLine(lines: readonly string[]): boolean {
  const last = lines.at(-1);
  return last !== undefined && last.startsWith(`[${DIGEST_LABEL}] `);
}

/**
 * §G.3 — the grammar of the digest line is the as-is grammar and has no field
 * for facts the baseline does not know. Such a fact is a field of the digest
 * record of `status --json`, and in default output it is printed on a line with
 * the label `SPECSTRIDE-DIGEST` before the digest line. Under the `parity`
 * profile neither is printed.
 */
export const FACTS_THE_BASELINE_DOES_NOT_KNOW = [
  "the hash of the comment and what was changed because of it",
  "a delegation of judgment",
  "the picked critic",
  "a fallback in force",
  "open alerts",
] as const;
export const SUCH_A_FACT_GOES_TO = ["status --json", "[SPECSTRIDE-DIGEST]"] as const;
export const NEITHER_IS_PRINTED_UNDER_PARITY = true as const;

/* ------------------------------------------------------------------ *
 * F100-FR-179 — the `[LOOP]` line.
 * ------------------------------------------------------------------ */

/** The label of the loop line (§G.3). */
export const LOOP_LABEL = "LOOP" as const;

/** The loop line stands before the digest (F100-FR-179). */
export const LOOP_STANDS_BEFORE_THE_DIGEST = true as const;

/** The loop line is printed in default output only (F100-FR-179). */
export const LOOP_IN_DEFAULT_OUTPUT_ONLY = true as const;

/** The loop line is never printed under the `parity` profile (F100-FR-179). */
export const LOOP_UNDER_PARITY_IS_PRINTED = false as const;

/** The rows of annex X §X.7 that hold the loop line back. */
export const LOOP_PARITY_ROWS = [19, 20] as const;

/** The keys of the loop line with the layer ON, in the order of §G.3. */
export const LOOP_KEYS_WITH_THE_LAYER_ON = [
  "strategy",
  "level",
  "containment",
  "protection",
  "units",
  "pass",
  "fail",
  "unchecked",
  "tainted",
  "cycles",
  "disengaged",
  "escalations",
  "failfast-stops",
  "fallback",
] as const;

/** The keys of the loop line with the layer OFF (§G.3). */
export const LOOP_KEYS_WITH_THE_LAYER_OFF = ["strategy", "reason"] as const;

/** The value of `strategy` with the layer off (§G.3). */
export const STRATEGY_WITH_THE_LAYER_OFF = "classic" as const;

/** The keys the loop line adds only with parallel units on (F100-FR-179). */
export const LOOP_KEYS_WITH_PARALLEL_UNITS_ON = [
  "parallel",
  "workers",
  "groups",
  "group-failures",
  "refused",
  "worker-caches",
  "wall-hours",
  "agent-hours",
] as const;

/** The three values `protection=` takes (§G.3). */
export const PROTECTION_VALUES_OF_THE_LINE = ["prevent", "detect", "detect,basic"] as const;
export type LineProtection = (typeof PROTECTION_VALUES_OF_THE_LINE)[number];

/**
 * §G.3 — the value of `protection` of the loop line comes from the containment
 * level through the rule of SL-6 (T244); `detect,basic` where only the basic
 * protection holds.
 */
export function protectionOfTheLine(input: {
  readonly containment: string;
  readonly sandboxDeniesControlPlaneWrites: boolean;
  readonly onlyBasicProtection?: boolean | undefined;
}): LineProtection {
  const value: Protection = protectionFor(input.containment, input.sandboxDeniesControlPlaneWrites);
  if (value === "detect" && input.onlyBasicProtection === true) return "detect,basic";
  return value;
}

/** Why the loop line is not printed. */
export type LoopLineRefusal = "parity-profile" | "compatibility-output" | "layer-never-engaged";

/** What the caller tells the rule about the run. */
export type LoopLineContext = {
  /** True where a loop layer is on. */
  readonly layerOn: boolean;
  /** True where the layer was switched off by rule, with an announced reason. */
  readonly switchedOffByRule?: boolean | undefined;
  /** The announced reason, where the layer was switched off by rule. */
  readonly reason?: string | undefined;
  /** True where parallel units are on. */
  readonly parallelUnitsOn?: boolean | undefined;
  /** The output mode in force. */
  readonly outputMode?: "default" | "compat" | undefined;
  /** The profile in force. */
  readonly profile?: string | undefined;
};

/**
 * F100-FR-179 — whether the `[LOOP]` line is printed: in default output only,
 * only when a loop layer is on or was switched off by rule with an announced
 * reason, and never under the `parity` profile.
 */
export function loopLineIsPrinted(
  context: LoopLineContext,
): { readonly printed: true } | { readonly printed: false; readonly reason: LoopLineRefusal } {
  if (context.profile === "parity") {
    return Object.freeze({ printed: false as const, reason: "parity-profile" as const });
  }
  if (context.outputMode === "compat") {
    return Object.freeze({ printed: false as const, reason: "compatibility-output" as const });
  }
  const offByRule = context.switchedOffByRule === true && (context.reason ?? "") !== "";
  if (!context.layerOn && !offByRule) {
    return Object.freeze({ printed: false as const, reason: "layer-never-engaged" as const });
  }
  return Object.freeze({ printed: true as const });
}

/** F100-FR-179 — the `parallel=` fields are printed only with parallel units on. */
export function parallelKeysArePrinted(context: LoopLineContext): boolean {
  return context.parallelUnitsOn === true;
}

/** The keys the loop line prints, in the order of §G.3, for one run. */
export function loopLineKeys(context: LoopLineContext): readonly string[] {
  if (!context.layerOn) return Object.freeze([...LOOP_KEYS_WITH_THE_LAYER_OFF]);
  const keys: string[] = [...LOOP_KEYS_WITH_THE_LAYER_ON];
  if (parallelKeysArePrinted(context)) keys.push(...LOOP_KEYS_WITH_PARALLEL_UNITS_ON);
  return Object.freeze(keys);
}

/**
 * The printer of the `[LOOP]` line: the pairs of §G.3 in their order, the
 * `parallel=` fields only with parallel units on, and nothing at all where the
 * rule holds the line back.
 */
export function formatLoopLine(
  context: LoopLineContext,
  values: Readonly<Record<string, string | number | boolean | null>>,
): string | null {
  const decision = loopLineIsPrinted(context);
  if (!decision.printed) return null;
  if (!context.layerOn) {
    return printPairs(LOOP_LABEL, [
      ["strategy", STRATEGY_WITH_THE_LAYER_OFF],
      ["reason", context.reason ?? null],
    ]);
  }
  const pairs = loopLineKeys(context)
    .filter((key) => values[key] !== undefined)
    .map(
      (key) =>
        Object.freeze([key, values[key]]) as readonly [string, string | number | boolean | null],
    );
  return printPairs(LOOP_LABEL, pairs);
}

/** The two lines of the end of a run, in their order: the loop line, then the digest. */
export function endOfRunLines(
  context: LoopLineContext,
  values: Readonly<Record<string, string | number | boolean | null>>,
  digest: Digest,
): readonly string[] {
  const loop = formatLoopLine(context, values);
  return Object.freeze(loop === null ? [formatDigest(digest)] : [loop, formatDigest(digest)]);
}

/** The row of the table of §G.3 the loop line belongs to. */
export const LOOP_FAMILY = "Loop line" as const;
export function loopFamilyRow(): ReturnType<typeof family> {
  return family(LOOP_FAMILY);
}

/** The row of the table of §G.3 the digest belongs to. */
export const DIGEST_FAMILY = "Digest" as const;
export function digestFamilyRow(): ReturnType<typeof family> {
  return family(DIGEST_FAMILY);
}

export { formatLine, formatValue };
