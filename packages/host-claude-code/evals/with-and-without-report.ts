/**
 * T029 — the with-and-without report (F113-FR-040).
 *
 * The second PAID task of a person: `node evals/with-and-without-report.ts`
 * from the package root. It compares the host WITH the plugin and WITHOUT it.
 * No job of the build and no schedule starts it; it is not a check of a change
 * and not a release check; a run that calls a model is logged as F113-FR-038
 * says, and its paid part is `unverified` in `../src/evals/paid-tasks.ts`.
 *
 * The hermetic part, done here: the comparison of the two observation sets.
 * With the plugin the host shows the skills, the four hooks and the status
 * surface of this host; without it, none of the product appears.
 */
import { resolve } from "node:path";
import { HOOK_EVENT_IDS } from "../src/hooks.ts";
import { SKILL_LOGICAL_IDS } from "../src/skills.ts";

/** What one side of the comparison observed on the host. */
export type HostObservation = {
  /** The skills the host offers. */
  readonly skills: readonly string[];
  /** The host hook events the host registered. */
  readonly hooks: readonly string[];
  /** The status surface, where the host shows one. */
  readonly statusSurface: boolean;
};

/** The observation of a host WITHOUT the plugin: none of the product. */
export function withoutThePlugin(): HostObservation {
  return Object.freeze({ skills: [], hooks: [], statusSurface: false });
}

/** The observation of a host WITH the plugin: what the plugin declares. */
export function withThePlugin(): HostObservation {
  return Object.freeze({
    skills: [...SKILL_LOGICAL_IDS],
    hooks: [...HOOK_EVENT_IDS],
    statusSurface: true,
  });
}

/** One difference the report records. */
export type Difference = {
  readonly subject: string;
  readonly withPlugin: string;
  readonly withoutPlugin: string;
};

/** The with-and-without report, in memory. */
export type WithAndWithoutReport = {
  readonly format: "with-and-without-report/1";
  readonly differences: readonly Difference[];
  readonly addsSomethingOfTheProduct: boolean;
};

/** Compares the two observations, in the order the declaration gives. */
export function compare(
  withPlugin: HostObservation,
  withoutPlugin: HostObservation,
): WithAndWithoutReport {
  const differences: Difference[] = [];
  const subjects: readonly (keyof HostObservation)[] = ["skills", "hooks", "statusSurface"];
  for (const subject of subjects) {
    const a = withPlugin[subject];
    const b = withoutPlugin[subject];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      differences.push({
        subject,
        withPlugin: JSON.stringify(a),
        withoutPlugin: JSON.stringify(b),
      });
    }
  }
  return {
    format: "with-and-without-report/1",
    differences,
    addsSomethingOfTheProduct:
      differences.length > 0 && withPlugin.skills.length > 0 && withPlugin.hooks.length > 0,
  };
}

function main(): void {
  const report = compare(withThePlugin(), withoutThePlugin());
  console.log(
    `with-and-without report: ${report.addsSomethingOfTheProduct ? "DIFFERS" : "NO DIFFERENCE"}`,
  );
  for (const difference of report.differences) {
    console.log(
      `  - ${difference.subject}: with=${difference.withPlugin} without=${difference.withoutPlugin}`,
    );
  }
  console.log(
    "the paid part of T029 (the model calls of the two runs) is `unverified`: " +
      "see src/evals/paid-tasks.ts (owner's ruling of 2026-09-30)",
  );
}

// A person runs this file directly; importing it starts nothing.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  main();
}
