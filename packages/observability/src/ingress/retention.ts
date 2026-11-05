/**
 * T040 — the retention policy (F111-FR-028).
 *
 * F111-FR-028: *The retention policy MUST be kept as at the baseline: the version
 * string `specstride-retention/v1`; raw capture disabled by default; raw retention
 * 7 days; metadata retention 30 days; the tool result limit 4096 bytes. A metadata
 * retention shorter than the raw retention MUST be refused with `metadata
 * retention must not be shorter than raw retention`; a negative or non-integer
 * number of days MUST be refused with `<name> must be a non-negative integer`. The
 * metadata of the policy MUST be `policy_version`, `raw_capture_enabled`,
 * `raw_retention_days` and `metadata_retention_days`. The decision MUST be a pure
 * function: raw content is removed when its age in days is greater than the raw
 * retention, metadata when greater than the metadata retention, and the removal of
 * metadata MUST force the removal of raw content. Applying the decision to files
 * is not part of this feature. This policy governs raw content that is retained in
 * the control plane ... and is independent of `telemetry.content`
 * (F111-FR-032) ...: raw capture off does not switch content for telemetry off,
 * and the reverse.*
 *
 * THE DECISION IS A FUNCTION AND THE SWEEP IS SOMEONE ELSE'S. `retentionActions`
 * takes an age and a policy and returns two flags. It opens no directory, stats
 * no file and deletes nothing — research D-12: `apply_retention_sweep` lives with
 * invocation retention at the baseline, and it stays there. A decision that
 * cannot touch a file is a decision a test can exercise over sixty ages in a
 * loop, which is what makes "the removal of metadata forces the removal of raw
 * content" checkable as an invariant rather than as a sentence.
 *
 * METADATA OUTLIVES RAW CONTENT, BY CONSTRUCTION. The refusal of a metadata
 * retention shorter than the raw one and the force in the decision are the same
 * rule approached from two sides: the first makes the bad policy unbuildable, the
 * second makes the bad outcome unreachable even if a policy arrived from
 * elsewhere. The redacted audit trail of what happened must not disappear before
 * the raw content it describes.
 *
 * THIS IS NOT THE SWITCH OF CONTENT CAPTURE. `rawCaptureEnabled` governs raw
 * content kept in the CONTROL PLANE (row 45 of annex X §X.7).
 * `captureIsOn` of `../accessor/accessor.ts` governs what reaches a SINK
 * (F111-FR-032, row 16). The requirement says in so many words that neither
 * switches the other, so the two live in two modules and neither reads the other.
 */

/** The version string of the baseline (B-2219). */
export const RETENTION_POLICY_VERSION = "specstride-retention/v1" as const;

/** The defaults of the baseline (B-2220). */
export const RETENTION_DEFAULTS = Object.freeze({
  rawCaptureEnabled: false,
  rawRetentionDays: 7,
  metadataRetentionDays: 30,
  toolResultMaxBytes: 4096,
});

/** The three fields the baseline validates as non-negative integers. */
export const NON_NEGATIVE_FIELDS = [
  "raw_retention_days",
  "metadata_retention_days",
  "tool_result_max_bytes",
] as const;

/** The message of a negative or non-integer value (B-2221). */
export function nonNegativeMessage(name: string): string {
  return `${name} must be a non-negative integer`;
}

/** The message of a byte limit that is not positive (B-2221). */
export const POSITIVE_BYTES_MESSAGE = "tool_result_max_bytes must be a positive integer" as const;

/** The message of a metadata retention shorter than the raw one (B-2221). */
export const METADATA_SHORTER_MESSAGE =
  "metadata retention must not be shorter than raw retention" as const;

/** A refusal of the policy. The message is the baseline's, word for word. */
export class RetentionRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetentionRefused";
  }
}

/** The retention policy in force. */
export type RetentionPolicy = {
  readonly rawCaptureEnabled: boolean;
  readonly rawRetentionDays: number;
  readonly metadataRetentionDays: number;
  readonly toolResultMaxBytes: number;
  readonly policyVersion: string;
};

/** What `resolveRetentionPolicy` is given. */
export type RetentionOptions = {
  readonly rawCaptureEnabled?: unknown;
  readonly rawRetentionDays?: unknown;
  readonly metadataRetentionDays?: unknown;
  readonly toolResultMaxBytes?: unknown;
  readonly policyVersion?: unknown;
};

function nonNegativeInteger(value: unknown): boolean {
  return (
    typeof value === "number" &&
    typeof value !== "boolean" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

/**
 * The policy in force. The three numbers must be non-negative integers, the byte
 * limit must be positive, and the metadata retention must not be shorter than the
 * raw one — each refused with the baseline's own message, in the baseline's own
 * order (B-2221).
 */
export function resolveRetentionPolicy(options: RetentionOptions = {}): RetentionPolicy {
  // `undefined` means "not given" and takes the default; `null` is a VALUE and
  // is refused, as the baseline refuses `None`.
  const raw =
    options.rawRetentionDays === undefined
      ? RETENTION_DEFAULTS.rawRetentionDays
      : options.rawRetentionDays;
  const metadata =
    options.metadataRetentionDays === undefined
      ? RETENTION_DEFAULTS.metadataRetentionDays
      : options.metadataRetentionDays;
  const bytes =
    options.toolResultMaxBytes === undefined
      ? RETENTION_DEFAULTS.toolResultMaxBytes
      : options.toolResultMaxBytes;

  for (const [name, value] of [
    ["raw_retention_days", raw],
    ["metadata_retention_days", metadata],
    ["tool_result_max_bytes", bytes],
  ] as const) {
    if (!nonNegativeInteger(value)) throw new RetentionRefused(nonNegativeMessage(name));
  }
  if ((bytes as number) <= 0) throw new RetentionRefused(POSITIVE_BYTES_MESSAGE);
  if ((metadata as number) < (raw as number)) throw new RetentionRefused(METADATA_SHORTER_MESSAGE);

  return Object.freeze({
    rawCaptureEnabled: options.rawCaptureEnabled === true,
    rawRetentionDays: raw as number,
    metadataRetentionDays: metadata as number,
    toolResultMaxBytes: bytes as number,
    policyVersion:
      typeof options.policyVersion === "string" ? options.policyVersion : RETENTION_POLICY_VERSION,
  });
}

/** The metadata fields of the policy (B-2222), in the baseline's order. */
export const RETENTION_METADATA_FIELDS = [
  "policy_version",
  "raw_capture_enabled",
  "raw_retention_days",
  "metadata_retention_days",
] as const;

/** The metadata that travels with a retained artefact (B-2222). */
export type RetentionMetadata = {
  readonly policy_version: string;
  readonly raw_capture_enabled: boolean;
  readonly raw_retention_days: number;
  readonly metadata_retention_days: number;
};

/** The metadata of the policy: the four fields and no other. */
export function retentionMetadata(policy: RetentionPolicy): RetentionMetadata {
  return Object.freeze({
    policy_version: policy.policyVersion,
    raw_capture_enabled: policy.rawCaptureEnabled,
    raw_retention_days: policy.rawRetentionDays,
    metadata_retention_days: policy.metadataRetentionDays,
  });
}

/** What the decision says to remove (B-2223). */
export type RetentionActions = {
  readonly remove_raw: boolean;
  readonly remove_metadata: boolean;
};

/**
 * THE DECISION. Raw content goes when its age is greater than the raw retention,
 * metadata when greater than the metadata retention, and metadata going forces
 * raw content to go with it (B-2223). A pure function of the age and the policy:
 * it reads no clock, no file and no environment.
 */
export function retentionActions(
  policy: RetentionPolicy,
  options: { readonly ageDays: number },
): RetentionActions {
  const age = options.ageDays;
  let removeRaw = age > policy.rawRetentionDays;
  const removeMetadata = age > policy.metadataRetentionDays;
  if (removeMetadata) removeRaw = true;
  return Object.freeze({ remove_raw: removeRaw, remove_metadata: removeMetadata });
}

/** F111-FR-028 — applying the decision to files belongs to invocation retention. */
export const APPLYING_THE_DECISION_IS_NOT_PART_OF_THIS_FEATURE = true as const;

/** Where the sweep lives (research D-12). */
export const THE_SWEEP_BELONGS_TO = "invocation retention" as const;

/** F111-FR-028 — this policy and the switch of content capture are independent. */
export const INDEPENDENT_OF_TELEMETRY_CONTENT = true as const;
