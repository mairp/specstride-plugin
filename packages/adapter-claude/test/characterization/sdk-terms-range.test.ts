// CT-125-28 (T064) — the terms row of the SDK transport, the version range
// and the warning outside it, and ONLY the call that starts a session
// carries the session-start options (F125-FR-037, ruling 70, CQ-148).
// Surfaces: data (data/terms-rows.json), state (the range check), the
// captured option sets.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SDK_PACKAGE,
  SDK_TESTED_VERSION,
  SDK_VERSION_RANGE,
  SESSION_START_ONLY_OPTIONS,
  continuationOptions,
  runSdkCriticCall,
  sdkVersionInRange,
  sdkVersionWarning,
  sessionStartOptions,
  termsRows,
} from "../../src/index.ts";
import type { QueryImpl } from "../../src/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A fake `query` that records the one call and yields a tool-less stream. */
function fakeQuery(): { query: QueryImpl; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  const query: QueryImpl = async function* (args) {
    calls.push({ prompt: args.prompt, options: args.options });
    yield {
      type: "system",
      subtype: "init",
      session_id: "minted-critic-3",
      tools: [],
      mcp_servers: [],
      plugins: [],
    };
    yield { type: "result", subtype: "success", session_id: "minted-critic-3", num_turns: 1 };
  };
  return { query, calls };
}

describe("CT-125-28 — the terms row of the SDK transport (F125-FR-037)", () => {
  it("the SDK transport at auth tier 1 is REFUSED, with the ruling as its basis", () => {
    const data = JSON.parse(
      readFileSync(join(HERE, "..", "..", "data", "terms-rows.json"), "utf8"),
    ) as {
      rows: {
        id: string;
        transport: string | string[];
        authTier: number;
        status: string;
        basis: string;
        verifiedOn: string | null;
        accessDate: string;
      }[];
      sdkTransport: Record<string, unknown>;
    };
    const row = data.rows.find(
      (entry) =>
        entry.transport === "sdk-in-process" ||
        (Array.isArray(entry.transport) && entry.transport.includes("sdk-in-process")),
    );
    const refused = data.rows.find(
      (entry) =>
        (Array.isArray(entry.transport)
          ? entry.transport.includes("sdk-in-process")
          : entry.transport === "sdk-in-process") && entry.authTier === 1,
    );
    assert.ok(refused, "the data holds a row for the SDK transport at auth tier 1");
    assert.equal(refused.status, "refused");
    assert.match(refused.basis, /subscription login/);
    assert.match(refused.basis, /ruling 70/);
    // Documentation only: unverified, with the access date and no verified date.
    assert.equal(refused.verifiedOn, null);
    assert.equal(refused.accessDate, "2026-09-29");
    assert.ok(row);
  });

  it("at auth tier 2 the SDK transport is ALLOWED for both audiences", () => {
    const allowed = termsRows.rows.filter(
      (row) =>
        Array.isArray(row.transport) &&
        row.transport.includes("sdk-in-process") &&
        row.status === "allowed",
    );
    assert.deepEqual(allowed.map((row) => row.audience).sort(), ["distributed", "personal"]);
    assert.deepEqual(allowed.map((row) => row.authTier).sort(), [2, 2]);
  });

  it("the sdkTransport facts state the range, the tested version and the warning", () => {
    const sdk = termsRows.sdkTransport as Record<string, string>;
    assert.equal(sdk["transport"], "sdk-in-process");
    assert.equal(sdk["auth"], "api-key");
    assert.equal(sdk["versionRange"], SDK_VERSION_RANGE);
    assert.equal(sdk["testedVersion"], SDK_TESTED_VERSION);
    assert.match(sdk["warningOutsideRange"], /0\.3/);
    assert.match(
      sdk["warningOutsideRange"] ?? "",
      new RegExp(SDK_PACKAGE.replace(/[/@]/g, "\\$&")),
    );
  });
});

describe("CT-125-28 — the version range and the warning outside it (F125-FR-037)", () => {
  it("the range is the 0.3 line from the tested 0.3.284 (CQ-148)", () => {
    assert.equal(SDK_TESTED_VERSION, "0.3.284");
    assert.equal(SDK_VERSION_RANGE, ">=0.3.284 <0.4.0");
    assert.equal(sdkVersionInRange("0.3.284"), true);
    assert.equal(sdkVersionInRange("0.3.417"), true);
    assert.equal(sdkVersionInRange("0.3.283"), false, "below the tested version");
    assert.equal(sdkVersionInRange("0.4.0"), false, "another line");
    assert.equal(sdkVersionInRange("1.0.0"), false);
    assert.equal(sdkVersionInRange(null), false, "an unknown version is never in the range");
    assert.equal(sdkVersionInRange("garbage"), false);
  });

  it("outside the range is a WARNING that names the package and the range — never a refusal", () => {
    assert.equal(sdkVersionWarning("0.3.284"), null);
    const warning = sdkVersionWarning("0.4.3");
    assert.ok(warning);
    assert.match(warning, new RegExp(SDK_PACKAGE.replace(/[/@]/g, "\\$&")));
    assert.match(warning, /0\.3\.284/);
    assert.match(warning, /may misbehave/);
    assert.match(sdkVersionWarning(null) ?? "", /unknown/);
  });
});

describe("CT-125-28 — only the call that STARTS a session carries the options", () => {
  it("the session-start options are exactly the declared set, on a session-starting call", () => {
    const options = sessionStartOptions({
      workdir: "/tmp/empty",
      env: { PATH: "/usr/bin" },
      maxTurns: 1,
      maxBudgetUsd: 0.5,
    });
    for (const name of SESSION_START_ONLY_OPTIONS) {
      assert.ok(name in options, name);
    }
    assert.deepEqual(options["settingSources"], []);
    assert.deepEqual(options["allowedTools"], []);
    assert.equal(options["permissionMode"], "acceptEdits");
    assert.equal(options["maxBudgetUsd"], 0.5);
    assert.equal("resume" in options, false);
  });

  it("a CONTINUATION call carries none of the session-start options — only resume and the call facts", () => {
    const options = continuationOptions({
      workdir: "/tmp/empty",
      sessionId: "minted-1",
      model: "claude-sonnet",
      maxTurns: 4,
      env: { PATH: "/usr/bin" },
    });
    for (const name of SESSION_START_ONLY_OPTIONS) {
      assert.equal(name in options, false, `${name} is session-start only`);
    }
    assert.equal(options["resume"], "minted-1");
    assert.equal(options["cwd"], "/tmp/empty");
    assert.equal(options["model"], "claude-sonnet");
  });

  it("the SDK critic call is always a session START: it sends the session-start options", async () => {
    const { query, calls } = fakeQuery();
    await runSdkCriticCall({
      queryImpl: query,
      mintedSessionId: "minted-critic-3",
      prompt: "CRITIC",
      maxBudgetUsd: 0.25,
      emptyDir: "/tmp/empty-critic-dir",
      model: "claude-haiku",
    });
    assert.equal(calls.length, 1, "exactly one call: the one that starts the session");
    const options = calls[0]!["options"] as Record<string, unknown>;
    for (const name of SESSION_START_ONLY_OPTIONS) {
      assert.ok(name in options, name);
    }
    assert.equal(options["maxTurns"], 1);
    assert.equal(options["cwd"], "/tmp/empty-critic-dir");
    assert.equal("resume" in options, false);
  });

  it("a continuation with an empty session id is refused", () => {
    assert.throws(
      () =>
        continuationOptions({
          workdir: "/tmp/empty",
          sessionId: "",
          env: {},
        }),
      /empty session id/,
    );
  });
});
