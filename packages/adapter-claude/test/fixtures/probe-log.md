# Release probe log — feature 125 (T076)

Date: 2026-10-28 · Host: Linux · Pin: `claude` 2.1.284 (floor 2.1.259, `verifiedOn` 2026-09-29)
Profile: the default profile of `specs/125-adapter-claude/contracts/argument-table.md`

## Status of the probe

| Part                                                                | Status       | Reason                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live call, proposer role (paid)                                     | `unverified` | Owner ruling of 2026-09-30: a live, paid model call is never run and never faked inside a run. Recorded in `.specstride/features/125-adapter-claude/verification-record.md`, row T076. |
| Live call, critic role (paid)                                       | `unverified` | Same ruling.                                                                                                                                                                           |
| Hermetic part (no login, no key, no model call, no process started) | done         | This log and `scripts/probe-hermetic.ts`.                                                                                                                                              |

Exactly one live call per role is foreseen by T076 and no other paid call; both
stay `unverified` until the operator runs them by hand.

## What the hermetic part confirms (from `data/` only)

Source: `packages/adapter-claude/scripts/probe-hermetic.ts`, run 2026-10-28,
exit 0, output below. It assembles both roles' argument lists from
`data/argument-table.json` at the pin and asserts on them; it makes no network
call and starts no process.

1. **The flags combine without conflict.** No flag appears twice on either
   list; exactly one `--permission-mode` per list; the proposer carries
   `acceptEdits`, the critic `dontAsk` with `--permission-prompts none`; no
   `--resume`, `--continue` or `--fork-session` on either list; the bypass
   flag `--dangerously-skip-permissions` is absent even where the
   precondition holds, because no consumer set `sandbox.permissionMode` in
   user configuration (F125-FR-012, CQ-183).
2. **The session id is echoed with nothing persisted.** Both lists carry
   `--session-id 7e5d9c2b-4a3f-4918-8276-4561237890ab` (minted) and
   `--no-session-persistence` (F125-FR-013, F125-FR-014).
3. **The budget cap (F125-FR-023, CQ-146).** The data holds
   `perCallUsd: null` — the default cap of the critic is NONE until the paid
   probe fixes it; the doctor warns (`budgetCapMissing`); the call is bounded
   by one turn (`--max-turns 1`), `maxTokens` 2048 and a prompt size of
   200,000 tokens. Under a subscription (auth tier 1) the CLI list carries no
   `--max-budget-usd` while no cap value exists; the cap check
   (`budget-exceeded`) refuses a call whose budget exceeds the cap once a
   cap is set. **What the default cap of the critic is: none, pending the
   paid probe (CQ-146).**
4. The parity context-window fallback is 200,000 (F125-FR-027).

## Raw output of `node scripts/probe-hermetic.ts` (2026-10-28, exit 0)

```text
FLAG-COMBINE OK: proposer argv = ["-p","--output-format","stream-json","--verbose","--disable-slash-commands","--model","claude-sonnet-4-5","--effort","medium","--permission-mode","acceptEdits","--allowedTools","Read,Grep,Glob","--permission-prompts","none","--safe-mode","--strict-mcp-config","--session-id","7e5d9c2b-4a3f-4918-8276-4561237890ab","--no-session-persistence","--settings","{\"sandbox\": {\"enabled\": true, \"allowUnsandboxedCommands\": false, \"failIfUnavailable\": true}}"]
FLAG-COMBINE OK: critic argv = ["-p","--output-format","stream-json","--verbose","--model","claude-opus-4-8","--tools","","--disallowedTools","mcp__*","--strict-mcp-config","--safe-mode","--disable-slash-commands","--session-id","7e5d9c2b-4a3f-4918-8276-4561237890ab","--no-session-persistence","--max-turns","1","--permission-mode","dontAsk","--permission-prompts","none"]
SESSION-ECO OK: session id 7e5d9c2b-4a3f-4918-8276-4561237890ab echoed; --no-session-persistence on; no resume/continue/fork argument
BUDGET OK: perCallUsd = null; maxTokens = 2048; oneTurn = 1; promptSizeTokens = 200000
WINDOW OK: parity fallback 200000
HERMETIC PROBE COMPLETE — the live (paid) part stays `unverified`.
```

## What only the paid part can fix (open, `unverified`)

- That the pinned binary accepts the combination on a live call (the
  introspection of 2026-09-29 checked `--help` only).
- That the harness echoes the session id in its stream and persists nothing
  in the real home on a live pass (capture E, T004, is `unverified` too).
- The value of the default per-call cap of the critic under a subscription
  (CQ-146): `data/models.json` keeps `perCallUsd: null` until then, and the
  doctor check warns.

## T077 — data/ re-checked against this log (2026-10-28)

No capture (T001 to T004) and no live probe call has been logged — all are
`unverified` — so there is nothing new to fill into `data/`. The values the
data already holds agree with this log and with the contract:

- pins: `data/argument-table.json` `pin` = `{cli: 2.1.284, floor: 2.1.259,
verifiedOn: 2026-09-29}` (the introspection of 2026-09-29, the only
  non-paid source);
- flag combinations: `data/argument-table.json` matches the contract tables
  and the assembled lists above;
- default cap: `data/models.json` `budgetCaps.perCallUsd` = `null` (CQ-146),
  `maxTokens` 2048, `oneTurn` 1, `promptSizeTokens` 200000;
- SDK pins: `data/terms-rows.json` `versionRange` `>=0.3.284 <0.4.0`,
  `testedVersion` 0.3.284 (CQ-148).

The doctor checks were re-run after this (2026-10-28):
`node --test test/characterization/doctor-checks.test.ts` — 13 pass, 0 fail
(all seven `harness.claude.*` checks, hermetic, no paid call, no secret
value). No data value changed.
