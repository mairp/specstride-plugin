/**
 * T008 — CT-110-101 and CT-110-106 (F110-FR-001, F110-FR-007).
 *
 * CT-110-101 (F110-FR-001): a value is validated against its type and range when
 * the layers are merged, and an invalid value refuses the launch with the key,
 * the value, the layer and the range in the message.
 *
 * CT-110-106 (F110-FR-007): the keys of the options the owner added exist with
 * the stated defaults and values under `parity`, and `loop.parallel.workers`
 * above 4 and `verification.parallelism` above 4 are configuration errors.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { catalogueEntry } from "../../src/schema/catalogue.ts";
import { ConfigValueError, UnknownKeyError, type LayerCode } from "../../src/schema/types.ts";
import {
  BOUNDED_BY_KEY,
  coerceText,
  defaultBound,
  validateKeyValue,
} from "../../src/schema/validate.ts";

/** The error a layer's value was refused with, with the suite's own assertions. */
function refused(key: string, value: unknown, layer: LayerCode, place?: string): ConfigValueError {
  const verdict = validateKeyValue(key, value, layer, place === undefined ? {} : { place });
  assert.equal(verdict.ok, false, `${key}=${String(value)} was accepted from ${layer}`);
  assert.ok(verdict.ok === false);
  assert.ok(
    verdict.error instanceof ConfigValueError,
    `${key}: the error is ${verdict.error.constructor.name}, not a value error`,
  );
  return verdict.error as ConfigValueError;
}

/** The value a layer's offer resolved to. */
function accepted(key: string, value: unknown, layer: LayerCode, fromText = false): unknown {
  const verdict = validateKeyValue(key, value, layer, { fromText });
  assert.ok(
    verdict.ok,
    `${key}=${String(value)} was refused: ${verdict.ok === false ? verdict.error.message : ""}`,
  );
  return verdict.value;
}

describe("CT-110-101 — a type error names the key, the value, the layer and the range (F110-FR-001)", () => {
  it("a whole number key set to text", () => {
    const error = refused("loop.maxIter", "soon", "E", "SPECSTRIDE_MAX_ITER");
    assert.equal(error.reason, "type");
    assert.equal(error.key, "loop.maxIter");
    assert.equal(error.value, "soon");
    assert.equal(error.layer, "SPECSTRIDE_MAX_ITER");
    assert.equal(error.range, "whole number");
    assert.match(error.message, /`loop\.maxIter`/);
    assert.match(error.message, /`soon`/);
    assert.match(error.message, /SPECSTRIDE_MAX_ITER/);
    assert.match(error.message, /`whole number`/);
  });

  it("a whole number key set to a fraction", () => {
    const error = refused(
      "roles.proposer.timeoutSec",
      1.5,
      "U",
      "~/.config/specstride/config.yaml",
    );
    assert.equal(error.reason, "type");
    assert.equal(error.range, "whole number of seconds");
    assert.match(error.message, /whole number/);
    assert.match(error.message, /1\.5/);
    assert.match(error.message, /config\.yaml/);
  });

  it("a boolean key set to a word that is neither of its two literals", () => {
    const error = refused("loop.escalation", "maybe", "F", "flag");
    assert.equal(error.reason, "type");
    assert.equal(error.range, "on, off");
    assert.match(error.message, /`on`, `off`/);
  });

  it("a closed set key set to a value outside the set", () => {
    const error = refused("loop.strategy", "turbo", "P", "/work/specstride.yaml");
    assert.equal(error.reason, "type");
    assert.equal(error.range, "micro, classic");
    assert.match(error.message, /`micro`, `classic`/);
    assert.match(error.message, /\/work\/specstride\.yaml/);
  });

  it("a list key set to a scalar, and a list with an element outside its set", () => {
    assert.equal(refused("loop.parallel.seedPaths", "src", "U").reason, "type");
    const error = refused("staleness.check_points", ["launch", "whenever"], "U");
    assert.equal(error.reason, "type");
    assert.match(error.message, /`launch`, `resume`, `pass-start`, `critic-start`/);
  });

  it("a table key set to a list", () => {
    assert.equal(refused("budget.rates", [1, 2], "U").reason, "type");
  });
});

describe("CT-110-101 — a range error names the key, the value, the layer and the range (F110-FR-001)", () => {
  it("below the smallest accepted value", () => {
    const error = refused("loop.parallel.workersMax", 0, "E", "SPECSTRIDE_PARALLEL_WORKERS_MAX");
    assert.equal(error.reason, "range");
    assert.equal(error.key, "loop.parallel.workersMax");
    assert.equal(error.value, 0);
    assert.equal(error.layer, "SPECSTRIDE_PARALLEL_WORKERS_MAX");
    assert.match(error.range, /at least 1/);
    assert.match(error.message, /smallest accepted value is 1/);
  });

  it("above the largest accepted value", () => {
    const error = refused("supervise.maxRelaunches", 6, "F", "flag");
    assert.equal(error.reason, "range");
    assert.equal(error.range, "0 to 5");
    assert.match(error.message, /largest accepted value is 5/);
    assert.match(error.message, /`supervise\.maxRelaunches`/);
    assert.match(error.message, /flag/);
  });

  it("a negative number where the cell names a whole number", () => {
    assert.equal(refused("roles.proposer.maxErrors", -1, "U").reason, "range");
  });

  it("0 is accepted where the cell says 0 disables or 0 is unlimited", () => {
    assert.equal(accepted("roles.proposer.maxNoProgress", 0, "U"), 0);
    assert.equal(accepted("loop.maxWallMin", 0, "U"), 0);
    assert.equal(accepted("roles.critic.malformedLimit", 0, "U"), 0);
  });

  it("a layer the catalogue does not list for the key is refused, naming the layers", () => {
    const error = refused("profile", "parity", "P", "/work/specstride.yaml");
    assert.equal(error.reason, "layer-not-allowed");
    assert.equal(error.range, "F E U");
    assert.match(error.message, /project-configuration/);
    assert.match(error.message, /`F E U`/);
  });

  it("an unknown key is a different error from an invalid value", () => {
    const verdict = validateKeyValue("loop.maxIterz", 3, "U");
    assert.ok(verdict.ok === false && verdict.error instanceof UnknownKeyError);
  });

  it("text from the environment or a flag is read into the key's type first", () => {
    assert.equal(accepted("loop.maxIter", "7", "E", true), 7);
    assert.equal(accepted("loop.escalation", "off", "E", true), false);
    assert.equal(accepted("loop.escalation", "on", "F", true), true);
    assert.deepEqual(accepted("budget.alerts.thresholds", "50,75,90", "E", true), [50, 75, 90]);
    assert.equal(coerceText("not a number", catalogueEntry("loop.maxIter")!.type), "not a number");
  });
});

describe("CT-110-106 — the options the owner added, with their defaults and parity values (F110-FR-007)", () => {
  /** The nine options F110-FR-007 names, with the default and the value under `parity`. */
  const OPTIONS: readonly (readonly [string, unknown, unknown])[] = Object.freeze([
    ["loop.parallel.units", false, false],
    ["loop.parallel.workers", 2, "not used"],
    ["loop.parallel.quota_headroom", 70, "not used"],
    ["loop.parallel.allow_detect", false, false],
    ["verification.parallelism", 1, 1],
    ["attempt.tier_bump", false, false],
    ["attempt.tier_bump_after", 2, "not used"],
    ["telemetry.content", "auto", "off"],
    ["harnesses.<id>.transport", "subprocess", "subprocess"],
  ]);

  for (const [key, expectedDefault, expectedParity] of OPTIONS) {
    it(`\`${key}\` has the default and the value under \`parity\` the requirement states`, () => {
      const entry = catalogueEntry(key);
      assert.ok(entry !== undefined, `${key} is not in the catalogue`);
      assert.equal(entry.default.kind, "value", `${key}: the default is ${entry.default.kind}`);
      assert.deepEqual(
        entry.default.kind === "value" ? entry.default.value : undefined,
        expectedDefault,
      );
      if (typeof expectedParity === "string" && entry.parity.kind === "literal") {
        assert.equal(entry.parity.literal, expectedParity);
      } else {
        assert.equal(
          entry.parity.kind,
          "value",
          `${key}: the parity entry is ${entry.parity.kind}`,
        );
        assert.deepEqual(
          entry.parity.kind === "value" ? entry.parity.value : undefined,
          expectedParity,
        );
      }
    });
  }

  it("`staleness.check_points` is launch, resume and pass-start against `critic-start`", () => {
    const entry = catalogueEntry("staleness.check_points");
    assert.ok(entry !== undefined);
    assert.deepEqual(entry.default.kind === "value" ? entry.default.value : undefined, [
      "launch",
      "resume",
      "pass-start",
    ]);
    assert.deepEqual(entry.parity.kind === "value" ? entry.parity.value : undefined, [
      "critic-start",
    ]);
    assert.deepEqual(entry.type.elementMembers, ["launch", "resume", "pass-start", "critic-start"]);
  });

  it("the model-tier ladder `harnesses.<id>.tiers` exists, with the descriptor as its default", () => {
    const entry = catalogueEntry("harnesses.<id>.tiers");
    assert.ok(entry !== undefined);
    assert.equal(entry.type.kind, "list");
    assert.equal(entry.default.kind, "deferred");
  });

  it("`loop.parallel.workers` above 4 is a configuration error", () => {
    assert.equal(accepted("loop.parallel.workers", 4, "U"), 4);
    const error = refused("loop.parallel.workers", 5, "U", "~/.config/specstride/config.yaml");
    assert.equal(error.reason, "range");
    assert.equal(error.key, "loop.parallel.workers");
    assert.equal(error.value, 5);
    assert.match(error.range, /at most 4/);
    assert.match(error.message, /largest accepted value is 4/);
    assert.match(error.message, /`loop\.parallel\.workersMax`/);
    assert.match(error.message, /config\.yaml/);
  });

  it("the bound of `loop.parallel.workers` is the value of `loop.parallel.workersMax`", () => {
    assert.equal(BOUNDED_BY_KEY["loop.parallel.workers"], "loop.parallel.workersMax");
    assert.equal(defaultBound("loop.parallel.workersMax"), 4);
    // The default of the bounding key is 4, which is what makes 5 an error out of
    // the box; a run that raised the bound may use more.
    const raised = validateKeyValue("loop.parallel.workers", 6, "U", {
      valueOf: (key) => (key === "loop.parallel.workersMax" ? 8 : undefined),
    });
    assert.equal(raised.ok, true);
    const lowered = validateKeyValue("loop.parallel.workers", 3, "U", {
      valueOf: (key) => (key === "loop.parallel.workersMax" ? 2 : undefined),
    });
    assert.equal(lowered.ok, false);
  });

  it("`verification.parallelism` above 4 is a configuration error", () => {
    assert.equal(accepted("verification.parallelism", 4, "U"), 4);
    const error = refused("verification.parallelism", 5, "E", "SPECSTRIDE_VERIFY_PARALLELISM");
    assert.equal(error.reason, "range");
    assert.equal(error.key, "verification.parallelism");
    assert.equal(error.value, 5);
    assert.equal(error.range, "1 to 4");
    assert.equal(error.layer, "SPECSTRIDE_VERIFY_PARALLELISM");
    assert.match(error.message, /largest accepted value is 4/);
    assert.equal(refused("verification.parallelism", 0, "U").reason, "range");
  });

  it("both caps hold for a value that arrives as text from the environment", () => {
    assert.equal(validateKeyValue("loop.parallel.workers", "5", "E", { fromText: true }).ok, false);
    assert.equal(
      validateKeyValue("verification.parallelism", "5", "E", { fromText: true }).ok,
      false,
    );
    assert.equal(validateKeyValue("loop.parallel.workers", "4", "E", { fromText: true }).ok, true);
  });
});
