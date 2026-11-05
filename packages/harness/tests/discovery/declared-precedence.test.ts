/**
 * T016 — characterization tests CT-146-10 and CT-146-11 of the source
 * `declared` and the precedence (F146-FR-010, F146-FR-011): a harness
 * entry in project configuration is ignored with one line of at most 200
 * bytes and a doctor warning; the precedence of four origins for one
 * harness id.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { discover } from "../../src/discovery/discover.ts";
import {
  LINE_BYTE_LIMIT,
  ignoredEntryLine,
  isDeclarationKey,
} from "../../src/discovery/sources/declared.ts";
import { applyPrecedence } from "../../src/discovery/precedence.ts";
import { makeCandidate } from "../../src/discovery/candidate.ts";
import { fakeResolver } from "./helpers.ts";

test("CT-146-10: a harness entry in project configuration is ignored, with one line and a warning", async () => {
  const printed: string[] = [];
  const result = await discover({
    resolver: fakeResolver(),
    printer: (line) => printed.push(line),
    projectConfig: {
      scope: "project",
      values: {
        harnesses: { "example-cli": { endpoint: "http://127.0.0.1:9" } },
        discovery: { enabled: true },
      },
    },
    switches: { discoveryEnabled: true, metadataPassEnabled: false, parityProfile: false },
  });
  // The entry is ignored: no candidate carries it.
  for (const candidate of result.candidates) {
    assert.equal(candidate.sources.includes("declared"), false);
    assert.equal(candidate.state, "detected");
  }
  // One line, one warning, each naming the key.
  assert.equal(result.lines.length, 1);
  assert.equal(printed.length, 1);
  const line = result.lines[0]!;
  assert.ok(line.includes("harnesses.example-cli"), `the line does not name the key: ${line}`);
  assert.equal(line.includes("\n"), false, "the message is not one line");
  assert.ok(
    Buffer.byteLength(line, "utf8") <= LINE_BYTE_LIMIT,
    `the line is ${Buffer.byteLength(line, "utf8")} bytes`,
  );
  assert.ok(line.startsWith("SPECSTRIDE-DISCOVERY"));
  const warning = result.findings.find((finding) => finding.code === "declared-entry-ignored");
  assert.ok(warning !== undefined, "no doctor warning was recorded");
  assert.ok(warning.message.includes("harnesses.example-cli"));
  // And the line the doctor sees is the line that was printed.
  assert.equal(printed[0], line);
  // Only the declaration-shaped keys are ignored: `discovery.enabled` is a
  // switch of this feature, not a harness declaration, and is not ignored.
  assert.equal(isDeclarationKey("discovery.enabled"), false);
});

test("CT-146-10: under the `parity` profile nothing is printed", async () => {
  const printed: string[] = [];
  const result = await discover({
    resolver: fakeResolver(),
    printer: (line) => printed.push(line),
    projectConfig: { scope: "project", values: { harnesses: { x: {} } } },
    switches: { discoveryEnabled: false, metadataPassEnabled: false, parityProfile: true },
  });
  assert.equal(printed.length, 0);
  assert.equal(result.lines.length, 0);
});

test("CT-146-10: the line is data of the module, at most 200 bytes, for any key", () => {
  const longKey = `harnesses.${"x".repeat(400)}`;
  const line = ignoredEntryLine(longKey);
  assert.ok(Buffer.byteLength(line, "utf8") <= LINE_BYTE_LIMIT);
  assert.equal(line.includes("\n"), false);
});

test("CT-146-11: the precedence of four origins for one harness id", () => {
  const findings = [{ code: "probe-time-limit", message: "the probe did not end in time" }];
  const declared = makeCandidate({
    id: "one-harness",
    sources: ["declared"],
    state: "declared",
    origin: "user",
    kind: "cli",
    termsRef: "https://terms.example/one",
  });
  const adapter = makeCandidate({
    id: "one-harness",
    sources: ["harness-adapter"],
    state: "tested",
    origin: "adapter",
    kind: "cli",
  });
  const bundled = makeCandidate({
    id: "one-harness",
    sources: ["binary"],
    origin: "bundled",
    kind: "cli",
    resolvedPath: "/bin/one-harness",
  });
  const detected = makeCandidate({
    id: "one-harness",
    sources: ["host"],
    origin: "detected",
    kind: "agent",
    findings,
  });
  const result = applyPrecedence([detected, bundled, adapter, declared]);
  // One candidate for the id, and the entry the consumer declared wins.
  assert.equal(result.candidates.length, 1);
  const winner = result.candidates[0]!;
  assert.equal(winner.state, "declared");
  assert.equal(winner.termsRef, "https://terms.example/one");
  // The sources of every candidate that described the id are recorded, in
  // the order of the precedence (F146-FR-011).
  assert.deepEqual(winner.sources, ["declared", "harness-adapter", "binary", "host"]);
  // The three losers are recorded with what outranked them.
  assert.equal(result.losers.length, 3);
  for (const loser of result.losers) {
    assert.equal(loser.id, "one-harness");
    assert.deepEqual(loser.outrankedBy, ["declared"]);
  }
  // The values of the winner are kept, and no value of a loser replaces
  // one: the resolved path stays the one the bundled descriptor source
  // read only where the winner held none — here the winner holds none, so
  // the value of no loser leaks in.
  assert.equal(winner.resolvedPath, null);
});
