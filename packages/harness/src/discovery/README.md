# packages/harness/src/discovery/

The discovery core of feature 146 (phases 2 to 6 of
`specs/146-harness-discovery/tasks.md`). Phase 1 (T003) creates this
directory; the modules arrive with their own tasks:

| Module               | Task | What it is                                                                    |
| -------------------- | ---- | ----------------------------------------------------------------------------- |
| `guarded-reader.ts`  | T006 | The guarded reader: the only way discovery touches the machine (F146-FR-004). |
| `probes/runner.ts`   | T008 | The bounded probe runner (F146-FR-014).                                       |
| `types.ts`           | T008 | The type of a candidate.                                                      |
| `sources/*.ts`       | T019 | The seven source readers (F146-FR-002 and neighbours).                        |
| `metadata-client.ts` | T020 | GET only, redirects refused (F146-FR-008).                                    |
| `discover.ts`        | T022 | The two passes and the switches.                                              |

The data this code reads ships in `data/`: `probe-limits.json` (the limits
and caps of the probes, T003) and `descriptors/*.yaml` (the bundled harness
descriptors, read by the logical name `package:harness:<id>`, loader in
`../descriptor/bundled.ts`).
