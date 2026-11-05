// CT-125-25 (T061) — the transport is chosen by the CONSUMER (F125-FR-034):
// user configuration, the environment or a flag — never automatically, not
// under `parity`; the SDK at auth tier 1 is refused; a project cannot
// choose. Surfaces: state (the selection), refusals.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SDK_PACKAGE,
  TRANSPORT_ENV_VARIABLE,
  TransportChoiceRefusedError,
  doctorTransportStates,
  selectTransport,
} from "../../src/index.ts";

const SDK_PRESENT = { present: true, version: "0.3.284" } as const;

describe("CT-125-25 — the transport is chosen by the consumer (F125-FR-034)", () => {
  it("with no channel set the default is the subprocess — NEVER the SDK, even installed and in range", () => {
    const chosen = selectTransport({ authTier: 2, sdk: SDK_PRESENT });
    assert.equal(chosen.transport, "subprocess");
    assert.equal(chosen.availability, "available");
    assert.match(chosen.reason ?? "", /never automatic/);
  });

  it("under `parity` the subprocess is FORCED: every consumer channel is ignored", () => {
    for (const channel of [
      { userConfiguration: { transport: "sdk-in-process" } },
      { environment: { [TRANSPORT_ENV_VARIABLE]: "sdk-in-process" } },
      { flag: "sdk-in-process" },
    ]) {
      const chosen = selectTransport({
        authTier: 2,
        parity: true,
        sdk: SDK_PRESENT,
        ...channel,
      });
      assert.equal(chosen.transport, "subprocess", JSON.stringify(channel));
    }
  });

  it("the consumer chooses through EACH of its three channels", () => {
    const expected = { transport: "sdk-in-process", availability: "available" };
    assert.deepEqual(
      (({ transport, availability }) => ({ transport, availability }))(
        selectTransport({
          authTier: 2,
          userConfiguration: { transport: "sdk-in-process" },
          sdk: SDK_PRESENT,
        }),
      ),
      expected,
    );
    assert.deepEqual(
      (({ transport, availability }) => ({ transport, availability }))(
        selectTransport({
          authTier: 2,
          environment: { [TRANSPORT_ENV_VARIABLE]: "sdk-in-process" },
          sdk: SDK_PRESENT,
        }),
      ),
      expected,
    );
    assert.deepEqual(
      (({ transport, availability }) => ({ transport, availability }))(
        selectTransport({ authTier: 2, flag: "sdk-in-process", sdk: SDK_PRESENT }),
      ),
      expected,
    );
  });

  it("the SDK at auth tier 1 is REFUSED, a configuration error, wherever it is chosen", () => {
    for (const channel of [
      { userConfiguration: { transport: "sdk-in-process" } },
      { environment: { [TRANSPORT_ENV_VARIABLE]: "sdk-in-process" } },
      { flag: "sdk-in-process" },
    ]) {
      assert.throws(
        () => selectTransport({ authTier: 1, sdk: SDK_PRESENT, ...channel }),
        (error: unknown) => {
          assert.ok(error instanceof TransportChoiceRefusedError);
          assert.match(error.message, /auth tier 2/);
          return true;
        },
        JSON.stringify(channel),
      );
    }
  });

  it("a PROJECT cannot choose: only the three consumer channels exist, no project file is read", () => {
    // The selection input has no project field; an object carrying
    // project-shaped keys contributes NOTHING to the choice.
    const withProjectNoise = selectTransport({
      authTier: 2,
      sdk: SDK_PRESENT,
      // A project-shaped settings record names a transport where only the
      // user's own key may stand: it contributes nothing.
      userConfiguration: { project: "sdk-in-process" } as unknown as {
        transport?: string;
      },
      environment: { ".claude.settings.transport": "sdk-in-process" } as Record<string, string>,
    });
    assert.equal(withProjectNoise.transport, "subprocess");
    // And a project-level variable next to the real one is not read either.
    const projectVariable = selectTransport({
      authTier: 2,
      sdk: SDK_PRESENT,
      environment: {
        SPECSTRIDE_PROJECT_TRANSPORT: "sdk-in-process",
        NPM_CONFIG_SPECSTRIDE_TRANSPORT: "sdk-in-process",
      },
    });
    assert.equal(projectVariable.transport, "subprocess");
  });

  it("a value that is not a transport is refused; `direct-call` stays the critic's own choice", () => {
    assert.throws(
      () => selectTransport({ authTier: 2, flag: "teleport" }),
      TransportChoiceRefusedError,
    );
    assert.equal(selectTransport({ authTier: 2, flag: "direct-call" }).transport, "direct-call");
  });

  it("the doctor names the states without changing the choice (F125-FR-036)", () => {
    const states = doctorTransportStates({
      authTier: 2,
      environment: { [TRANSPORT_ENV_VARIABLE]: "sdk-in-process" },
      sdk: { present: false },
    });
    assert.deepEqual(
      states.map((state) => state.transport),
      ["subprocess", "sdk-in-process"],
    );
    assert.equal(states[0].availability, "available");
    assert.equal(states[1].availability, "absent-dependency");
    assert.match(states[1].reason ?? "", new RegExp(SDK_PACKAGE.replace(/[/@]/g, "\\$&")));
  });
});
