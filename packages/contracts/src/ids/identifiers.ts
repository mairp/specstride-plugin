/**
 * T026 — the identifier types and the minting rules as data (annex B, §B.3;
 * F100-FR-044, F100-FR-045).
 *
 * One branded string type per row of `data/identifiers.json`, so that a
 * `RunId` and a `LaunchId` cannot be mixed up at a call, and the scope, the
 * minting process and the rule of every row as data a reader can quote.
 */
import identifiers from "../../data/identifiers.json" with { type: "json" };

declare const brand: unique symbol;
/** A string that carries the name of the identifier it is (annex B, §B.3). */
export type Branded<Name extends string> = string & { readonly [brand]: Name };

export type WorkspaceId = Branded<"workspaceId">;
export type PipelineId = Branded<"pipelineId">;
export type RunId = Branded<"runId">;
export type LaunchId = Branded<"launchId">;
export type EngineStartId = Branded<"engineStartId">;
export type AttemptId = Branded<"attemptId">;
export type PassId = Branded<"passId">;
export type UnitId = Branded<"unitId">;
export type JobId = Branded<"jobId">;
export type VerdictId = Branded<"verdictId">;
export type WorkerId = Branded<"workerId">;
export type GroupId = Branded<"groupId">;

/** One row of the table of §B.3. */
export type IdentifierRow = {
  /** The identifier, without the back-ticks of the annex. */
  readonly identifier: string;
  /** The scope in which the value is unique. */
  readonly scope: string;
  /** The process that mints it. */
  readonly mintedBy: string;
  /** The rule of the annex, verbatim. */
  readonly rule: string;
};

const unbacktick = (cell: string): string => cell.replace(/`/g, "").trim();

const RAW = (identifiers as { identifiers: Record<string, string>[] }).identifiers;

/**
 * The rows of the table of §B.3. The annex writes `workerId`, `groupId` in
 * one row; the row is split so that every identifier has a row of its own.
 */
export const identifierRows: readonly IdentifierRow[] = Object.freeze(
  RAW.flatMap((row) =>
    unbacktick(row["Identifier"] ?? "")
      .split(",")
      .map((name) => unbacktick(name))
      .filter((name) => name !== "")
      .map((name) =>
        Object.freeze({
          identifier: name,
          scope: row["Scope"] ?? "",
          mintedBy: row["Minted by"] ?? "",
          rule: row["Rule"] ?? "",
        }),
      ),
  ),
);

/** Every identifier name of §B.3. */
export const IDENTIFIER_NAMES: readonly string[] = Object.freeze(
  identifierRows.map((r) => r.identifier),
);

/** The row of one identifier, or `undefined` where the table holds none. */
export function identifierRow(name: string): IdentifierRow | undefined {
  return identifierRows.find((r) => r.identifier === name);
}

/** The scope of an identifier, from the table (F100-FR-044). */
export function scopeOf(name: string): string | undefined {
  return identifierRow(name)?.scope;
}

/** The process that mints an identifier, from the table (F100-FR-044). */
export function mintedBy(name: string): string | undefined {
  return identifierRow(name)?.mintedBy;
}

/** The rule of an identifier, from the table (F100-FR-044). */
export function ruleOf(name: string): string | undefined {
  return identifierRow(name)?.rule;
}

/**
 * F100-FR-045. A `launch` continues the unfinished run of the same feature,
 * with its `runId` and its counts. A new run starts only when no unfinished
 * run of the feature exists or when the consumer passes `--new-run`. Counts
 * inside a run are reset only by `--reset-counts`, which is accepted from the
 * command line only and is never stored in the run snapshot.
 */
export type LaunchContinuation =
  | { readonly kind: "continue"; readonly runId: RunId; readonly resetCounts: boolean }
  | { readonly kind: "new-run"; readonly reason: "no-unfinished-run" | "--new-run" };

export type LaunchRequest = {
  /** The unfinished run of the feature, where one exists. */
  readonly unfinishedRunId?: RunId | undefined;
  /** The flag `--new-run` of the command line. */
  readonly newRun?: boolean | undefined;
  /** The flag `--reset-counts`; accepted from the command line only. */
  readonly resetCounts?: boolean | undefined;
};

/** Decide what a `launch` does with the run of the feature (F100-FR-045). */
export function continuationOfLaunch(request: LaunchRequest): LaunchContinuation {
  if (request.newRun === true) return { kind: "new-run", reason: "--new-run" };
  if (request.unfinishedRunId === undefined)
    return { kind: "new-run", reason: "no-unfinished-run" };
  return {
    kind: "continue",
    runId: request.unfinishedRunId,
    resetCounts: request.resetCounts === true,
  };
}

/**
 * `--reset-counts` is never stored in the run snapshot (F100-FR-045): the
 * snapshot writer asks this before it records a key.
 */
export const RESET_COUNTS_IS_STORED_IN_SNAPSHOT = false as const;

/** `--reset-counts` is accepted from the command line only (F100-FR-045). */
export const RESET_COUNTS_RANKS: readonly string[] = Object.freeze(["flag"]);
