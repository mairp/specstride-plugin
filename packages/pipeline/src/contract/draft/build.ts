/**
 * T020 — the draft builder and the single bootstrap finding (F107-FR-005;
 * 011 FR-002; C-211, C-212).
 *
 * The draft is a pure function of the inventory: sources (F107-FR-001), the
 * feature records, the repository facts, the candidates, one coverage entry
 * per task, the single open blocker `semantic-derivation-required` and no
 * stage. The top-level field names are those of annex G §G.8; the member names
 * inside the records are the baseline's (data-model.md, "Member names"). Two
 * names differ from the baseline by register row DV-120 and the key-name map
 * of annex X §X.8: `schema` (for `schema_version`, value
 * `specstride.launch-contract/1`) and `configuration.relaunch` (for
 * `configuration.auto`).
 *
 * `configuration` carries `verification` (mode and reason, F107-FR-036), the
 * learning block the port returned, when it was asked for (F107-FR-002), the
 * hash of the comment, when a comment was given (F107-FR-014) — and no other
 * member beyond the baseline's.
 */
import { isAbsolute } from "node:path";

/** The canonical model and its task type, through the package root (EP-03). */
type CanonicalSpecModel = ReturnType<
  (typeof import("@specstride/spec-formats"))["validate"]["parse"]
>;
type SpecTask = CanonicalSpecModel["phases"][number]["tasks"][number];

import type { RepositoryFacts, FeatureRecord } from "../inventory/features.ts";
import { contractId } from "../inventory/features.ts";
import type { SourceRecord } from "../inventory/sources.ts";
import type {
  PrerequisiteCandidate,
  ShellCandidate,
  VerificationDocumentRecord,
} from "../inventory/candidates.ts";
import { obligationIdOf } from "../inventory/candidates.ts";
import type { SourceCounts } from "../inventory/verification-source.ts";

/** The schema id of a launch contract (DV-120). */
export const LAUNCH_CONTRACT_SCHEMA = "specstride.launch-contract/1" as const;

/** The generated-by record, with the baseline member names (DV-066, N-16). */
export const GENERATED_BY = Object.freeze({
  tool: "contract-derive",
  version: "1.0",
} as const);

/** The id and the fixed text of the single bootstrap finding (F107-FR-005). */
export const BOOTSTRAP_FINDING_ID = "semantic-derivation-required" as const;
export const BOOTSTRAP_FINDING_MESSAGE =
  "Classify every execution-relevant obligation and construct the stage graph.";
export const BOOTSTRAP_FINDING_RESOLUTION =
  "Complete semantic derivation, reconcile verification, and validate the contract.";

/** One coverage entry, with the baseline member names (data-model.md). */
export type CoverageEntry = {
  readonly id: string;
  readonly kind: string;
  readonly timing: string;
  readonly producer: string;
  readonly disposition: string;
  readonly rationale: string;
  readonly source: { readonly anchor: string; readonly line: number; readonly path: string };
  readonly stage_ids: readonly string[];
  readonly verification_ids: readonly string[];
  readonly evidence: readonly string[];
};

/** One finding, with the baseline member names (data-model.md). */
export type DraftFinding = {
  readonly id: string;
  readonly severity: string;
  readonly status: string;
  readonly message: string;
  readonly source: { readonly anchor: string; readonly line: number; readonly path: string };
  readonly resolution: string;
  readonly provenance?: unknown;
};

/** The members of `configuration` this feature owns (row 52; F107-FR-005). */
export type ContractConfiguration = {
  /** The baseline members, with the values the baseline derives on FX-32. */
  readonly agent_stream: true;
  readonly color: "auto";
  readonly live_detail: "full";
  readonly specstride_live: true;
  readonly telemetry: {
    readonly loki: { readonly enabled: false };
    readonly otel: { readonly enabled: false };
  };
  /** F107-FR-036 — the verification mode and its reason (row 52). */
  readonly verification: { readonly mode: "required" | "plan" | "off"; readonly reason: string };
  /** The learning block the port returned, when it was asked for. */
  readonly learning?: unknown;
  /**
   * The record of the comment (F107-FR-034, F107-FR-035): the hash over the
   * text as typed and what was changed because of it — the record the keys
   * `comment` and `changed` of the digest line are read from.
   */
  readonly comment?: {
    readonly hash: string;
    readonly changed: readonly { readonly option: string; readonly value: unknown }[];
  };
};

/** One stage of the draft, with the members of data-model.md. */
export type StageDraft = {
  readonly id: string;
  readonly kind: string;
  readonly depends_on: readonly string[];
  readonly cwd: string;
  readonly action?: readonly string[];
  readonly resume?: readonly string[];
  readonly preconditions: readonly Record<string, unknown>[];
  readonly postconditions: readonly Record<string, unknown>[];
  readonly recovery: Record<string, unknown>;
  readonly evidence: readonly string[];
};

/** The judgment record of the exchange (data-model.md; F107-FR-009). */
export type JudgmentRecord = {
  readonly items: readonly {
    readonly id: string;
    readonly kind: string;
    readonly anchor: string;
    readonly choices: readonly string[];
  }[];
  readonly answers: readonly {
    readonly item: string;
    readonly choice: string;
    readonly provenance: {
      readonly who: string;
      readonly route: string;
      readonly harness?: string;
      readonly batch: string;
    };
    readonly settled: readonly string[];
  }[];
};

/** The draft of a launch contract (annex G §G.8; DV-120). */
export type LaunchContractDraft = {
  readonly schema: typeof LAUNCH_CONTRACT_SCHEMA;
  readonly id: string;
  readonly status: "draft";
  readonly generated_by: typeof GENERATED_BY;
  readonly repository: RepositoryFacts;
  readonly authorized_roots: readonly string[];
  readonly features: readonly FeatureRecord[];
  readonly sources: readonly SourceRecord[];
  readonly inventory: {
    readonly prerequisites: readonly PrerequisiteCandidate[];
    readonly shell_candidates: readonly ShellCandidate[];
    readonly tasks: readonly Record<string, unknown>[];
    readonly verification_documents: readonly VerificationDocumentRecord[];
    readonly judgment?: JudgmentRecord;
  };
  readonly configuration: ContractConfiguration;
  readonly coverage: readonly CoverageEntry[];
  readonly findings: readonly DraftFinding[];
  readonly stages: readonly StageDraft[];
};

/** The tasks of every feature, read through the canonical model only (F107-FR-007). */
export type ModelTask = {
  readonly task: SpecTask;
  readonly phase: number | null;
  readonly file: string;
};

/** The projection of a task into the inventory, with the baseline members. */
export function taskRecord(task: ModelTask): Record<string, unknown> {
  const tagged = task.task.markers.filter((marker: string) => marker !== "P")[0];
  const story = tagged === undefined ? null : tagged.replace(/^\[|\]$/g, "");
  return {
    checked: task.task.ticked,
    id: task.task.id,
    line: task.task.line,
    parallel_marker: task.task.markers.includes("P"),
    phase: task.phase,
    source: task.file,
    story: story ?? null,
    text: task.task.text,
  };
}

/** The phase timing of a task: `specstride-phase:<n>` or `unclassified`. */
export function timingOf(phase: number | null): string {
  return phase === null ? "unclassified" : `specstride-phase:${phase}`;
}

/** One coverage entry per task, settled by fact for none (F107-FR-005). */
export function coverageOfTasks(tasks: readonly ModelTask[]): readonly CoverageEntry[] {
  return tasks.map((one) => ({
    id: obligationIdOf({
      source: one.file,
      line: one.task.line,
      taskId: one.task.id,
      text: one.task.text,
    }),
    kind: "implementation",
    timing: timingOf(one.phase),
    producer: "unclassified",
    disposition: "unresolved",
    rationale: one.task.text,
    source: { anchor: one.task.id, line: one.task.line, path: one.file },
    stage_ids: [],
    verification_ids: [],
    evidence: [],
  }));
}

/** The single bootstrap finding (F107-FR-005). */
export function bootstrapFinding(coverage: readonly CoverageEntry[]): DraftFinding {
  const anchor = coverage[0]?.source ?? { anchor: "artifact-set", line: 1, path: "." };
  return {
    id: BOOTSTRAP_FINDING_ID,
    severity: "blocker",
    status: "open",
    message: BOOTSTRAP_FINDING_MESSAGE,
    source: anchor,
    resolution: BOOTSTRAP_FINDING_RESOLUTION,
  };
}

/** The baseline members of `configuration` (the values of the as-is default). */
export function baselineConfiguration(): Omit<
  ContractConfiguration,
  "verification" | "learning" | "comment"
> {
  return {
    agent_stream: true,
    color: "auto",
    live_detail: "full",
    specstride_live: true,
    telemetry: { loki: { enabled: false }, otel: { enabled: false } },
  };
}

/** What the builder is given: everything the inventory produced, already read. */
export type DraftInput = {
  readonly root: string;
  readonly featureDirs: readonly string[];
  readonly features: readonly FeatureRecord[];
  readonly sources: readonly SourceRecord[];
  readonly facts: RepositoryFacts;
  readonly prerequisites: readonly PrerequisiteCandidate[];
  readonly shellCandidates: readonly ShellCandidate[];
  readonly verificationDocuments: readonly VerificationDocumentRecord[];
  readonly tasks: readonly ModelTask[];
  readonly counts: SourceCounts;
  readonly verificationMode: "required" | "plan" | "off";
  readonly verificationReason: string;
  readonly learning?: unknown;
  readonly commentHash?: string;
  /**
   * What was changed because of the comment (F107-FR-035): one entry per
   * named option of `--comment-selects`, with the option and the value in
   * force — recorded beside the hash under `configuration.comment`.
   */
  readonly commentChanged?: readonly { readonly option: string; readonly value: unknown }[];
};

/**
 * F107-FR-005 — the draft. A pure function of its input: no clock, no state,
 * no read. Equal inputs give equal bytes.
 */
export function buildDraft(input: DraftInput): LaunchContractDraft {
  const coverage = coverageOfTasks(input.tasks);
  return {
    schema: LAUNCH_CONTRACT_SCHEMA,
    id: contractId(input.root, input.featureDirs),
    status: "draft",
    generated_by: GENERATED_BY,
    repository: input.facts,
    authorized_roots: [input.root],
    features: input.features,
    sources: input.sources,
    inventory: {
      prerequisites: input.prerequisites,
      shell_candidates: input.shellCandidates,
      tasks: input.tasks.map(taskRecord),
      verification_documents: input.verificationDocuments,
    },
    configuration: {
      ...baselineConfiguration(),
      verification: { mode: input.verificationMode, reason: input.verificationReason },
      ...(input.learning !== undefined ? { learning: input.learning } : {}),
      // F107-FR-034, F107-FR-035 — the record the keys `comment` and
      // `changed` of the line before the digest line are read from: the hash
      // over the text as typed, and one entry per named option.
      ...(input.commentHash !== undefined
        ? { comment: { hash: input.commentHash, changed: input.commentChanged ?? [] } }
        : {}),
    },
    coverage,
    findings: [bootstrapFinding(coverage)],
    stages: [],
  };
}

/** The absolute form of a root for `authorized_roots` (a path, never a name). */
export function authorizedRoot(root: string): string {
  return isAbsolute(root) ? root : root;
}

/** The counts the `[SPECSTRIDE-DERIVE]` line prints (F107-FR-008). */
export function countsForTheLine(counts: SourceCounts): {
  declarations: number;
  commands: number;
  mappings: number;
} {
  return {
    declarations: counts.sourceDeclarations,
    commands: counts.normalizedCommands,
    mappings: counts.phaseMappings,
  };
}

/** The canonical model of one task list, held by the caller (F107-FR-007). */
export type TasksOfModel = readonly {
  readonly model: unknown;
  readonly tasks: readonly ModelTask[];
}[];
