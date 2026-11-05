/**
 * T006 — the identity of an invocation, the path-safe components and the id
 * generator (F126-FR-026).
 *
 * Every invocation of a harness (proposer, accelerator, critic) has an
 * identity: run id, feature, role, harness label, phase, attempt, iteration
 * and invocation id. The harness label is carried only as a value
 * (F126-FR-039): nothing here branches on it.
 */
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { randomBytes } from "node:crypto";

/** The roles a pass may carry (F126-FR-012, F126-FR-026). */
export const ROLES = ["proposer", "accelerator", "critic"] as const;
export type Role = (typeof ROLES)[number];

/** The eight fields of an invocation identity. */
export type InvocationIdentity = {
  readonly runId: string;
  readonly feature: string;
  readonly role: Role;
  /** The harness label, as a value only (F126-FR-039). */
  readonly harness: string;
  readonly phase: string;
  readonly attempt: number;
  readonly iteration: number;
  readonly invocationId: string;
};

/** The fields a caller gives; the invocation id may be generated. */
export type IdentityInput = Omit<InvocationIdentity, "invocationId" | "role"> & {
  /** Checked under the `parity` profile (F126-FR-012). */
  readonly role: string;
  readonly invocationId?: string | undefined;
  /** `parity` turns the role check of F126-FR-012 on. */
  readonly profile?: "parity" | string | undefined;
};

/** The refusal of a component that is not path-safe (F126-FR-026). */
export class IdentityComponentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityComponentError";
  }
}

/**
 * One path component: every run of characters outside `A-Za-z0-9_.-` is
 * replaced by `-`, leading and trailing `.` and `-` are removed, and the
 * result is cut to 128 characters. An empty result refuses with
 * `identity component is not path-safe` (F126-FR-026).
 */
export function pathSafeComponent(raw: string): string {
  const replaced = raw.replace(/[^A-Za-z0-9_.-]+/g, "-");
  const trimmed = replaced.replace(/^[.-]+/, "").replace(/[.-]+$/, "");
  const cut = trimmed.slice(0, 128);
  if (cut.length === 0) {
    throw new IdentityComponentError("identity component is not path-safe");
  }
  return cut;
}

/**
 * A missing invocation id is generated as
 * `inv-<iteration, 6 digits>-<8 hexadecimal characters>` (F126-FR-026).
 */
export function generateInvocationId(iteration: number): string {
  const hex = randomBytes(4).toString("hex");
  return `inv-${String(iteration).padStart(6, "0")}-${hex}`;
}

/**
 * Where `invocation.idBase` is set (alias `SPECSTRIDE_INVOCATION_ID`, flag
 * `--invocation-id`), the id of pass n is `<base>-iter-<n>` (F126-FR-026).
 */
export function invocationIdFor(iteration: number, idBase?: string | undefined): string {
  if (idBase !== undefined && idBase.length > 0) return `${idBase}-iter-${iteration}`;
  return generateInvocationId(iteration);
}

/** Check the role under the `parity` profile (F126-FR-012, F126-FR-026). */
function checkRole(role: string, profile: string | undefined): asserts role is Role {
  if (profile !== "parity") return;
  if (!(ROLES as readonly string[]).includes(role)) {
    throw new IdentityComponentError("role must be proposer, accelerator or critic");
  }
}

/** The whole identity, with the id generated or taken as given. */
export function buildIdentity(input: IdentityInput): InvocationIdentity {
  checkRole(input.role, input.profile);
  const invocationId = input.invocationId ?? invocationIdFor(input.iteration);
  return {
    runId: input.runId,
    feature: input.feature,
    role: input.role as Role,
    harness: input.harness,
    phase: input.phase,
    attempt: input.attempt,
    iteration: input.iteration,
    invocationId,
  };
}

/**
 * The expected evidence path is stored absolute, with the home expanded and
 * links resolved (F126-FR-026).
 */
export function absoluteExpectedEvidencePath(path: string): string {
  const expanded = path.startsWith("~/") || path === "~" ? joinHome(path) : path;
  const absolute = isAbsolute(expanded) ? expanded : resolve(expanded);
  try {
    return realpathSync(absolute);
  } catch {
    // The file may not exist yet: the absolute path without the resolution stands.
    return absolute;
  }
}

/** Expand a leading `~` to the home of the user. */
function joinHome(path: string): string {
  const rest = path === "~" ? "" : path.slice(1);
  return `${homedir()}${rest}`;
}

/** The identity as the artifact records name it (data-model: eight fields). */
export function identityFields(identity: InvocationIdentity): {
  runId: string;
  feature: string;
  role: string;
  harness: string;
  phase: string;
  attempt: number;
  iteration: number;
  invocationId: string;
} {
  return {
    runId: identity.runId,
    feature: identity.feature,
    role: identity.role,
    harness: identity.harness,
    phase: identity.phase,
    attempt: identity.attempt,
    iteration: identity.iteration,
    invocationId: identity.invocationId,
  };
}
