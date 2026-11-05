# Live probe of the critic of form (b) (T050)

PAID. One critic call of form (b) — the direct call with an API key
(F131-FR-038). Not run by this feature: the owner ruling of 2026-09-30
leaves every paid, live and person-run step to an authorized person, out of
band. The status in `probe.json` is `unverified` with that reason until the
log lands.

- `procedure.sh` — the scripted probe, guarded by `AUTHORIZED=yes` and by a
  key being set; it never runs here.
- `probe.json` — the record: status, reason, harness pin, and, once the
  probe has run, the log files it must list.

No test, no CI job and no run of the runtime waits for this probe or
executes it (F131-FR-038; Principle XII). The hermetic part of T050 — the
settings resolution (address, key reference, model), the window rule of both
profiles, the budget cap and the call through the generic `openai-chat`
client — is in `packages/adapter-codex/src/critic-direct.ts` and its tests,
against the fake endpoint of `tests/conformance/codex/fake-endpoint.ts`.
