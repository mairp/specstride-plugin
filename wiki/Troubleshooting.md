# Troubleshooting

Start with the `specstride-doctor` skill.

- **`no feature found`**: there is no directory under `specs/` with a `tasks.md`.
- **`several features found`**: set `SPECSTRIDE_FEATURE`.
- **Exit 2, `stop=max_rejects`**: the critic rejected three attempts. Its reasons are in the output. Fix the spec or the work, then
  run again.
- **`commit blocked: possible secret`**: the phase is approved but not committed. Check the named file. `commits_blocked` in
  the digest counts these, and the run exits 1.
- **A critic that keeps returning nothing usable**: run stops with `critic_unavailable`. Check your Claude login and usage limit.
- **`All phases already approved` after you reset the repository**: approvals live outside the working tree and a `git reset` does not
  clear them. To start over, delete that workspace's directory under `~/.specstride/workspaces/`.
- **`the layer `parallel` is off for the run: <reason>`**: parallel units did not start, and the run continued in order. `no-group`:
  no two `[P]` tasks with disjoint files; `containment`: set `loop.parallel.allow_detect: on` in your user configuration;
  `harness`: the implementer's harness has no tested concurrent sessions (use `dsh`).
