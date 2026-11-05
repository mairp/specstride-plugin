// PT-125-C-052-skills-switch and PT-125-C-058-skills-flag (T019) — the
// slash-command skills of the proposer are off: the disabling flag is passed
// unless `harnesses.claude.proposerSkills` is `1`; any other value leaves
// them disabled (F125-FR-010; B-0534, B-0741; FX-01).
// Surface: transcript.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildProposerArgv } from "../../src/invoke-proposer.ts";

const FLAG = "--disable-slash-commands";

describe("PT-125-C-052/058-skills — the skills switch (F125-FR-010)", () => {
  it("the flag is passed by default, under `parity` and under the default profile", () => {
    assert.ok(
      buildProposerArgv({ role: "proposer", profile: "parity", authTier: 1 }).includes(FLAG),
    );
    assert.ok(
      buildProposerArgv({
        role: "proposer",
        profile: "default",
        authTier: 1,
        sessionId: "00000000-0000-4000-8000-000000000000",
        allowedTools: ["Read"],
      }).includes(FLAG),
    );
  });

  it("any value other than `1` leaves the skills disabled (B-0534)", () => {
    for (const value of ["", "0", "true", "yes"]) {
      assert.ok(
        buildProposerArgv({
          role: "proposer",
          profile: "parity",
          authTier: 1,
          proposerSkills: value === "1",
        }).includes(FLAG),
        `the value ${JSON.stringify(value)} must leave the skills disabled`,
      );
    }
  });

  it("the opt-in `1` turns the flag off (B-0741)", () => {
    const argv = buildProposerArgv({
      role: "proposer",
      profile: "parity",
      authTier: 1,
      proposerSkills: true,
    });
    assert.ok(!argv.includes(FLAG));
    // The rest of the as-is list is unchanged.
    assert.deepEqual([...argv], ["-p", "--dangerously-skip-permissions", "--verbose"]);
  });
});
