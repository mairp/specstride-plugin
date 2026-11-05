# Live probe of the critic of form (a) (T044)

PAID. One critic call under the harness's read-only sandbox, with a seeded
write, a seeded network attempt and a seeded read of a planted file at a
withheld location (F131-FR-017, F131-FR-038). Not run by this feature: the
owner ruling of 2026-09-30 leaves every paid, live and person-run step to an
authorized person, out of band. The status in `probe.json` is `unverified`
with that reason until the log lands.

- `procedure.sh` — the scripted probe, guarded by `AUTHORIZED=yes`.
- `probe.json` — the record: status, reason, harness pin, and, once the
  probe has run, the log files it must list.

No test, no CI job and no run of the runtime waits for this probe or
executes it (F131-FR-038; Principle XII). The hermetic part of T044 — the
invocation of form (a), the withheld-paths check, the read-denial probe and
the proof, and the refusals the mode provides against the fake binary — is
in `packages/adapter-codex/src/critic-readonly.ts` and its tests.
