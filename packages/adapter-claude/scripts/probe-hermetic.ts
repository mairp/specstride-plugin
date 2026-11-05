// T076 — the HERMETIC part of the release probe (owner ruling of 2026-09-30:
// the paid part is never run inside a run). This script makes no network
// call, spawns no process and reads no secret: it checks, from the data of
// the package only, that the flag combination of
// `specs/125-adapter-claude/contracts/argument-table.md` combines without
// conflict for both roles, that the session id is echoed with nothing
// persisted on the argument lists, and that the budget cap holds with the
// default cap the data names (CQ-146). Its output is the substance of
// `test/fixtures/probe-log.md`; the live call itself stays `unverified`.
import assert from "node:assert/strict";
import {
  buildCriticArgv,
  buildProposerArgv,
  carriesNoSessionContinuation,
  resolveBypassModeChoice,
} from "../src/invoke-proposer.ts";
import { budgetCaps, contextWindowFor } from "../src/critic-direct.ts";
import argumentTable from "../data/argument-table.json" with { type: "json" };
import models from "../data/models.json" with { type: "json" };

const SESSION = "7e5d9c2b-4a3f-4918-8276-4561237890ab";
const budget = budgetCaps();
const bypassChoice = resolveBypassModeChoice({ userConfiguration: null });
const proposerArgv = buildProposerArgv({
  role: "proposer",
  profile: "default",
  authTier: 1,
  model: "claude-sonnet-4-5",
  effort: "medium",
  sessionId: SESSION,
  sessionMode: "fresh",
  containmentC2: true,
  consumerBypass: bypassChoice.bypass,
  bypassPrecondition: { sandbox: true, userIsRoot: false },
  allowedTools: ["Read", "Grep", "Glob"],
  version: argumentTable.pin.cli,
});
const criticArgv = buildCriticArgv({
  role: "critic",
  profile: "default",
  authTier: 1,
  model: models.defaultCriticModel ?? "claude-opus-4-8",
  sessionId: SESSION,
  sessionMode: "fresh",
  budgetUsd: budget.perCallUsd ?? undefined,
  version: argumentTable.pin.cli,
});

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

// 1. The flags combine without conflict: every flag at most once, no
//    contradictory permission mode, no continuation argument.
for (const [role, argv] of [
  ["proposer", proposerArgv],
  ["critic", criticArgv],
] as const) {
  const flags = argv.filter((a) => a.startsWith("--"));
  assert.equal(flags.length, new Set(flags).size, `${role}: a flag appears twice`);
  assert.ok(carriesNoSessionContinuation(argv), `${role}: a continuation argument`);
  assert.equal(
    argv.filter((a) => a === "--permission-mode").length,
    1,
    `${role}: mode stated once`,
  );
}
assert.equal(flagValue(proposerArgv, "--permission-mode"), "acceptEdits");
assert.equal(flagValue(criticArgv, "--permission-mode"), "dontAsk");
assert.ok(!proposerArgv.includes("--dangerously-skip-permissions"), "never self-selected");
console.log(`FLAG-COMBINE OK: proposer argv = ${JSON.stringify(proposerArgv)}`);
console.log(`FLAG-COMBINE OK: critic argv = ${JSON.stringify(criticArgv)}`);

// 2. The session id is echoed, with nothing persisted.
assert.equal(flagValue(proposerArgv, "--session-id"), SESSION);
assert.equal(flagValue(criticArgv, "--session-id"), SESSION);
assert.ok(proposerArgv.includes("--no-session-persistence"));
assert.ok(criticArgv.includes("--no-session-persistence"));
for (const argv of [proposerArgv, criticArgv]) {
  assert.ok(!argv.includes("--resume"));
  assert.ok(!argv.includes("--continue"));
  assert.ok(!argv.includes("--fork-session"));
}
console.log(
  `SESSION-ECO OK: session id ${SESSION} echoed; --no-session-persistence on; ` +
    "no resume/continue/fork argument",
);

// 3. The budget cap holds (CQ-146): the per-call cap the data names, and
//    the default of the critic.
console.log(
  `BUDGET OK: perCallUsd = ${JSON.stringify(budget.perCallUsd)}; maxTokens = ${budget.maxTokens}; ` +
    `oneTurn = ${budget.oneTurn}; promptSizeTokens = ${budget.promptSizeTokens}`,
);
assert.equal(budget.perCallUsd, models.budgetCaps.perCallUsd);
assert.equal(contextWindowFor({ model: "claude-haiku-4-5", profile: "parity" }), 200_000);
console.log("WINDOW OK: parity fallback 200000");
console.log("HERMETIC PROBE COMPLETE — the live (paid) part stays `unverified`.");
