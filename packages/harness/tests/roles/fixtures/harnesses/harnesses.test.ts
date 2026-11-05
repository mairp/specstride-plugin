/**
 * T002 — the fixture lists of harnesses (F124-FR-038, F124-FR-040).
 *
 * Every entry of every list is in the form of the field `harnesses` of
 * feature 100, annex C §C.6, and every value lands in the closed set it
 * belongs to (annex X §X.6, rows 28, 34 and 43; the states, the completion
 * forms and the cost classes). The lists together cover every state, both
 * forms of the `completion` level, every cost class, known and unknown
 * windows, and known and unknown terms.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  costClasses,
  formsOfTheCompletionLevel,
  statesOfAHarness,
} from "../../../../../../packages/contracts/src/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

type Entry = Record<string, unknown>;

function readHarnesses(name: string): Array<Entry> {
  const parsed = JSON.parse(readFileSync(join(HERE, name), "utf8")) as {
    harnesses: Array<Entry>;
  };
  return parsed.harnesses;
}

const LIST_FILES = readdirSync(HERE)
  .filter((name) => name.endsWith(".json"))
  .sort();

test("roles/fixtures/harnesses: every entry carries the fields of annex C §C.6", () => {
  assert.ok(LIST_FILES.length > 0);
  for (const file of LIST_FILES) {
    for (const entry of readHarnesses(file)) {
      for (const field of [
        "id",
        "state",
        "origin",
        "version",
        "descriptorHash",
        "resolvedPath",
        "containmentCeiling",
        "sources",
      ]) {
        assert.ok(field in entry, `${file}/${entry.id}: the field \`${field}\` is present`);
      }
      assert.ok(entry.descriptorHash instanceof String || typeof entry.descriptorHash === "string");
      assert.ok((entry.sources as Record<string, unknown>).state !== undefined);
    }
  }
});

test("roles/fixtures/harnesses: every value lands in its closed set", () => {
  for (const file of LIST_FILES) {
    for (const entry of readHarnesses(file)) {
      assert.ok(
        statesOfAHarness.has(entry.state as string),
        `${file}/${entry.id}: state "${entry.state}" is a member of row 34`,
      );
      const form = entry.completionForm as Record<string, unknown>;
      assert.ok(
        formsOfTheCompletionLevel.has(form.value as string),
        `${file}/${entry.id}: completion form "${form.value}" is a member of row 28`,
      );
      const cost = entry.costClass as Record<string, unknown>;
      assert.ok(
        costClasses.has(cost.value as string),
        `${file}/${entry.id}: cost class "${cost.value}" is a member of row 43`,
      );
      const window = entry.contextWindow as Record<string, unknown>;
      assert.ok(
        window.tokens === null || typeof window.tokens === "number",
        `${file}/${entry.id}: the window is a token count or null`,
      );
    }
  }
});

test("roles/fixtures/harnesses: every state of a harness is covered", () => {
  const seen = new Set(LIST_FILES.flatMap((f) => readHarnesses(f).map((e) => e.state as string)));
  for (const state of statesOfAHarness.members) {
    assert.ok(seen.has(state), `the state \`${state}\` appears in a list`);
  }
});

test("roles/fixtures/harnesses: both forms of the completion level are covered", () => {
  const seen = new Set(
    LIST_FILES.flatMap((f) =>
      readHarnesses(f).map((e) => (e.completionForm as Record<string, unknown>).value as string),
    ),
  );
  for (const form of formsOfTheCompletionLevel.members) {
    assert.ok(seen.has(form), `the completion form \`${form}\` appears in a list`);
  }
});

test("roles/fixtures/harnesses: every cost class is covered", () => {
  const seen = new Set(
    LIST_FILES.flatMap((f) =>
      readHarnesses(f).map((e) => (e.costClass as Record<string, unknown>).value as string),
    ),
  );
  for (const cost of costClasses.members) {
    assert.ok(seen.has(cost), `the cost class \`${cost}\` appears in a list`);
  }
});

test("roles/fixtures/harnesses: known and unknown windows are covered", () => {
  const windows = LIST_FILES.flatMap((f) =>
    readHarnesses(f).map((e) => e.contextWindow as Record<string, unknown>),
  );
  assert.ok(
    windows.some((w) => typeof w.tokens === "number"),
    "a known window",
  );
  assert.ok(
    windows.some((w) => w.tokens === null && w.source === "unknown"),
    "an unknown window",
  );
});

test("roles/fixtures/harnesses: known and unknown terms are covered", () => {
  const terms = LIST_FILES.flatMap((f) =>
    readHarnesses(f).map((e) => e.terms as Record<string, unknown>),
  );
  assert.ok(
    terms.some((t) => t.decision === "allowed" && typeof t.row === "string"),
    "known terms",
  );
  assert.ok(
    terms.some((t) => t.decision === "refused" && typeof t.row === "string"),
    "known terms, refused on a row",
  );
  assert.ok(
    terms.some((t) => t.decision === "unknown" && t.row === null),
    "unknown terms, with no row",
  );
});

test("roles/fixtures/harnesses: no entry carries a secret value", () => {
  for (const file of LIST_FILES) {
    const text = readFileSync(join(HERE, file), "utf8");
    assert.doesNotMatch(
      text,
      /(api[-_]?key|token|password|secret)\s*:/i,
      `${file} holds no secret`,
    );
  }
});
