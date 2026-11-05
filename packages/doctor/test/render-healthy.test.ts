/**
 * T013 (feature 112) — CT-112-123 (F112-FR-023): the healthy output.
 *
 * A healthy doctor prints EXACTLY ONE line of at most 200 bytes that names the
 * host, the audience, the proposer, the critic and the counts; warnings print
 * as further lines after that line; a finding of severity `ok` is NEVER
 * printed. The golden output of the healthy case is the fixture
 * `fixtures/golden-healthy.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderText, healthyLine } from "../src/render/text.ts";
import type { Finding } from "../src/registry/types.ts";
import type { Severity } from "@specstride/contracts/ep/doctor";
import { GOLDEN } from "./fixtures/golden-healthy.ts";

const SUBJECT = { host: "cli", audience: "personal", proposer: "claude", critic: "codex" };

function findingOf(id: string, severity: Severity): Finding {
  return {
    id,
    severity,
    lb: false,
    message: `${id} observed`,
    evidence: Object.freeze({}),
    remedy: `fix ${id}`,
  };
}

test("CT-112-123: the healthy output is exactly one line of at most 200 bytes", () => {
  const out = renderText([], SUBJECT, 0);
  const lines = out.split("\n");
  assert.equal(lines.length, 1, `expected one line, got ${String(lines.length)}`);
  assert.ok(Buffer.byteLength(out, "utf8") <= 200, "the healthy line exceeds 200 bytes");
  // It names the host, the audience, the proposer, the critic and the counts.
  for (const name of [
    "host=cli",
    "audience=personal",
    "proposer=claude",
    "critic=codex",
    "warnings=0",
    "notes=0",
  ]) {
    assert.ok(out.includes(name), `the healthy line does not name ${name}`);
  }
});

test("CT-112-123: the golden output of the healthy case is reproduced byte for byte", () => {
  const golden = GOLDEN.trimEnd();
  const out = renderText([], SUBJECT, 0);
  assert.equal(out, golden);
});

test("CT-112-123: a healthy run with findings of severity ok still prints the one line only", () => {
  // `ok` is NEVER printed (F112-FR-023, last sentence).
  const out = renderText([findingOf("env.node", "ok"), findingOf("host.plugin", "ok")], SUBJECT, 0);
  assert.equal(out.split("\n").length, 1);
  assert.ok(!out.includes("env.node"));
  assert.ok(!out.includes("host.plugin"));
});

test("CT-112-123: warnings print as further lines after the one healthy line", () => {
  const out = renderText(
    [findingOf("critic.diversity", "warn"), findingOf("terms.stale", "info")],
    SUBJECT,
    0,
  );
  const lines = out.split("\n");
  assert.ok(lines.length >= 3, "warnings and notes must follow the healthy line");
  assert.ok(lines[0]?.startsWith("specstride doctor:"));
  // Order: severity, then id — the warning before the note.
  const warnLine = lines.findIndex((l) => l.includes("critic.diversity"));
  const infoLine = lines.findIndex((l) => l.includes("terms.stale"));
  assert.ok(warnLine > 0 && infoLine > warnLine, "warnings must come after the healthy line");
});

test("CT-112-123: the healthy line helper stays inside 200 bytes for long names", () => {
  const line = healthyLine(
    {
      host: "a-very-long-host-name-indeed-xxxxxxxxxxxx",
      audience: "distributed",
      proposer: "example-agent-with-long-name",
      critic: "another-long-critic-name-xxxxxxxx",
    },
    [findingOf("a.warn", "warn")],
  );
  assert.ok(Buffer.byteLength(line, "utf8") <= 200);
});
