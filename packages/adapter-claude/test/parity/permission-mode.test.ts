// PT-125-C-058-permission-mode (T021) — under the default profile the
// proposer states accept-edits with an explicit allow list and no prompts;
// the bypass mode only by the consumer's choice in user configuration and
// only where the precondition holds; the adapter never selects it by itself
// and refuses the launch where the precondition fails, without a fallback
// (F125-FR-012; B-0689; CQ-183; FX-01).
// Surface: transcript.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InvokeRefusedError, buildProposerArgv } from "../../src/invoke-proposer.ts";

const BASE = {
  role: "proposer" as const,
  profile: "default" as const,
  authTier: 1 as const,
  sessionId: "00000000-0000-4000-8000-000000000000",
  allowedTools: ["Read", "Grep", "Glob"],
};

const PRECONDITION = { sandbox: true, userIsRoot: false };

describe("PT-125-C-058-permission-mode — the stated mode (F125-FR-012)", () => {
  it("accept-edits is stated, with an allow list and no prompts (B-0689)", () => {
    const argv = buildProposerArgv(BASE);
    const modeAt = argv.indexOf("--permission-mode");
    assert.notEqual(modeAt, -1);
    assert.equal(argv[modeAt + 1], "acceptEdits");
    assert.ok(argv.includes("--allowedTools"));
    assert.equal(argv[argv.indexOf("--allowedTools") + 1], "Read,Grep,Glob");
    assert.equal(argv[argv.indexOf("--permission-prompts") + 1], "none");
  });

  it("the parity profile states the baseline's own bypass flag, mapped through the table", () => {
    const argv = buildProposerArgv({ role: "proposer", profile: "parity", authTier: 1 });
    assert.ok(argv.includes("--dangerously-skip-permissions"));
  });

  it("the adapter never selects the bypass mode by itself (CQ-183)", () => {
    const argv = buildProposerArgv({ ...BASE, bypassPrecondition: PRECONDITION });
    assert.ok(!argv.includes("--dangerously-skip-permissions"));
  });

  it("the consumer's choice plus the precondition selects the bypass mode", () => {
    const argv = buildProposerArgv({
      ...BASE,
      consumerBypass: true,
      bypassPrecondition: PRECONDITION,
    });
    assert.ok(argv.includes("--dangerously-skip-permissions"));
  });

  it("the launch is refused where the consumer chose bypass but no sandbox was detected", () => {
    assert.throws(
      () =>
        buildProposerArgv({
          ...BASE,
          consumerBypass: true,
          bypassPrecondition: { sandbox: false, userIsRoot: false },
        }),
      (error: Error) =>
        error instanceof InvokeRefusedError &&
        error.reason === "bypass-precondition" &&
        /no sandbox detected/.test(error.message),
    );
  });

  it("the launch is refused where the user is root, and never falls back silently", () => {
    assert.throws(
      () =>
        buildProposerArgv({
          ...BASE,
          consumerBypass: true,
          bypassPrecondition: { sandbox: true, userIsRoot: true },
        }),
      (error: Error) =>
        error instanceof InvokeRefusedError &&
        error.reason === "bypass-precondition" &&
        /the user is root/.test(error.message),
    );
    // No fallback: the built list never silently appears in another mode.
    const refused = (() => {
      try {
        buildProposerArgv({
          ...BASE,
          consumerBypass: true,
          bypassPrecondition: { sandbox: false, userIsRoot: true },
        });
        return false;
      } catch {
        return true;
      }
    })();
    assert.equal(refused, true);
  });
});
