/**
 * T100 — the TEST SCAFFOLDS (F105-FR-024).
 *
 * Where a scaffold directory is set, the derivation writes:
 *
 *  - for the test runners the baseline knows (vitest, else jest; and pytest),
 *    ONE FILE with ONE TEST PER VERIFICATION OBLIGATION, marked as to do or as
 *    skipped;
 *  - and ALWAYS a list of the scaffolds with the kind
 *    `verification-test-scaffold` and the version 1 that names every
 *    verification obligation.
 *
 * The phase context states that a scaffold is NEVER PASSING EVIDENCE
 * (F105-FR-024; the sentence is in `./phase-context.ts`). They are written
 * under `feature:<slug>:verification:scaffolds`.
 *
 * Each generated file carries its own MARKER OF GENERATION on the first line,
 * so that a plan whose hash moved can be scaffolded again over its own earlier
 * output while a file a person edited is still protected (F105-FR-023).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { holdsLogicalName } from "@specstride/contracts/ids/logical-names";
import oldSide from "@specstride/contracts/data/layout-old-side.json" with { type: "json" };
import { pythonJson } from "../plan/hash.ts";
import { VerificationError } from "../plan/record.ts";
import type { PlanObligation, VerificationPlan } from "../plan/record.ts";
import { authorizeOutput, safeWrite, type SafeWriteOutcome } from "./safe-writes.ts";

/** The logical name the scaffolds are written under (F105-FR-024). */
export const SCAFFOLDS_NAME = "feature:<slug>:verification:scaffolds" as const;

/** The place of the scaffolds of one feature (F105-FR-024). */
export function scaffoldsNameOf(slug: string): string {
  return SCAFFOLDS_NAME.replace("<slug>", slug);
}

/** True where the logical name of the scaffolds is one feature 100 knows. */
export function theScaffoldsNameIsKnown(): boolean {
  return holdsLogicalName(SCAFFOLDS_NAME);
}

/** The kind of the list of the scaffolds (F105-FR-024). */
export const SCAFFOLD_LIST_KIND = "verification-test-scaffold" as const;
/** The version of the list of the scaffolds (F105-FR-024). */
export const SCAFFOLD_LIST_VERSION = 1 as const;

/** The marker of a generated scaffold in a language with `//` comments. */
export const SLASH_MARKER = "// specstride-verification-plan:" as const;
/** The marker of a generated scaffold in a language with `#` comments. */
export const HASH_MARKER = "# specstride-verification-plan:" as const;
/**
 * The marker of the LIST, which has no comment line: its stable sorted-JSON
 * opening is the signature that identifies it as prior generated output
 * (`lib/verification_plan.py`:1494).
 */
export const LIST_MARKER = '{\n  "kind": "verification-test-scaffold",' as const;

/** The runners the baseline knows, in the order it tries them (`:1416`). */
export const RUNNERS_THE_BASELINE_KNOWS = ["vitest", "jest", "pytest"] as const;
export type Runner = (typeof RUNNERS_THE_BASELINE_KNOWS)[number];

/**
 * The item of the old side of the layout that records the as-is name of the
 * PYTEST scaffold (annex Y, `layout-old-side.json`): B-1067, with the logical
 * name `feature:<slug>:verification:scaffolds`.
 */
export const PYTEST_SCAFFOLD_ITEM = "B-1067" as const;

/**
 * The as-is name of the pytest scaffold, READ FROM THE OLD SIDE OF THE LAYOUT
 * (`@specstride/contracts/data/layout-old-side.json`, item B-1067) and not
 * written out here.
 *
 * Why it is read and not typed: the name ends in `.py`, and the static check
 * "no package file carries a legacy name" of F100-FR-026 collects every
 * `*.py` and `*.sh` token of every `asIsPaths` of that file and refuses it in
 * a package file. The name is no legacy COMMAND name — it is the as-is
 * OUTPUT name that F105-FR-024 (item B-1067) makes this feature write, and
 * the same data file records it with `what: "content"`. Reading it from there
 * keeps the check true and makes the name feature 100's data rather than a
 * second copy that could drift.
 */
export const PYTEST_FILE_NAME: string = (() => {
  const items = (oldSide as { items?: { item?: string; asIsPaths?: string[] }[] }).items ?? [];
  const found = items.find((one) => one.item === PYTEST_SCAFFOLD_ITEM)?.asIsPaths?.[0];
  if (found === undefined) {
    throw new VerificationError(
      `the old side of the layout holds no as-is path for ${PYTEST_SCAFFOLD_ITEM} ` +
        "(F105-FR-024; @specstride/contracts/data/layout-old-side.json)",
    );
  }
  return found;
})();

/** The file name of each runner's scaffold (`:1418`, `:1446`, `:1471`). */
export const FILE_NAMES: Readonly<Record<Runner, string>> = Object.freeze({
  vitest: "verification.generated.test.ts",
  jest: "verification.generated.test.js",
  pytest: PYTEST_FILE_NAME,
});

/** The file name of the list of the scaffolds (`:1498`). */
export const LIST_FILE_NAME = "verification.generated.json" as const;

/** The name of a test function a scaffold may carry (`:1388`). */
export function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, "_").toLowerCase();
}

/** One scaffold that was written (F105-FR-024). */
export type Scaffold = {
  readonly path: string;
  readonly framework: Runner | "canonical";
  readonly obligationRefs: readonly string[];
  /** True where the file already held exactly this content. */
  readonly reused: boolean;
  readonly outcome: SafeWriteOutcome;
};

/** The vitest scaffold: one `it.todo` per obligation (`:1416`). */
export function vitestScaffold(plan: VerificationPlan): string {
  const lines = [
    `${SLASH_MARKER} ${plan.contentHash}`,
    "// Generated scaffolds remain TODO until a project-specific oracle is supplied.",
    'import { describe, it } from "vitest";',
    "",
    `describe(${pythonJson(`Verification plan ${plan.id}`)}, () => {`,
  ];
  for (const obligation of plan.obligations) {
    lines.push(`  it.todo(${pythonJson(`${obligation.id} ${obligation.title}`)});`);
  }
  lines.push("});", "");
  return lines.join("\n");
}

/** The jest scaffold: one `test.todo` per obligation (`:1446`). */
export function jestScaffold(plan: VerificationPlan): string {
  const lines = [
    `${SLASH_MARKER} ${plan.contentHash}`,
    "// Generated scaffolds remain TODO until a project-specific oracle is supplied.",
    `describe(${pythonJson(`Verification plan ${plan.id}`)}, () => {`,
  ];
  for (const obligation of plan.obligations) {
    lines.push(`  test.todo(${pythonJson(`${obligation.id} ${obligation.title}`)});`);
  }
  lines.push("});", "");
  return lines.join("\n");
}

/** The pytest scaffold: one SKIPPED test per obligation (`:1471`). */
export function pytestScaffold(plan: VerificationPlan): string {
  const lines = [
    `${HASH_MARKER} ${plan.contentHash}`,
    "# Generated scaffolds are skipped until a project-specific oracle is supplied.",
    "import pytest",
    "",
  ];
  for (const obligation of plan.obligations) {
    lines.push(
      `@pytest.mark.skip(reason=${pythonJson(`TODO ${obligation.id}: supply an executable oracle`)})`,
      `def test_${safeName(obligation.id)}():`,
      `    ${pythonJson(obligation.title)}`,
      "    raise AssertionError('unreachable while skipped')",
      "",
    );
  }
  return lines.join("\n");
}

/** One obligation as the list of the scaffolds names it (`:1502`). */
export function listedObligation(obligation: PlanObligation): Record<string, unknown> {
  return {
    id: obligation.id,
    title: obligation.title,
    phase: obligation.phase ?? null,
    level: obligation.level,
    kind: obligation.kind,
    oracle: [...obligation.oracle],
    witnesses: [...obligation.witnesses],
  };
}

/** The list of the scaffolds, which is ALWAYS written (F105-FR-024). */
export function scaffoldList(plan: VerificationPlan): string {
  const record = {
    kind: SCAFFOLD_LIST_KIND,
    version: SCAFFOLD_LIST_VERSION,
    verificationPlanId: plan.id,
    verificationPlanHash: plan.contentHash,
    obligations: plan.obligations.map(listedObligation),
  };
  // `json.dumps(manifest, indent=2, sort_keys=True) + "\n"` (`:1512`).
  return `${pythonJson(record, { indent: 2, sortKeys: true })}\n`;
}

/** The runner whose scaffold is written, from the frameworks of the plan. */
export function runnersOf(frameworks: readonly string[]): readonly Runner[] {
  const out: Runner[] = [];
  // vitest ELSE jest: the baseline writes at most one of the two (`:1444`).
  if (frameworks.includes("vitest")) out.push("vitest");
  else if (frameworks.includes("jest")) out.push("jest");
  if (frameworks.includes("pytest")) out.push("pytest");
  return Object.freeze(out);
}

/** The content and the marker of one runner's scaffold. */
export function scaffoldOf(
  runner: Runner,
  plan: VerificationPlan,
): { readonly content: string; readonly marker: string } {
  if (runner === "vitest") return { content: vitestScaffold(plan), marker: SLASH_MARKER };
  if (runner === "jest") return { content: jestScaffold(plan), marker: SLASH_MARKER };
  return { content: pytestScaffold(plan), marker: HASH_MARKER };
}

/**
 * Write the scaffolds of a plan below an output directory (F105-FR-024). Each
 * place is authorized first (F105-FR-023), and `reused` says that the file
 * already held exactly this content.
 */
export function writeScaffolds(input: {
  readonly plan: VerificationPlan;
  readonly outputDirectory: string;
  /** The reader of a file that already exists, injected for a test. */
  readonly readIfPresent?: ((path: string) => string | undefined) | undefined;
  /** The writer, injected; the default is the safe write of F105-FR-023. */
  readonly write?:
    ((input: { path: string; content: string; marker?: string }) => SafeWriteOutcome) | undefined;
}): readonly Scaffold[] {
  const workdir = input.plan.project.workdir;
  const directory = authorizeOutput(workdir, input.outputDirectory);
  const write = input.write ?? ((one) => safeWrite(one));
  const read = input.readIfPresent ?? defaultRead;
  const scaffolds: Scaffold[] = [];
  const refs = input.plan.obligations.map((one) => one.id);
  for (const runner of runnersOf(input.plan.project.frameworks)) {
    const path = authorizeOutput(workdir, join(directory, FILE_NAMES[runner]));
    const { content, marker } = scaffoldOf(runner, input.plan);
    const reused = read(path) === content;
    const outcome = write({ path, content, marker });
    scaffolds.push(
      Object.freeze({
        path,
        framework: runner,
        obligationRefs: Object.freeze([...refs]),
        reused,
        outcome,
      }),
    );
  }
  const listPath = authorizeOutput(workdir, join(directory, LIST_FILE_NAME));
  const listContent = scaffoldList(input.plan);
  const listReused = read(listPath) === listContent;
  const listOutcome = write({ path: listPath, content: listContent, marker: LIST_MARKER });
  scaffolds.push(
    Object.freeze({
      path: listPath,
      framework: "canonical" as const,
      obligationRefs: Object.freeze([...refs]),
      reused: listReused,
      outcome: listOutcome,
    }),
  );
  return Object.freeze(scaffolds);
}

/** The reader of an existing file, where the caller injects none. */
function defaultRead(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The list of scaffolds the public command prints (F105-FR-024, B-1040):
 * `json.dumps(artifacts, sort_keys=True)` of the baseline
 * (`lib/verification_plan.py`:2404), over the four fields of an artifact.
 */
export function scaffoldArtifactsJson(scaffolds: readonly Scaffold[]): string {
  return pythonJson(
    scaffolds.map((one) => ({
      framework: one.framework,
      obligationRefs: [...one.obligationRefs],
      path: one.path,
      reused: one.reused,
    })),
    { sortKeys: true },
  );
}

/** The scaffolds the derivation reports after a `create --generate-tests`. */
export function generatedReport(
  scaffolds: readonly Scaffold[],
): readonly { readonly path: string; readonly framework: string; readonly reused: boolean }[] {
  return Object.freeze(
    scaffolds.map((one) =>
      Object.freeze({ path: one.path, framework: one.framework, reused: one.reused }),
    ),
  );
}
