/**
 * T015 / CT-131-7 — dated facts (F131-FR-007, F131-SC-005).
 *
 * Every fact of the descriptor, of the recorded fixtures and of the terms
 * rows carries a `verified-on` date and the version pin of the harness, or
 * is marked `unverified` with the check that would settle it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(PACKAGE, "data");
const FIXTURES = join(PACKAGE, "fixtures");

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PIN = /^codex-cli \d+\.\d+\.\d+/;

type Node = Record<string, unknown>;

function isRecord(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The mark of an unverified fact: a `status` that says so, an `unverified`
 * field, or an `unverifiedReason` that names the check that would settle it.
 */
function unverifiedMark(node: Node): string | null {
  if (typeof node.unverified === "string" && node.unverified !== "") return node.unverified;
  if (typeof node.unverifiedReason === "string" && node.unverifiedReason !== "") {
    return node.unverifiedReason;
  }
  if (typeof node.status === "string" && node.status.startsWith("unverified")) {
    return node.status;
  }
  return null;
}

/** Whether one object carries a date and a pin, or an `unverified` mark. */
function isDatedFact(node: Node): boolean {
  const dated = DATE.test(String(node.verifiedOn ?? "")) || DATE.test(String(node.accessed ?? ""));
  const pinned = PIN.test(String(node.pin ?? "")) || PIN.test(String(node.harnessVersion ?? ""));
  if (dated && pinned) return true;
  // FR-007: or the fact is marked `unverified` with the settling check.
  return unverifiedMark(node) !== null;
}

/** Every object in the document, the root included. */
/** Whether the object states at least one primitive fact of its own. */
function statesAFact(node: Node): boolean {
  return Object.values(node).some((value) => typeof value !== "object" || value === null);
}

function* objects(value: unknown): Generator<Node> {
  if (isRecord(value)) {
    yield value;
    for (const child of Object.values(value)) yield* objects(child);
  } else if (Array.isArray(value)) {
    for (const child of value) yield* objects(child);
  }
}

test("CT-131-7: every fact of the descriptor carries a date and a pin or an unverified mark", () => {
  const path = join(DATA, "descriptor.json");
  const descriptor = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const roots: Node[] = [...objects(descriptor)];
  assert.ok(roots.length > 10, "the descriptor holds facts");
  // A pure container (only objects and lists beneath it) is not a fact; an
  // object that states a primitive fact of its own must be stamped.
  // The root of the descriptor carries its date on `verifiedOn` and its pin
  // one level down, in `detect.pin` (the loader refuses unknown top-level
  // keys), so the root is judged by that rule.
  const pinAnywhere = roots.some((node) => PIN.test(String(node.pin ?? "")));
  assert.ok(DATE.test(String((descriptor as Node).verifiedOn ?? "")));
  assert.ok(pinAnywhere, "the pin of the harness is recorded in the descriptor");
  const unstamped = roots
    .slice(1)
    .filter((node) => statesAFact(node) && !isDatedFact(node))
    .map((node) => Object.keys(node).slice(0, 4).join(","));
  assert.deepEqual(unstamped, []);
  // The pin is the recorded harness version, read with a read-only --version.
  assert.equal((descriptor as Node).descriptorVersion, 1);
});

test("CT-131-7: every row of the terms rows carries a date and a pin or an unverified mark", () => {
  const path = join(DATA, "terms-rows.json");
  const terms = JSON.parse(readFileSync(path, "utf8")) as {
    rows: Node[];
    status: string;
  };
  assert.ok(terms.rows.length >= 5);
  assert.match(terms.status, /^unverified/);
  for (const row of terms.rows) {
    assert.ok(isDatedFact(row), `row ${JSON.stringify(row).slice(0, 60)}`);
  }
});

test("CT-131-7: every recorded fixture carries a date and a pin or an unverified mark", () => {
  assert.ok(existsSync(FIXTURES));
  const checked: string[] = [];
  for (const entry of readdirSync(FIXTURES)) {
    const meta = join(FIXTURES, entry, "capture.json");
    if (!existsSync(meta)) continue;
    const capture = JSON.parse(readFileSync(meta, "utf8")) as Node;
    assert.ok(isDatedFact(capture), meta);
    // A fixture recorded from a capture states the version of the harness
    // that produced it; a capture that was not made carries the mark.
    assert.match(String(capture.harnessVersion ?? ""), PIN);
    assert.ok(unverifiedMark(capture) !== null || capture.result === "made", meta);
    checked.push(entry);
  }
  assert.deepEqual(checked, ["capture-1", "capture-2", "capture-3", "capture-4", "capture-5"]);
});
