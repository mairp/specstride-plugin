/**
 * T006 — the writer of the resolved registry (F124-FR-021, F124-FR-022; annex
 * C §C.6 of feature 100; the logical name `run:<runId>:registry`).
 *
 * The one act on the machine of role resolution: the record is built, it is
 * validated against `specstride.registry/1`, it is checked to hold no secret
 * value (F100-FR-052), and it is written ATOMICALLY — a temporary name in the
 * same directory, fsync, a rename (F100-FR-036), through the atomic write of
 * the kernel. A reader never sees a partial record.
 */
import { join } from "node:path";
import { atomicWriteJson, isTemporaryName } from "@specstride/kernel/atomic-write";
import {
  SCHEMA_ID,
  readResolvedRegistry,
  type ResolvedRegistry,
  type RegistryHarness,
  type RoleEntry,
} from "@specstride/contracts/records/resolved-registry";
import type { CriticPick, RolePlan } from "./types.ts";

/** The schema id the record carries in its field `schema` (F100-FR-048). */
export const REGISTRY_SCHEMA_ID = SCHEMA_ID;

/** The logical name of the record, with the placeholder of the run id. */
export const REGISTRY_LOGICAL_NAME = "run:<runId>:registry" as const;

/**
 * The name of the file of the record inside the state directory of the run
 * (annex B §B.5): the record of the logical name `run:<runId>:registry` is
 * `registry.json` in the directory of the run.
 */
export function registryPathFor(runId: string, stateRoot: string): string {
  if (runId.length === 0 || runId.includes("/") || runId.includes("\\")) {
    throw new RegistryWriterError(`the run id "${runId}" is not a directory name`);
  }
  return join(stateRoot, runId, "registry.json");
}

/** A record the writer refused to build or to write. */
export class RegistryWriterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryWriterError";
  }
}

/**
 * A key that names a secret (F100-FR-052, F100-FR-203): the record of the
 * resolved registry carries the REFERENCE of a secret, never its value, and a
 * key of this shape may not appear in the record at all.
 */
const SECRET_KEY = /(secret|password|passwd|apikey|api_key|token|credential)$/i;

/** A value that looks like the body of a private key. */
const PRIVATE_KEY_BODY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/**
 * F100-FR-052 — no value of the record is a secret value. Walks the record:
 * a key of the shape above, or a value carrying a private-key body, refuses
 * the record before it reaches the disk.
 */
export function holdsNoSecretValue(
  value: unknown,
  where: string = "schema",
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = holdsNoSecretValue(value[i], `${where}[${i}]`);
      if (!found.ok) return found;
    }
    return { ok: true };
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) {
        return { ok: false, reason: `the key "${where}.${key}" names a secret (F100-FR-052)` };
      }
      const found = holdsNoSecretValue(child, `${where}.${key}`);
      if (!found.ok) return found;
    }
    return { ok: true };
  }
  if (typeof value === "string" && PRIVATE_KEY_BODY.test(value)) {
    return { ok: false, reason: `the value of "${where}" holds a private-key body (F100-FR-052)` };
  }
  return { ok: true };
}

/** The fields of the record this feature writes. */
export type ResolvedRegistryInput = {
  /** The harnesses of the registry, as annex C §C.6 reads them. */
  readonly harnesses: readonly RegistryHarness[];
  /** The registered roles. */
  readonly roles: readonly RoleEntry[];
  /** The role plan: per phase, per role, the ordered entries. */
  readonly plan: RolePlan;
  /** How the critic was chosen. */
  readonly criticPick: CriticPick;
  /** The ranked candidates that were not picked, in pass-over order. */
  readonly runnersUp: readonly { readonly harness: string; readonly reason: string }[];
  /** The lines announced at launch. */
  readonly announced: readonly string[];
};

/**
 * Build the record: the field `schema` is set here (F100-FR-048), and the
 * record is validated against `specstride.registry/1` BEFORE it is written —
 * a record that does not validate never reaches the disk.
 */
export function buildResolvedRegistry(input: ResolvedRegistryInput): ResolvedRegistry {
  const candidate: ResolvedRegistry = {
    schema: REGISTRY_SCHEMA_ID,
    harnesses: input.harnesses,
    roles: input.roles,
    plan: input.plan as unknown as ResolvedRegistry["plan"],
    criticPick: input.criticPick as unknown as ResolvedRegistry["criticPick"],
    runnersUp: input.runnersUp,
    announced: input.announced,
  };
  const secret = holdsNoSecretValue(candidate);
  if (!secret.ok) throw new RegistryWriterError(secret.reason);
  // Validates against `specstride.registry/1` or throws (F100-FR-048/049).
  return readResolvedRegistry(candidate);
}

/**
 * F124-FR-021 — write the record at `run:<runId>:registry`: a temporary name
 * in the SAME directory, fsync, rename (F100-FR-036). The record is built and
 * validated first; the write is the last step, and it is the only act on the
 * machine this module performs.
 */
export function writeResolvedRegistry(options: {
  readonly runId: string;
  /** The root of the run state on disk; the record stays inside it. */
  readonly stateRoot: string;
  readonly input: ResolvedRegistryInput;
}): { readonly path: string; readonly record: ResolvedRegistry } {
  const record = buildResolvedRegistry(options.input);
  const path = registryPathFor(options.runId, options.stateRoot);
  atomicWriteJson(path, record, { root: options.stateRoot, createDirectory: true });
  return { path, record };
}

/** True for a name the atomic write uses while the record is in flight. */
export function isATemporaryRegistryName(name: string): boolean {
  return isTemporaryName(name);
}
