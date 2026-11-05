// T057 (F116-FR-019) — the static guard that no excluded field of the fact
// block (contracts/fact-block-content.md, "Never holds") is a field of the
// builder's output. The guard walks the deep keys of a representative block
// and fails loudly on any excluded name.
import { buildFactBlock, type FactBlock } from "./build.ts";

/** The fields the fact block MUST NOT hold (F116-FR-019). */
export const EXCLUDED_FIELDS: readonly string[] = Object.freeze([
  "cycleCount",
  "repairCount",
  "retryCount",
  "failureCount",
  "failures",
  "declarationOrder",
  "startedAt",
  "finishedAt",
  "durationMs",
  "output",
  "earlierResults",
  "treeBefore",
  "treeAfter",
  "protectedBefore",
  "protectedAfter",
  "fingerprintPerRow",
  "modelTier",
  "sessionId",
  "routingDecision",
  "fromClosingCheck",
  "checkpointNote",
  "groupId",
  "workerId",
  "testCounts",
]);

/** A representative final state: one declared unit, one of every fact kind. */
function representativeBlock(): FactBlock {
  const block = buildFactBlock({
    manifestHash: "representative",
    manifestCommands: ["check:x"],
    treeFingerprint: "0".repeat(64),
    taskOrder: ["the task"],
    units: [
      {
        unitId: "u",
        tasks: ["the task"],
        results: [
          {
            ordinal: 1,
            seq: 1,
            treeAfter: "0".repeat(64),
            commands: [{ id: "check:x", exit: 0, tainted: false, cached: false, flaky: [0, 0] }],
          },
        ],
      },
    ],
    protectedFacts: {
      changedSincePhaseEntry: ["a.ts"],
      authorised: ["a.ts"],
      changedSinceLaunchInApprovedPhases: [],
      suppressionMarkers: [{ path: "t.ts", added: 0, removed: 0 }],
    },
    integrityEvents: ["pin-mismatch"],
    furtherFacts: ["manifest-rederived"],
    excludedCommands: [],
    ledgerInvalidFrom: null,
  });
  if (block === null) throw new Error("the representative state must give a block");
  return block;
}

function deepKeys(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) deepKeys(v, into);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as object)) {
      into.push(k);
      deepKeys(v, into);
    }
  }
  return into;
}

/** The excluded fields that appear as a field of the builder's output. */
export function excludedFieldViolations(): string[] {
  const keys = new Set(deepKeys(representativeBlock()));
  return EXCLUDED_FIELDS.filter((field) => keys.has(field));
}

/** The static guard: throws when an excluded field leaked into the output. */
export function assertNoExcludedField(): void {
  const violations = excludedFieldViolations();
  if (violations.length > 0) {
    throw new Error(`excluded fields in the fact block output: ${violations.join(", ")}`);
  }
}
