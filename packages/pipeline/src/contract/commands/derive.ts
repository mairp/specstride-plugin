/**
 * T021 — the `contract derive` command (F107-FR-002 … F107-FR-008; annex G
 * §G.8; 011 FR-002).
 *
 * The command resolves the features in scope (T017), builds the inventory
 * (T016, T018), reads every task list through the canonical spec model
 * (F107-FR-007), builds the draft (T020) and writes it to `--output` through
 * the atomic write of the kernel. Exit 0 when the draft was written, 2 on any
 * error (row `contract derive`, annex G §G.4) — an unreadable source, a
 * feature that is ambiguous, a feature path that is not a directory.
 *
 * Under the `parity` profile the command prints NOTHING: the compatibility
 * output is the file alone, and the product line `[SPECSTRIDE-DERIVE]` — the
 * counts of F107-FR-008 and the verification mode with its reason — is printed
 * only under a product profile (data.json: never under parity).
 *
 * `--next-batch` and `--answer` are the two halves of the judgment exchange
 * `specstride.judgment/1` (T022, T023; F107-FR-009, F107-FR-010): both load
 * the draft from `--output` — the file a plain derive wrote — and never
 * re-derive it. The FIRST `--next-batch` writes `inventory.judgment`
 * (F107-FR-009b) and only then; a plain derive never does, and no cursor
 * file is kept. `--next-batch` prints one exchange record on standard
 * output; `--answer` records the picks of one batch and, when the last open
 * answer lands, runs the completion (F107-FR-041) inside the same call. A
 * draft with no judgment item at all completes on the first `--next-batch`.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import { DERIVE_EXIT_CODES, exitOf } from "./exit-codes.ts";
import { LINE_TABLE, productLine } from "./lines.ts";
import { contractStateName } from "../layout.ts";
import { writeAtomicallyJson, hashContent } from "../kernel.ts";
import { verificationModeRule } from "../draft/verification-mode.ts";
import { specModel } from "../ports.ts";
import type { LearningBindingRulesPort } from "../ports.ts";
import {
  repositoryFacts,
  featureRecord,
  contractId,
  resolveFeatures,
  countingPhaseNumberOf,
} from "../inventory/features.ts";
import { inventorySources } from "../inventory/sources.ts";
import {
  prerequisiteCandidates,
  shellCandidates,
  verificationDocumentRecord,
} from "../inventory/candidates.ts";
import { discoverDeclaredCommands, countsOf } from "../inventory/verification-source.ts";
import {
  buildDraft,
  bootstrapFinding,
  coverageOfTasks,
  type LaunchContractDraft,
  type ModelTask,
} from "../draft/build.ts";
import type { CompletionInput } from "../draft/complete.ts";
import { writeVerificationCommands } from "../draft/verification-commands.ts";
import {
  nextBatchOf,
  recordAnswer,
  openItemsOf,
  isAcceptable,
  completeWhenSettled,
  type JudgmentBatch,
} from "../judgment/batches.ts";
import { judgmentItemsOf, type JudgmentItem } from "../judgment/items.ts";
import { DEFAULT_STAGE_KINDS } from "../default-registries.ts";
import { StageKindRegistry } from "../../kinds/registry.ts";
import {
  parseCommentSelects,
  narrowingProblem,
  recordOfWhatChanged,
  selectionsWithValues,
} from "../launch/steer.ts";
import type { LineRow } from "./lines.ts";

/** The arguments of one derive call. */
export type DeriveArgs = {
  readonly repo: string;
  readonly feature: readonly string[];
  readonly output: string;
  readonly specFormat?: string;
  readonly comment?: string;
  /**
   * The values of `--comment-selects` (F107-FR-035): each names an option a
   * comment may select; only with `--comment`. Checked by `steer.ts`.
   */
  readonly commentSelects?: readonly string[];
  /** The learning mode in force on the call, for the narrowing check. */
  readonly learningMode?: string;
  /**
   * The paging half of the judgment exchange (F107-FR-009): serve the next
   * batch of open items of the draft at `--output`. Never records an answer.
   */
  readonly nextBatch?: boolean;
  /**
   * The answering half of the judgment exchange (F107-FR-010): the id of the
   * batch the answers close and, for each item of it, the id of the item and
   * the id of one choice.
   */
  readonly answer?: {
    readonly batch: string;
    readonly picks: readonly { readonly item: string; readonly choice: string }[];
  };
};

/** The result of a derive call: the exit code and what it printed. */
export type DeriveResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly draft?: LaunchContractDraft;
  readonly outputPath?: string;
};

const PARITY_PROFILE = "parity";

/** The tasks of one task list, read through the canonical model (F107-FR-007). */
function tasksOfFeature(root: string, featureDir: string): readonly ModelTask[] {
  const tasksPath = join(featureDir, "tasks.md");
  if (!existsSync(tasksPath)) return [];
  const text = readFileSync(tasksPath, "utf8");
  const filePath = relative(root, tasksPath).split(sep).join("/");
  const model = specModel.parse({
    file: filePath,
    text,
    format: "speckit-tasks",
    feature: basename(featureDir),
  });
  const tasks: ModelTask[] = [];
  for (const phase of model.phases) {
    const heading = phase.section.split("\n")[0] ?? "";
    // A heading the old grammar could not read yields NO phase (DV-060): the
    // tasks of such a section are derived with `phase: null`.
    const counted = countingPhaseNumberOf(heading);
    for (const task of phase.tasks) {
      tasks.push({ task, phase: counted ?? null, file: filePath });
    }
  }
  return tasks;
}

/** The `[SPECSTRIDE-DERIVE]` row of the line table. */
export function deriveLine(): LineRow {
  const row = LINE_TABLE.find((one) => one.label === "[SPECSTRIDE-DERIVE]");
  if (row !== undefined) return row;
  throw new Error("the line table holds no [SPECSTRIDE-DERIVE] row");
}

/* ------------------------------------------------------------------ *
 * The judgment exchange `specstride.judgment/1` (F107-FR-009, F107-FR-010,
 * F107-FR-041): the two halves load the draft from `--output`, never
 * re-deriving it, and the draft itself is the only state of the exchange.
 * ------------------------------------------------------------------ */

/** The schema id of one batch of the exchange (CQ-024). */
export const JUDGMENT_EXCHANGE_SCHEMA = "specstride.judgment/1" as const;

/** One refused call of the exchange: exit 2, one line on stderr, nothing written. */
function exchangeRefusal(message: string): DeriveResult {
  return {
    exitCode: exitOf(DERIVE_EXIT_CODES, 2),
    stdout: "",
    stderr: `contract-derive: error: ${message}\n`,
  };
}

/** Write the draft of the exchange back to its file (exit 2 when it fails). */
function writeExchangeDraft(path: string, draft: LaunchContractDraft): DeriveResult | undefined {
  try {
    writeAtomicallyJson(path, draft, { createDirectory: true });
    return undefined;
  } catch (cause) {
    return exchangeRefusal(`cannot write the draft at ${path}: ${String(cause)}`);
  }
}

/** The draft the exchange works on, loaded from `--output` (the exit-2 error of the row `contract derive`). */
function draftOfTheExchange(
  path: string,
):
  | { readonly ok: true; readonly draft: LaunchContractDraft }
  | { readonly ok: false; readonly refusal: DeriveResult } {
  if (!existsSync(path)) {
    return {
      ok: false,
      refusal: exchangeRefusal(`cannot read the draft at ${path}: the file does not exist`),
    };
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    return {
      ok: false,
      refusal: exchangeRefusal(`cannot read the draft at ${path}: ${String(cause)}`),
    };
  }
  try {
    return { ok: true, draft: JSON.parse(text) as LaunchContractDraft };
  } catch (cause) {
    return {
      ok: false,
      refusal: exchangeRefusal(`the draft at ${path} is not JSON: ${String(cause)}`),
    };
  }
}

/**
 * The declared commands the completion is given: the same deterministic
 * discovery the deriving call ran over the repository the call names (the
 * draft's inventory holds its shell candidates and verification documents;
 * the phase of a plan-declared command is rediscovered, never invented).
 */
function declaredCommandsOfTheCompletion(
  input: DeriveArgs,
  draft: LaunchContractDraft,
): CompletionInput["declaredCommands"] {
  const feature = draft.features[0];
  const planPath =
    feature === undefined ? join(input.repo, "plan.md") : join(input.repo, feature.path, "plan.md");
  const discoveries = discoverDeclaredCommands(input.repo, {
    feature: feature?.slug,
    file: existsSync(planPath) ? planPath : undefined,
    phases: [{ section: existsSync(planPath) ? readFileSync(planPath, "utf8") : "" }],
  });
  return discoveries.map((one) => ({
    id: one.id,
    argv: one.argv,
    phase: one.phase,
    timeLimitMs: one.timeLimitMs,
    ...(one.cwd !== undefined ? { cwd: one.cwd } : {}),
    ...(one.env !== undefined ? { env: one.env } : {}),
    undeclaredBecauseOfScopes: one.undeclaredBecauseOfScopes,
    feature: feature?.slug ?? "",
    anchor: `${relative(input.repo, one.provenance.file).split(sep).join("/")}:${one.provenance.line}`,
  }));
}

/**
 * Run the completion (F107-FR-041) inside an exchange call: write the
 * completed draft back to the draft file and every verification-commands
 * document the completion returns under its physical path, relative to the
 * repository root of the call.
 */
function runTheCompletion(
  input: DeriveArgs,
  draft: LaunchContractDraft,
):
  | { readonly ok: true; readonly draft: LaunchContractDraft }
  | { readonly ok: false; readonly refusal: DeriveResult } {
  const result = completeWhenSettled(draft, {
    registry: new StageKindRegistry(DEFAULT_STAGE_KINDS, "contract-derive-judgment"),
    declaredCommands: declaredCommandsOfTheCompletion(input, draft),
  });
  const failure = writeExchangeDraft(input.output, result.draft);
  if (failure !== undefined) return { ok: false, refusal: failure };
  for (const document of result.documents) {
    try {
      writeVerificationCommands({ root: input.repo, document });
    } catch (cause) {
      return {
        ok: false,
        refusal: exchangeRefusal(
          `cannot write the verification-commands document of ${document.feature}: ${String(cause)}`,
        ),
      };
    }
  }
  return { ok: true, draft: result.draft };
}

/**
 * The exchange record `specstride.judgment/1` of one batch: one line of
 * JSON, with the items VERBATIM and `bytes` the UTF-8 byte size of the very
 * record it names (the size is its own fixed point, so the host can check
 * the byte cap of F107-FR-009 against what it received).
 */
export function exchangeRecordOf(batch: JudgmentBatch): string {
  const record = (bytes: number): string =>
    JSON.stringify({
      schema: JUDGMENT_EXCHANGE_SCHEMA,
      id: batch.batch,
      items: batch.items,
      bytes,
      remaining: batch.remaining,
    });
  let bytes = 0;
  for (let guard = 0; guard < 16; guard += 1) {
    const text = record(bytes);
    const size = Buffer.byteLength(text, "utf8");
    if (size === bytes) return text;
    bytes = size;
  }
  return record(bytes);
}

/** F107-FR-009 — the paging half: serve the next batch of the draft. */
function serveNextBatch(input: DeriveArgs): DeriveResult {
  const read = draftOfTheExchange(input.output);
  if (!read.ok) return read.refusal;
  let draft = read.draft;

  // The FIRST call writes the judgment into the draft (F107-FR-009b) — and
  // only then; a later call never rewrites it, and a plain derive never
  // writes it at all.
  if (draft.inventory.judgment === undefined) {
    draft = {
      ...draft,
      inventory: {
        ...draft.inventory,
        judgment: { items: [...judgmentItemsOf(draft)], answers: [] },
      },
    };
    const failure = writeExchangeDraft(input.output, draft);
    if (failure !== undefined) return failure;
  }

  const batch = nextBatchOf(draft);
  // Nothing is left to ask — a draft with no judgment item at all, or one
  // whose every item is answered: the completion runs in this same call
  // (F107-FR-041, the edge of the spec).
  if (openItemsOf(draft).length === 0) {
    const done = runTheCompletion(input, draft);
    if (!done.ok) return done.refusal;
    draft = done.draft;
  }
  return {
    exitCode: exitOf(DERIVE_EXIT_CODES, 0),
    stdout: `${exchangeRecordOf(batch)}\n`,
    stderr: "",
    draft,
    outputPath: input.output,
  };
}

/** F107-FR-010 — the answering half: record the picks of one batch. */
function answerTheBatch(input: DeriveArgs): DeriveResult {
  const answer = input.answer;
  if (answer === undefined) return exchangeRefusal("--answer needs a batch and its picks");
  const read = draftOfTheExchange(input.output);
  if (!read.ok) return read.refusal;
  let draft = read.draft;
  const judgment = draft.inventory.judgment;
  if (judgment === undefined) {
    return exchangeRefusal(
      `the draft at ${input.output} holds no judgment; the first --next-batch writes it (F107-FR-009b)`,
    );
  }

  // Every pick is checked BEFORE any is recorded: a refusal records nothing.
  // A second answer that differs from the one recorded — or from an earlier
  // pick of the same call — is refused (F107-FR-010e).
  const pending = new Map<string, string>();
  for (const pick of answer.picks) {
    const item = judgment.items.find((one) => one.id === pick.item);
    if (item === undefined) {
      return exchangeRefusal(`no judgment item ${pick.item} in the draft (F107-FR-010e)`);
    }
    const recorded =
      judgment.answers.find((one) => one.item === pick.item)?.choice ?? pending.get(pick.item);
    if (recorded !== undefined && recorded !== pick.choice) {
      return exchangeRefusal(
        `the item ${pick.item} is already answered ${recorded}; a differing answer is refused (F107-FR-010e)`,
      );
    }
    // The stored item is the item of `judgment/items.ts` VERBATIM; the
    // record type of the draft spells fewer members than the exchange wrote.
    if (!isAcceptable(item as unknown as JudgmentItem, pick.choice)) {
      return exchangeRefusal(
        `the choice ${pick.choice} is not one of the choices of the item ${pick.item} (F107-FR-010e)`,
      );
    }
    pending.set(pick.item, pick.choice);
  }

  // Record: an identical re-answer is a no-op, and the draft file is written
  // back after every recorded call (F107-FR-009b).
  let count = 0;
  for (const pick of answer.picks) {
    const already = (draft.inventory.judgment?.answers ?? []).some(
      (one) => one.item === pick.item && one.choice === pick.choice,
    );
    if (already) continue;
    draft = recordAnswer(draft, {
      item: pick.item,
      choice: pick.choice,
      who: "host-model",
      route: "host-model",
      batch: answer.batch,
      settled: [],
    });
    count += 1;
    const failure = writeExchangeDraft(input.output, draft);
    if (failure !== undefined) return failure;
  }

  // The last open answer: the completion runs INSIDE this call (F107-FR-041).
  const remaining = openItemsOf(draft).length;
  const completed = remaining === 0;
  if (completed) {
    const done = runTheCompletion(input, draft);
    if (!done.ok) return done.refusal;
    draft = done.draft;
  }
  const line = productLine("[SPECSTRIDE-JUDGMENT]", {
    batch: answer.batch,
    recorded: count,
    remaining,
    state: completed ? "completed" : "exchanged",
  });
  return {
    exitCode: exitOf(DERIVE_EXIT_CODES, 0),
    stdout: process.env.SPECSTRIDE_PROFILE === PARITY_PROFILE ? "" : `${line}\n`,
    stderr: "",
    draft,
    outputPath: input.output,
  };
}

/**
 * F107-FR-002 … F107-FR-008 — one PLAIN call of `contract derive` (the
 * judgment halves `--next-batch` and `--answer` are answered above, over the
 * draft file this call writes). Reads the repository; writes only the file
 * `--output` names — never a state file of the host, never a cursor, and
 * never `inventory.judgment` (F107-FR-009b: the first `--next-batch` writes
 * it, so the draft of this call is the one the oracle compares).
 *
 * `learning` is the learning-binding rules port (T007): `undefined` omits the
 * block (F107-FR-002c).
 */
export function derive(input: DeriveArgs, learning?: LearningBindingRulesPort): DeriveResult {
  // The two halves of the judgment exchange come first: both load the draft
  // from `--output` and never re-derive it (F107-FR-009, F107-FR-010).
  if (input.answer !== undefined) return answerTheBatch(input);
  if (input.nextBatch === true) return serveNextBatch(input);

  const parity = process.env.SPECSTRIDE_PROFILE === PARITY_PROFILE;

  // 1. The features in scope (F107-FR-002).
  const resolution = resolveFeatures(input.repo, input.feature);
  if (!resolution.ok) {
    return {
      exitCode: exitOf(DERIVE_EXIT_CODES, 2),
      stdout: "",
      stderr: `contract-derive: error: ${resolution.message}\n`,
    };
  }

  // 1b. The selections of the comment (F107-FR-035): `--comment-selects`
  //     needs `--comment`; every named option must narrow. A refusal happens
  //     BEFORE anything is written, and nothing is written (exit 2).
  let commentChanged: readonly { readonly option: string; readonly value: unknown }[] = [];
  if (input.commentSelects !== undefined && input.commentSelects.length > 0) {
    if (input.comment === undefined) {
      return {
        exitCode: exitOf(DERIVE_EXIT_CODES, 2),
        stdout: "",
        stderr: "contract-derive: error: --comment-selects needs --comment\n",
      };
    }
    const parsed = parseCommentSelects(input.commentSelects, "derive");
    if (!parsed.ok) {
      return {
        exitCode: exitOf(DERIVE_EXIT_CODES, 2),
        stdout: "",
        stderr: `contract-derive: error: ${parsed.refusal.message}\n`,
      };
    }
    const valuesInForce: Record<string, unknown> = {
      features: resolution.featureDirs.map((dir) => basename(dir)),
      ...(input.learningMode !== undefined ? { learning: input.learningMode } : {}),
    };
    const paired = selectionsWithValues(parsed.selects, valuesInForce);
    for (const one of paired) {
      const problem = narrowingProblem(one.option, one.value, {
        featuresInScope: valuesInForce.features as string[],
        learningModeInForce: input.learningMode,
      });
      if (problem !== undefined) {
        return {
          exitCode: exitOf(DERIVE_EXIT_CODES, 2),
          stdout: "",
          stderr: `contract-derive: error: ${problem}\n`,
        };
      }
    }
    // The record of what changed (F107-FR-035), beside the hash under
    // `configuration.comment`; recorded before anything is printed.
    commentChanged = recordOfWhatChanged(paired);
  }

  // 2. The inventory sources (F107-FR-001) and the repository facts (F107-FR-003).
  let sources: ReturnType<typeof inventorySources>;
  try {
    sources = inventorySources({ root: input.repo, featureDirs: resolution.featureDirs });
  } catch (cause) {
    return {
      exitCode: exitOf(DERIVE_EXIT_CODES, 2),
      stdout: "",
      stderr: `contract-derive: error: ${String(cause)}\n`,
    };
  }
  const facts = repositoryFacts(input.repo);

  // 3. The features and the tasks, through the canonical model (F107-FR-007).
  const features = resolution.featureDirs.map((dir) => featureRecord(input.repo, dir));
  const tasks = resolution.featureDirs.flatMap((dir) => tasksOfFeature(input.repo, dir));

  // 4. The candidates (F107-FR-004).
  const prerequisites = prerequisiteCandidates({ root: input.repo, sources });
  const shell = shellCandidates({ root: input.repo, sources });
  const verificationDocuments = resolution.featureDirs
    .map((dir) =>
      verificationDocumentRecord({
        root: input.repo,
        path: join(dir, "verification-commands.json"),
      }),
    )
    .filter((one): one is NonNullable<typeof one> => one !== undefined);

  // 5. The verification-plan source (F107-FR-008): the declared commands of
  //    the workspace, through the operations of the point. The counts come
  //    from the discoveries, the blockers and the findings.
  const planPath = join(resolution.featureDirs[0] ?? input.repo, "plan.md");
  const discoveries = discoverDeclaredCommands(input.repo, {
    feature: features[0]?.slug,
    file: existsSync(planPath) ? planPath : undefined,
    phases: [{ section: existsSync(planPath) ? readFileSync(planPath, "utf8") : "" }],
  });
  const counts = countsOf({
    discoveries,
    blockers: [],
    findings: verificationDocuments
      .filter((one) => !one.valid_json)
      .map((one) => ({
        rule: "verification-document",
        message: one.error ?? "",
        class: "learning" as const,
        exit: 20 as const,
      })),
  });

  // 6. The verification mode and its reason (F107-FR-036; rows 52 and 284),
  //    through the ONE rule of T053 (`draft/verification-mode.ts`): `required`
  //    wherever commands are declared, else the mode configuration resolves
  //    (default `required`, ruling K1) — never an invented command. The
  //    reason is `declared` or `configured`, the closed set of row 284.
  const decision = verificationModeRule({
    declaredCommands: counts.normalizedCommands,
  });
  const mode = decision.mode;
  const reason = decision.reason;

  // 7. The learning block, when the rules port is handed over (F107-FR-002).
  const derived = learning?.derive({
    mode,
    logBytes: null,
    slug: contractId(input.repo, resolution.featureDirs),
  });

  // 8. The draft (F107-FR-005).
  const draft = buildDraft({
    root: input.repo,
    featureDirs: resolution.featureDirs,
    features,
    sources,
    facts,
    prerequisites,
    shellCandidates: shell,
    verificationDocuments,
    tasks,
    counts,
    verificationMode: mode,
    verificationReason: reason,
    ...(derived !== undefined && derived !== null ? { learning: derived } : {}),
    ...(input.comment !== undefined ? { commentHash: hashContent(input.comment) } : {}),
    ...(commentChanged.length > 0 ? { commentChanged } : {}),
  });

  // 9. Write the draft through the atomic write (F107-FR-005a).
  try {
    writeAtomicallyJson(input.output, draft, { createDirectory: true });
  } catch (cause) {
    return {
      exitCode: exitOf(DERIVE_EXIT_CODES, 2),
      stdout: "",
      stderr: `contract-derive: error: ${String(cause)}\n`,
    };
  }

  // 10. The exchange halves handle the judgment: a plain derive never writes
  //     `inventory.judgment` (F107-FR-009b) and never records an answer.

  const stdout = parity
    ? ""
    : `${productLine("[SPECSTRIDE-DERIVE]", {
        // F107-FR-039 — the line names state by LOGICAL NAME, never by a
        // value that holds text of the repository.
        contract: contractStateName(contractId(input.repo, resolution.featureDirs)),
        sources: sources.length,
        tasks: tasks.length,
        declarations: counts.sourceDeclarations,
        commands: counts.normalizedCommands,
        mappings: counts.phaseMappings,
        verification: mode,
        reason,
      })}\n`;

  return {
    exitCode: exitOf(DERIVE_EXIT_CODES, 0),
    stdout,
    stderr: "",
    draft,
    outputPath: input.output,
  };
}

// Re-exported for the parity and characterization tests and the wiring.
export { bootstrapFinding, coverageOfTasks };
