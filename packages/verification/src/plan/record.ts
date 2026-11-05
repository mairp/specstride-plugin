/**
 * T087 — the RECORD of the verification plan of the Specstride baseline
 * (F105-FR-011), and the error every refusal of this feature raises.
 *
 * Lisa's shapes are in `./lisa-plan.ts`, extracted and pinned; they are a
 * SUBSET of this record. The Specstride baseline adds to a command its
 * provenance (`source`, `declaredId`, `phase`), its environment, its staging
 * fields, and to the plan `declaredCommands` and `source.projection`. The
 * fields below are the baseline's names, and the optional markers are the
 * baseline's: a field the baseline omits when it holds its default is optional
 * here, so a port that set it to its default would write another plan hash and
 * fail its parity test.
 */
import { CONFIGURATION_ERROR_CODE } from "../mode/closed-sets.ts";
import type { ReusePolicy } from "../mode/closed-sets.ts";
import type { SourceBinding, DeclaredCommandsBinding } from "./projection.ts";
import type {
  VerificationAutomationStatus,
  VerificationKind,
  VerificationLevel,
} from "./lisa-plan.ts";

/**
 * The error of this feature. Every refusal of F105-FR-013 — and of the
 * derivation, the writes and the sources — is a verification error, and the
 * result code of a verification error is 3 (F105-FR-013; the closed set of
 * row 52 of annex X §X.6).
 */
export class VerificationError extends Error {
  /** The result code a verification error ends with: 3. */
  readonly code = CONFIGURATION_ERROR_CODE;
  constructor(message: string) {
    super(message);
    this.name = "VerificationError";
  }
}

/** The kind every plan carries (F105-FR-011). */
export const PLAN_KIND = "verification-plan" as const;
/** The version every plan carries (F105-FR-011). */
export const PLAN_VERSION = 1 as const;

/** The stage of a command; `pre` is STORED as `prestage` (F105-FR-016). */
export const STAGES = ["gate", "prestage", "both"] as const;
export type Stage = (typeof STAGES)[number];

/**
 * The reuse policies of a staged command (F105-FR-016). They are the closed
 * set of row 229 of annex X §X.6, registered in `../mode/closed-sets.ts`, and
 * are READ from there — a second list would be a second place to edit.
 */
export type { ReusePolicy } from "../mode/closed-sets.ts";

/** One command of the plan (F105-FR-015, F105-FR-016). */
export type PlanCommand = {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutSec: number;
  /** Where the command came from: `declared`, or absent for a discovered one. */
  readonly source?: string;
  readonly declaredId?: string;
  readonly phase?: number;
  readonly env?: Readonly<Record<string, string>>;
  /** Omitted when it is `gate` (`lib/verification_plan.py`:329). */
  readonly stage?: Stage;
  readonly reportPath?: string;
  /** Omitted when it is `per-attempt`. */
  readonly reusePolicy?: ReusePolicy;
  /** Omitted when it is false. */
  readonly detached?: boolean;
  /** Omitted when it is true. */
  readonly cumulative?: boolean;
  /** The declarations the check manifest carries (CQ-216); no as-is equivalent. */
  readonly steps?: readonly { readonly argv: readonly string[]; readonly required: boolean }[];
  readonly resource?: string;
  /** File and line of the declaration (F105-FR-015). */
  readonly provenance?: { readonly file: string; readonly line: number };
};

/** One verification obligation of the plan (F105-FR-014). */
export type PlanObligation = {
  readonly id: string;
  readonly title: string;
  readonly phase?: number;
  readonly requirementRefs: readonly string[];
  readonly acceptanceRefs: readonly string[];
  readonly workItemRefs: readonly string[];
  readonly level: VerificationLevel;
  readonly kind: VerificationKind;
  readonly setup: readonly string[];
  readonly action: string;
  readonly oracle: readonly string[];
  readonly witnesses: readonly string[];
  readonly negativeCases: readonly string[];
  readonly automationStatus: VerificationAutomationStatus;
};

/** One suite of the plan (F105-FR-018). */
export type PlanSuite = {
  readonly id: string;
  readonly name: string;
  readonly scope: "phase" | "release";
  readonly phase?: number;
  readonly obligationRefs: readonly string[];
  readonly commandRefs: readonly string[];
};

/** One verification gate of the plan (F105-FR-018). */
export type PlanGate = {
  readonly id: string;
  readonly scope: "phase" | "release";
  readonly phase?: number;
  readonly obligationRefs: readonly string[];
  readonly suiteRefs: readonly string[];
  readonly cumulative: boolean;
  readonly required: boolean;
  /** Omitted when no command opted out of being cumulative. */
  readonly excludedCommandRefs?: readonly string[];
};

/** `project` of the plan (F105-FR-011). */
export type PlanProject = {
  readonly workdir: string;
  readonly fingerprint: string;
  readonly frameworks: readonly string[];
};

/** The verification plan (F105-FR-011). */
export type VerificationPlan = {
  readonly id: string;
  readonly kind: typeof PLAN_KIND;
  readonly version: typeof PLAN_VERSION;
  readonly source: SourceBinding;
  readonly project: PlanProject;
  readonly obligations: readonly PlanObligation[];
  readonly commands: readonly PlanCommand[];
  readonly suites: readonly PlanSuite[];
  readonly gates: readonly PlanGate[];
  readonly assumptions: readonly string[];
  readonly ambiguities: readonly string[];
  readonly unsupportedCapabilities: readonly string[];
  /** Present only where a verification-commands document was given. */
  readonly declaredCommands?: DeclaredCommandsBinding;
  readonly contentHash: string;
};

/** The fields of F105-FR-011, in the order the requirement names them. */
export const PLAN_FIELDS = [
  "id",
  "kind",
  "version",
  "source",
  "project",
  "obligations",
  "commands",
  "suites",
  "gates",
  "assumptions",
  "ambiguities",
  "unsupportedCapabilities",
  "declaredCommands",
  "contentHash",
] as const;

/**
 * `sourceRevision` (F105-FR-011): the revision the verification gate ran
 * against, or `available: false` with a reason where there is no repository.
 */
export type SourceRevision =
  | {
      readonly available: true;
      readonly revision: string;
      readonly workingTreeDirty: boolean | null;
      readonly capturedAt: number;
    }
  | { readonly available: false; readonly reason: string };

/** The fields of `sourceRevision` the requirement names. */
export const SOURCE_REVISION_FIELDS = [
  "available",
  "revision",
  "workingTreeDirty",
  "capturedAt",
] as const;

/** The stage a staged command may carry (F105-FR-034). */
export const PRESTAGE_STAGES = ["prestage", "both"] as const;

/** The default of `stage`, which the plan omits (F105-FR-016). */
export const DEFAULT_STAGE: Stage = "gate";
/** The default of `reusePolicy`, which the plan omits (F105-FR-016). */
export const DEFAULT_REUSE_POLICY: ReusePolicy = "per-attempt";
/** The default of `kind` of a declared command (F105-FR-016). */
export const DEFAULT_DECLARED_KIND = "verify" as const;

/** The staging record the baseline compares against its defaults (:329). */
export const DEFAULT_STAGING = Object.freeze({
  stage: DEFAULT_STAGE,
  reportPath: null,
  reusePolicy: DEFAULT_REUSE_POLICY,
  detached: false,
  cumulative: true,
});
