# Costs and limits

Every attempt makes at least two model calls, and the `DIGEST` line reports `cost_usd` for them where the provider reports a cost; `dsh` providers report none, so it reads 0 there.

| Variable                  | Meaning                               | Default       |
| ------------------------- | ------------------------------------- | ------------- |
| `SPECSTRIDE_MODEL`        | Claude model for both roles           | `sonnet`      |
| `SPECSTRIDE_PROPOSER`     | `claude`, or `dsh:<provider>/<model>` | `claude`      |
| `SPECSTRIDE_CRITIC`       | `claude`, or `dsh:<provider>/<model>` | `claude`      |
| `SPECSTRIDE_CRITIC_MODEL` | Model for the critic                  | same as above |
| `SPECSTRIDE_FEATURE`      | Feature directory under `specs/`      | the only one  |

Parallel units, in `~/.config/specstride/config.yaml`:

| Key                          | Meaning                                                                                | Default |
| ---------------------------- | -------------------------------------------------------------------------------------- | ------- |
| `loop.parallel.units`        | Run disjoint `[P]` tasks at once                                                       | `off`   |
| `loop.parallel.allow_detect` | Allow groups where the harness cannot fence workers; read from user configuration only | `off`   |
| `loop.parallel.workers`      | Workers per group                                                                      | `2`     |

The README lists the current limits.
