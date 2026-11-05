/**
 * T056 — the delegated judgment (F107-FR-011; user story 5).
 *
 * A host that declares no model MAY delegate the judgment to a harness that
 * USER CONFIGURATION names (the key `derive.judgment.harness`, row 47 of
 * annex X §X.6). The rules this module owns:
 *
 * - the delegation goes through the `completion` level of the harness port
 *   (EP-02, `specstride.harness/1`) and through NOTHING else — one call per
 *   open item, one answer per call (`HarnessRegistryPort.completion`,
 *   `packages/pipeline/src/contract/ports.ts`);
 * - the harness is resolved through the REGISTRY (`holds`), discovered
 *   harnesses included; nothing here tests a harness name (F100-FR-023);
 * - the harness name is accepted from user configuration, the environment or
 *   a flag (`harnessNameFrom`) and NEVER from project configuration or the
 *   consumer's comment (F107-FR-011);
 * - every answer the delegation records carries the route
 *   `delegated-harness` and the id of the harness in its provenance — the
 *   record the digest key `delegated` is read from (`delegatedKeyOf`,
 *   F123-FR-043; row 260 closed set `host-model` | `delegated-harness`);
 * - without a named harness a model-less host stops at the first batch with
 *   a refusal that NAMES THE KEY (`DELEGATION_REFUSAL`, exit 2, nothing
 *   recorded).
 *
 * A harness that fails answers with `choiceId` empty and the failure named;
 * the refusal of the batch stays this feature's own (`harness-failed`), and
 * nothing is recorded for an item the harness did not answer.
 */
import type { LaunchContractDraft } from "../draft/build.ts";
import {
  completeWhenSettled,
  nextBatchOf,
  recordAnswer,
  isAcceptable,
  type JudgmentBatch,
} from "./batches.ts";
import type { CompletionAnswer, CompletionRequest, HarnessRegistryPort } from "../ports.ts";
import type { StageKindRegistry } from "../../kinds/registry.ts";

/** The user-configuration key that names the harness (row 47 of annex X §X.6). */
export const HARNESS_CONFIG_KEY = "derive.judgment.harness" as const;

/** The route every answer of a delegation records (F107-FR-011; row 260). */
export const DELEGATED_ROUTE = "delegated-harness" as const;

/** The exit code of a refused delegation (`contract derive`, exit 2 on any error). */
export const DELEGATION_REFUSAL_EXIT_CODE = 2 as const;

/** The output cap of one completion call, in bytes (the batch byte cap). */
export const DELEGATION_OUTPUT_CAP = 8400 as const;

/** The time limit of one completion call, in milliseconds. */
export const DELEGATION_TIME_LIMIT_MS = 30_000 as const;

/** A refused delegation: it names the key (F107-FR-011), exit 2, nothing written. */
export type DelegationRefusal = {
  readonly reason: "no-named-harness" | "harness-not-in-registry" | "harness-failed";
  /** The configuration key the refusal names (F107-FR-011). */
  readonly key: typeof HARNESS_CONFIG_KEY;
  /** The harness id when one was named. */
  readonly harness?: string;
  readonly message: string;
  readonly exit: typeof DELEGATION_REFUSAL_EXIT_CODE;
};

/** What one delegated batch returns. */
export type DelegationResult =
  | {
      readonly ok: true;
      /** The draft with the answers of the batch recorded. */
      readonly draft: LaunchContractDraft;
      /** The batch that was delegated. */
      readonly batch: JudgmentBatch;
      /** The harness that answered. */
      readonly harnessId: string;
      /** True when the completion of the draft has run with this batch. */
      readonly completed: boolean;
    }
  | { readonly ok: false; readonly refusal: DelegationRefusal };

/** Where a harness name may come from (F107-FR-011): never project config, never the comment. */
export type HarnessNameSource =
  | { readonly from: "user-configuration"; readonly harnessId: string }
  | { readonly from: "environment"; readonly harnessId: string }
  | { readonly from: "flag"; readonly harnessId: string };

/**
 * F107-FR-011 — the harness name is accepted from user configuration, the
 * environment or a flag, in that order, and from NOTHING else: a project
 * configuration value or the consumer's comment never names the harness
 * (the inputs below carry ONLY the three accepted sources).
 */
export function harnessNameFrom(input: {
  /** The value of `derive.judgment.harness` in user configuration. */
  readonly userConfiguration?: string | undefined;
  /** The value of the environment variable `SPECSTRIDE_HARNESS`. */
  readonly environment?: string | undefined;
  /** The value of the flag `--harness`. */
  readonly flag?: string | undefined;
}): HarnessNameSource | undefined {
  if (input.userConfiguration !== undefined && input.userConfiguration !== "")
    return { from: "user-configuration", harnessId: input.userConfiguration };
  if (input.environment !== undefined && input.environment !== "")
    return { from: "environment", harnessId: input.environment };
  if (input.flag !== undefined && input.flag !== "") return { from: "flag", harnessId: input.flag };
  return undefined;
}

/** The request of one item, framed as data (the prompt carries the question, the excerpt and the choices). */
export function completionRequestOf(
  item: {
    readonly id: string;
    readonly question: string;
    readonly choices: readonly string[];
    readonly excerpt?: string;
  },
  input: { readonly outputCap: number; readonly timeLimitMs: number },
): CompletionRequest {
  const prompt = [
    item.question,
    ...(item.excerpt !== undefined ? [` excerpt: ${item.excerpt}`] : []),
    ` choices: ${item.choices.join(", ")}`,
  ].join("\n");
  return {
    itemId: item.id,
    prompt,
    choiceIds: item.choices,
    outputCap: input.outputCap,
    timeLimitMs: input.timeLimitMs,
  };
}

/**
 * F107-FR-011 — delegate the NEXT batch to the named harness through the
 * `completion` level of the port. Every answer is recorded with the route
 * `delegated-harness` and the id of the harness; when the batch holds the
 * last open item the completion of the draft (T066) runs. A refusal names
 * the key and records NOTHING.
 */
export async function delegateBatch(
  draft: LaunchContractDraft,
  harnessPort: HarnessRegistryPort,
  input: {
    /** The named harness, as `harnessNameFrom` resolved it. */
    readonly harnessName: HarnessNameSource | undefined;
    readonly registry: StageKindRegistry;
    readonly declaredCommands: Omit<
      import("../draft/complete.ts").CompletionInput,
      "draft"
    >["declaredCommands"];
    readonly outputCap?: number;
    readonly timeLimitMs?: number;
  },
): Promise<DelegationResult> {
  const outputCap = input.outputCap ?? DELEGATION_OUTPUT_CAP;
  const timeLimitMs = input.timeLimitMs ?? DELEGATION_TIME_LIMIT_MS;
  const batch = nextBatchOf(draft);
  if (input.harnessName === undefined) {
    return {
      ok: false,
      refusal: {
        reason: "no-named-harness",
        key: HARNESS_CONFIG_KEY,
        message: `no harness named: set ${HARNESS_CONFIG_KEY} in user configuration to delegate the judgment`,
        exit: DELEGATION_REFUSAL_EXIT_CODE,
      },
    };
  }
  const harnessId = input.harnessName.harnessId;
  // The harness is resolved through the REGISTRY (discovered ones included);
  // nothing here tests a harness name (F100-FR-023).
  if (!harnessPort.holds(harnessId)) {
    return {
      ok: false,
      refusal: {
        reason: "harness-not-in-registry",
        key: HARNESS_CONFIG_KEY,
        harness: harnessId,
        message: `the harness ${harnessId} named by ${HARNESS_CONFIG_KEY} is not in the harness registry`,
        exit: DELEGATION_REFUSAL_EXIT_CODE,
      },
    };
  }
  let written = draft;
  for (const item of batch.items) {
    const request = completionRequestOf(item, { outputCap, timeLimitMs });
    const answer: CompletionAnswer = await harnessPort.completion(request);
    if (answer.choiceId === "" || !isAcceptable(item, answer.choiceId)) {
      // A harness that fails answers with an empty choice; the refusal of
      // the batch stays this feature's own, and nothing is recorded.
      return {
        ok: false,
        refusal: {
          reason: "harness-failed",
          key: HARNESS_CONFIG_KEY,
          harness: harnessId,
          message: `the harness ${harnessId} answered nothing usable for ${item.id}`,
          exit: DELEGATION_REFUSAL_EXIT_CODE,
        },
      };
    }
    written = recordAnswer(written, {
      item: item.id,
      choice: answer.choiceId,
      who: harnessId,
      route: DELEGATED_ROUTE,
      harness: harnessId,
      batch: batch.batch,
      settled: [],
    });
  }
  const completed = batch.final;
  if (completed) {
    completeWhenSettled(written, {
      registry: input.registry,
      declaredCommands: input.declaredCommands,
    });
  }
  return { ok: true, draft: written, batch, harnessId, completed };
}

/**
 * The source of the digest key `delegated` (F107-FR-011 → F123-FR-043): the
 * routes recorded in `inventory.judgment`. `delegated-harness` when ANY
 * recorded answer was delegated, `host-model` when the host's model answered
 * alone, `none` while the exchange has not started.
 */
export function delegatedKeyOf(
  draft: LaunchContractDraft,
): "delegated-harness" | "host-model" | "none" {
  const answers = draft.inventory.judgment?.answers ?? [];
  if (answers.some((one) => one.provenance.route === DELEGATED_ROUTE)) return DELEGATED_ROUTE;
  if (answers.length > 0) return "host-model";
  return "none";
}
