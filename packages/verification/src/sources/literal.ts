/**
 * T105 — the source "commands declared literally in the plan or the task
 * list", on the CANONICAL SPEC MODEL (F105-FR-015).
 *
 * A consumer writes the command inside the text of a task or of a plan:
 * `` `npm run build` ``, a fenced block of one line, or a line that begins
 * `Command:`. This source reads those out of the canonical spec model (EP-03)
 * and NEVER out of a parse of its own — the model carries the text of every
 * task with its line, and that is where the provenance comes from.
 *
 * What the requirement fixes about such a command:
 *
 *  - the WORKING DIRECTORY is the repository root;
 *  - the TIME LIMIT is that of the entry point of F105-FR-017 whose kind it
 *    runs, else 1800 seconds;
 *  - a command that cannot be written as a fixed argument list is a BLOCKER
 *    and never a guess — so a pipe, a redirection, a `&&`, a variable, a glob
 *    or an unbalanced quotation mark is refused here and recorded among the
 *    `ambiguities` with its provenance (F105-FR-015);
 *  - the launch contract's derivation writes these values into the
 *    verification-commands document it stores, so this source and that
 *    document agree by construction.
 */
import type {
  CanonicalSpecModel,
  SpecPhase,
  SpecSource,
} from "@specstride/contracts/records/canonical-spec-model";
import { pythonJson, stableId } from "../plan/hash.ts";
import { DEFAULT_DECLARED_KIND, type PlanCommand } from "../plan/record.ts";
import { TOOLCHAINS } from "./discovery.ts";
import { notAFixedArgumentList, type Blocker, type Provenance } from "./finding.ts";
import { DEFAULT_TIME_LIMIT_SEC, type SourceContribution } from "./registry.ts";

/** The id this source registers under (F105-FR-015). */
export const SOURCE_ID = "literal" as const;

/** The characters a shell would read, which make a command no fixed list. */
export const CHARACTERS_A_SHELL_WOULD_READ = [
  "|",
  "&",
  ";",
  ">",
  "<",
  "$",
  "`",
  "*",
  "?",
  "(",
  ")",
  "{",
  "}",
  "\n",
] as const;

/** The kinds whose time limit comes from the entry points of F105-FR-017. */
export function timeLimitOfKind(kind: string): number {
  for (const toolchain of TOOLCHAINS) {
    for (const entry of toolchain.entryPoints) {
      if (entry.kind === kind) return entry.timeoutSec;
    }
  }
  return DEFAULT_TIME_LIMIT_SEC;
}

/** The kind a literal command runs, read from the words of the command. */
export function kindOfLiteral(text: string): string {
  const lower = text.toLowerCase();
  for (const kind of ["test", "build", "lint", "format"]) {
    if (new RegExp(`\\b${kind}\\b`).test(lower)) return kind;
  }
  return DEFAULT_DECLARED_KIND;
}

/** The three forms a literal declaration may take (F105-FR-015). */
export const DECLARATION_FORMS = ["back-ticked", "fenced", "command-line"] as const;
export type DeclarationForm = (typeof DECLARATION_FORMS)[number];

/** One literal declaration, before it is read as an argument list. */
export type LiteralDeclaration = {
  readonly text: string;
  readonly form: DeclarationForm;
  readonly phase: number;
  readonly taskId: string;
  readonly provenance: Provenance;
};

/** The declarations inside the text of one task. */
export function declarationsInText(input: {
  readonly text: string;
  readonly phase: number;
  readonly taskId: string;
  readonly file: string;
  readonly line: number;
}): readonly LiteralDeclaration[] {
  const out: LiteralDeclaration[] = [];
  const base = {
    phase: input.phase,
    taskId: input.taskId,
    provenance: Object.freeze({ file: input.file, line: input.line }),
  };
  for (const match of input.text.matchAll(/`([^`\n]+)`/g)) {
    out.push(Object.freeze({ text: match[1]!.trim(), form: "back-ticked" as const, ...base }));
  }
  for (const match of input.text.matchAll(/^[ \t]*Command:[ \t]*(.+)$/gm)) {
    out.push(Object.freeze({ text: match[1]!.trim(), form: "command-line" as const, ...base }));
  }
  for (const match of input.text.matchAll(/```[a-zA-Z]*\n([^\n]+)\n```/g)) {
    out.push(Object.freeze({ text: match[1]!.trim(), form: "fenced" as const, ...base }));
  }
  return Object.freeze(out.filter((one) => one.text !== ""));
}

/**
 * The argument list of a literal declaration, or `undefined` where it cannot
 * be written as one (F105-FR-015). Quotation marks are read; a character a
 * shell would read, and an unbalanced quotation mark, give `undefined` and a
 * blocker — never a guess.
 */
export function argumentListOf(text: string): readonly string[] | undefined {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let open = false;
  for (const character of text) {
    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
        continue;
      }
      current += character;
      open = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      open = true;
      continue;
    }
    if ((CHARACTERS_A_SHELL_WOULD_READ as readonly string[]).includes(character)) return undefined;
    if (character === " " || character === "\t") {
      if (open) parts.push(current);
      current = "";
      open = false;
      continue;
    }
    current += character;
    open = true;
  }
  if (quote !== undefined) return undefined;
  if (open) parts.push(current);
  return parts.length === 0 ? undefined : Object.freeze(parts);
}

/** The blocker a declaration that is no fixed argument list gives. */
export function blockerOf(declaration: LiteralDeclaration): Blocker {
  return notAFixedArgumentList({
    message:
      `the command \`${declaration.taskId}\` declared literally as ` +
      `"${declaration.text}" cannot be written as a fixed argument list and is never guessed`,
    provenance: Object.freeze([declaration.provenance]),
  });
}

/** The source of a model whose kind names the plan or the task list. */
export function sourcesOfTheModel(model: CanonicalSpecModel): readonly SpecSource[] {
  return Object.freeze(model.sources.filter((one) => one.kind === "plan" || one.kind === "tasks"));
}

/** The file a declaration of a phase is reported in (F105-FR-015). */
export function fileOfTheDeclarations(model: CanonicalSpecModel): string {
  const sources = sourcesOfTheModel(model);
  return sources[0]?.path ?? model.sources[0]?.path ?? "";
}

/** Every literal declaration of a phase of the canonical spec model. */
export function declarationsOfPhase(input: {
  readonly phase: Pick<SpecPhase, "number" | "tasks">;
  readonly file: string;
}): readonly LiteralDeclaration[] {
  return Object.freeze(
    (input.phase.tasks ?? []).flatMap((task) =>
      declarationsInText({
        text: task.text,
        phase: input.phase.number,
        taskId: task.id,
        file: input.file,
        line: task.line,
      }),
    ),
  );
}

/**
 * The source itself (F105-FR-015): the commands declared literally in the plan
 * or the task list, with the repository root as the working directory and the
 * time limit of the entry point whose kind each runs.
 */
export function readLiteralSource(input: {
  readonly model: CanonicalSpecModel;
  readonly repositoryRoot: string;
}): SourceContribution {
  const file = fileOfTheDeclarations(input.model);
  const commands: PlanCommand[] = [];
  const blockers: Blocker[] = [];
  for (const phase of input.model.phases) {
    for (const declaration of declarationsOfPhase({ phase, file })) {
      const argv = argumentListOf(declaration.text);
      if (argv === undefined) {
        blockers.push(blockerOf(declaration));
        continue;
      }
      const kind = kindOfLiteral(declaration.text);
      const [executable, ...args] = argv;
      commands.push(
        Object.freeze({
          id: stableId(
            "CMD",
            `literal:${declaration.taskId}:${declaration.phase}:${pythonJson([...argv])}:${input.repositoryRoot}`,
          ),
          kind,
          label: `${declaration.taskId} (declared literally)`,
          executable: executable!,
          args: Object.freeze(args),
          // The repository ROOT is the working directory (F105-FR-015).
          cwd: input.repositoryRoot,
          // The time limit of the entry point whose kind it runs, else 1800 s.
          timeoutSec: timeLimitOfKind(kind),
          source: SOURCE_ID,
          declaredId: declaration.taskId,
          phase: declaration.phase,
          provenance: declaration.provenance,
        }),
      );
    }
  }
  return Object.freeze({
    sourceId: SOURCE_ID,
    commands: Object.freeze(commands),
    blockers: Object.freeze(blockers),
    findings: Object.freeze([]),
    assumptions: Object.freeze([]),
    ambiguities: Object.freeze([]),
  });
}
