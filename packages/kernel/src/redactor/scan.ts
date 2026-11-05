/**
 * T044 — the scan before a commit (F111-FR-031).
 *
 * F111-FR-031: *... Before the runtime makes a commit, the files of the commit
 * that the runtime wrote MUST be scanned with the same redactor for registered
 * secrets and for the patterns; a hit MUST block the commit and raise
 * `redaction.commit_blocked`, which names the files and the counts and never the
 * matches.*
 *
 * NEVER THE MATCHES. The hit records a file, a line and WHICH RULE matched — the
 * name of the pattern, which is a name in versioned data and not a secret — and
 * nothing of the text. `commitBlockedEvent` goes one step further: its `data` is
 * the list of files and the list of counts, with no line and no name, because a
 * line number in a stream that a person reads beside the repository is a pointer
 * to the secret.
 *
 * IT FAILS CLOSED ON A FILE IT CANNOT READ (F111-FR-024). A file of the commit
 * that cannot be read is not a file that holds no secret; it is a file nobody
 * checked. The scan blocks, names it, and marks the hit `unreadable`. That marker
 * is this module's own: the union of `PreCommitHit.matched` in
 * `@specstride/contracts` has two members, and neither says "not checked", so the
 * scan widens the kind here rather than reporting a file it never read as clean.
 *
 * ONE HIT PER OCCURRENCE. Several patterns can match the same characters — the
 * widened set holds provider prefixes that overlap the baseline's — so a match is
 * keyed by the offset at which it starts, and the first rule to claim an offset
 * owns it. Without that, a count would say more about how many patterns the set
 * holds than about how many secrets the file holds.
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { compilePattern, type PatternEntry } from "./patterns.ts";
import type { SpecstrideRedactor } from "./redactor.ts";

/** The event a hit raises (F111-FR-031). */
export const COMMIT_BLOCKED_EVENT_TYPE = "redaction.commit_blocked" as const;

/** What matched: a registered secret, a pattern, or nothing because the file was not read. */
export const MATCH_KINDS = ["registered-secret", "pattern", "unreadable"] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

/** One hit of the scan. It names the rule and never the match. */
export type CommitScanHit = {
  /** The file of the commit, as the caller named it. */
  readonly file: string;
  /** The line, 1-indexed. Zero where the file could not be read. */
  readonly line: number;
  /** What matched. */
  readonly matched: MatchKind;
  /** The name of the pattern, where a pattern matched. */
  readonly pattern?: string;
};

/** The event of a blocked commit: the files and the counts, and nothing else. */
export type CommitBlockedEvent = {
  readonly type: typeof COMMIT_BLOCKED_EVENT_TYPE;
  readonly data: {
    readonly files: readonly string[];
    readonly counts: readonly number[];
  };
};

/** What the scan returns. */
export type CommitScanResult = {
  readonly hits: readonly CommitScanHit[];
  readonly blocked: boolean;
  /** The files that were hit, in the order the caller gave them. */
  readonly files: readonly string[];
  /** The count of hits of each file of `files`, aligned with it. */
  readonly counts: readonly number[];
  /** The event, where the commit is blocked. */
  readonly event?: CommitBlockedEvent;
};

/** What the scan is given. */
export type CommitScanOptions = {
  /** The root the file names are relative to. */
  readonly root: string;
  /** The SAME redactor the ingress uses: its registry and its patterns. */
  readonly redactor: SpecstrideRedactor;
  /** The value patterns to scan for. Absent: the redactor's own. */
  readonly values?: readonly PatternEntry[];
};

function hitsOfLine(
  line: string,
  file: string,
  number_: number,
  options: CommitScanOptions,
): readonly CommitScanHit[] {
  const claimed = new Map<number, CommitScanHit>();

  // The registered secrets first: they are literal, and they own their offsets.
  for (const offset of options.redactor.registry.hitOffsets(line)) {
    claimed.set(offset, Object.freeze({ file, line: number_, matched: "registered-secret" }));
  }

  for (const entry of options.values ?? options.redactor.values) {
    const expression = compilePattern(entry, true);
    let match = expression.exec(line);
    while (match !== null) {
      if (!claimed.has(match.index)) {
        claimed.set(
          match.index,
          Object.freeze({ file, line: number_, matched: "pattern", pattern: entry.name }),
        );
      }
      if (match[0].length === 0) expression.lastIndex += 1;
      match = expression.exec(line);
    }
  }

  return Object.freeze(
    [...claimed.entries()].sort(([left], [right]) => left - right).map(([, hit]) => hit),
  );
}

/**
 * Scan the files of the commit that the runtime wrote. The files are read and
 * never written; the decision to block is the caller's to act on.
 */
export function scanCommitFiles(
  files: readonly string[],
  options: CommitScanOptions,
): CommitScanResult {
  const hits: CommitScanHit[] = [];
  const perFile = new Map<string, number>();

  for (const file of files) {
    const path = isAbsolute(file) ? file : join(options.root, file);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      hits.push(Object.freeze({ file, line: 0, matched: "unreadable" }));
      perFile.set(file, (perFile.get(file) ?? 0) + 1);
      continue;
    }
    const lines = text.split("\n");
    for (const [index, line] of lines.entries()) {
      for (const hit of hitsOfLine(line, file, index + 1, options)) {
        hits.push(hit);
        perFile.set(file, (perFile.get(file) ?? 0) + 1);
      }
    }
  }

  const hitFiles = files.filter((file) => (perFile.get(file) ?? 0) > 0);
  const counts = hitFiles.map((file) => perFile.get(file) ?? 0);
  const blocked = hits.length > 0;
  const event = blocked
    ? Object.freeze({
        type: COMMIT_BLOCKED_EVENT_TYPE,
        data: Object.freeze({ files: Object.freeze(hitFiles), counts: Object.freeze(counts) }),
      })
    : undefined;

  return Object.freeze({
    hits: Object.freeze(hits),
    blocked,
    files: Object.freeze(hitFiles),
    counts: Object.freeze(counts),
    ...(event === undefined ? {} : { event }),
  });
}

/** The event of a blocked commit, or `undefined` where nothing was hit. */
export function commitBlockedEvent(result: CommitScanResult): CommitBlockedEvent | undefined {
  return result.event;
}
