/**
 * T025 — the state resolver (F146-FR-017, F146-FR-018, F146-FR-019).
 *
 * The four states of a harness (row 34 of annex X §X.6):
 *
 *   (found by a source)  ─────────────────►  detected
 *   detected  ── the consumer writes or confirms the descriptor ──►  declared
 *   declared | detected  ── a passed result of harness verification,
 *                           same version and hash ──►  locally-verified
 *   locally-verified  ── version or descriptor hash changes ──►
 *                           declared or detected (as before)
 *   (shipped tested harness adapter)  ──►  tested
 *                           (no transition leads into or out of it)
 *
 * The resolver is pure: it reads the stored result of `harness verify`
 * (`specstride.harness-verify/1` at `user:harness-verify:<id>`) only through
 * the value handed in, so a test replaces it. A result that names another
 * version or another hash is not used, and the resolver returns a doctor
 * finding that says so (F146-FR-018). Verification is opt-in: the resolver
 * never runs it (F146-FR-018).
 */
import type { CandidateFinding, StateOfAHarness } from "./types.ts";

/** The state a harness that no source declared has before promotion. */
export type BaseState = "declared" | "detected";

/**
 * What discovery finds of one harness now: the base state its sources give
 * (`declared` only where the consumer wrote the descriptor at
 * `user:harness:<id>` or confirmed the entry, F146-FR-017), the version the
 * probe read, the hash of the descriptor, and the raw record stored at
 * `user:harness-verify:<id>`, if any.
 */
export type StateResolverInput = {
  readonly id: string;
  readonly baseState: BaseState;
  /** The version the probe read now, or null. */
  readonly version: string | null;
  /** The canonical hash of the harness descriptor now, or null. */
  readonly descriptorHash: string | null;
  /** The ids of the tested harness adapters that ship with the product. */
  readonly shippedAdapterIds: readonly string[];
  /** The raw stored result at `user:harness-verify:<id>`, or null where none. */
  readonly verification: unknown;
};

/** What the resolver decides: one of the four states, plus doctor findings. */
export type StateResolution = {
  readonly state: StateOfAHarness;
  readonly findings: readonly CandidateFinding[];
};

/** The schema constant of the stored result (owner: annex B §B.20). */
export const VERIFICATION_SCHEMA_CONSTANT = "specstride.harness-verify/1" as const;

/**
 * F146-FR-017 — a value outside the four members reads as `detected`, the
 * state of a harness that a source found and nothing else confirmed (the
 * branch of T004, `stateOfAHarnessUnknown`).
 */
export function stateOfUnknownValue(value: unknown): StateOfAHarness {
  if (value === "tested" || value === "locally-verified" || value === "declared") {
    return value;
  }
  return "detected";
}

/**
 * Read the outcome of a stored result. An unknown value is read as `failed`
 * (the schema of `contracts/schemas/harness-verify-result.schema.json`,
 * annex X §X.6 row 131).
 */
export function outcomeOfStoredResult(raw: unknown): "passed" | "failed" {
  if (raw === "passed") return "passed";
  return "failed";
}

/**
 * Whether the stored value is a result of harness verification at all: it
 * must carry the schema constant. A value without it is not a result and
 * never promotes.
 */
export function isStoredVerification(raw: unknown): raw is Record<string, unknown> {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as Record<string, unknown>).schema === VERIFICATION_SCHEMA_CONSTANT
  );
}

/**
 * Resolve the state of one harness.
 *
 * - `tested` comes only from a shipped tested harness adapter
 *   (F146-FR-019): no base state, no stored result and no configuration
 *   can set it.
 * - `locally-verified` comes only from a stored result that is present,
 *   carries the schema constant, `passed`, and names the version and the
 *   descriptor hash discovery finds now (F146-FR-018). Anything else
 *   leaves the base state and yields a doctor finding.
 * - every other harness keeps its base state: `declared` where the
 *   consumer wrote or confirmed the descriptor, `detected` otherwise.
 */
export function resolveHarnessState(input: StateResolverInput): StateResolution {
  const findings: CandidateFinding[] = [];

  // F146-FR-019: the shipped tested adapters are the only road into `tested`.
  if (input.shippedAdapterIds.includes(input.id)) {
    return { state: "tested", findings };
  }

  // F146-FR-018: promotion, or a stored result that stops counting.
  if (isStoredVerification(input.verification)) {
    const stored = input.verification;
    const outcome = outcomeOfStoredResult(stored.outcome);
    const storedVersion = typeof stored.version === "string" ? stored.version : null;
    const storedHash = typeof stored.descriptorHash === "string" ? stored.descriptorHash : null;
    if (
      outcome === "passed" &&
      storedVersion === input.version &&
      storedHash === input.descriptorHash
    ) {
      return { state: "locally-verified", findings };
    }
    // The result is not used; the doctor says so (F146-FR-018).
    findings.push({
      code: "harness-verify-result-unused",
      message:
        `the stored result of harness verification for "${input.id}" is not used: ` +
        `${describeWhyUnused(outcome, storedVersion, storedHash, input)}; ` +
        `state stays "${input.baseState}"`,
    });
  }

  // F146-FR-017: the base state, with `detected` for every other harness.
  return { state: input.baseState, findings };
}

/** One line on why a stored result stopped counting (F146-FR-018). */
function describeWhyUnused(
  outcome: "passed" | "failed",
  storedVersion: string | null,
  storedHash: string | null,
  input: StateResolverInput,
): string {
  if (outcome !== "passed") return "its outcome is not `passed`";
  if (storedVersion !== input.version) {
    return `it names version ${JSON.stringify(storedVersion)} but discovery finds ${JSON.stringify(input.version)}`;
  }
  return "it names another descriptor hash than discovery finds now";
}
