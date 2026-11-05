/**
 * CT-115-147 (T067, IR-47, F115-FR-034) — characterization: the escalation
 * target equals no critic-class call in model and in effort.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { criticSignals } from "../../src/router/route.ts";
import { nextRung, targetAgainstCriticCalls } from "../../src/router/escalation.ts";

const CRITIC = { model: "large", effort: "high" };

test("CT-115-147 (IR-47): targetIsCriticModel is true only when both model and effort are equal", () => {
  assert.deepEqual(criticSignals({ model: "large", effort: "high" }, [CRITIC]), {
    targetIsCriticModel: true,
    targetSharesCriticModel: false,
  });
  assert.deepEqual(targetAgainstCriticCalls({ model: "large", effort: "high" }, [CRITIC]), {
    targetIsCriticModel: true,
    targetSharesCriticModel: false,
  });
});

test("CT-115-147 (IR-47): the same model at another effort is not a collision", () => {
  assert.deepEqual(criticSignals({ model: "large", effort: "medium" }, [CRITIC]), {
    targetIsCriticModel: false,
    targetSharesCriticModel: true,
  });
});

test("CT-115-147 (IR-47): another model at the critic's effort is not a collision either", () => {
  assert.deepEqual(criticSignals({ model: "small", effort: "high" }, [CRITIC]), {
    targetIsCriticModel: false,
    targetSharesCriticModel: false,
  });
});

test("CT-115-147 (IR-47): the rule holds over the whole pinned ladder", () => {
  const ladder = [
    { model: "small", effort: "medium" },
    { model: "large", effort: "medium" },
    CRITIC,
  ] as const;
  // The rung before the critic's rung is reachable.
  assert.deepEqual(nextRung(ladder, ladder[1]), CRITIC);
  // The collision is on the rung itself, never earlier: the target of the
  // first rung differs in model and effort from the critic-class call.
  const target = nextRung(ladder, ladder[0]);
  assert.deepEqual(criticSignals(target ?? { model: "none", effort: "none" }, [CRITIC]), {
    targetIsCriticModel: false,
    targetSharesCriticModel: true,
  });
});
