/**
 * T050 — the isolation of a command inside a batch (F148-FR-013).
 *
 * F148-FR-013 is six claims, and each is one line of `isolationOf`:
 *
 *  1. the commands of a batch run IN THE SAME TREE — one working directory
 *     for the whole batch, which `isolationOf` copies from the batch and
 *     never varies per member;
 *  2. each has its OWN PROCESS GROUP — the kind `command` gives every
 *     execution a group of its own (`FIXED_SPAWN_OPTIONS.detached`), and
 *     `processGroupsAreDistinct` reads that back from the running commands;
 *  3. each has its OWN TEMPORARY DIRECTORY — `temporaryDirectoryOf` names one
 *     per batch and slot, and it reaches the command as `TMPDIR`;
 *  4. each has its OWN CAPTURED OUTPUT WITH ITS OWN CAP — the cap is per
 *     member, so two commands that each print well past it give two capped
 *     captures and never one shared budget;
 *  5. each has its OWN TIME LIMIT — the limit of its own manifest entry, not
 *     a limit of the batch;
 *  6. each gets THE ENVIRONMENT ALLOW-LIST — the same `commandEnvironment` a
 *     single command gets, with the member's temporary directory overlaid.
 *
 * Nothing here creates a directory: a temporary directory is a NAME this
 * module computes and the caller makes, so the module stays a pure function
 * of its inputs and a test can assert the names without a file system.
 */
import { join } from "node:path";
import type { ManifestEntry, PinnedIdentity } from "@specstride/contracts/ep/check-runner";
import {
  FIXED_SPAWN_OPTIONS,
  startCommand,
  type CommandRun,
  type RunningCommand,
} from "../command/kind-command.ts";
import {
  TEMPORARY_DIRECTORY_NAME,
  commandEnvironment,
  type EnvironmentOptions,
} from "../command/environment.ts";
import { MAX_OUTPUT_CHARS } from "../result/errors.ts";
import type { Batch, BatchEntry, BatchMember } from "./admission.ts";

/** F148-FR-013 — what every member of a batch has of its own. */
export const ISOLATED_PER_MEMBER: readonly string[] = Object.freeze([
  "its own process group",
  "its own temporary directory",
  "its own captured output with its own cap",
  "its own time limit",
  "the environment allow-list",
]);

/** F148-FR-013 — what the members of a batch SHARE. */
export const SHARED_BY_THE_BATCH: readonly string[] = Object.freeze(["the same tree"]);

/** The name the runner sets to the member's own temporary directory. */
export { TEMPORARY_DIRECTORY_NAME };

/** The process group of a member is its own: the kind `command` detaches it. */
export const EVERY_MEMBER_IS_DETACHED: true = FIXED_SPAWN_OPTIONS.detached;

/**
 * F148-FR-013 — the name of the temporary directory of ONE member: one per
 * batch and slot, so no two members of a run can be handed the same one.
 */
export function temporaryDirectoryOf(
  root: string,
  batch: number,
  slot: number,
  checkId: string,
): string {
  const safe = checkId.replace(/[^A-Za-z0-9._-]/g, "_");
  return join(root, `check-${String(batch)}-${String(slot)}-${safe}`);
}

/** What a caller gives for the isolation of one batch. */
export type IsolationContext = {
  /** The one tree every member of the batch runs in. */
  readonly workingDirectory: string;
  /** The root under which each member's temporary directory is named. */
  readonly temporaryRoot: string;
  readonly profile?: string;
  /** The cap of EACH member's capture; the default is the cap of a command. */
  readonly maxOutputChars?: number;
  readonly environmentOptions?: EnvironmentOptions;
  /** The pinned identity of a member, by the id of its command. */
  readonly identities?: Readonly<Record<string, PinnedIdentity>>;
  readonly containment?: CommandRun["containment"];
  readonly proposerContainment?: CommandRun["proposerContainment"];
};

/** The isolation of one member: what it has of its own, by name. */
export type MemberIsolation = {
  readonly checkId: string;
  readonly batch: number;
  readonly slot: number;
  /** The one tree of the batch (F148-FR-013, claim 1). */
  readonly workingDirectory: string;
  /** The member's own temporary directory (claim 3). */
  readonly temporaryDirectory: string;
  /** The member's own cap (claim 4). */
  readonly maxOutputChars: number;
  /** The member's own time limit, from its own manifest entry (claim 5). */
  readonly timeLimitMs: number;
  /** The environment the member gets, with the allow-list applied (claim 6). */
  readonly environment: Readonly<Record<string, string>>;
};

/**
 * F148-FR-013 — the isolation of ONE member of a batch. A pure function of
 * the member and the context: it starts nothing and creates nothing.
 */
export function isolationOf(member: BatchMember, context: IsolationContext): MemberIsolation {
  const temporaryDirectory = temporaryDirectoryOf(
    context.temporaryRoot,
    member.batch,
    member.slot,
    member.entry.id,
  );
  const environment = commandEnvironment(asManifestEntry(member.entry), context.profile ?? "", {
    ...(context.environmentOptions ?? {}),
    temporaryDirectory,
  });
  return Object.freeze({
    checkId: member.entry.id,
    batch: member.batch,
    slot: member.slot,
    workingDirectory: context.workingDirectory,
    temporaryDirectory,
    maxOutputChars: context.maxOutputChars ?? MAX_OUTPUT_CHARS,
    timeLimitMs: member.entry.timeLimitMs,
    environment,
  });
}

/** The isolation of every member of a batch, in slot order. */
export function isolationOfABatch(
  batch: Batch,
  context: IsolationContext,
): readonly MemberIsolation[] {
  return Object.freeze(batch.members.map((member) => isolationOf(member, context)));
}

/**
 * F148-FR-013 — the findings of an isolation that is not one: two members
 * that share a temporary directory, or that do not share the tree. An empty
 * list is the whole of the requirement's first four claims, read back.
 */
export function isolationFindings(isolations: readonly MemberIsolation[]): readonly string[] {
  const findings: string[] = [];
  const seen = new Map<string, string>();
  const trees = new Set<string>();
  for (const one of isolations) {
    trees.add(one.workingDirectory);
    const already = seen.get(one.temporaryDirectory);
    if (already !== undefined) {
      findings.push(
        `the members \`${already}\` and \`${one.checkId}\` share the temporary directory ` +
          `\`${one.temporaryDirectory}\`; each member of a batch has its own (F148-FR-013)`,
      );
    }
    seen.set(one.temporaryDirectory, one.checkId);
    if (one.environment[TEMPORARY_DIRECTORY_NAME] !== one.temporaryDirectory) {
      findings.push(
        `the member \`${one.checkId}\` was not handed its own temporary directory as ` +
          `\`${TEMPORARY_DIRECTORY_NAME}\` (F148-FR-013)`,
      );
    }
  }
  if (trees.size > 1) {
    findings.push(
      `the members of a batch run in the same tree; ${String(trees.size)} trees were named ` +
        `(F148-FR-013)`,
    );
  }
  return Object.freeze(findings);
}

/**
 * The entry as the kind `command` takes it. The kind reads `id`, `argv` and
 * `env`; the one field that differs between `BatchEntry` and the EP-05 type
 * is `reads`, whose second form (`reads: tree`) the interface type cannot
 * carry, and which the kind never looks at.
 */
function asManifestEntry(entry: BatchEntry): ManifestEntry {
  return entry as unknown as ManifestEntry;
}

/** The run of one member of a batch, as the kind `command` takes it. */
export function commandRunOf(member: BatchMember, context: IsolationContext): CommandRun {
  const isolation = isolationOf(member, context);
  const identity: PinnedIdentity = context.identities?.[member.entry.id] ?? {
    kind: "command",
    executable: member.entry.argv[0] ?? "",
    argv: Object.freeze(member.entry.argv.slice(1)),
  };
  return {
    entry: asManifestEntry(member.entry),
    identity,
    workingDirectory: isolation.workingDirectory,
    timeLimitMs: isolation.timeLimitMs,
    profile: context.profile ?? "",
    maxOutputChars: isolation.maxOutputChars,
    environmentOptions: {
      ...(context.environmentOptions ?? {}),
      temporaryDirectory: isolation.temporaryDirectory,
    },
    ...(context.containment === undefined ? {} : { containment: context.containment }),
    ...(context.proposerContainment === undefined
      ? {}
      : { proposerContainment: context.proposerContainment }),
  };
}

/**
 * F148-FR-013 — start every member of a batch, each isolated. They are
 * started together: a batch of more than one runs side by side.
 */
export function startTheMembers(
  batch: Batch,
  context: IsolationContext,
): readonly RunningCommand[] {
  return Object.freeze(batch.members.map((member) => startCommand(commandRunOf(member, context))));
}

/** F148-FR-013 — true where no two running members share a process group. */
export function processGroupsAreDistinct(running: readonly RunningCommand[]): boolean {
  const groups = running
    .map((one) => one.processGroup)
    .filter((group): group is number => group !== null);
  return new Set(groups).size === groups.length;
}
