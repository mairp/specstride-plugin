# @specstride/pipeline

The pipeline runtime of the Specstride product: the stage executor inside the
runtime root, the launch checks, the `supervise` verbs, and both relaunch
classifier tables (feature 123; owners 107 and 123).

## System requirements

- Node.js 22 or later. No native dependencies; the package installs with npm.

### Optional

- **`script`** — the terminal tool of the platform (on Linux, `script` from
  `util-linux` (BSD utils)). It is an *optional* system requirement: a stage
  of kind `specstride` shows its output through a terminal when colour is on
  and standard output is not a terminal, and `script` is how the product
  obtains that terminal. The product does not ship the tool. Where it is
  absent, cannot be started or ends before the child starts, the stage runs
  its child through a pipe as with colour off, the run goes on, the pipeline
  entry prints one `[WARN]` line that names the tool, and the doctor reports
  a warning that is never launch-blocking (`pipeline.terminal-tool`).

## Layout

- `src/entry/` — arguments, start-up refusals, dry run, lock, engine request
- `src/executor/` — stage loop, retry, child runner, outcome, state, events
- `src/kinds/`, `src/checks/` — the two open registries of EP-19
- `src/launch-checks/` — the six launch checks and the doctor registrations
- `src/relaunch/` — both classifier tables, the budget, the owner switch
- `src/supervisor/` — the `supervise` verbs, observation, cadence, lines
- `src/output/` — the line table, the digest, the data loader
- `data/` — the data files copied from `specs/123-pipeline-runtime-and-supervisor/contracts/`
