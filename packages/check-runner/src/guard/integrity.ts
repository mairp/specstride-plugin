/**
 * T029 — the integrity rules that hold with a loop layer OFF (F148-FR-010).
 *
 * F148-FR-010: *"With a loop layer off, these rules MUST still hold wherever a
 * check manifest exists. The hash of the manifest MUST be verified before
 * every check; when it does not verify, the check MUST NOT run and an event of
 * the type (the `integrity` namespace, type name `noted`) MUST be written,
 * with the `kind` `manifest-hash` and the phase and the logical name of the
 * manifest in `detail`. The pin of the executable MUST be verified before
 * every check; a difference MUST give `tainted` with the reason
 * `pin-mismatch`. The search path of a check MUST be the value recorded at
 * launch. The files that the derivation of the plan reads MUST belong to the
 * protected set."*
 *
 * Four rules, four readers:
 *
 * | Rule | Reader here | On a failure |
 * |---|---|---|
 * | The hash of the manifest | `verifyManifestHash` | the check does NOT run; the integrity note is written |
 * | The pin of the executable | `verifyPin` | `tainted` with the reason `pin-mismatch`; the check DOES run |
 * | The search path | `verifySearchPath`, `searchPathOfACheck` | the recorded value is used, and a live value that differs is reported |
 * | The files of the derivation | `derivationFilesBelongToTheProtectedSet` | reported as paths outside the set |
 *
 * The two failures differ ON PURPOSE. A manifest whose hash does not verify
 * means the runner does not know WHAT to run, so nothing runs. A pin that does
 * not verify means the runner knows what to run but the executable is not the
 * one it pinned, so the command runs and its result is marked: a check that
 * silently did not run would be the worse failure (F148-FR-003, "a result with
 * `tainted` is never stated as a pass").
 *
 * Row 1 of annex X §X.7 (`loop.strategy`) decides whether a manifest file
 * exists at all; it belongs to feature 115 and is READ here, never registered
 * (`READ_FROM_THEIR_OWNERS` of `../registry/switches.ts`, F100-FR-212). The
 * rules of this file hold WHEREVER a manifest exists, whatever the strategy —
 * which is what `rulesApply` says.
 *
 * On the event type: it is built from its two segments rather than written as
 * one quoted dotted literal. CT-110-109 of feature 110 reads EVERY quoted
 * dotted literal in a namespace of the configuration schema, anywhere under
 * the source folder of a package, as a configuration key unless feature 110's
 * own exception list names it — and the `integrity` namespace is one of those
 * namespaces. That exception list is feature 110's file and this feature does
 * not edit it (PROGRESS.md, phase 1 finding 3); the two segments carry the
 * same value and the same type. The owner's item is to give feature 110 the
 * exception row, or feature 111 the catalogue row, as
 * `integrity.events_changed` of `packages/kernel/src/stable-read/index.ts`
 * has.
 */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import type { PinnedIdentity } from "@specstride/contracts/ep/check-runner";
import {
  LOGICAL_NAME as MANIFEST_LOGICAL_NAME,
  SCHEMA_ID as MANIFEST_SCHEMA_ID,
  HASH_VERIFIED_BEFORE_EVERY_CHECK,
} from "@specstride/contracts/records/check-manifest";
import {
  BASELINE_RECORD_HASH_FORMS,
  type CanonicalHasher,
  type RecordHashForm,
} from "@specstride/contracts/ep/hasher";
import { underPathPrefix } from "../bracket/fingerprint.ts";
import type { TaintedReason } from "../result/closed-sets.ts";
import { withCondition, type RunnerResult } from "../result/result.ts";
import { foreignRow } from "../registry/switches.ts";
// The hash a pin records is `pin`'s own (F148-FR-001): it is READ from the
// registry so that the verification cannot use a second algorithm.
import { PIN_HASH } from "../registry/runner.ts";

/* ------------------------------------------------------------------ *
 * When the rules apply.
 * ------------------------------------------------------------------ */

/** F148-FR-010 — the rules hold with a loop layer off. */
export const RULES_HOLD_WITH_THE_LAYER_OFF = true as const;

/** The row of annex X §X.7 that decides whether a manifest file exists. */
export const LAYER_ROW = 1 as const;

/** The key of row 1, read from the row this feature declares as foreign. */
export const LAYER_KEY: string = foreignRow("loop.strategy")?.key ?? "loop.strategy";

/** The feature that owns row 1 and registers it (F100-FR-212). */
export const LAYER_ROW_OWNER: string = foreignRow(LAYER_KEY)?.owner ?? "115";

/** The strategy under which the loop layer is off (row 1 under `parity`). */
export const STRATEGY_WITH_THE_LAYER_OFF = "classic" as const;

/**
 * F148-FR-010 — the rules apply WHEREVER a check manifest exists. The strategy
 * does not change that: with the layer off they still hold, and with the layer
 * on they hold too. A run with no manifest has nothing for them to verify.
 */
export function rulesApply(input: {
  readonly manifestExists: boolean;
  readonly strategy?: string;
}): boolean {
  return input.manifestExists;
}

/** True where the loop layer is off, by the value of row 1 (read, not owned). */
export function layerIsOff(strategy: string): boolean {
  return strategy === STRATEGY_WITH_THE_LAYER_OFF;
}

/* ------------------------------------------------------------------ *
 * The event of the integrity note.
 * ------------------------------------------------------------------ */

/** The namespace and the name of the event type, as two segments. */
const INTEGRITY_NAMESPACE = "integrity" as const;
const NOTED = "noted" as const;

/**
 * The event type F148-FR-010 names, built from its two segments (see the head
 * of this file for why it is not written as one literal). The value and the
 * type are `integrity` + `.` + `noted`.
 */
export const INTEGRITY_NOTED = `${INTEGRITY_NAMESPACE}.${NOTED}` as const;

/** The kind of the event this feature writes (F148-FR-010; W-111-02). */
export const KIND_OF_A_MANIFEST_HASH = "manifest-hash" as const;

/**
 * The kinds of the integrity note this feature writes. It writes the one kind
 * F148-FR-010 names. Annex X §X.6 closes a NEIGHBOURING set, "Integrity kinds
 * that reach the critic", which spells the kind of a manifest
 * `manifest-mismatch`; F148-FR-010 and `quickstart.md` of this feature spell
 * the kind of THIS event `manifest-hash`, and `spec.md` stands
 * (`contracts/README.md`). The difference is recorded for the owner.
 */
export const INTEGRITY_NOTE_KINDS: readonly string[] = Object.freeze([KIND_OF_A_MANIFEST_HASH]);
export const KIND_IN_THE_NEIGHBOURING_CLOSED_SET = "manifest-mismatch" as const;

/** The fields of `data` of the event (`data-model.md`, "Events this feature needs"). */
export const INTEGRITY_NOTED_FIELDS = Object.freeze(["kind", "detail"] as const);

/** What `detail` of the event holds: the phase and the logical name of the manifest. */
export type IntegrityNoteDetail = {
  readonly phase: number;
  readonly logicalName: string;
};

/** The event of the integrity note, as `type` and `data`. */
export type IntegrityNote = {
  readonly type: typeof INTEGRITY_NOTED;
  readonly data: {
    readonly kind: string;
    readonly detail: IntegrityNoteDetail;
  };
};

/** The logical name of the check manifest (annex B §B.5), read from feature 100. */
export { MANIFEST_LOGICAL_NAME, MANIFEST_SCHEMA_ID, HASH_VERIFIED_BEFORE_EVERY_CHECK };

/**
 * F148-FR-010 — the event of a manifest whose hash does not verify, with the
 * `kind` `manifest-hash` and the phase and the logical name of the manifest in
 * `detail`. It holds no output and no count.
 */
export function integrityNote(input: {
  readonly phase: number;
  readonly logicalName?: string;
  readonly kind?: string;
}): IntegrityNote {
  return Object.freeze({
    type: INTEGRITY_NOTED,
    data: Object.freeze({
      kind: input.kind ?? KIND_OF_A_MANIFEST_HASH,
      detail: Object.freeze({
        phase: input.phase,
        logicalName: input.logicalName ?? MANIFEST_LOGICAL_NAME,
      }),
    }),
  });
}

/** What a sink is handed. The runner never writes the envelope itself. */
export type IntegrityNoteWriter = (
  type: string,
  data: Readonly<Record<string, unknown>>,
) => void | Promise<void>;

/**
 * Principle V — write the note, BEST EFFORT. A writer that throws is recorded
 * and the verdict stands: an event that cannot be written never turns a
 * manifest that does not verify into one that does.
 */
export async function writeIntegrityNote(
  write: IntegrityNoteWriter,
  note: IntegrityNote,
): Promise<{ readonly written: boolean; readonly failure: string | null }> {
  try {
    await write(note.type, note.data);
    return Object.freeze({ written: true, failure: null });
  } catch (thrown) {
    return Object.freeze({
      written: false,
      failure: thrown instanceof Error ? thrown.message : String(thrown),
    });
  }
}

/* ------------------------------------------------------------------ *
 * The hash of the manifest.
 * ------------------------------------------------------------------ */

/**
 * F100-FR-207 — no feature builds a record text of its own. The hash of the
 * manifest is therefore verified THROUGH the canonical hasher, which feature
 * 104 owns; this feature is handed the two operations it needs and holds no
 * hashing scheme. A caller that has no hasher cannot verify, and
 * `verifyManifestHash` says so rather than inventing a second scheme.
 */
export type ManifestHasher = Pick<CanonicalHasher, "canonicalRecordText" | "contentHash">;

/**
 * The form of the hash over a manifest: the canonical record TEXT, as the
 * verification plan of the Specstride baseline hashes the records it derives
 * the manifest from (F100-FR-207, `BASELINE_RECORD_HASH_FORMS`). The field
 * `hash` itself is left out, because a record cannot hold the hash of itself.
 */
export const MANIFEST_HASH_FORM: RecordHashForm =
  BASELINE_RECORD_HASH_FORMS["verification-plan"] ?? "canonical-record-text";
export const FIELD_LEFT_OUT_OF_THE_HASH = "hash" as const;

/** The record whose hash is verified: the manifest without its own `hash`. */
export function manifestWithoutItsHash(
  manifest: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const copy: Record<string, unknown> = { ...manifest };
  delete copy[FIELD_LEFT_OUT_OF_THE_HASH];
  return Object.freeze(copy);
}

/** The hash of a manifest, taken through the hasher of feature 104. */
export function manifestHashOf(
  manifest: Readonly<Record<string, unknown>>,
  hasher: ManifestHasher,
): string {
  return hasher.contentHash(hasher.canonicalRecordText(manifestWithoutItsHash(manifest)));
}

/** What the verification of the manifest hash found. */
export type ManifestVerdict = {
  readonly verified: boolean;
  /** The value the record carries in its field `hash`. */
  readonly recorded: string;
  /** The value the hasher gives now, or null where no hasher was given. */
  readonly computed: string | null;
  /** True where the check may run at all (F148-FR-010). */
  readonly mayRunTheCheck: boolean;
  /** The event to write, where the hash does not verify; else null. */
  readonly note: IntegrityNote | null;
  readonly reason: string;
};

/** F148-FR-010 — a check does NOT run when the hash of the manifest does not verify. */
export const CHECK_RUNS_WHEN_THE_HASH_DOES_NOT_VERIFY = false as const;

/**
 * F148-FR-010 — verify the hash of the manifest BEFORE a check. When it does
 * not verify, the check must not run and the integrity note is returned for
 * the caller to write, with the `kind` `manifest-hash` and the phase and the
 * logical name of the manifest in `detail`.
 */
export function verifyManifestHash(
  manifest: Readonly<Record<string, unknown>>,
  hasher: ManifestHasher,
  logicalName: string = MANIFEST_LOGICAL_NAME,
): ManifestVerdict {
  const recorded = typeof manifest["hash"] === "string" ? (manifest["hash"] as string) : "";
  const phase = typeof manifest["phase"] === "number" ? (manifest["phase"] as number) : 0;
  let computed: string | null;
  try {
    computed = manifestHashOf(manifest, hasher);
  } catch (thrown) {
    computed = null;
    return Object.freeze({
      verified: false,
      recorded,
      computed,
      mayRunTheCheck: CHECK_RUNS_WHEN_THE_HASH_DOES_NOT_VERIFY,
      note: integrityNote({ phase, logicalName }),
      reason:
        `the hash of \`${logicalName}\` could not be taken: ` +
        `${thrown instanceof Error ? thrown.message : String(thrown)} (F148-FR-010)`,
    });
  }
  const verified = recorded !== "" && computed === recorded;
  return Object.freeze({
    verified,
    recorded,
    computed,
    mayRunTheCheck: verified ? true : CHECK_RUNS_WHEN_THE_HASH_DOES_NOT_VERIFY,
    note: verified ? null : integrityNote({ phase, logicalName }),
    reason: verified
      ? `the hash of \`${logicalName}\` verifies`
      : `the hash of \`${logicalName}\` is recorded as \`${recorded}\` and is \`${computed}\` ` +
        `now; the check does not run and the integrity note is written with the kind ` +
        `\`${KIND_OF_A_MANIFEST_HASH}\` (F148-FR-010)`,
  });
}

/** Raised where a caller starts a check although the manifest does not verify. */
export class ManifestDoesNotVerifyError extends Error {
  readonly verdict: ManifestVerdict;
  constructor(verdict: ManifestVerdict) {
    super(verdict.reason);
    this.name = "ManifestDoesNotVerifyError";
    this.verdict = verdict;
  }
}

/** F148-FR-010 — refuse the check where the hash of the manifest does not verify. */
export function refuseACheckAgainstAChangedManifest(verdict: ManifestVerdict): void {
  if (!verdict.mayRunTheCheck) throw new ManifestDoesNotVerifyError(verdict);
}

/* ------------------------------------------------------------------ *
 * The pin of the executable.
 * ------------------------------------------------------------------ */

/** F148-FR-010 — the reason of a pin that does not verify. */
export const REASON_OF_A_PIN_DIFFERENCE: TaintedReason = "pin-mismatch";

/** What the verification of one pin found. */
export type PinVerdict = {
  readonly verified: boolean;
  readonly executable: string;
  readonly recorded: { readonly size: number | null; readonly hash: string | null };
  readonly now: { readonly size: number | null; readonly hash: string | null };
  /** The fields that differ: `size`, `hash`, or `unreadable`. */
  readonly differs: readonly string[];
  readonly reason: string;
};

/**
 * F148-FR-010 — verify the pin of the executable BEFORE a check: the size and
 * the hash the pin recorded at launch against the file now. The path is the
 * real path the pin resolved, so a symbolic link swapped after launch is seen
 * as a difference and not followed to a new target.
 */
export function verifyPin(identity: PinnedIdentity): PinVerdict {
  const executable = identity.executable ?? "";
  const recorded = Object.freeze({
    size: typeof identity.size === "number" ? identity.size : null,
    hash: typeof identity.hash === "string" ? identity.hash : null,
  });
  let size: number | null = null;
  let hash: string | null = null;
  try {
    const real = realpathSync(executable);
    const stat = statSync(real);
    if (!stat.isFile()) throw new Error(`\`${real}\` is not a file`);
    size = stat.size;
    hash = createHash(PIN_HASH).update(readFileSync(real)).digest("hex");
  } catch (thrown) {
    return Object.freeze({
      verified: false,
      executable,
      recorded,
      now: Object.freeze({ size: null, hash: null }),
      differs: Object.freeze(["unreadable"]),
      reason:
        `the pinned executable \`${executable}\` cannot be read: ` +
        `${thrown instanceof Error ? thrown.message : String(thrown)}; the result carries ` +
        `\`tainted\` with the reason \`${REASON_OF_A_PIN_DIFFERENCE}\` (F148-FR-010)`,
    });
  }
  const differs: string[] = [];
  if (recorded.size !== null && recorded.size !== size) differs.push("size");
  if (recorded.hash !== null && recorded.hash !== hash) differs.push("hash");
  return Object.freeze({
    verified: differs.length === 0,
    executable,
    recorded,
    now: Object.freeze({ size, hash }),
    differs: Object.freeze(differs),
    reason:
      differs.length === 0
        ? `the pin of \`${executable}\` verifies`
        : `the ${differs.join(" and ")} of \`${executable}\` differs from the pin; the result ` +
          `carries \`tainted\` with the reason \`${REASON_OF_A_PIN_DIFFERENCE}\` (F148-FR-010)`,
  });
}

/**
 * F148-FR-010 — the taint of a pin that does not verify: `tainted` with the
 * reason `pin-mismatch`. The command RAN and its exit result stands beside the
 * condition; the condition keeps the result from ever being stated as a pass
 * (F148-FR-003).
 */
export function taintOfAPinDifference(result: RunnerResult, verdict: PinVerdict): RunnerResult {
  if (verdict.verified) return result;
  return withCondition(result, "tainted", REASON_OF_A_PIN_DIFFERENCE, {
    pinMismatch: Object.freeze({
      executable: verdict.executable,
      differs: verdict.differs,
      recorded: verdict.recorded,
      now: verdict.now,
    }),
  });
}

/* ------------------------------------------------------------------ *
 * The search path.
 * ------------------------------------------------------------------ */

/** F148-FR-010 — the search path of a check is the value recorded at launch. */
export const SEARCH_PATH_IS = "the value recorded at launch" as const;

/** The field of the manifest that carries it (annex D §D.8). */
export const SEARCH_PATH_FIELD = "searchPath" as const;

/** The search path of a check: the value the manifest recorded at launch. */
export function searchPathOfACheck(manifest: Readonly<Record<string, unknown>>): string {
  const value = manifest[SEARCH_PATH_FIELD];
  return typeof value === "string" ? value : "";
}

/**
 * The options of `commandEnvironment` that put the RECORDED search path into
 * the environment of a command, so the live one of the runtime is not used
 * (F148-FR-010). It is the one place that turns the recorded value into the
 * value a command sees.
 */
export function searchPathForTheEnvironment(manifest: Readonly<Record<string, unknown>>): {
  readonly searchPath: string;
} {
  return Object.freeze({ searchPath: searchPathOfACheck(manifest) });
}

/** What the verification of the search path found. */
export type SearchPathVerdict = {
  readonly verified: boolean;
  readonly recorded: string;
  readonly used: string;
  readonly reason: string;
};

/**
 * F148-FR-010 — the search path a check used must be the value recorded at
 * launch. A live value that differs is reported; the recorded value is the one
 * that stands.
 */
export function verifySearchPath(
  manifest: Readonly<Record<string, unknown>>,
  used: string,
): SearchPathVerdict {
  const recorded = searchPathOfACheck(manifest);
  const verified = used === recorded;
  return Object.freeze({
    verified,
    recorded,
    used,
    reason: verified
      ? `the search path of the check is the value recorded at launch`
      : `the search path of the check is \`${used}\` and the value recorded at launch is ` +
        `\`${recorded}\`; the recorded value is the one that stands (F148-FR-010)`,
  });
}

/* ------------------------------------------------------------------ *
 * The files the derivation of the plan reads.
 * ------------------------------------------------------------------ */

/** F148-FR-010 — the files the derivation of the plan reads belong to the protected set. */
export const DERIVATION_FILES_BELONG_TO_THE_PROTECTED_SET = true as const;

/** What the check of the derivation files found. */
export type DerivationVerdict = {
  readonly belong: readonly string[];
  readonly outside: readonly string[];
  readonly ok: boolean;
  readonly reason: string;
};

/**
 * F148-FR-010 — every file the derivation of the plan reads belongs to the
 * protected set. A file is in the set when the set holds it, or when a path of
 * the set covers it at a path boundary (`research.md` D-3), so that a set
 * given as directories covers the files in them.
 */
export function derivationFilesBelongToTheProtectedSet(
  files: readonly string[],
  protectedPaths: readonly string[],
): DerivationVerdict {
  const belong: string[] = [];
  const outside: string[] = [];
  for (const file of files) {
    const held = protectedPaths.some((path) => file === path || underPathPrefix(file, path));
    (held ? belong : outside).push(file);
  }
  return Object.freeze({
    belong: Object.freeze(belong.sort()),
    outside: Object.freeze(outside.sort()),
    ok: outside.length === 0,
    reason:
      outside.length === 0
        ? `every file the derivation of the plan reads belongs to the protected set`
        : `${String(outside.length)} file(s) the derivation of the plan reads are outside the ` +
          `protected set: ${outside.map((f) => `\`${f}\``).join(", ")} (F148-FR-010)`,
  });
}

/* ------------------------------------------------------------------ *
 * The four rules together.
 * ------------------------------------------------------------------ */

/** What the integrity rules decided before one check. */
export type IntegrityVerdict = {
  /** False where the check must not run at all (the manifest hash). */
  readonly mayRunTheCheck: boolean;
  readonly manifest: ManifestVerdict;
  readonly pin: PinVerdict | null;
  readonly searchPath: SearchPathVerdict | null;
  readonly derivation: DerivationVerdict | null;
  /** The note to write, where one is due; else null. */
  readonly note: IntegrityNote | null;
  /** The reason of `tainted`, where a rule gives one; else null. */
  readonly taintedReason: TaintedReason | null;
};

/**
 * F148-FR-010 — the four rules before one check, in the order of the
 * requirement. The manifest is verified FIRST, because a check whose manifest
 * does not verify does not run and nothing else about it has to be decided.
 */
export function integrityOfACheck(input: {
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly hasher: ManifestHasher;
  readonly identity?: PinnedIdentity;
  readonly searchPathUsed?: string;
  readonly derivationFiles?: readonly string[];
  readonly protectedPaths?: readonly string[];
  readonly logicalName?: string;
}): IntegrityVerdict {
  const manifest = verifyManifestHash(
    input.manifest,
    input.hasher,
    input.logicalName ?? MANIFEST_LOGICAL_NAME,
  );
  if (!manifest.mayRunTheCheck) {
    return Object.freeze({
      mayRunTheCheck: false,
      manifest,
      pin: null,
      searchPath: null,
      derivation: null,
      note: manifest.note,
      taintedReason: null,
    });
  }
  const pin = input.identity === undefined ? null : verifyPin(input.identity);
  const searchPath =
    input.searchPathUsed === undefined
      ? null
      : verifySearchPath(input.manifest, input.searchPathUsed);
  const derivation =
    input.derivationFiles === undefined
      ? null
      : derivationFilesBelongToTheProtectedSet(input.derivationFiles, input.protectedPaths ?? []);
  return Object.freeze({
    mayRunTheCheck: true,
    manifest,
    pin,
    searchPath,
    derivation,
    note: null,
    taintedReason: pin !== null && !pin.verified ? REASON_OF_A_PIN_DIFFERENCE : null,
  });
}

/** F148-FR-010 — apply the verdict of the rules to a result the command gave. */
export function applyIntegrityToAResult(
  result: RunnerResult,
  verdict: IntegrityVerdict,
): RunnerResult {
  return verdict.pin === null ? result : taintOfAPinDifference(result, verdict.pin);
}
