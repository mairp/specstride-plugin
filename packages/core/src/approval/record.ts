/**
 * T006 of feature 101 — Lisa's gate store, EXTRACTED AS SOURCE
 * (F101-FR-028, F101-FR-029; research.md D1, ruling 12 / DP-014).
 *
 * ## Extraction
 *
 * | Item | Value |
 * |---|---|
 * | Source tree | `<lisa>` at local `main` `363e6a392ff6e59ec4905c044fb3b0a5239cbffc` ("chore: license the project under MIT", 2026-09-27 22:19:19 +0400), the tree DP-013 names for the 18 packages |
 * | Source file | `packages/core/src/gates/store.ts`, 244 lines, sha256 `45ccfadc5924ccc794ec1130d2220358202ee88f726bd8d8a951625035e1d7a4` |
 * | Read with | `git -C <lisa> show 363e6a3:packages/core/src/gates/store.ts` — the baseline is read-only and was never written to |
 * | What was taken | The whole file: the three name functions, the class `GateStore` with its layout, `writeEvidenceAtomic`, `hasEvidence`, `writeApproved`, `isApproved`, `writeFeedback`, `hasFeedback`, `firstUnapproved`, `allApproved`, `archiveAttempt`, `archiveApprovedFeedback`, `newestVerdict` and `writeVerdictTranscript` |
 *
 * **Licence note.** `<lisa>` at `363e6a3` carries `LICENSE` = the MIT
 * Licence, "Copyright (c) 2026 mairp", sha256
 * `ebcf480ee37cc93ed60bd5c460b5f1453ca008a0818469a7a8e51e9c8487e8ab`; this
 * repository's `LICENSE` has the SAME sha256 and the same holder, and
 * `packages/core/package.json` at `363e6a3` declares `"license": "MIT"` for
 * `@lisa/core`. MIT into MIT with one holder: compatible. The full record,
 * with every mechanical change and why none of them changes behaviour, is
 * `packages/core/EXTRACTED.md`.
 *
 * ## The one change the extraction had to make
 *
 * The baseline reaches `node:fs` directly. `@specstride/core` may not: `node:fs`
 * and `node:fs/promises` are forbidden to a core package
 * (`packages/contracts/data/package-graph.json`, F100-FR-012, F100-FR-234), and
 * every file goes through the atomic write of the kernel (F101-FR-028). So the
 * eight operations the baseline called are named as the port `GateTree` below,
 * which the composition root implements over the kernel. The BODIES are the
 * baseline's, operation for operation and branch for branch; only the receiver
 * of each call moved. `writeEvidenceAtomic` keeps its name and its guarantee —
 * the kernel's atomic write is the same three steps the baseline wrote by hand
 * (temporary name in the same directory, fsync, rename), so the gate still
 * never observes a half-written file (F101-FR-028, F100-FR-036).
 *
 * This module is the content owner of the approval record of feature 100 annex
 * B §B.14. T043 rewrites the store for that record and signs it; T074 verifies
 * it on resume. Until then the class holds the extracted behaviour, which the
 * characterization tests pin.
 */
import { atomicWriteSteps, type GateTree } from "./gate-tree.ts";
import {
  approvalKeyOf,
  signWithTheApprovalKey,
  type ApprovalKeyRecord,
  type ApprovalKeyStore,
} from "./key.ts";

export type { GateTree };
export { atomicWriteSteps };

/* ------------------------------------------------------------------ *
 * The three per-phase marker names (Lisa lines 41-49, verbatim).
 * ------------------------------------------------------------------ */

/** The three per-phase marker filenames, given a phase number. */
export function evidenceName(n: number): string {
  return `GATE${n}-EVIDENCE.md`;
}
export function approvedName(n: number): string {
  return `GATE${n}-APPROVED`;
}
export function feedbackName(n: number): string {
  return `GATE${n}-FEEDBACK.md`;
}

/**
 * The gate store is scoped to one feature's directory tree (Lisa lines 51-57):
 *
 *   <featureDir>/gates/          GATE<N>-{EVIDENCE.md,APPROVED,FEEDBACK.md}
 *   <featureDir>/attempts/…      archived rejects + approved-feedback
 *   <featureDir>/verdicts/…      phase<N>.attempt<M>.*.txt transcripts
 *
 * The tree is reached through the port, never through a file-system module.
 */
export class GateStore {
  readonly featureDir: string;
  readonly gatesDir: string;
  readonly attemptsDir: string;
  readonly verdictsDir: string;
  private readonly tree: GateTree;

  constructor(featureDir: string, tree: GateTree) {
    this.featureDir = featureDir;
    this.tree = tree;
    this.gatesDir = tree.join(featureDir, "gates");
    this.attemptsDir = tree.join(featureDir, "attempts");
    this.verdictsDir = tree.join(featureDir, "verdicts");
  }

  /** Create the gate/attempt/verdict tree (idempotent). */
  ensureLayout(): void {
    this.tree.makeDirectory(this.tree.join(this.gatesDir, "proofs"));
    this.tree.makeDirectory(this.attemptsDir);
    this.tree.makeDirectory(this.verdictsDir);
  }

  evidencePath(n: number): string {
    return this.tree.join(this.gatesDir, evidenceName(n));
  }

  approvedPath(n: number): string {
    return this.tree.join(this.gatesDir, approvedName(n));
  }

  feedbackPath(n: number): string {
    return this.tree.join(this.gatesDir, feedbackName(n));
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  1. Atomic evidence write (F101-FR-028, F100-FR-036). tmp → fsync → rename.
  // ───────────────────────────────────────────────────────────────────────────
  /**
   * Write `GATE<N>-EVIDENCE.md` atomically: the content goes to a temporary
   * name in the SAME directory, is fsynced, and is renamed onto the final path.
   * The gate — a bare existence check — therefore never sees a partial file.
   * The three steps are the kernel's (`atomicWriteSteps`).
   */
  writeEvidenceAtomic(n: number, content: string): string {
    this.tree.makeDirectory(this.gatesDir);
    const finalPath = this.evidencePath(n);
    this.tree.write(finalPath, content);
    return finalPath;
  }

  /** The bare file-existence gate the proposer loop keys on (`test -f`). */
  hasEvidence(n: number): boolean {
    return this.tree.exists(this.evidencePath(n));
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Critic markers — APPROVED is an existence marker; FEEDBACK carries the
  //  rejection reasons. Only the runtime writes them.
  // ───────────────────────────────────────────────────────────────────────────
  /** Write the empty `GATE<N>-APPROVED` existence marker. */
  writeApproved(n: number): string {
    this.tree.makeDirectory(this.gatesDir);
    const p = this.approvedPath(n);
    this.tree.write(p, "");
    return p;
  }

  isApproved(n: number): boolean {
    return this.tree.exists(this.approvedPath(n));
  }

  /** Write `GATE<N>-FEEDBACK.md` (the critic's rejection reasons for the attempt). */
  writeFeedback(n: number, reasons: string): string {
    this.tree.makeDirectory(this.gatesDir);
    const p = this.feedbackPath(n);
    this.tree.write(p, reasons);
    return p;
  }

  hasFeedback(n: number): boolean {
    return this.tree.exists(this.feedbackPath(n));
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  2. first-unapproved resume derivation (F101-FR-002).
  // ───────────────────────────────────────────────────────────────────────────
  /**
   * The resume phase: the FIRST phase number (in the given order) lacking a
   * `GATE<N>-APPROVED` marker. The position is derived from disk, never from a
   * stored counter — a crash mid-run resumes exactly where it stopped. Returns
   * `undefined` when every phase is already approved (nothing to do).
   */
  firstUnapproved(phaseNumbers: readonly number[]): number | undefined {
    for (const n of phaseNumbers) {
      if (!this.isApproved(n)) return n;
    }
    return undefined;
  }

  /** True iff every phase in the list has an APPROVED marker. */
  allApproved(phaseNumbers: readonly number[]): boolean {
    return this.firstUnapproved(phaseNumbers) === undefined;
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  3. Stale-evidence archive (the REJECT path) — MOVE evidence, COPY feedback
  //     and verdict (F101-FR-027).
  // ───────────────────────────────────────────────────────────────────────────
  /**
   * Archive a rejected attempt: MOVE `GATE<N>-EVIDENCE.md` into
   * `attempts/phase<N>/attempt<M>/` (so the gate is genuinely reset — the next
   * proposer pass must do real work), COPY the feedback (kept in `gates/` for
   * the retry prompt), and COPY the newest matching verdict transcript to
   * `verdict.txt`. Returns the attempt directory. Idempotent per (n, attempt).
   */
  archiveAttempt(n: number, attempt: number): string {
    const dir = this.tree.join(this.attemptsDir, `phase${n}`, `attempt${attempt}`);
    this.tree.makeDirectory(dir);

    const evidence = this.evidencePath(n);
    if (this.tree.exists(evidence)) {
      this.tree.move(evidence, this.tree.join(dir, evidenceName(n))); // MOVE — resets the gate
    }
    const feedback = this.feedbackPath(n);
    if (this.tree.exists(feedback)) {
      this.tree.copy(feedback, this.tree.join(dir, feedbackName(n))); // COPY — retry keeps it
    }
    const verdict = this.newestVerdict(n, attempt);
    if (verdict) {
      this.tree.copy(verdict, this.tree.join(dir, "verdict.txt")); // COPY newest transcript
    }
    return dir;
  }

  /**
   * On APPROVE: move any leftover `GATE<N>-FEEDBACK.md` into
   * `attempts/phase<N>/approved/` so stale feedback can never bleed into a
   * later phase. Returns the moved-to path, or `undefined` when there was no
   * leftover feedback.
   */
  archiveApprovedFeedback(n: number): string | undefined {
    const feedback = this.feedbackPath(n);
    if (!this.tree.exists(feedback)) return undefined;
    const dir = this.tree.join(this.attemptsDir, `phase${n}`, "approved");
    this.tree.makeDirectory(dir);
    const dest = this.tree.join(dir, feedbackName(n));
    this.tree.move(feedback, dest);
    return dest;
  }

  /**
   * The newest verdict transcript for (phase, attempt): the file matching
   * `phase<N>.attempt<M>.*.txt` with the latest modification time (baseline
   * `ls -t … | head -1`).
   */
  newestVerdict(n: number, attempt: number): string | undefined {
    const prefix = `phase${n}.attempt${attempt}.`;
    let newest: { path: string; mtimeMs: number } | undefined;
    let entries: readonly string[];
    try {
      entries = this.tree.list(this.verdictsDir);
    } catch {
      return undefined;
    }
    for (const name of entries) {
      if (!name.startsWith(prefix) || !name.endsWith(".txt")) continue;
      const path = this.tree.join(this.verdictsDir, name);
      const mtimeMs = this.tree.modifiedAtMs(path);
      if (!newest || mtimeMs > newest.mtimeMs) newest = { path, mtimeMs };
    }
    return newest?.path;
  }

  /** Persist a critic verdict transcript for (phase, attempt) under a tag. */
  writeVerdictTranscript(n: number, attempt: number, tag: string, body: string): string {
    this.tree.makeDirectory(this.verdictsDir);
    const p = this.tree.join(this.verdictsDir, `phase${n}.attempt${attempt}.${tag}.txt`);
    this.tree.write(p, body);
    return p;
  }
}

/* ==================================================================== *
 * T043 — the approval record of feature 100 annex B §B.14
 * (`specstride.approval/1`), which REPLACES the empty approval marker of
 * both as-is systems (F101-FR-029). The class above keeps the marker
 * functions because the characterization tests of phase 2 pin them and
 * because the compatibility projection still reads a marker written by an
 * as-is system; the ENGINE writes no marker.
 * ==================================================================== */

/** The schema id of the approval record (annex B §B.14). */
export const APPROVAL_SCHEMA_ID = "specstride.approval/1" as const;

/** The logical name of the approval record (annex B §B.5). */
export const APPROVAL_LOGICAL_NAME = "gate:<N>:approved" as const;

/** The path of the approval record under the control root (`layout.json`). */
export function approvalRecordPath(slug: string, phase: number): string {
  return `features/${slug}/approvals/phase-${phase}.json`;
}

/** F101-FR-029 — the engine writes no approval marker of its own. */
export const THE_ENGINE_WRITES_A_MARKER = false as const;

/** F101-FR-029 — only the engine writes an approval record. */
export const ONLY_THE_ENGINE_WRITES_AN_APPROVAL_RECORD = true as const;

/** F101-FR-029 — the record is kept in the control plane. */
export const APPROVAL_RECORD_ROOT = "control" as const;

/**
 * F101-FR-029 — the fields of the approval record, in the order of annex B
 * §B.14. `sig` is the signature OVER EVERY FIELD ABOVE IT, so it is last and
 * is never part of what is signed.
 */
export const FIELDS_OF_THE_APPROVAL_RECORD = Object.freeze([
  "schema",
  "feature",
  "phase",
  "runId",
  "engineStartId",
  "attemptId",
  "verdictId",
  "nonceHash",
  "critic",
  "evidenceHash",
  "verification",
  "treeFingerprint",
  "approvedAt",
  "keyId",
  "sig",
]);

/** The one field the signature does not cover: itself. */
export const FIELD_THE_SIGNATURE_DOES_NOT_COVER = "sig" as const;

/** The critic of an approval record: who judged, and how the form was proved. */
export type ApprovalCritic = {
  readonly harness: string;
  readonly provider: string;
  readonly model: string | null;
  /** The form of the `completion` level (annex C §C.3). */
  readonly form: string;
  /** The result of the proof of the form, as the call record carries it. */
  readonly proof: string;
};

/** The verification half of an approval record: the mode and the result hash. */
export type ApprovalVerification = {
  readonly mode: string;
  readonly hash: string;
};

/** The approval record itself, with every field of §B.14. */
export type ApprovalRecordOfThePhase = {
  readonly schema: typeof APPROVAL_SCHEMA_ID;
  readonly feature: string;
  readonly phase: number;
  readonly runId: string;
  readonly engineStartId: string;
  readonly attemptId: string;
  readonly verdictId: string;
  readonly nonceHash: string;
  readonly critic: ApprovalCritic;
  readonly evidenceHash: string;
  readonly verification: ApprovalVerification;
  readonly treeFingerprint: string;
  readonly approvedAt: string;
  readonly keyId: string;
  readonly sig: string;
};

/** Everything the engine knows when it writes an approval record. */
export type ApprovalRecordInputs = Omit<ApprovalRecordOfThePhase, "schema" | "keyId" | "sig">;

/** The canonical record hash of feature 100 (annex X §X.5), as a function. */
export type CanonicalRecordHash = (record: unknown) => string;

/** The record without the signature: what the signature is computed over. */
export function unsignedApprovalRecord(
  inputs: ApprovalRecordInputs,
  keyId: string,
): Omit<ApprovalRecordOfThePhase, "sig"> {
  return Object.freeze({
    schema: APPROVAL_SCHEMA_ID,
    feature: inputs.feature,
    phase: inputs.phase,
    runId: inputs.runId,
    engineStartId: inputs.engineStartId,
    attemptId: inputs.attemptId,
    verdictId: inputs.verdictId,
    nonceHash: inputs.nonceHash,
    critic: inputs.critic,
    evidenceHash: inputs.evidenceHash,
    verification: inputs.verification,
    treeFingerprint: inputs.treeFingerprint,
    approvedAt: inputs.approvedAt,
    keyId,
  });
}

/**
 * F101-FR-029 — build the approval record and sign it with the approval key of
 * the feature. The signature is HMAC-SHA-256 over the CANONICAL RECORD HASH of
 * every field but `sig`, so two readings of the same record cannot differ by
 * field order or by spacing.
 */
export function signApprovalRecord(
  inputs: ApprovalRecordInputs,
  key: ApprovalKeyRecord,
  canonicalRecordHash: CanonicalRecordHash,
): ApprovalRecordOfThePhase {
  const unsigned = unsignedApprovalRecord(inputs, key.keyId);
  const sig = signWithTheApprovalKey(key, canonicalRecordHash(unsigned));
  return Object.freeze({ ...unsigned, sig });
}

/** What the writer of an approval record hands back. */
export type ApprovalRecordWritten = {
  readonly record: ApprovalRecordOfThePhase;
  readonly path: string;
  /** Whether the approval key of the feature was made for this record. */
  readonly keyWasCreated: boolean;
};

/**
 * F101-FR-029 and F101-FR-030 — write the approval record of a phase. The key
 * of the feature is made here where none exists, which is exactly "when the
 * first approval record of a feature is written".
 *
 * `write` is the atomic write of the phase gate (`../gate/writers.ts`), so no
 * reader ever sees a part of the record (F101-FR-028).
 */
export function writeApprovalRecord(
  inputs: ApprovalRecordInputs,
  deps: {
    readonly keys: ApprovalKeyStore;
    readonly canonicalRecordHash: CanonicalRecordHash;
    readonly write: (path: string, record: ApprovalRecordOfThePhase) => void;
    readonly now: string;
  },
): ApprovalRecordWritten {
  const { key, created } = approvalKeyOf(deps.keys, inputs.feature, deps.now);
  const record = signApprovalRecord(inputs, key, deps.canonicalRecordHash);
  const path = approvalRecordPath(inputs.feature, inputs.phase);
  deps.write(path, record);
  return Object.freeze({ record, path, keyWasCreated: created });
}
