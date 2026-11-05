/**
 * T184 — the two kinds of run request as types, from the key `runRequests` of
 * `data/process-model.json` (annex F, §F.2; F100-FR-159).
 *
 * The runtime root accepts exactly two kinds. A request of kind `engine` has
 * the same lock, lease, relaunch classifier and digest as one of kind
 * `pipeline`, and no launch contract to validate.
 */
import processModel from "../../data/process-model.json" with { type: "json" };

/** The section of annex F that owns the table. */
export const ANNEX_SECTION = "annex F, §F.2" as const;

/** The key of `data/process-model.json` this module reads. */
export const DATA_KEY = "runRequests" as const;

/** The two kinds of run request, and no other (F100-FR-159). */
export const RUN_REQUEST_KINDS = ["pipeline", "engine"] as const;
export type RunRequestKind = (typeof RUN_REQUEST_KINDS)[number];

type RawRequest = {
  Kind: string;
  "What it is": string;
  "Produced by": string;
  "Has a launch contract and stages": string;
};

/** One row of the table of §F.2. */
export type RunRequestRow = {
  readonly kind: RunRequestKind;
  readonly whatItIs: string;
  readonly producedBy: string;
  readonly hasALaunchContractAndStages: boolean;
};

const unbacktick = (cell: string): string => cell.replace(/`/g, "").trim();

/** Load the table of §F.2 from `data/process-model.json` (F100-FR-159). */
export function loadRunRequests(): readonly RunRequestRow[] {
  return Object.freeze(
    (processModel as { runRequests: RawRequest[] }).runRequests.map((row) =>
      Object.freeze({
        kind: unbacktick(row.Kind) as RunRequestKind,
        whatItIs: row["What it is"],
        producedBy: row["Produced by"],
        hasALaunchContractAndStages: /^yes$/i.test(row["Has a launch contract and stages"].trim()),
      }),
    ),
  );
}

/** The rows of the table of §F.2, in the order of the annex. */
export const runRequestRows: readonly RunRequestRow[] = loadRunRequests();

/** The row of a kind, or `undefined` for a kind the table does not hold. */
export function runRequestRow(kind: string): RunRequestRow | undefined {
  return runRequestRows.find((row) => row.kind === kind);
}

/** A run request of kind `pipeline`: a promoted launch contract (§F.2). */
export type PipelineRunRequest = {
  readonly kind: "pipeline";
  /** The pipeline the promoted launch contract names. */
  readonly pipelineId: string;
  /** The logical name of the promoted launch contract. */
  readonly launchContract: string;
  /** The stages of the launch contract, by id. */
  readonly stages: readonly string[];
};

/** A run request of kind `engine`: one engine start with its arguments (§F.2). */
export type EngineRunRequest = {
  readonly kind: "engine";
  /** The feature the engine start is about. */
  readonly slug: string;
  /** The arguments of the engine start. */
  readonly argv: readonly string[];
};

/** A run request the runtime root accepts (F100-FR-159). */
export type RunRequest = PipelineRunRequest | EngineRunRequest;

/** True where the value is a run request of a kind the runtime root accepts. */
export function isRunRequestKind(kind: string): kind is RunRequestKind {
  return (RUN_REQUEST_KINDS as readonly string[]).includes(kind);
}

/**
 * F100-FR-159 — a request of kind `engine` has the same lock, lease, relaunch
 * classifier and digest as one of kind `pipeline`.
 */
export const SHARED_BY_BOTH_KINDS = ["lock", "lease", "relaunch classifier", "digest"] as const;

/** F100-FR-159 — a request of kind `engine` has no launch contract to validate. */
export function hasALaunchContract(kind: RunRequestKind): boolean {
  return runRequestRow(kind)?.hasALaunchContractAndStages ?? false;
}

/** The runtime root accepts exactly these two kinds and refuses any other. */
export function acceptRunRequestKind(kind: string): {
  readonly accepted: boolean;
  readonly message?: string;
} {
  if (isRunRequestKind(kind)) return Object.freeze({ accepted: true });
  return Object.freeze({
    accepted: false,
    message:
      `the runtime root accepts the run request kinds ${RUN_REQUEST_KINDS.join(" and ")} ` +
      `only; "${kind}" is not one of them (F100-FR-159)`,
  });
}
