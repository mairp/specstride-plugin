# Captured limit signals, and the classifier rows that wait for them (T001)

Task T001 of `specs/127-quota-budgets-and-pause/tasks.md`. This file is the agreed capture list of
the **Checkpoint** of phase 1 ("the capture list is agreed"). It answers two questions:

1. which captured limit signals exist today, for the five Wave 1 harnesses;
2. which row of the default classifier stays `unverified` until a capture exists, and which capture
   closes it.

`packages/policy/test/captures.test.ts` checks this file against
`specs/127-quota-budgets-and-pause/contracts/classifier.table.json` and
`specs/127-quota-budgets-and-pause/contracts/text-patterns.json`, so the list cannot drift from the
table it describes: every `ruleId` of the table appears below exactly once, and every pattern group
is attributed.

## 1. Which captures exist: none

**No captured limit signal exists for any of the five Wave 1 harnesses.** Every provider fact about
a limit signal in this feature rests on documentation or on a type file, exactly as
`specs/127-quota-budgets-and-pause/spec.md` says in its assumptions ("Every fact about a provider's
limit signal rests on documentation or on a type file only and is `unverified` until the adapter
features capture it").

Two independent readings agree:

- **The adapter specifications.** Each of the five says that the feature itself runs none of its
  captures, and the requirement that carries the classifier entries is `unverified` with the capture
  named as the check that would settle it.
- **The repository.** The five adapter packages hold the campaign skeleton only — `package.json`,
  `tsconfig.json` and `src/index.ts`. There is no fixture tree, no recorded stream and no capture log
  under `packages/adapter-claude/`, `packages/adapter-dsh/`, `packages/adapter-codex/`,
  `packages/adapter-pi/` or `packages/adapter-prime/`.

| Harness | Adapter feature | The capture that would record a limit signal | Paid? | Exists? |
| ------- | --------------- | -------------------------------------------- | ----- | ------- |
| Claude CLI stream | 125 | **Capture C** — a real limit event on the CLI stream (F125-FR-031 status; F125-SC-009) | yes (a real subscription run) | **no** |
| dsh | 130 | **Capture 5** of F130-FR-042 — the message forms of a limit (F130-FR-038) | yes | **no** |
| Codex | 131 | **Capture 1** of F131-FR-037 — the record the stream emits when a login limit is reached, and the exit code (F131-FR-032) | yes, stated so by F131-FR-037 | **no** |
| pi | 134 | **Capture 2** of F134-FR-027 — one recorded stream of a proposer pass and one of a critic call (F134-FR-024) | yes | **no** |
| prime | 138 | **Capture 2** of F138-FR-042 — the record and the exit code when a provider limit is reached (F138-FR-039) | yes | **no** |

Every one of these five captures is a **paid, live, person-run** step: each needs a real call to a
provider against a real subscription or key. Under the owner's out-of-band policy (the campaign scope
note of 2026-10-02) this feature runs none of them, fakes no result, and records them here as
`unverified` with the reason. The adapter specifications say the same independently: F130-FR-042
("none run by this feature, none run by a test or by CI"), F131-FR-037 ("This feature runs none of
them"), F138-FR-042 ("this feature runs none itself").

**What this does not block.** No test and no implementation task of feature 127 waits for a capture.
The characterization tests `CT-127-*` run on hand-written streams, the fake clock and the stubs of
feature 141; a test that would need a captured fixture is a skip with its reason, never a pass
(F131-FR-037 states the rule, and F125-SC-009 says the absence of capture C "blocks the freeze of the
status of F125-FR-031 only, and no test waits for it").

## 2. The classifier rows that stay `unverified`

The default table is `specs/127-quota-budgets-and-pause/contracts/classifier.table.json`, point
`classify`, 19 rows. The column **Kind of fact** is what decides whether a capture is needed:

- a **provider fact** — that some real provider really emits this shape — is `unverified` until a
  capture shows it;
- a **product rule** — a rule this product makes up itself (the stall heuristic, the default row, and
  the `retryable` constant of each class from §Q.1) — needs no capture and is proven by the
  conformance suite of EP-12 and the tests of T013 to T015.

Note that a row's *shape* is testable today in either case: the table evaluator is exercised by
`CT-127-5` with synthetic signal vectors. What a capture settles is only whether the signal a row
matches ever actually arrives from a provider.

| Row (`ruleId`) | Fires on | Gives | Kind of fact | Status | Capture that closes it |
| -------------- | -------- | ----- | ------------ | ------ | ---------------------- |
| `Q-01-quota_window` | `structuredClass = quota_window` | `quota_window`, `structured` | provider fact | **unverified** | 125 capture C — the only Wave 1 harness with a structured quota record is Claude; its limit-event shape rests on the SDK type file and on strings of the binary, which a summarising fetch of the documentation contradicts (F125-FR-031 status) |
| `Q-01-quota_credit` | `structuredClass = quota_credit` | `quota_credit`, `structured` | provider fact | **unverified** | 125 capture C (the billing error and the credit-required code of F125-FR-031) |
| `Q-01-rate_limit_transient` | `structuredClass = rate_limit_transient` | `rate_limit_transient`, `structured` | provider fact | **unverified** | 125 capture C (the retry event whose category is a rate limit, F125-FR-031) |
| `Q-01-overload` | `structuredClass = overload` | `overload`, `structured` | provider fact | **unverified** | 125 capture C (status 529, F125-FR-031) |
| `Q-01-auth` | `structuredClass = auth` | `auth`, `structured` | provider fact | **unverified** | 125 capture C; 138 capture 2 for the reader class `provider_auth` (F138-FR-039) |
| `Q-01-context_window` | `structuredClass = context_window` | `context_window`, `structured` | provider fact | **unverified** | 125 capture C; 130 capture 5 for the code `CONTEXT_WINDOW_EXCEEDED` (F130-FR-038) |
| `Q-01-agent_failure` | `structuredClass = agent_failure` | `agent_failure`, `structured` | product rule | verified by test | none — the class is the product's own name for a failed harness process (§Q.1); it is the identity row that lets an adapter pass it through |
| `Q-01-provider_other` | `structuredClass = provider_other` | `provider_other`, `structured` | product rule | verified by test | none — the catch-all class of §Q.1, passed through from an adapter |
| `Q-02` | `httpStatus ∈ {402}` | `quota_credit`, `status` | provider fact | **unverified** | 125 capture C (a billing error); 131 capture 1 (the body code `insufficient_quota` of F131-FR-033). 402 itself rests on documentation only |
| `Q-03` | `httpStatus ∈ {401, 403}` | `auth`, `status` | provider fact | **unverified** | 131 capture 1 (status 401 named by F131-FR-033); 125 capture C |
| `Q-04` | `httpStatus ∈ {529, 503}` | `overload`, `status` | provider fact | **unverified** | 125 capture C (529 is the Anthropic overload status named by F125-FR-031); 503 rests on documentation only |
| `Q-05` | `httpStatus = 429` | `rate_limit_transient`, `status` | provider fact | **unverified** | 131 capture 1 (status 429 without the exhausted-credit body code, F131-FR-033); 125 capture C |
| `Q-06` | `textGroup = window` | `quota_window`, `text` | provider fact | **unverified** | all five: 125 capture C (`session limit`, `weekly limit`, `opus limit`, `sonnet limit`), 130 capture 5 (`QUOTA:`, `RATE_LIMIT:`), 131 capture 1 (`try again in`), 134 capture 2, 138 capture 2 (a limit with a reset time in the message) |
| `Q-07` | `textGroup = credit` | `quota_credit`, `text` | provider fact | **unverified** | 125 capture C (`credit balance is too low`, `billing_error`); 131 capture 1 (`insufficient_quota`); 130 capture 5 (a `QUOTA` message that says credit, F130-FR-038) |
| `Q-08` | `textGroup = auth` | `auth`, `text` | provider fact | **unverified** | 130 capture 5 (`INVALID_CREDENTIAL`); 125 capture C; 138 capture 2 |
| `Q-09` | `textGroup = overload` | `overload`, `text` | provider fact | **unverified** | 125 capture C. No adapter specification names an overload *text* form; the three substrings rest on documentation only |
| `Q-10` | `textGroup = context` | `context_window`, `text` | provider fact | **unverified** | 130 capture 5 (`CONTEXT_WINDOW_EXCEEDED`); 125 capture C (`prompt is too long`) |
| `Q-11` | `stalled = true` | `quota_window`, `stall` | product rule | verified by test | none — the stall watchdog is this product's own. Because the confidence is `stall`, the pause follows only after the confirming probe (§Q.2), so the heuristic never pauses a run on its own |
| `Q-99` | default row | `provider_other`, `text` | product rule | verified by test | none — F127-FR-001 fixes it: an input that matches no entry is `provider_other` with the confidence `text` |

**Count**: 19 rows. **15 stay `unverified`** until a capture exists (`Q-01-quota_window`,
`Q-01-quota_credit`, `Q-01-rate_limit_transient`, `Q-01-overload`, `Q-01-auth`,
`Q-01-context_window`, `Q-02` to `Q-10`). **4 are product rules** that need no capture
(`Q-01-agent_failure`, `Q-01-provider_other`, `Q-11`, `Q-99`).

### The pattern set

Every group of `specs/127-quota-budgets-and-pause/contracts/text-patterns.json` is `unverified`; the
file says so itself ("Every entry is unverified: it rests on documentation or on a summary of a type
file (R14 B4, B8, B13) and must be checked against a captured stream by the harness adapter
feature"). The groups and the harness each one comes from:

| Group | Feeds row | Harnesses the substrings come from | Captures that close it |
| ----- | --------- | ---------------------------------- | ---------------------- |
| `window` | `Q-06` | Claude, dsh, Codex, pi, prime | 125 C, 130 5, 131 1, 134 2, 138 2 |
| `credit` | `Q-07` | Claude, Codex, dsh | 125 C, 131 1, 130 5 |
| `auth` | `Q-08` | dsh, Claude, prime | 130 5, 125 C, 138 2 |
| `overload` | `Q-09` | Claude (documentation only) | 125 C |
| `context` | `Q-10` | dsh, Claude | 130 5, 125 C |

### The requirements that carry an `unverified` status for this reason

These are the statuses already written in `specs/127-quota-budgets-and-pause/spec.md`; this file
does not add to them, it collects them:

| Requirement | What waits | Capture |
| ----------- | ---------- | ------- |
| F127-FR-001 | the quota signal of every Wave 1 harness is captured in a fixture by its adapter feature | all five |
| F127-FR-002 | a captured limit event of the Claude stream and of each other Wave 1 harness | all five |
| F127-FR-007 | the fields a host hook receives on a limit (R3, R14 open question 7) | a host capture, feature 113 |
| F127-FR-008 | the quota signals of dsh, Codex, pi and prime are captured by their adapter features | 130 5, 131 1, 134 2, 138 2 |
| F127-FR-038 | the limit and warning events of the Claude stream, captured on a real subscription run | 125 C |

### Agreement

The list is agreed on the evidence above: the five adapter specifications name the captures and say
their features run none of them, and the five adapter packages on disk hold no capture. Nothing in
this feature's own task list produces a capture — `tasks.md` says so under **Path Conventions**:
"this feature inherits none of its own. The captures of the limit signal of Claude, dsh, Codex, pi
and prime belong to the adapter features 125, 130, 131, 134 and 138; T001 confirms them first."
