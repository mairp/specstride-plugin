/**
 * T066 — the completion of the draft (F107-FR-041; F107-SC-008), called by the
 * judgment exchange (T023) when the last open answer is recorded, or when the
 * draft has no judgment item at all.
 *
 * A PURE function: it takes the draft, the answers and the inventory facts and
 * returns the completed draft, the documents to write and the findings; equal
 * inputs give equal bytes. It writes nothing itself.
 *
 * (a) STAGES — one stage of kind `specstride` per feature, in feature order,
 *     with the members of data-model.md; the action and the resume action are
 *     the engine's real argv `["specstride", "run"]` and nothing else (the
 *     engine of this product takes no `--feature`/`--tasks` flags: the feature
 *     is pinned by the runtime, not by the contract); the working directory
 *     is the repository root as `.`; the postconditions are never empty
 *     (F107-FR-041a); the recovery is one stage attempt.
 * (b) PRECONDITIONS — one for every prerequisite candidate answered `mapped`,
 *     on the stage of the feature the candidate's provenance names, of the
 *     timing the answer settled (a file that is present is checked at
 *     preflight); a prerequisite answered `optional` writes none; a
 *     prerequisite that is PRESENT writes one too — a present file is a fact
 *     the stage checks, which is what the strict rule of the unchecked
 *     prerequisite asks (F107-FR-017).
 * (c) COVERAGE — a task in a phase keeps `specstride-phase:<n>` and is
 *     settled by fact (CQ-036; F107-FR-041d): an unticked task gets the
 *     producer `stage:<id>` of the stage of its feature, the disposition
 *     `mapped` and that stage id; a ticked task gets the producer `existing`,
 *     the disposition `mapped` and that stage id; the verification ids of a
 *     task entry are the ids of the declared commands of its phase; a task in
 *     no phase is settled only by the answer of its `classify-obligation`
 *     item; a declared command answered `specstride-phase:<n>` is settled
 *     with the stage of that phase.
 * (d) FINDINGS — the prerequisite answered `keep-blocker` and the answer
 *     `keep-blocker` of a `resolve-blocker` item write an open blocker with
 *     the answer's provenance (F107-FR-041e); every other item's answer is
 *     recorded with its provenance; the bootstrap finding is resolved, with a
 *     resolution that names the completion.
 * (e) DOCUMENTS — the verification-commands document of every feature that
 *     declared at least one command, to be written by the command under
 *     `feature:<slug>:verification:commands` (T067).
 *
 * The host writes nothing: the completion runs inside the CLI.
 */
import { relative, sep } from "node:path";

import type { LaunchContractDraft, CoverageEntry, DraftFinding } from "./build.ts";
import { BOOTSTRAP_FINDING_ID, timingOf } from "./build.ts";
import type { StageKindRegistry } from "../../kinds/registry.ts";
import { idFromName } from "../inventory/features.ts";
import { contractStateName } from "../layout.ts";
import type { VerificationCommandsDocument } from "./verification-commands.ts";
import {
  verificationCommandsLogicalName,
  physicalStatePath,
  verificationCommandsDocument,
} from "./verification-commands.ts";

/** The kind of the stage the completion writes (the closed set of feature 123). */
export const SPECSTRIDE_STAGE_KIND = "specstride" as const;

/** The resolved status of the bootstrap finding. */
export const BOOTSTRAP_RESOLUTION =
  "Resolved by the completion of the draft: the stages, the coverage and the verification are settled.";

/** The answers the completion reads, as the judgment record holds them. */
export type AnswerRecord = NonNullable<
  LaunchContractDraft["inventory"]["judgment"]
>["answers"][number];

/** What the completion returns: the draft and the documents to write. */
export type CompletionResult = {
  readonly draft: LaunchContractDraft;
  readonly documents: readonly VerificationCommandsDocument[];
};

/** The facts the completion needs beyond the draft. */
export type CompletionInput = {
  readonly draft: LaunchContractDraft;
  readonly registry: StageKindRegistry;
  readonly declaredCommands: readonly {
    readonly id: string;
    readonly argv: readonly string[];
    readonly phase: number;
    readonly timeLimitMs: number;
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly undeclaredBecauseOfScopes: readonly string[];
    readonly feature: string;
    readonly anchor: string;
  }[];
};

/** The choice of an answer, by the item it answered. */
export function answerFor(
  input: CompletionInput,
  itemId: string,
): { readonly choice: string; readonly provenance: unknown } | undefined {
  const judgment = input.draft.inventory.judgment;
  if (judgment === undefined) return undefined;
  const item = judgment.items.find((one) => one.id === itemId);
  const answer = judgment.answers.find((one) => one.item === itemId);
  if (item === undefined || answer === undefined) return undefined;
  return { choice: answer.choice, provenance: answer.provenance };
}

/** The id of the stage of one feature: `run-` + the id rule of the slug. */
export function stageIdOfFeature(slug: string): string {
  return `run-${idFromName(slug)}`;
}

/**
 * The action of a `specstride` stage (F107-FR-041a): the engine's real argv,
 * and NOTHING else — the engine of this product takes no `--feature` or
 * `--tasks` flag; the feature is pinned by the runtime, not by the contract.
 */
export const STAGE_ACTION: readonly string[] = Object.freeze(["specstride", "run"]);

/** The recovery of a `specstride` stage: one attempt (F107-FR-041a). */
export const STAGE_RECOVERY = Object.freeze({ max_attempts: 1 } as const);

/**
 * The physical path of a feature's verification-commands document, relative
 * to the repository root (the `target` a postcondition names; the parity
 * shape writes `target`, never `path`).
 */
export function stateTargetOf(root: string, slug: string): string {
  return relative(root, physicalStatePath(root, verificationCommandsLogicalName(slug)))
    .split(sep)
    .join("/");
}

/**
 * F107-FR-041 — the completion. Equal inputs give equal bytes: nothing here
 * reads a clock, a file or the environment.
 */
export function completeDraft(input: CompletionInput): CompletionResult {
  const draft = input.draft;
  const judgment = draft.inventory.judgment;
  const tasks = draft.inventory.tasks as readonly {
    id: string;
    phase: number | null;
    source: string;
    text: string;
    ticked?: boolean;
    checked: boolean;
  }[];
  const prerequisiteAnswers = new Map<string, string>();
  const classifyAnswers = new Map<string, string>();
  const commandAnswers = new Map<string, string>();
  const blockerAnswers = new Map<string, string>();
  for (const item of judgment?.items ?? []) {
    const answer = (judgment?.answers ?? []).find((one) => one.item === item.id);
    if (answer === undefined) continue;
    if (item.kind === "settle-prerequisite") prerequisiteAnswers.set(item.anchor, answer.choice);
    else if (item.kind === "classify-obligation") classifyAnswers.set(item.anchor, answer.choice);
    else if (item.kind === "map-declared-command") commandAnswers.set(item.anchor, answer.choice);
    else if (item.kind === "resolve-blocker") blockerAnswers.set(item.anchor, answer.choice);
  }

  // (e) DOCUMENTS — one per feature that declared at least one command,
  //     computed FIRST: a stage names the document of its feature in its
  //     postconditions and its evidence (F107-FR-041a, F107-FR-041c).
  const documents = draft.features
    .map((feature) => {
      const commands = input.declaredCommands.filter(
        (one) => one.feature === feature.slug && one.undeclaredBecauseOfScopes.length === 0,
      );
      if (commands.length === 0) return undefined;
      return verificationCommandsDocument({
        slug: feature.slug,
        root: draft.repository.root,
        commands,
      });
    })
    .filter((one): one is VerificationCommandsDocument => one !== undefined);

  // (a) STAGES — one per feature, in order, with the members the STRICT
  //     validator accepts (F107-FR-041a): the engine's real argv, the
  //     repository root as the working directory, postconditions that are
  //     never empty, one stage attempt, and evidence that names state by
  //     LOGICAL NAME.
  const stages: {
    id: string;
    kind: string;
    depends_on: string[];
    cwd: string;
    action?: string[];
    resume?: string[];
    preconditions: Record<string, unknown>[];
    postconditions: Record<string, unknown>[];
    recovery: Record<string, unknown>;
    evidence: string[];
  }[] = [];
  const featureByPath = new Map(draft.features.map((one) => [one.path, one]));
  for (const feature of draft.features) {
    const document = documents.find((one) => one.feature === feature.slug);
    stages.push({
      id: stageIdOfFeature(feature.slug),
      kind: SPECSTRIDE_STAGE_KIND,
      depends_on: [],
      // The working directory is the repository root (F107-FR-041a).
      cwd: ".",
      action: [...STAGE_ACTION],
      resume: [...STAGE_ACTION],
      preconditions: [],
      postconditions: [
        document !== undefined
          ? {
              check: "file_exists",
              timing: "stage",
              target: stateTargetOf(draft.repository.root, feature.slug),
            }
          : // No document was written for the feature: the control plane of
            // the repository is still the state the stage leaves behind.
            { check: "dir_exists", timing: "stage", target: ".specstride" },
      ],
      recovery: { ...STAGE_RECOVERY },
      evidence: [
        document !== undefined
          ? verificationCommandsLogicalName(feature.slug)
          : contractStateName(draft.id),
      ],
    });
  }
  for (const [index, stage] of stages.entries()) {
    if (index > 0) stage.depends_on = [stages[index - 1]!.id];
  }

  // (b) PRECONDITIONS — one per prerequisite answered `mapped`, and one per
  //     PRESENT prerequisite: a file that is there is a fact the stage checks
  //     at preflight (F107-FR-017: a present prerequisite nobody names is a
  //     defect of the contract).
  for (const candidate of draft.inventory.prerequisites) {
    const choice = prerequisiteAnswers.get(candidate.id);
    if (choice !== "mapped" && candidate.present !== true) continue;
    const sourcePath = candidate.source.path;
    const featurePath = sourcePath.split("/").slice(0, -1).join("/");
    const stage =
      stages.find((one) => featureByPath.get(featurePath)?.slug === one.id.replace(/^run-/, "")) ??
      stages[0];
    if (stage === undefined) continue;
    stage.preconditions.push({
      id: `pre-${candidate.id.toLowerCase()}`,
      check: "file_exists",
      timing: "preflight",
      target: candidate.resolved,
      cwd: draft.repository.root,
    });
  }

  // (c) COVERAGE — settled by fact for the tasks (CQ-036), by answer for the
  //     rest.
  const stageOfFeature = new Map(
    draft.features.map((one) => [one.slug, stageIdOfFeature(one.slug)] as const),
  );
  const declaredByAnchor = new Map(input.declaredCommands.map((one) => [one.anchor, one]));
  /** The ids of the declared commands of one phase (F107-FR-041d). */
  const verificationIdsOf = (phase: number): string[] =>
    input.declaredCommands
      .filter((one) => one.undeclaredBecauseOfScopes.length === 0 && one.phase === phase)
      .map((one) => one.id);
  const coverage: CoverageEntry[] = draft.coverage.map((entry) => {
    const task = tasks.find((one) => one.id === entry.source.anchor);
    if (task !== undefined && task.phase !== null) {
      // Settled by fact (CQ-036; F107-FR-041d): the entry of a task that
      // stands in a phase is `mapped` on the stage of its feature — unticked
      // to the stage, ticked to `existing` (the work is already there).
      const slug = task.source.split("/").slice(-2, -1)[0] ?? "";
      const stageId = stageOfFeature.get(slug);
      if (stageId === undefined) return entry;
      return {
        ...entry,
        disposition: "mapped",
        producer: task.checked ? "existing" : `stage:${stageId}`,
        stage_ids: [stageId],
        verification_ids: verificationIdsOf(task.phase),
      };
    }
    const choice = classifyAnswers.get(entry.source.anchor);
    if (choice !== undefined && choice !== "keep-blocker") {
      const slug = entry.source.path.split("/").slice(-2, -1)[0] ?? "";
      const stageId = stageOfFeature.get(slug);
      return {
        ...entry,
        disposition: choice === "optional" ? "unsupported" : entry.disposition,
        producer: "judgment",
        timing: choice.startsWith("specstride-phase:") ? choice : entry.timing,
        stage_ids: stageId !== undefined ? [stageId] : entry.stage_ids,
      };
    }
    const command = declaredByAnchor.get(entry.source.anchor);
    if (command !== undefined) {
      const choice = commandAnswers.get(entry.source.anchor);
      const timing = choice?.startsWith("specstride-phase:") ? choice : timingOf(command.phase);
      return {
        ...entry,
        disposition: "supported",
        producer: "stage",
        timing,
        verification_ids: [command.id],
      };
    }
    return entry;
  });

  // (d) FINDINGS — the kept blockers, with the provenance of the answers.
  const findings: DraftFinding[] = [];
  for (const candidate of draft.inventory.prerequisites) {
    if (prerequisiteAnswers.get(candidate.id) !== "keep-blocker") continue;
    findings.push({
      id: `missing-prerequisite-${candidate.id.toLowerCase()}`,
      severity: "blocker",
      status: "open",
      message: `the prerequisite ${candidate.resolved} of ${candidate.source.path} is absent`,
      source: { anchor: candidate.id, line: candidate.source.line, path: candidate.source.path },
      resolution: "Provide the prerequisite, or answer `optional` in the judgment exchange.",
      provenance: (judgment?.answers ?? []).find(
        (one) =>
          one.item === itemOfKind(judgment?.items ?? [], "settle-prerequisite", candidate.id),
      )?.provenance,
    });
  }
  for (const [anchor, choice] of blockerAnswers) {
    if (choice !== "keep-blocker") continue;
    const answer = (judgment?.answers ?? []).find(
      (one) => one.item === itemOfKind(judgment?.items ?? [], "resolve-blocker", anchor),
    );
    findings.push({
      id: `blocker-${anchor.toLowerCase()}`,
      severity: "blocker",
      status: "open",
      message: `the blocker ${anchor} was kept by the judgment exchange`,
      source: { anchor, line: 1, path: "." },
      resolution: "Resolve the blocker, or answer `accepted` in the judgment exchange.",
      provenance: answer?.provenance,
    });
  }
  const bootstrap = findingsOfBootstrap(draft.findings);
  findings.push({
    ...bootstrap,
    status: "resolved",
    resolution: BOOTSTRAP_RESOLUTION,
  });

  return {
    draft: {
      ...draft,
      coverage,
      findings,
      stages,
      status: "draft",
    },
    documents,
  };
}

function itemOfKind(
  items: readonly { readonly id: string; readonly kind: string; readonly anchor: string }[],
  kind: string,
  anchor: string,
): string | undefined {
  return items.find((one) => one.kind === kind && one.anchor === anchor)?.id;
}

/** The bootstrap finding of the draft, whatever its status was. */
function findingsOfBootstrap(findings: readonly DraftFinding[]): DraftFinding {
  const found = findings.find((one) => one.id === BOOTSTRAP_FINDING_ID);
  return found ?? findings[0]!;
}
