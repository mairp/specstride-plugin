/**
 * T067 — the writer of the verification-commands document (F107-FR-041c;
 * F105-FR-016).
 *
 * The completion of the draft writes the declared verification commands of a
 * feature under the logical name `feature:<slug>:verification:commands`, in
 * the shape of F105-FR-016: a record with the non-empty list `commands` and
 * the optional fields `schema_version`, `discovery` and `phaseTimeouts`; a
 * command has `id`, `phase`, `executable`, `cwd` and `timeoutSec`, with `args`
 * and `env` optional. Only the commands the inventory declared are written —
 * never `reads`, `writes` or `sideEffects`, which the document may not carry
 * (F105-FR-016; rulings P11, 35). The write goes through the atomic write of
 * the kernel.
 */
import { join } from "node:path";

import { writeAtomicallyJson } from "../kernel.ts";

/** The logical name the document lives under (annex B §B.5; F107-FR-041c). */
export function verificationCommandsLogicalName(slug: string): string {
  return `feature:${slug}:verification:commands`;
}

/** One command of the document, in the shape of F105-FR-016. */
export type VerificationCommand = {
  readonly id: string;
  readonly phase: number;
  readonly executable: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly timeoutSec: number;
  readonly env?: Readonly<Record<string, string>>;
};

/** The document itself, in the shape of F105-FR-016. */
export type VerificationCommandsDocument = {
  readonly schema_version: "1.0";
  readonly feature: string;
  readonly commands: readonly VerificationCommand[];
};

/**
 * The document of a feature, from the commands the verification-plan source
 * declared for it. Only declared commands: a command the inventory refused
 * (a scope declaration, or no fixed argument list) is never written.
 */
export function verificationCommandsDocument(input: {
  readonly slug: string;
  readonly root: string;
  readonly commands: readonly {
    readonly id: string;
    readonly argv: readonly string[];
    readonly phase: number;
    readonly timeLimitMs: number;
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly undeclaredBecauseOfScopes: readonly string[];
  }[];
}): VerificationCommandsDocument {
  const commands = input.commands
    .filter((one) => one.undeclaredBecauseOfScopes.length === 0 && one.argv.length > 0)
    .map((one) => {
      const base: {
        id: string;
        phase: number;
        executable: string;
        args?: string[];
        cwd: string;
        timeoutSec: number;
        env?: Record<string, string>;
      } = {
        id: one.id,
        phase: one.phase,
        executable: one.argv[0] as string,
        ...(one.argv.length > 1 ? { args: one.argv.slice(1).map(String) } : {}),
        cwd: one.cwd ?? input.root,
        timeoutSec: Math.max(1, Math.round(one.timeLimitMs / 1000)),
      };
      if (one.env !== undefined) base.env = { ...one.env };
      return base;
    });
  return { schema_version: "1.0", feature: input.slug, commands };
}

/**
 * The physical path of a logical name under the control plane of the
 * repository: the members of the logical name are directories. The CLI is the
 * one writer of state files, and it writes through the atomic write.
 */
export function physicalStatePath(root: string, logicalName: string): string {
  return join(root, ".specstride", "state", ...logicalName.split(":"));
}

/**
 * Write the document of a feature under its logical name and return the path
 * it was written to (F107-FR-041c). The host never writes: this is the CLI.
 */
export function writeVerificationCommands(input: {
  readonly root: string;
  readonly document: VerificationCommandsDocument;
}): string {
  const path = physicalStatePath(
    input.root,
    verificationCommandsLogicalName(input.document.feature),
  );
  writeAtomicallyJson(path, input.document, { createDirectory: true });
  return path;
}
