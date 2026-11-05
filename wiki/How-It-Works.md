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
5. **Rejection.** The feedback goes to the next attempt. Three attempts on a phase ends the run with exit 2.

Records live in `~/.specstride/workspaces/<hash>/`. Running again continues from the approved phases. If the engine is
killed, its passes end with it; the next start carries an interrupted phase or parallel group to its end from these records.
The `stop` verb asks a running engine to end at the next safe boundary.

## Parallel units (opt-in)

With `loop.parallel.units: on` and `loop.parallel.allow_detect: on` in `~/.config/specstride/config.yaml`, tasks marked `[P]`
whose files are disjoint run at once, each in its own worker tree, while the project's files stay untouched. At the barrier
the engine audits each worker's change against its files, merges the changes, ticks the tasks and runs the checks itself, with no
model call, before the critic sees the phase. Tasks whose files overlap are refused with the reason printed, and run in order.
Groups run only when the implementer runs on `dsh`; otherwise the layer stays off and the run continues in order. The
`[LOOP]` line at the end of a run says `parallel=on` or `off`, with the reason.
