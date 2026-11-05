# Dialects of the generative-model conventions (F128-FR-033)

The option `telemetry.otel.dialects` (key of `config-keys.tsv`, row 100,
default `[]`) names optional sets of attribute names that the exporter ADDS to
a span. `specstride` is always on and is not a dialect; the dialects are
`genai` and `openinference`. A dialect adds attributes and never renames or
drops a base attribute; an unknown dialect name is a configuration error.

## Verification record of the attribute names (T072)

**Every name below is `unverified`.** The verification of a name means: read at
the convention's current public document and record the version that document
carries. This verification was attempted in the proposer pass of 2026-10-07 in
a hermetic environment with no network access to the public documents (no web
search available), so no name could be checked at source. The specification
itself requires the names of both dialects to be marked `unverified`, because
the conventions were reported as moved (the generative-model conventions
formerly under `docs/semconv/gen-ai/` of the OpenTelemetry semantic-conventions
repository, and OpenInference under the `arize-ai/openinference` specification,
were both reported as relocated). No verification date, version or URL is
therefore claimed for any name.

| Dialect         | Attribute                    | Meaning                                             | Status     |
| --------------- | ---------------------------- | --------------------------------------------------- | ---------- |
| `genai`         | `gen_ai.request.model`       | The model the request asked for                     | unverified |
| `genai`         | `gen_ai.response.model`      | The model that answered                             | unverified |
| `genai`         | `gen_ai.usage.input_tokens`  | Input (prompt) token count                          | unverified |
| `genai`         | `gen_ai.usage.output_tokens` | Output (completion) token count                     | unverified |
| `openinference` | `openinference.span.kind`    | The span kind of the convention (`LLM`, `CHAIN`, …) | unverified |
| `openinference` | `llm.token_count.prompt`     | Prompt token count                                  | unverified |
| `openinference` | `llm.token_count.completion` | Completion token count                              | unverified |
| `openinference` | `llm.token_count.total`      | Total token count                                   | unverified |

Versions consulted: **none.** The current version of the OpenTelemetry
generative-model conventions and of the OpenInference specification are
themselves `unverified` for the same reason. When the owner re-runs this
verification against the public documents, each row above flips from
`unverified` to the verified spelling, and the version and URL go into this
table; a row whose spelling the document contradicts is corrected here and in
`src/export/spans/dialects.ts` in the same change.

## What the exporter does with the names

`src/export/spans/dialects.ts` holds the table above as data
(`DIALECT_ATTRIBUTES`), reads `telemetry.otel.dialects`
(`resolveDialects`), and applies the enabled dialects to the attributes of a
closed span (`applyDialects`). The facts the dialects derive from are the
span's own base attributes (`model`, token counts under the exporter's own
names); a dialect adds its attributes only from facts that are already there —
it invents nothing, renames nothing and drops nothing.
