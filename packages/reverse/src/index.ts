/**
 * `@specstride/reverse` — the reverse capability of the CLI (features 108 and
 * 140). Layer L6 of `packages/contracts/data/package-graph.json`: it may
 * import `@specstride/contracts`, `@specstride/kernel` and
 * `@specstride/spec-formats`, and nothing else.
 *
 * Phase 1 of feature 108 (T001, T002) establishes the package: its identity,
 * the logical names a reverse run writes, and the contract schemas copied into
 * `data/`. The wrapper (`src/wrapper/`), the plan (`src/plan/`) and the guard
 * (`src/guard/`) arrive in the later phases and are re-exported from here.
 *
 * Every logical name below is checked against the table of annex B §B.5 at
 * load, through the resolver of `@specstride/contracts`: a name this package
 * invents, or one the table renames, fails at import and not at run time
 * (F100-FR-053).
 */
import { holdsLogicalName } from "@specstride/contracts/ids/logical-names";

/** The name of this package in the workspace and in the package graph. */
export const PACKAGE_NAME = "@specstride/reverse" as const;

/** Its layer in `packages/contracts/data/package-graph.json` (F108-FR-001). */
export const PACKAGE_LAYER = "L6" as const;

/**
 * The only packages this one may import (the `mayImport` row of the graph).
 * The import-boundary check of the workspace is the enforcement; this list is
 * the package's own record of the rule it is held to.
 */
export const ALLOWED_IMPORTS = Object.freeze([
  "@specstride/contracts",
  "@specstride/kernel",
  "@specstride/spec-formats",
] as const);

/**
 * The logical names a reverse run writes or reads, as annex B §B.5 holds them.
 * `<slug>` is the slug of the run and `<unit-key>` the key of a unit phase;
 * the names are patterns of the table, not resolved paths.
 */
export const REVERSE_LOGICAL_NAMES = Object.freeze([
  "reverse:<slug>:inventory",
  "reverse:<slug>:inventory-summary",
  "reverse:<slug>:driver",
  "reverse:<slug>:verification-commands",
  "reverse:<slug>:analysis",
  "reverse:<slug>:output",
  "reverse:<slug>:claims:<unit-key>",
  "reverse:<slug>:test-plan",
  "reverse:<slug>:scaffolds",
] as const);

/** A logical name of this package that the table of §B.5 does not hold. */
export class ReverseNameNotInTheLayoutError extends Error {
  readonly missing: readonly string[];
  constructor(missing: readonly string[]) {
    super(
      `the layout table of annex B §B.5 does not hold ${missing.length} logical name(s) of @specstride/reverse: ${missing.join(", ")}`,
    );
    this.name = "ReverseNameNotInTheLayoutError";
    this.missing = Object.freeze([...missing]);
  }
}

/**
 * The names of `REVERSE_LOGICAL_NAMES` the layout table does not hold. Empty
 * when the package and the table agree.
 */
export function namesMissingFromTheLayout(): readonly string[] {
  return Object.freeze(REVERSE_LOGICAL_NAMES.filter((name) => !holdsLogicalName(name)));
}

const missingAtLoad = namesMissingFromTheLayout();
if (missingAtLoad.length > 0) throw new ReverseNameNotInTheLayoutError(missingAtLoad);

/**
 * The contract schemas of `specs/108-reverse/contracts/`, copied byte for byte
 * into `packages/reverse/data/` by T002. `planOutput` fixes the keys of the
 * plan JSON (F108-FR-015); `verificationCommands` fixes the fields of the
 * verification-commands document of a reverse run (F108-FR-022).
 */
export const SCHEMA_FILES = Object.freeze({
  planOutput: "data/plan-output.schema.json",
  verificationCommands: "data/verification-commands.schema.json",
} as const);

/** The schema titles the two files carry, as the specification wrote them. */
export const SCHEMA_TITLES = Object.freeze({
  planOutput: "specstride.reverse-plan/1",
  verificationCommands: "specstride.reverse-verification-commands/1",
} as const);

/**
 * Phase 2 of feature 108 (T004) — the one call into the inventory and the
 * reader of its fields. It is the only way this package reaches the inventory:
 * the CLI command `reverse inventory` of annex G §G.1, whose verb feature 140
 * owns (F108-FR-014, F108-FR-027).
 */
export * from "./plan/inventory-call.ts";

/**
 * Phase 3 of feature 108 (T011 to T017) — the slug and the output refusals,
 * the gate-state refusal, the driver spec, the verification-commands document,
 * `plan` and the wrapper. Each module is the one the task names, so that a
 * reader of the package graph finds the behaviour where the task list puts it.
 */
export * as output from "./plan/output.ts";
export * as collision from "./plan/collision.ts";
export * as driver from "./plan/driver.ts";
export * as commands from "./plan/commands.ts";
export * as schemaCheck from "./plan/schema-check.ts";
export * as reversePlan from "./plan/plan.ts";
export * as wrapper from "./wrapper/wrapper.ts";

/**
 * Phase 4 of feature 108 (T023) — the guard: the re-walk, the comparison, the
 * problems, `testautomation/`, the git checks, the printing and the exit codes
 * (F108-FR-027 to F108-FR-032).
 */
export * as guard from "./guard/guard.ts";
export * as guardWalk from "./guard/walk.ts";
export * as guardGit from "./guard/git.ts";

/**
 * Phase 5 of feature 108 (T025) — the dry run: the plan lines and the engine
 * command, exit 0, nothing launched (F108-FR-005).
 */
export * as dryRun from "./wrapper/dry-run.ts";

/**
 * Phase 7 of feature 108 (T027) — default output and its byte cap: one line
 * for a success, only the failing items with their fixes for a failure, state
 * named by logical name, nothing under the `parity` profile, and never more
 * than 1,120 bytes (2,240 on a failure) for a command the host skill calls
 * between invocation and launch (F108-FR-034, F108-SC-006).
 */
export * as defaultOutput from "./wrapper/default-output.ts";

/**
 * Feature 140 — the closed family of finding codes, the byte-exact
 * serializers and the finding type with its two printers (phases 1 and 2,
 * T003, T005, T006).
 */
export * as codes from "./codes.ts";
export * as serialize from "./inventory/serialize.ts";
export * as findings from "./lint/findings.ts";

/**
 * Phase 3 of feature 140 (T013 to T018) — the reverse lint: the frame with
 * its arguments, levels, ownership, template loading and finding sort; the
 * template, placeholder and structure rules; the evidence grammar, the claim
 * blocks and citation resolution; the rules of `spec.md`, of the design
 * artifacts and of the checklist; the rules of `tasks.md` through the
 * spec-format adapter with the coverage rule and the claims file; and the
 * shipped Spec Kit templates with their notice (F140-FR-001 to F140-FR-014,
 * F140-FR-026).
 */
export * as lint from "./lint/lint.ts";
export * as lintTemplates from "./lint/templates.ts";
export * as lintEvidence from "./lint/evidence.ts";
export * as lintSpecRules from "./lint/spec.ts";
export * as lintTaskRules from "./lint/tasks.ts";
export * as shippedTemplates from "./lint/shipped.ts";

/**
 * Phase 4 of feature 140 (T022 to T028) — the source INVENTORY: the limits
 * and their settings, the walk core in its two modes, the file entries with
 * their classification and skip reasons, the manifests and the Spec Kit
 * facts, the entry points, the workspaces and the units, the document with
 * its `schema` and its fingerprint, the summary with its budget rule, and the
 * verb `inventory` with its exit codes (F140-FR-001, F140-FR-015 to
 * F140-FR-025).
 */
export * as inventoryLimits from "./inventory/limits.ts";
export * as inventoryWalk from "./inventory/walk.ts";
export * as inventoryEntries from "./inventory/entries.ts";
export * as inventoryProject from "./inventory/project.ts";
export * as inventoryUnits from "./inventory/units.ts";
export * as inventoryDocument from "./inventory/document.ts";
export * as inventorySummary from "./inventory/summary.ts";
export * as inventoryCli from "./inventory/cli.ts";
