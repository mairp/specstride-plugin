# Specstride

**Development governance for coding agents: every phase reviewed, signed and committed.**

An agent that grades its own work says "done" when it isn't. Specstride is a Claude Code plugin that takes a Spec Kit feature to done, phase by phase, unattended: implement, verify, review, commit, resume. A separate reviewer must approve each phase before the run moves on, and every approval leaves a signed record and its own commit.

Provider-agnostic. Open source. Runs on your machine. Your models, your keys.

## Install

```
/plugin marketplace add mairp/specstride-plugin
/plugin install specstride@specstride-marketplace
```

Then, in a git repository with `specs/NAME/tasks.md` and a test script in `package.json`, say:

> Run Specstride on the feature in this repo.

## Built for unattended work

- **Kill the engine mid-run and nothing of it survives.** SIGKILL the engine in the middle of a phase and no engine process is left running. Start it again and the run picks up where it stopped.
- **Approved means committed.** Every approved phase becomes its own commit. If a commit is blocked, the run never reports success: the engine exits 1 and says so.
- **A clean stop.** The `stop` verb of the `specstride` CLI that the plugin bundles ends the run at the next safe boundary: the workers finish their pass, the merge check runs, the record closes whole, no survivor.
- **The reviewer can come from any provider your DeepSeek Harness (`dsh`) reaches.**
- **Secrets held back.** Credentials are redacted from what the reviewer reads, and a credential in the change blocks the commit.

## A real run

The engine's own output, trimmed, from a stored log: the phase's tests passed, the reviewer still said no, and the run came back and finished.

```
===== PHASE 1 — the overlapping work  (2026-11-04T03:21:24.358Z) =====
[001-par-overlap] phase 1 attempt 1: proposer started
[001-par-overlap] verification: npm test -> passed
[001-par-overlap] phase 1 attempt 1: rejected
----- phase 1 REJECTED on attempt 1/3 -----
[001-par-overlap] phase 1 attempt 2: proposer started
[001-par-overlap] verification: npm test -> passed
[001-par-overlap] phase 1 attempt 2: approved
===== PHASE 1 APPROVED (attempt 2) =====
----- git checkpoint: phase 1 approved -----
```

## Parallel units, opt-in

Mark tasks `[P]` in your Spec Kit `tasks.md` and turn the layer on. Tasks whose files are disjoint run at once, each in its own worker tree, and the project's files are untouched while they run. The engine merges their work and runs the phase's checks before the reviewer sees the phase. Tasks whose files overlap are refused, with the reason printed, and run in order.

Turn it on in your user configuration, `~/.config/specstride/config.yaml`:

```yaml
loop:
  parallel:
    units: on
    allow_detect: on
```

Groups run only when the implementer runs on dsh, the one harness whose concurrent sessions are tested; with any other harness the layer stays off and the run continues in order. `allow_detect` lets groups run where the harness cannot fence each worker into its own files: the run then reports `protection=detect`, and a worker that writes outside its files is caught by the audit after the group instead of being prevented. Specstride reads `allow_detect` from this user file only.

## Your models, your keys

Choose the implementer and the reviewer independently, on any provider and model your DeepSeek Harness (`dsh`) reaches. By default both are separate Claude sessions.

```
SPECSTRIDE_PROPOSER=dsh:<provider>/<model>
SPECSTRIDE_CRITIC=dsh:<provider>/<model>
```

The loop stays the same whichever you choose: same gates, same records, same commits.

## How it works

1. The implementer works through the phase's tasks.
2. The engine runs the tests itself.
3. The reviewer — a separate session, with no tools — reads the actual change against the tasks and answers with a one-time nonce.
4. Approved: tasks ticked, one commit, signed record. Rejected: back to the implementer with the reasons, up to 3 attempts.

## Who it's for

People who leave agents running on real work and need to trust the result when they come back.

## Requirements

- Linux. macOS is not verified: no Mac has run it.
- Node 22+, git, Claude Code
- Spec Kit feature specs
- Your own subscription or API key for the models you choose

**Costs.** Each phase makes at least two model calls on your own subscription or key, so a run costs more than a single session. The `DIGEST` line reports the cost where the provider reports it — dsh providers report none, so it shows 0 there.

## Roadmap

Native Codex and Pi roles.

## Links

- [Wiki](wiki/Home.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md) — the proposer runs with your permissions

Apache-2.0.

Specstride is not affiliated with Anthropic.
