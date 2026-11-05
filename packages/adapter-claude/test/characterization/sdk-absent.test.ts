// CT-125-27 (T063) — with the SDK absent the transport is UNAVAILABLE, the
// doctor names it, and a run on the subprocess is unchanged (F125-FR-036);
// and the CI check that the packed package and everything it installs hold
// no file of the SDK. Surfaces: state (the loader, the selection, the
// doctor), the subprocess argument list, the packed file list.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SDK_PACKAGE,
  TRANSPORT_ENV_VARIABLE,
  TransportChoiceRefusedError,
  buildProposerArgv,
  doctorTransportStates,
  loadSdk,
  resolveSdkLocation,
  selectTransport,
} from "../../src/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(HERE, "..", "..");

describe("CT-125-27 — the SDK absent (F125-FR-036)", () => {
  it("resolution from a workspace without the SDK finds nothing", () => {
    const empty = mkdtempSync(join(tmpdir(), "sdk-absent-"));
    assert.equal(resolveSdkLocation(empty, import.meta.url), null);
  });

  it("the loader states `absent-dependency` — not an error of the run — and names the package", async () => {
    const empty = mkdtempSync(join(tmpdir(), "sdk-absent-"));
    const outcome = await loadSdk({ runWorkspace: empty });
    assert.equal(outcome.available, false);
    if (outcome.available) return;
    assert.equal(outcome.availability, "absent-dependency");
    assert.match(outcome.reason, new RegExp(SDK_PACKAGE.replace(/[/@]/g, "\\$&")));
    assert.match(outcome.reason, /optional peer dependency/);
  });

  it("a chosen SDK transport whose dependency is absent is unavailable, and the doctor says so", () => {
    const state = selectTransport({
      authTier: 2,
      environment: { [TRANSPORT_ENV_VARIABLE]: "sdk-in-process" },
      sdk: { present: false },
    });
    assert.equal(state.transport, "sdk-in-process");
    assert.equal(state.availability, "absent-dependency");
    assert.match(state.reason ?? "", new RegExp(SDK_PACKAGE.replace(/[/@]/g, "\\$&")));
    const states = doctorTransportStates({
      authTier: 2,
      environment: { [TRANSPORT_ENV_VARIABLE]: "sdk-in-process" },
      sdk: { present: false },
    });
    const sdk = states.find((entry) => entry.transport === "sdk-in-process");
    assert.ok(sdk);
    assert.equal(sdk.availability, "absent-dependency");
    assert.match(sdk.reason ?? "", /optional peer dependency/);
  });

  it("a run on the subprocess is UNCHANGED by the absent SDK: the argument list is byte-equal", () => {
    const build = (): readonly string[] =>
      buildProposerArgv({
        role: "proposer",
        profile: "default",
        authTier: 2,
        sessionMode: "fresh",
        sessionId: "1a2b3c4d-5e6f-4918-8276-4561237890ab",
        model: "claude-sonnet",
      });
    const before = build();
    // The doctor observes the absent SDK; the subprocess path builds the
    // same argv: the states are reported, never selected by the default.
    const states = doctorTransportStates({
      authTier: 2,
      sdk: { present: false },
    });
    assert.deepEqual(build(), before);
    assert.equal(states[0].transport, "subprocess");
    assert.equal(states[0].availability, "available");
    assert.ok(!before.join(" ").includes("agent-sdk"), "no SDK artifact in the argv");
  });

  it("a choice is still required for the SDK: absence never falls back silently on a CHOSEN sdk run", () => {
    assert.equal(
      selectTransport({
        authTier: 2,
        environment: { [TRANSPORT_ENV_VARIABLE]: "sdk-in-process" },
        sdk: { present: false },
      }).availability,
      "absent-dependency",
    );
    assert.throws(
      () => selectTransport({ authTier: 1, flag: "sdk-in-process" }),
      TransportChoiceRefusedError,
    );
  });

  it("the packed package and everything it installs hold NO file of the SDK", () => {
    // The same check the build workflow runs (scripts/check-packed-package.mjs).
    const result = spawnSync(
      process.execPath,
      [join(PACKAGE, "scripts", "check-packed-package.mjs")],
      { encoding: "utf8" },
    );
    assert.equal(
      result.status,
      0,
      `the packed-package check failed:\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(result.stdout, /no file of/);
  });

  it("the package declares the SDK as an OPTIONAL PEER dependency, and nowhere else", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    assert.deepEqual(manifest["peerDependencies"], {
      [SDK_PACKAGE]: ">=0.3.284 <0.4.0",
    });
    assert.deepEqual(manifest["peerDependenciesMeta"], {
      [SDK_PACKAGE]: { optional: true },
    });
    for (const field of ["dependencies", "optionalDependencies", "devDependencies"]) {
      const record = manifest[field] as Record<string, string> | undefined;
      assert.equal(record?.[SDK_PACKAGE], undefined, field);
    }
  });
});
