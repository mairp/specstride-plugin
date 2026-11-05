# How it works

For each phase:

1. **Proposer.** A fresh implementer session (Claude by default, or any `dsh` provider) gets the spec, the plan, the phase's tasks and any feedback from the critic, and writes
   its evidence to `.specstride/`, which is excluded from your commits through `.git/info/exclude`.
2. **Verification.** The engine runs `npm test` itself. A failure sends the phase back without calling the critic. With no
   `test` script, this step is off.
3. **Critic.** A new session with no tools gets the tasks, the claim, the test output, and the change, including the contents of
   new files, with credentials redacted. It must answer with a one-time nonce, so text planted in the evidence cannot pass
   for its verdict.
4. **Approval.** The engine writes a signed record and reads it back, restores and ticks `tasks.md` itself, scans the change for
   credentials and commits. If a credential blocks the commit, the run ends with exit 1, never 0.
5. **Rejection.** The feedback goes to the next attempt, and when it names a new set of unmet tasks, a diagnosis runs first
   (below). Three attempts on a phase ends the run with exit 2.

Records live in `~/.specstride/workspaces/<hash>/`. Running again continues from the approved phases. If the engine is
killed, its passes end with it; the next start carries an interrupted phase or parallel group to its end from these records.
The `stop` verb asks a running engine to end at the next safe boundary.

## When a phase is stuck

A rejected phase is not simply started again. When the critic's feedback names a set of unmet tasks the phase has not been
diagnosed for yet, the **diagnostician** runs once: a fresh session, never the implementer's, on the critic's harness unless
`SPECSTRIDE_DIAGNOSTICIAN_HARNESS` names another. It reads the phase from the outside and writes a hint. It gives no verdict,
and nothing it says approves or rejects the phase.

The next attempt is then an **accelerated** one: the implementer (or the harness in `SPECSTRIDE_ACCELERATOR_HARNESS`) gets a
narrowed prompt with the hint as its first instruction, aimed at the unmet tasks. It counts as a normal attempt, the engine runs
the tests and the critic judges it like any other, and two accelerated attempts never follow each other. The run log shows both:

```
----- diagnostician: phase 1 attempt 1 (unmet set changed) -----
----- accelerator: phase 1 attempt 2/3 (dsh) — acting on the hint for T002,T003 -----
```

Both are on by default. `SPECSTRIDE_DIAGNOSTICIAN=false` or `SPECSTRIDE_ACCELERATOR=false` turns one off.

## Parallel units (opt-in)

With `loop.parallel.units: on` and `loop.parallel.allow_detect: on` in `~/.config/specstride/config.yaml`, tasks marked `[P]`
whose files are disjoint run at once, each in its own worker tree, while the project's files stay untouched. At the barrier
the engine audits each worker's change against its files, merges the changes, ticks the tasks and runs the checks itself, with no
model call, before the critic sees the phase. Tasks whose files overlap are refused with the reason printed, and run in order.
Groups run only when the implementer runs on `dsh`; otherwise the layer stays off and the run continues in order. The
`[LOOP]` line at the end of a run says `parallel=on` or `off`, with the reason.
