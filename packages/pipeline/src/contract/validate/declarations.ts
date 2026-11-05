/**
 * T054 — the declarations of the launch contract and their provenance check
 * (F107-FR-037; F107-FR-008; annex X §X.6 row 261; research.md rows 11 and
 * 15; rulings P11 and 35; CQ-190).
 *
 * What lives here, and nowhere else:
 *
 * - THE PROVENANCE CHECK (one rule, one place — F107-FR-012): every entry
 *   under `configuration.scopes` carries its `source`, and that source is a
 *   member of the closed set of row 261 (`user-config`, `environment`,
 *   `flag`). `compose.ts` delegates here; the shape of an entry is the item
 *   schema's (`schemas/configuration.schema.json`), never restated;
 * - THE CONTENT RULES: the declarations are validated as any content — a
 *   write scope is keyed by a task id that exists, and every declared path
 *   lies inside the authorized roots and names no file of the control plane;
 * - THE KEYS (feature 142 row 93 of annex X §X.7; feature 110): the write
 *   scope of a task is `loop.parallel.scopes.<taskId>`; the reads, the writes
 *   and the side effects of a verification command are
 *   `verification.scopes.<commandId>.reads`, `.writes` and `.sideEffects`;
 * - THE UNDECLARED RULE (ruling P11; CQ-190): a verification command with no
 *   declaration of the allowed provenance is UNDECLARED, and an undeclared
 *   command runs alone, one after the other. `undeclaredCommandIds` and
 *   `serialDependsOn` are the only reading of that rule in this package;
 * - `stages[].writes[]` is validated (the stage item schema) and UNUSED:
 *   only parallel units and verification may read it, and no reader exists
 *   here (F107-FR-037).
 *
 * The declarations enter derivation only from user configuration, the
 * environment or a flag — never from repository text, an answer to a judgment
 * item or the comment (rulings P11 and 35). The verification-plan source
 * reports none (F107-FR-008); a source of `verification-plan` is refused by
 * the provenance check, as it always was.
 */
import { declarationSourceSet } from "../schemas/closed-sets.ts";

/** The members of the closed set of row 261, read from `@specstride/contracts`. */
export const DECLARED_SOURCES: readonly string[] = declarationSourceSet.members;

/** The key prefix of the declared write scope of a task (feature 142; row 93). */
export const TASK_SCOPE_KEY_PREFIX = "loop.parallel.scopes." as const;

/** The key prefix of the declared reads and writes of a verification command (feature 110). */
export const COMMAND_SCOPE_KEY_PREFIX = "verification.scopes." as const;

/** The keys of one verification command's declaration (feature 110). */
export const COMMAND_SCOPE_KINDS = ["reads", "writes", "sideEffects"] as const;

/**
 * F107-FR-037 — `stages[].writes[]` is validated and unused. No code of this
 * package reads it: only parallel units (feature 142) and verification
 * (feature 105) may.
 */
export const STAGE_WRITES_ARE_UNUSED =
  "stages[].writes[] is validated and unused: only parallel units and verification may read it (F107-FR-037)" as const;

/** One problem the declarations' check found (exit 20, class `structure`). */
export type DeclarationProblem = {
  readonly rule: string;
  readonly path: string;
  readonly message: string;
  readonly class: "structure";
  readonly exit: 20;
};

function problem(path: string, message: string): DeclarationProblem {
  return { rule: "declarations", path, message, class: "structure", exit: 20 };
}

/** The write-scope key of one task (feature 142; row 93 of annex X §X.7). */
export function taskScopeKeyOf(taskId: string): string {
  return `${TASK_SCOPE_KEY_PREFIX}${taskId}`;
}

/** The three configuration keys of one verification command (feature 110). */
export function commandScopeKeysOf(commandId: string): readonly string[] {
  return COMMAND_SCOPE_KINDS.map((kind) => `${COMMAND_SCOPE_KEY_PREFIX}${commandId}.${kind}`);
}

/** True when the key is the write-scope key of a task. */
export function isTaskScopeKey(key: string): boolean {
  return key.startsWith(TASK_SCOPE_KEY_PREFIX);
}

/** True when the key is a reads/writes/sideEffects key of a verification command. */
export function isCommandScopeKey(key: string): boolean {
  if (!key.startsWith(COMMAND_SCOPE_KEY_PREFIX)) return false;
  const rest = key.slice(COMMAND_SCOPE_KEY_PREFIX.length);
  const dot = rest.lastIndexOf(".");
  if (dot < 1) return false;
  return (COMMAND_SCOPE_KINDS as readonly string[]).includes(rest.slice(dot + 1));
}

/**
 * True when the path names the control plane: a logical name of the state
 * layout, or anything under `.specstride/state`. A declaration never reaches
 * the control plane (F107-FR-037).
 */
export function namesTheControlPlane(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.includes(".specstride/state")) return true;
  return /^(pipeline|feature|launch|run):/.test(normalized);
}

/** True when the path lies inside one of the authorized roots (F107-FR-037). */
export function insideAnAuthorizedRoot(path: string, authorizedRoots: readonly string[]): boolean {
  const normalized = path.replaceAll("\\", "/");
  return authorizedRoots.some((root) => {
    const base = root.replaceAll("\\", "/").replace(/\/+$/, "");
    return normalized === base || normalized.startsWith(`${base}/`);
  });
}

/** The task ids the record knows: the inventory's tasks, else the coverage anchors. */
function taskIdsOf(record: Record<string, unknown>): readonly string[] {
  const ids: string[] = [];
  const inventory = record.inventory as { tasks?: unknown } | undefined;
  if (Array.isArray(inventory?.tasks)) {
    for (const task of inventory.tasks as { id?: unknown }[]) {
      if (task !== null && typeof task === "object" && typeof task.id === "string") {
        ids.push(task.id);
      }
    }
  }
  if (ids.length === 0 && Array.isArray(record.coverage)) {
    for (const entry of record.coverage as { source?: { anchor?: unknown } }[]) {
      const anchor = entry?.source?.anchor;
      if (typeof anchor === "string" && /^T\d/.test(anchor)) ids.push(anchor);
    }
  }
  return ids;
}

function scopesOf(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const configuration = record.configuration;
  if (configuration === null || typeof configuration !== "object") return undefined;
  const scopes = (configuration as Record<string, unknown>).scopes;
  if (scopes === null || typeof scopes !== "object") return undefined;
  return scopes as Record<string, unknown>;
}

function entriesOf(group: unknown): [string, Record<string, unknown>][] {
  if (group === null || typeof group !== "object") return [];
  return Object.entries(group as Record<string, unknown>).filter(
    (entry): entry is [string, Record<string, unknown>] =>
      entry[1] !== null && typeof entry[1] === "object",
  );
}

/**
 * The provenance check of F107-FR-037 (row 261), the ONE place the rule
 * stands: every declaration under `configuration.scopes` carries a `source`
 * of the closed set. Returns one problem per refused declaration.
 */
export function declarationSourceProblems(record: unknown): readonly DeclarationProblem[] {
  const problems: DeclarationProblem[] = [];
  if (record === null || typeof record !== "object") return problems;
  const scopes = scopesOf(record as Record<string, unknown>);
  if (scopes === undefined) return problems;
  for (const [group, entries] of [
    ["tasks", entriesOf(scopes.tasks)],
    ["commands", entriesOf(scopes.commands)],
  ] as const) {
    for (const [key, entry] of entries) {
      const source = entry.source;
      if (typeof source !== "string" || !DECLARED_SOURCES.includes(source)) {
        problems.push(
          problem(
            `/configuration/scopes/${group}/${key}/source`,
            `the declaration of "${key}" under configuration.scopes.${group} does not carry ` +
              `its provenance: the source must be one of ${DECLARED_SOURCES.join(", ")} ` +
              `(research.md row 14; annex X §X.6 row 261)`,
          ),
        );
      }
    }
  }
  return problems;
}

/**
 * The content rules of the declarations (F107-FR-037): a task write scope is
 * keyed by a task id that exists; a declared path lies inside the authorized
 * roots and names no file of the control plane. The provenance rule stands in
 * `declarationSourceProblems`; the shape stands in the item schema.
 */
export function declarationProblems(record: unknown): readonly DeclarationProblem[] {
  const problems: DeclarationProblem[] = [...declarationSourceProblems(record)];
  if (record === null || typeof record !== "object") return problems;
  const typed = record as Record<string, unknown>;
  const scopes = scopesOf(typed);
  if (scopes === undefined) return problems;
  const ids = taskIdsOf(typed);
  const roots = Array.isArray(typed.authorized_roots)
    ? (typed.authorized_roots as unknown[]).filter((one): one is string => typeof one === "string")
    : [];

  for (const [key, entry] of entriesOf(scopes.tasks)) {
    if (!isTaskScopeKey(key)) {
      problems.push(
        problem(
          `/configuration/scopes/tasks/${key}`,
          `the key "${key}" is not a write-scope key of a task; the key is ` +
            `${TASK_SCOPE_KEY_PREFIX}<taskId> (feature 142; annex X §X.7 row 93)`,
        ),
      );
      continue;
    }
    const taskId = key.slice(TASK_SCOPE_KEY_PREFIX.length);
    if (!ids.includes(taskId)) {
      problems.push(
        problem(
          `/configuration/scopes/tasks/${key}`,
          `the write scope names the task "${taskId}", which the launch contract does not hold`,
        ),
      );
    }
    const scope = entry.scope;
    if (typeof scope === "string" && scope !== "") {
      if (namesTheControlPlane(scope)) {
        problems.push(
          problem(
            `/configuration/scopes/tasks/${key}/scope`,
            `the write scope of "${taskId}" names the control plane, which no declaration may do`,
          ),
        );
      } else if (!insideAnAuthorizedRoot(scope, roots)) {
        problems.push(
          problem(
            `/configuration/scopes/tasks/${key}/scope`,
            `the write scope of "${taskId}" lies outside the authorized roots of the launch contract`,
          ),
        );
      }
    }
  }

  for (const [commandId, entry] of entriesOf(scopes.commands)) {
    for (const kind of ["reads", "writes"] as const) {
      const paths = entry[kind];
      if (!Array.isArray(paths)) continue;
      for (const path of paths) {
        if (typeof path !== "string" || path === "") continue;
        if (namesTheControlPlane(path)) {
          problems.push(
            problem(
              `/configuration/scopes/commands/${commandId}/${kind}`,
              `the declared ${kind} of "${commandId}" name the control plane, which no declaration may do`,
            ),
          );
        } else if (!insideAnAuthorizedRoot(path, roots)) {
          problems.push(
            problem(
              `/configuration/scopes/commands/${commandId}/${kind}`,
              `the declared ${kind} of "${commandId}" lie outside the authorized roots of the launch contract`,
            ),
          );
        }
      }
    }
  }
  return problems;
}

/** One declaration of the reads and writes of a verification command. */
export type CommandDeclaration = {
  readonly commandId: string;
  readonly reads?: readonly string[];
  readonly writes?: readonly string[];
  readonly source: string;
};

/**
 * The declaration of one verification command, when it carries the provenance
 * of row 261 (F107-FR-037, CQ-190). `undefined` — the command is UNDECLARED.
 */
export function declarationOfCommand(
  record: unknown,
  commandId: string,
): CommandDeclaration | undefined {
  if (record === null || typeof record !== "object") return undefined;
  const scopes = scopesOf(record as Record<string, unknown>);
  const commands = scopes?.commands;
  const entry: unknown =
    commands !== null && typeof commands === "object"
      ? (commands as Record<string, unknown>)[commandId]
      : undefined;
  if (entry === null || typeof entry !== "object") return undefined;
  const typed = entry as Record<string, unknown>;
  if (typeof typed.source !== "string" || !DECLARED_SOURCES.includes(typed.source)) {
    return undefined;
  }
  return {
    commandId,
    ...(Array.isArray(typed.reads) ? { reads: typed.reads as readonly string[] } : {}),
    ...(Array.isArray(typed.writes) ? { writes: typed.writes as readonly string[] } : {}),
    source: typed.source,
  };
}

/** True when the verification command has a declaration of the allowed provenance. */
export function isDeclaredCommand(record: unknown, commandId: string): boolean {
  return declarationOfCommand(record, commandId) !== undefined;
}

/**
 * The verification commands of the record that are UNDECLARED (ruling P11;
 * CQ-190): the command ids of `configuration.scopes.commands` (the commands
 * the consumer knows) that carry no declaration of the allowed provenance.
 */
export function undeclaredCommandIds(record: unknown): readonly string[] {
  const scopes =
    record !== null && typeof record === "object"
      ? scopesOf(record as Record<string, unknown>)
      : undefined;
  if (scopes === undefined) return [];
  return entriesOf(scopes.commands)
    .filter(([id]) => !isDeclaredCommand(record, id))
    .map(([id]) => id);
}

/**
 * The `depends_on` an UNDECLARED command runs with: it runs ALONE, one after
 * the other (ruling P11) — after every other command of the scopes, so no
 * other command may run beside it. A declared command's `depends_on` is the
 * graph's own, never rewritten here.
 */
export function serialDependsOn(record: unknown, commandId: string): readonly string[] {
  const scopes =
    record !== null && typeof record === "object"
      ? scopesOf(record as Record<string, unknown>)
      : undefined;
  if (scopes === undefined) return [];
  return entriesOf(scopes.commands)
    .map(([id]) => id)
    .filter((id) => id !== commandId);
}
