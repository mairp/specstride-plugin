/**
 * T073 — CT-128-15, the optional attribute dialects (F128-FR-033; surface:
 * telemetry).
 *
 * F128-FR-033: *The option `telemetry.otel.dialects` MUST name optional sets
 * of attribute names for generative-model conventions: `specstride` (always
 * on), `genai` and `openinference`. An enabled dialect MUST add attributes to
 * a span and MUST never rename or drop a base attribute. Under `genai` the
 * attributes MUST be the token and model attributes of the generative-model
 * conventions, and under `openinference` the span kinds and the token count
 * attributes of that convention. An unknown dialect name MUST be a
 * configuration error.*
 *
 * The test proves the three clauses on real spans built by the
 * `SpanBuilder`: with dialects on, a closed span carries its base attributes
 * UNCHANGED plus the added ones; with the same builder and no dialects, none
 * of the dialect names appear; an unknown name raises the configuration
 * error.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ALWAYS_ON_DIALECT,
  DIALECT_ATTRIBUTES,
  KNOWN_DIALECTS,
  UnknownDialectError,
  applyDialects,
  resolveDialects,
} from "@specstride/observability/export/spans/dialects";
import { SpanBuilder } from "@specstride/observability/export/spans/builder";

/** A pinned id source (span ids stay deterministic). */
let spanSeq = 0;
function pinnedRng(n: number): Buffer {
  spanSeq += 1;
  return Buffer.concat([Buffer.from([spanSeq & 0xff]), Buffer.alloc(n - 1, 0x0c)]);
}

const ns = (step: number) => (BigInt(step) * 1_000_000n).toString();

function builder(dialects: readonly string[]): SpanBuilder {
  spanSeq = 0;
  return new SpanBuilder({
    form: "as-is",
    runId: "r-dialects",
    traceId: "b".repeat(32),
    rng: pinnedRng,
    nowNanos: () => 1_000_000n,
    dialects: resolveDialects(dialects),
  });
}

describe("CT-128-15 — the dialects add attributes and never touch a base attribute", () => {
  it("an enabled dialect adds its attributes to a closed span (F128-FR-033)", () => {
    const b = builder(["genai", "openinference"]);
    b.feed({
      name: "iter_start",
      data: { iter: 1, model: "m1", input_tokens: 10, output_tokens: 4 },
      timeNanos: ns(1),
    });
    b.feed({ name: "iter_done", data: {}, timeNanos: ns(2) });
    const span = b.closedSpans().find((s) => s.name === "iter 1");
    assert.ok(span, "the pass span closed");
    // The generative-model conventions: model and token attributes.
    assert.equal(span.attributes["gen_ai.request.model"], "m1");
    assert.equal(span.attributes["gen_ai.response.model"], "m1");
    assert.equal(span.attributes["gen_ai.usage.input_tokens"], 10);
    assert.equal(span.attributes["gen_ai.usage.output_tokens"], 4);
    // The OpenInference convention: span kind and token counts.
    assert.equal(span.attributes["openinference.span.kind"], "LLM");
    assert.equal(span.attributes["llm.token_count.prompt"], 10);
    assert.equal(span.attributes["llm.token_count.completion"], 4);
    assert.equal(span.attributes["llm.token_count.total"], 14);
  });

  it("a dialect never renames and never drops a base attribute (F128-FR-033)", () => {
    const base = { model: "m1", input_tokens: 10, output_tokens: 4, specstride_scope_x: 1 };
    const baseRecord = { ...base, "specstride.scope": "pass" } as Record<
      string,
      string | number | boolean
    >;
    const withDialects = applyDialects(baseRecord, ["genai", "openinference"]);
    // Every base key survives with its own value and its own name.
    for (const [key, value] of Object.entries(baseRecord)) {
      assert.ok(Object.hasOwn(withDialects, key), `base attribute ${key} survives`);
      assert.equal(withDialects[key], value, `base attribute ${key} keeps its value`);
    }
    // The dialect names are pure additions: the key set only grows.
    assert.deepEqual(
      Object.keys(withDialects)
        .filter((k) => !Object.hasOwn(baseRecord, k))
        .sort(),
      Object.values(DIALECT_ATTRIBUTES.genai)
        .concat(Object.values(DIALECT_ATTRIBUTES.openinference))
        .sort(),
    );
  });

  it("a base attribute colliding with a dialect name keeps the BASE value", () => {
    const withDialects = applyDialects({ model: "m1", "gen_ai.request.model": "the-base-value" }, [
      "genai",
    ]);
    assert.equal(withDialects["gen_ai.request.model"], "the-base-value");
  });

  it("without dialects no span carries a dialect attribute", () => {
    const b = builder([]);
    b.feed({
      name: "iter_start",
      data: { iter: 2, model: "m1", input_tokens: 3 },
      timeNanos: ns(1),
    });
    b.feed({ name: "iter_done", data: {}, timeNanos: ns(2) });
    for (const span of b.closedSpans()) {
      for (const names of [DIALECT_ATTRIBUTES.genai, DIALECT_ATTRIBUTES.openinference]) {
        for (const name of Object.values(names)) {
          assert.equal(name in span.attributes, false, `${name} absent without the dialect`);
        }
      }
    }
  });

  it("an unknown dialect name is a configuration error (F128-CT-15)", () => {
    assert.throws(() => resolveDialects(["genai", "wiggum"]), UnknownDialectError);
    assert.throws(() => resolveDialects("genai"), UnknownDialectError);
    assert.throws(() => resolveDialects([42]), UnknownDialectError);
    try {
      resolveDialects(["ralph"]);
      assert.fail("expected a throw");
    } catch (error) {
      assert.ok(error instanceof UnknownDialectError);
      assert.equal(error.dialect, "ralph");
      assert.match(error.message, /unknown telemetry dialect/);
    }
  });

  it("the known names resolve; specstride is always on and never a dialect", () => {
    assert.deepEqual(resolveDialects(undefined), []);
    assert.deepEqual(resolveDialects(null), []);
    assert.deepEqual(resolveDialects([]), []);
    assert.deepEqual(resolveDialects(["openinference"]), ["openinference"]);
    assert.deepEqual(resolveDialects(["genai", "openinference", "genai"]), [
      "genai",
      "openinference",
    ]);
    assert.equal(KNOWN_DIALECTS.includes(ALWAYS_ON_DIALECT), false);
    assert.deepEqual([...KNOWN_DIALECTS], ["genai", "openinference"]);
  });
});
