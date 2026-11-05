/**
 * T036 — THE STALENESS VERDICT: the reading of the files, the call of the
 * classification, and the lines of F104-FR-025 (F104-FR-024, F104-FR-025,
 * F104-FR-027; CQ-214; `contracts/verdict.md`).
 *
 * The split this module exists to keep (CQ-214, answered by the owner on
 * 2026-09-30):
 *
 *  - the CLASSIFICATION — recorded hashes and hashes now to `unchanged`,
 *    `ticks-only`, `changed` or `unreadable`, and to `fresh` or `stale` — is the
 *    pure operation of the canonical hasher in `@specstride/kernel`
 *    (`packages/kernel/src/hasher/staleness.ts`), so that `@specstride/core` and
 *    the loop layers reach it without importing this package. It reads no file;
 *  - THIS package reads the files, computes the hashes now THROUGH the hasher,
 *    calls that classification and builds the lines below. It decides nothing
 *    about a state itself: there is no comparison of hashes in this file, and
 *    `classifySources` of the kernel is the one thing that turns hashes into
 *    states. EP-03 gains no operation for the verdict (F104-FR-024).
 *
 * F104-FR-027 — the verdict is one function whose result does not depend on
 * when it is asked. This module therefore holds no clock and no check point:
 * WHERE the comparison is made belongs to features 102, 103 and 105 (ruling K3,
 * research D-5; annex X §X.7 row 15). `COMPARES_AT_A_CHECK_POINT` is `false`.
 *
 * Two verdicts, one classification (F104-FR-024, interpretation I1):
 *
 *  - the verdict of a RUN, whose recorded sources are those of the run snapshot
 *    (annex B §B.12): the name rule of closed set 50 applies, so a recorded
 *    name outside `spec`, `plan` and `tasks` gives a stale verdict, and the
 *    names are reported in the order spec, plan, tasks;
 *  - the verdict over the sources of a LAUNCH CONTRACT: every source the
 *    contract holds is compared, of any kind of annex X §X.6 row 256, each
 *    identified by its INDEX and its path, and the name rule does not apply.
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  classifySources,
  changedNames,
  verdictOf,
  type ClassifiedSource,
} from "@specstride/kernel/hasher";
import type { SourceReading } from "@specstride/contracts/ep/hasher";
import {
  VERDICT_LINES,
  carriesACheckboxInsensitiveHash,
  type SourceState,
  type SourceVerdict,
  type SpecSource,
  type Verdict,
} from "./model.ts";
import { operatingSystemMessage } from "./errors.ts";
import { hashesOfBytes, repositoryPath } from "./sources.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F104-FR-024", "F104-FR-025", "F104-FR-027"] as const;

/** The rows of the behaviour inventory of R18 behind the verdict. */
export const BEHAVIOUR_ROWS = Object.freeze([
  // Stale check: a source whose SHA-256 changed is stale unless kind `tasks`
  // and the checkbox-normalized hash still equals `semantic_sha256`; an
  // unreadable source is reported `sources[i] cannot be read` (011 FR-007).
  "B-2511",
  // Exit 23 with stderr `stale contract sources:` + list; the file is NOT
  // rewritten to draft in this case (011 FR-007).
  "B-2634",
  // `render_launcher.py` exit 23 with stderr `stale contract sources:`.
  "B-2545",
]);

/** The classification is the kernel hasher's, never this module's (CQ-214). */
export const CLASSIFIER = "@specstride/kernel/hasher" as const;

/** This module makes no comparison at a check point of its own (F104-FR-027). */
export const COMPARES_AT_A_CHECK_POINT = false as const;

/** This module asks no clock: the verdict does not depend on when it is asked. */
export const READS_A_CLOCK = false as const;

/* ------------------------------------------------------------------ *
 * The hashes NOW: the one read of the verdict.
 * ------------------------------------------------------------------ */

/** What the files say now about one recorded source. */
export type HashesNow = {
  /** The content hash now, or `undefined` where the file cannot be read. */
  readonly contentHash?: string | undefined;
  /** For a task list, the hash now that ignores checkboxes. */
  readonly checkboxInsensitiveHash?: string | undefined;
  /** The operating-system error, where the file cannot be read (F104-FR-025). */
  readonly error?: string | undefined;
};

/**
 * The hashes of one recorded source AS THE FILE IS NOW. This is the impure
 * step, kept in one place: the read, and then the hasher.
 *
 * A read that fails gives no hash and carries the operating-system message, as
 * `sources[<i>] cannot be read: <path>: <error>` needs it (F104-FR-025). The
 * hash that ignores checkboxes is asked for only where the RECORD is a task
 * list, so that the rule of F104-FR-022 is applied to a task list alone.
 */
export function hashesNowOf(root: string, source: SpecSource): HashesNow {
  const absolute = isAbsolute(source.path) ? source.path : join(root, source.path);
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(absolute);
  } catch (cause) {
    return Object.freeze({ error: operatingSystemMessage(cause) });
  }
  const kind = carriesACheckboxInsensitiveHash(source) ? "tasks" : source.kind;
  return Object.freeze(hashesOfBytes(bytes, kind));
}

/**
 * The reading the classification is handed, built from the record and the
 * hashes now (F104-FR-024). It is the shape of feature 100's `SourceReading`;
 * no state is decided here.
 */
export function readingOf(source: SpecSource, now: HashesNow): SourceReading {
  return Object.freeze({
    logicalName: source.name,
    repositoryPath: source.path,
    recordedHash: source.contentHash,
    recordedHashIgnoringCheckboxes: source.checkboxInsensitiveHash,
    hashNow: now.contentHash,
    hashNowIgnoringCheckboxes: now.checkboxInsensitiveHash,
  });
}

/* ------------------------------------------------------------------ *
 * The verdict (F104-FR-024).
 * ------------------------------------------------------------------ */

/** One compared source: the record, what the file says now, and its state. */
export type ComparedSource = {
  readonly index: number;
  readonly name: string;
  readonly path: string;
  readonly state: SourceState;
  readonly moreThanTicks?: boolean | undefined;
  /** The operating-system error, where the file could not be read. */
  readonly error?: string | undefined;
  /** Set where the name rule of a run refused the recorded name (row 50). */
  readonly nameOutsideTheRunVerdict?: boolean | undefined;
};

/** The verdict with its compared sources and the lines of F104-FR-025. */
export type VerdictReport = {
  readonly verdict: Verdict;
  readonly compared: readonly ComparedSource[];
  /** One line per source that is `changed` or `unreadable`, in the order recorded. */
  readonly lines: readonly string[];
};

/** Which name rule a verdict applies: `run` for a run, `none` for a contract. */
export type VerdictKind = "run" | "launch-contract";

/** The name rule each kind of verdict applies (F104-FR-024, I1). */
export const NAME_RULE_OF: Readonly<Record<VerdictKind, "run" | "none">> = Object.freeze({
  run: "run",
  "launch-contract": "none",
});

/** What a verdict is asked for. */
export type VerdictRequest = {
  /** The root of the repository; a recorded relative path is read under it. */
  readonly root: string;
  /** The recorded sources: the run snapshot's, or the contract's, in order. */
  readonly sources: readonly SpecSource[];
  /** `run` applies the name rule of closed set 50; `launch-contract` does not. */
  readonly kind?: VerdictKind | undefined;
};

/** The order the verdict of a RUN names its sources in (F104-FR-024). */
export const ORDER_OF_THE_NAMES = ["spec", "plan", "tasks"] as const;

/**
 * The compared sources in the order the verdict REPORTS them. For a run that is
 * spec, plan, tasks — the order of closed set 50 — with any source whose name is
 * outside the set kept, at the end, because such a source makes the verdict
 * stale and must be visible. For a launch contract it is the recorded order,
 * because a contract names a source by its INDEX (F104-FR-024, I1).
 */
export function inReportOrder(
  compared: readonly ComparedSource[],
  kind: VerdictKind,
): readonly ComparedSource[] {
  if (kind !== "run") return compared;
  const rank = (name: string) => {
    const at = ORDER_OF_THE_NAMES.indexOf(name as (typeof ORDER_OF_THE_NAMES)[number]);
    return at === -1 ? ORDER_OF_THE_NAMES.length : at;
  };
  return Object.freeze(
    [...compared].sort((a, b) => rank(a.name) - rank(b.name) || a.index - b.index),
  );
}

/**
 * The classified sources in the order the verdict reports them. It is
 * `inReportOrder` over the kernel's own shape, which carries the same `name` and
 * `index` the ordering reads.
 */
export function classifiedInReportOrder(
  classified: readonly ClassifiedSource[],
  kind: VerdictKind,
): readonly ClassifiedSource[] {
  if (kind !== "run") return classified;
  const order = inReportOrder(
    classified.map((s) => ({ index: s.index, name: s.name, path: s.path, state: s.state })),
    kind,
  );
  return Object.freeze(
    order.map((s) => classified.find((c) => c.index === s.index) as ClassifiedSource),
  );
}

/** A state that makes the verdict stale, as the classification reports it. */
function isStale(state: SourceState): boolean {
  return state === "changed" || state === "unreadable";
}

/**
 * F104-FR-025 — the lines, one per source that is `changed` or `unreadable`, in
 * the order recorded and named by INDEX. The texts themselves are the ONE pair
 * of `VERDICT_LINES` in `model.ts`, so this module writes no line of its own.
 */
export function linesOf(compared: readonly ComparedSource[]): readonly string[] {
  return Object.freeze(
    compared
      .filter((source) => isStale(source.state))
      .map((source) =>
        source.state === "unreadable"
          ? VERDICT_LINES.unreadable(source.index, source.path, source.error ?? "")
          : VERDICT_LINES.changed(source.index, source.path),
      ),
  );
}

/**
 * F104-FR-024 — THE VERDICT. The files are read here, the hashes now are taken
 * from the hasher, the classification of `@specstride/kernel` turns them into
 * states and one verdict, and the lines of F104-FR-025 are built over the
 * result.
 *
 * `moreThanTicks` is reported for the task list: `false` where the content hash
 * differs but the hash that ignores checkboxes is equal, `true` for any other
 * difference. A tick by the proposer, by the engine after approval or by the
 * runtime for an integrated group therefore never makes a run stale.
 */
export function verdict(request: VerdictRequest): VerdictReport {
  const kind = request.kind ?? "run";
  const now = request.sources.map((source) => hashesNowOf(request.root, source));
  const readings = request.sources.map((source, index) =>
    readingOf(source, now[index] as HashesNow),
  );
  // The ONE call that turns hashes into states: the pure operation of the
  // canonical hasher in the kernel (CQ-214). Nothing in this file compares a
  // hash itself.
  const classified: readonly ClassifiedSource[] = classifySources(readings, {
    nameRule: NAME_RULE_OF[kind],
  });
  const compared: readonly ComparedSource[] = Object.freeze(
    classified.map((source, index) => {
      const error = now[index]?.error;
      return Object.freeze({
        index: source.index,
        name: source.name,
        path: source.path,
        state: source.state,
        ...(source.moreThanTicks === undefined ? {} : { moreThanTicks: source.moreThanTicks }),
        ...(error === undefined ? {} : { error }),
        ...(source.nameOutsideTheRunVerdict === undefined
          ? {}
          : { nameOutsideTheRunVerdict: source.nameOutsideTheRunVerdict }),
      });
    }),
  );
  const ordered = inReportOrder(compared, kind);
  const sources: readonly SourceVerdict[] = Object.freeze(
    ordered.map((source) =>
      Object.freeze({
        name: source.name,
        path: source.path,
        state: source.state,
        ...(source.moreThanTicks === undefined ? {} : { moreThanTicks: source.moreThanTicks }),
      }),
    ),
  );
  return Object.freeze({
    verdict: Object.freeze({
      // `fresh` or `stale` is the kernel's too, over the same classification.
      result: verdictOf(classified),
      sources,
      // `changed[]` is the kernel's too, over the classified sources in the
      // order the verdict reports them (F104-FR-024).
      changed: changedNames(classifiedInReportOrder(classified, kind)),
    }),
    compared,
    lines: linesOf(compared),
  });
}

/** The verdict of a RUN: the recorded sources are the run snapshot's (§B.12). */
export function verdictOfARun(root: string, sources: readonly SpecSource[]): VerdictReport {
  return verdict({ root, sources, kind: "run" });
}

/**
 * The verdict over the sources of a LAUNCH CONTRACT (F104-FR-025): every source
 * the contract holds is compared, of any kind of annex X §X.6 row 256, by index
 * and path; the name rule of the run does not apply.
 */
export function verdictOfALaunchContract(
  root: string,
  sources: readonly SpecSource[],
): VerdictReport {
  return verdict({ root, sources, kind: "launch-contract" });
}

/**
 * The recorded sources of a launch contract as this module takes them: a
 * contract records a `path` and a `kind` per source and names it by its index,
 * so the logical name of the record is the path itself where the contract gives
 * none (F104-FR-024, I1).
 */
export function recordedSourcesOfAContract(
  root: string,
  sources: readonly {
    readonly path: string;
    readonly kind: string;
    readonly name?: string | undefined;
    readonly contentHash: string;
    readonly checkboxInsensitiveHash?: string | undefined;
  }[],
): readonly SpecSource[] {
  return Object.freeze(
    sources.map((source) =>
      Object.freeze({
        kind: source.kind === "tasks" ? ("tasks" as const) : (source.kind as SpecSource["kind"]),
        name: source.name ?? source.path,
        path: repositoryPath(root, source.path),
        contentHash: source.contentHash,
        ...(source.checkboxInsensitiveHash === undefined
          ? {}
          : { checkboxInsensitiveHash: source.checkboxInsensitiveHash }),
      }),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * What the CALLER does with a stale launch contract (F104-FR-025).
 * ------------------------------------------------------------------ */

/**
 * B-2634, B-2545 — the header the caller prints on stderr before the list, the
 * exit it takes, and the one thing it does NOT do: rewrite the status of the
 * launch contract to draft.
 *
 * The verdict is the SOLE input of that decision (F104-FR-025): the caller does
 * not re-read a hash and does not decide a state of its own.
 */
export const STALE_CONTRACT_HEADER = "stale contract sources:" as const;

/** The exit of a stale launch contract (011 FR-007; B-2634, B-2545, B-2565). */
export const EXIT_OF_A_STALE_CONTRACT = 23 as const;

/** The status of the launch contract is NOT rewritten to draft (B-2634). */
export const REWRITES_THE_STATUS_TO_DRAFT = false as const;

/** The verdict is the sole input of the decision that a contract is stale. */
export const VERDICT_IS_THE_SOLE_INPUT = true as const;

/** What the caller of a stale launch contract prints and exits with. */
export type StaleContractReport = {
  /** The stderr lines: the header, then one line per stale source. */
  readonly stderr: readonly string[];
  readonly exit: number;
  readonly rewritesTheStatusToDraft: boolean;
};

/**
 * F104-FR-025 — the report of a launch contract whose sources are stale. It is
 * built from the VERDICT alone; where the verdict is fresh there is no report,
 * and the caller exits 0.
 */
export function staleContractReport(report: VerdictReport): StaleContractReport | undefined {
  if (report.verdict.result !== "stale") return undefined;
  return Object.freeze({
    stderr: Object.freeze([STALE_CONTRACT_HEADER, ...report.lines]),
    exit: EXIT_OF_A_STALE_CONTRACT,
    rewritesTheStatusToDraft: REWRITES_THE_STATUS_TO_DRAFT,
  });
}

/** True where the verdict is stale; a convenience over `report.verdict.result`. */
export function isStaleReport(report: VerdictReport): boolean {
  return report.verdict.result === "stale";
}
