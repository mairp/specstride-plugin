/**
 * T007 — the consumed interfaces of the launch contract, and the two ports
 * that the command wiring hands over (specs/107-launch-contract/tasks.md,
 * T007; plan.md "Structure Decision").
 *
 * `@specstride/pipeline` may import `@specstride/contracts`, `@specstride/kernel`,
 * `@specstride/spec-formats` and `@specstride/config` only. What it needs from
 * a package outside that set reaches it as a PORT, and the command wiring in
 * `@specstride/cli` — a composition root that may import every package — hands
 * the implementation over. This module holds the interface of what is
 * consumed; it holds no rule of the other feature.
 *
 * Consumed as imports (inside the `mayImport` set, so no port is needed):
 *
 * - the canonical spec model of feature 104, EP-03
 *   (`@specstride/spec-formats`): the reading of the sources — tasks, phases,
 *   the task list — through `model.ts`; consumed as the type
 *   `SpecModelConsumer` below, so that derivation calls the model and never
 *   its own grammar (F107-FR-004, research.md row 8);
 * - the two open registries of EP-19 (feature 123, `src/kinds/registry.ts`
 *   and `src/checks/`): validation asks the registry of stage kinds and the
 *   registry of precondition checks, never a switch over a name (annex F
 *   §F.7); consumed as `StageKindRegistryConsumer` and `CheckRegistryConsumer`.
 *
 * The two PORTS the command wiring hands over:
 *
 * - `HarnessRegistryPort` — the harness registry of EP-02 with the
 *   `completion` call (F107-FR-011): a host that declares no model delegates
 *   the judgment to a harness that user configuration names, through the
 *   `completion` level of the harness port, and the answer records the route
 *   `delegated-harness` and the id of the harness. `@specstride/harness` and
 *   its adapters are outside the `mayImport` set of this layer;
 * - `LearningBindingRulesPort` — the rules of the learning binding that
 *   feature 106 exports (`@specstride/learning`, `src/binding.ts`): the block
 *   of F106-FR-027 at derivation and the structural rules and the two
 *   refusals of F106-FR-028 at validation. `@specstride/learning` is outside
 *   the `mayImport` set of this layer.
 *
 * The test doubles for the consumed interfaces come from `@specstride/testkit`:
 * the samples of EP-03 (`samples/EP-03`, the sample format and its model) and
 * of EP-19 (`samples/EP-19`, the sample stage kind and the sample check), used
 * by `test/contract-ports.test.ts`. The doubles are imported in tests only —
 * this layer ships none, and no source file of the product names a sample.
 */
import * as specFormats from "@specstride/spec-formats";
import type {
  StageKindOperations,
  StageKindRegistry,
  PreconditionCheckRegistry,
} from "../kinds/registry.ts";

/* ------------------------------------------------------------------ *
 * Consumed: the canonical spec model (EP-03, feature 104).
 * ------------------------------------------------------------------ */

/**
 * The surface of `@specstride/spec-formats` the launch contract consumes, as
 * the type of the model module (`model.ts`) that EP-03 defines. Derivation
 * reads the tasks, the phases and the task lists of a source through this
 * type and through nothing else (F107-FR-004; research.md row 8: the grammar
 * owner for tasks is the canonical spec model).
 */
export type SpecModelConsumer = typeof import("@specstride/spec-formats").validate;

/**
 * Consume the model: the module object is the implementation of EP-03 this
 * package ships with, handed to the consumers as the port value. `parse` and
 * `parseFile` live in `validate.ts` of EP-03.
 */
export const specModel: SpecModelConsumer = specFormats.validate;

/** The registry of the formats the model resolves (EP-03, `registry.ts`). */
export type SpecFormatRegistryConsumer = typeof import("@specstride/spec-formats").registry;

/** The registry of the formats the model resolves (EP-03, `registry.ts`). */
export const specFormatRegistry: SpecFormatRegistryConsumer = specFormats.registry;

/* ------------------------------------------------------------------ *
 * Consumed: the two registries of EP-19 (feature 123).
 * ------------------------------------------------------------------ */

/** The registry of stage kinds (EP-19), as this feature consumes it. */
export type StageKindRegistryConsumer = StageKindRegistry;

/** The registry of precondition checks (EP-19), as this feature consumes it. */
export type CheckRegistryConsumer = PreconditionCheckRegistry;

/** The operations of one registered stage kind (EP-19, annex F §F.7). */
export type { StageKindOperations };

/* ------------------------------------------------------------------ *
 * Port 1 — the harness registry with the `completion` call (EP-02).
 * ------------------------------------------------------------------ */

/** The capability level the delegated judgment goes through (EP-02, §C.3). */
export type CompletionLevel = "completion";

/** The request of one delegated judgment item, as the port receives it. */
export type CompletionRequest = {
  /** The id of the judgment item the question belongs to. */
  readonly itemId: string;
  /** The question, framed as data: the excerpt and the ids of its choices. */
  readonly prompt: string;
  /** The ids of the choices of the item; the answer is one of them. */
  readonly choiceIds: readonly string[];
  /** The output cap of the call, in bytes. */
  readonly outputCap: number;
  /** The time limit of the call, in milliseconds. */
  readonly timeLimitMs: number;
};

/** The answer of one delegated judgment item, as the port returns it. */
export type CompletionAnswer = {
  readonly itemId: string;
  /** The id of the chosen choice; empty when the harness answered nothing usable. */
  readonly choiceId: string;
  /** The id of the harness that answered (F107-FR-011, the provenance). */
  readonly harnessId: string;
  /** The route every answer of a delegation records (F107-FR-011). */
  readonly route: "delegated-harness";
};

/**
 * Port 1 (F107-FR-011): the harness registry with the `completion` call. The
 * command wiring in `@specstride/cli` hands the registry of EP-02 over; this
 * feature resolves the harness user configuration names through `resolve`
 * and asks the delegation through `completion` — and nothing else here
 * tests a harness name (F100-FR-023).
 */
export type HarnessRegistryPort = {
  /** True when the registry holds the named harness (discovered ones included). */
  holds(harnessId: string): boolean;
  /**
   * The `completion` call of the `completion` level (EP-02, §C.3): one call,
   * one answer. A harness that fails answers with `choiceId` empty and the
   * failure named; the refusal of the batch stays this feature's own.
   */
  completion(request: CompletionRequest): Promise<CompletionAnswer>;
};

/* ------------------------------------------------------------------ *
 * Port 2 — the rules of the learning binding (feature 106).
 * ------------------------------------------------------------------ */

/** The block `configuration.learning` holds (F106-FR-027), read structurally. */
export type LearningBlock = Readonly<Record<string, unknown>>;

/** A structural finding of the binding: the class `learning`, exit 20. */
export type LearningFinding = {
  readonly rule: string;
  readonly message: string;
  readonly class: "learning";
  readonly exit: 20;
};

/** A refusal of the binding: a changed or lost prefix, exit 23. */
export type LearningRefusalOf106 = {
  readonly reason: string;
  readonly message: string;
  readonly exit: 23;
};

/** What the rules of the binding return for one launch contract. */
export type LearningBindingVerdict = {
  readonly structural: readonly LearningFinding[];
  readonly refusals: readonly LearningRefusalOf106[];
  readonly ok: boolean;
  readonly exit: 0 | 20 | 23;
};

/** The input of the derivation of the block (F106-FR-027). */
export type LearningDeriveInput = {
  readonly mode: string;
  readonly logBytes: string | null;
  readonly slug: string;
};

/**
 * Port 2: the rules of the learning binding that feature 106 exports.
 * Validation of the launch contract calls these rules and owns none of them:
 * the block of F106-FR-027 at derivation, the structural rules and the two
 * refusals of F106-FR-028 at validation (exit 20 with the class `learning`;
 * exit 23 with the reason of a changed prefix).
 */
export type LearningBindingRulesPort = {
  /** Derive the block `configuration.learning`; `null` when it is omitted. */
  derive(input: LearningDeriveInput): LearningBlock | null;
  /** The structural rules and the two refusals, over one launch contract. */
  validate(contract: {
    readonly configuration?: LearningBlock | undefined;
  }): LearningBindingVerdict;
};
