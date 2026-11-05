# start-pass — `startPass` of the dsh adapter (feature 130, T073; the parallel-units campaign, step 1)

One WORKER pass of a group through the port operation `startPass`
(`specstride.harness/1`, annex C §C.1). The pass loop keeps its own
single-pass door (`services.runPass`); this is the other door, the one the
group executor calls once per worker (F143-FR-010):

- the pass is PREPARED exactly as the pass loop prepares its own
  (`prepareDshProposerPass` — one preparation, no drift): the argument table
  of the proposer, the settings and their aliases, the permission mode, the
  model reference and its throwaway home;
- the process is started through the process primitive of the kernel
  (F100-FR-234): a session and a process GROUP of its own, standard input
  closed, no shell, the two outputs on files the caller reads when it waits;
- the WRITE ROOT is the working directory — the contained mode
  `workspace-write` roots the writes of the pass at the tree the process
  runs in — so a write root that is not the working directory is refused;
- the SESSION is fresh, under the minted worker id; dsh declares no
  continuation, so a directive that continues a session is refused;
- the WORKER ENVIRONMENT (F143-FR-009) travels as the port's allow-list
  states it and no further name of it;
- the TIME LIMIT of the port input is enforced on the group: SIGTERM at the
  limit, SIGKILL after the grace period.

The capture of `concurrentSessions` — three real `zai/glm-5.3-flash`
sessions at once under one configuration home and one login, with separate
session stores — is pinned in `test/concurrent-sessions.test.ts`
(CT-130-46); the operation itself is pinned with the fake binary of the
conformance suite in `test/start-pass.test.ts` (CT-130-47).
