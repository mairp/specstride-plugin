# Capture plan of the prime adapter (fixture-side mirror)

This is the readable mirror of `specs/138-adapter-prime/contracts/capture-plan.json`
(T001, F138-FR-042). The JSON file stands where the two differ. The five
captures and the two live probes are **prepared here, not run**: each is run
and logged only by the owner's authorization, and the paid ones are logged in
`docs/ecosystem/PROGRESS.md` (paid probes). Until a capture has run, the facts
that wait for it stay `unverified` in `spec.md`.

Pin of every capture and probe: `prime-agent 0.7.3`.

| #            | What                                                                                                                                      | Paid?                                                               | Expected output                                                                                                           | Lands in                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| (1) proposer | One recorded stream of a proposer pass in JSON print mode, prompt on standard input                                                       | **yes**, logged                                                     | Stream schema version 3, success terminal, exit 0, cost and unit readable                                                 | `capture-1-proposer.jsonl`, `capture-1-proposer.exit` |
| (1) critic   | One recorded stream of a critic call in JSON print mode, restricted flag set                                                              | **yes**, logged (the live probe p2)                                 | Stream schema version 3, visible text is the verdict, terminal record decides                                             | `capture-1-critic.jsonl`, `capture-1-critic.exit`     |
| (2)          | The record and the exit code when a provider limit is reached                                                                             | scripted where possible; else one small **paid** call, logged       | Error record of the limit class, exit code 0, class matches `contracts/classifier-entries.json`                           | `capture-2-*`                                         |
| (3)          | Whether the initial record states the tool list                                                                                           | no — read from capture (1)                                          | Finding recorded with date and version                                                                                    | `capture-3-*`                                         |
| (4)          | The resume flag inside a session directory in print mode                                                                                  | one small **paid** call, logged (the live probe beyond capture (1)) | The stream continues the prior session id; flag form and exit code recorded                                               | `capture-4-*`                                         |
| (5)          | The configuration directory follows the home variable; no write to the real home; none of the four kinds of auto-loaded context is loaded | no — scripted check that calls no model, plus reads of capture (1)  | The watched home gains the state, the real home is untouched; no skill, extension, context file or prompt template loaded | `capture-5-*`                                         |

## The two live probes

| Probe | Role     | Paid?   | Logged                                    | Expected                                                                        |
| ----- | -------- | ------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| p1    | proposer | **yes** | `docs/ecosystem/PROGRESS.md`, paid probes | One real call on the pin; a version-3 stream with a success terminal and exit 0 |
| p2    | critic   | **yes** | `docs/ecosystem/PROGRESS.md`, paid probes | One real call on the pin, JSON mode; the terminal record decides                |

Rule (`capture-plan.json`, `rule`): run only by explicit authorization; this
feature runs none. The scripts and expected outputs above are the preparation
this task owns; the running and the logging belong to the owner.
