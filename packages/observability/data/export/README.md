# Exporter data (`data/export/`)

The copies of the contracts of feature 128 that the exporter reads. Taken
unmodified from `specs/128-telemetry-export/contracts/` (T003); the copy is the
source of truth for the build, the contract source for the specification.
The consistency test `test/export/data-consistency.test.ts` holds the check that
`contracts/README.md` fixes: every scope, metric, key and form has a requirement
in `specs/128-telemetry-export/spec.md`, and the reverse.

| File | What it holds |
|---|---|
| `span-scopes.tsv` | The sixteen scopes of a span: as-is name, new name, opener, closer, error closers |
| `metrics.tsv` | The fifteen metrics: new name, as-is name, kind, unit |
| `config-keys.tsv` | The nineteen keys of the exporter, their defaults under the two profiles, their environment aliases, flags and their rows of annex X §X.7 |
| `payload-forms.tsv` | The two forms of a payload, per subject |
| `attribute-names.tsv` | The attribute name of every envelope id and of the span attributes the feature introduces |
| `as-is-openers-closers.tsv` | The baseline event that opens or closes each scope |
| `span-state.schema.json` | The delivery-record schema, `specstride.span-state/1` |

## Keys checked against feature 110 and annex X (T004)

`config-keys.tsv` was checked against the key list of feature 110
(`specs/110-config-and-terms/contracts/config-keys.tsv`, rows 154–160 and
249–260), the rows 16, 42, 46 and 97–106 of annex X §X.7 (feature 100,
`specs/100-specstride/contracts/data/parity-profile.json`, which the annex
stands where they differ), the spelling decisions of §K.9 of feature 110 and
the environment aliases of §K.8 of feature 110. Every key, default, value
vocabulary and alias agrees. The differences of presentation, recorded here:

1. **`telemetry.otel.legacyMetricNames` is recorded as a boolean here, not as
   the literals `on`/`off`.** Feature 110 (row 42 of §X.7, DV-058) keeps the
   as-is literals `on` and `off` and states the reading of `off`; this table
   records the resolved values `false`/`false` because the exporter reads the
   profile value, not the literal.
2. **`telemetry.sinkTimeoutMs` is carried here though its owner is feature
   111.** Row 46 of §X.7 (owner 111) is a sink-call time limit the exporter
   honours, so the key sits in this table with `under_parity` `not used`, as
   feature 110's list also carries it.
3. **The seven §K.8 environment aliases** (`SPECSTRIDE_OTEL_TRACES`,
   `RALPH_LOKI_URL`, `RALPH_OTEL_URL`, `RALPH_LOKI_TIMEOUT`,
   `RALPH_OTEL_TIMEOUT`, `RALPH_LOKI_MAX_BATCH_BYTES`,
   `RALPH_OTEL_MAX_BATCH_BYTES`) are read at rank 4 only (F110-FR-020); the
   `RALPH_*_TIMEOUT` pair is seconds, decimal, converted to milliseconds, which
   the `note` column states. The four `SPECSTRIDE_*` switch aliases come from
   annex X §X.8 of feature 100, not from §K.8. `SPECSTRIDE_OTEL_STATE_DIR`
   names no key: it is accepted and has no effect, which the `note` column
   records.
4. **The flags** `--telemetry`, `--loki-url`, `--otel`, `--otel-url` and
   `-j`/`--stream-json` are set at rank 2 under the flag rule of feature 110
   (F128-FR-005): a URL flag given with `-j` sets the matching switch to whether
   that URL was given, and neither `--otel` nor `--telemetry` sets the other
   sink's switch.

`spec.md` names two `telemetry.*` tokens that are not keys of this feature and
that the consistency test excludes deliberately: `telemetry.delivery` and
`telemetry.endpoint` (the delivery-record event and its state directory, which
the exporter produces and honours but reads from no key).

## Notes of the implementation (T019 and T023), beside the T004 notes

**T019 — the four flags reach the exporter through feature 110 (proposal U1).
Feature 110 does NOT hold the rows of U1 yet.** The flag table `§K.10 Short
flags of the baseline` proposed by U1 of `analyze-report.md` (mapping
`--telemetry` → `telemetry.enabled` = true, `--loki-url` →
`telemetry.loki.url`, `--otel` → `telemetry.otel.enabled` = true, `--otel-url`
→ `telemetry.otel.url`, each at rank 2) is not in
`specs/110-config-and-terms/spec.md` at the time of writing.
`src/export/config.ts` therefore takes the enablement and the addresses from
the RESOLVED KEYS ONLY — it parses no argument list (the core never imports
this package, so an argument parser here could never be called). Until
feature 110 lands the rows, a flag is delivered to the exporter by placing the
key and its value in the resolved-key record, exactly as `--set` would; the
gap is recorded here and is upstream (U1), owned by feature 110.

**T023 — the exporter applies NO combination rule of its own. Feature 110 does
NOT hold the rule yet.** The combination rule of F128-FR-005 (`-j` with a URL
flag sets each switch to whether that URL was given; `--otel` never sets
`telemetry.enabled` and `--telemetry` never sets `telemetry.otel.enabled`) is a
FLAG rule — it needs to know which flags were GIVEN, which only the flag layer
knows — so it belongs in feature 110's U1 rule text, not in
`src/export/config.ts`. That module reads `telemetry.enabled` and
`telemetry.otel.enabled` as it finds them and computes no combination. The
parity test `tests/parity/128/pass-loop-flags.test.ts` proves the resolved-key
records the rule must produce; the rule itself is upstream (U1), owned by
feature 110, and this note records that it is not there yet.
