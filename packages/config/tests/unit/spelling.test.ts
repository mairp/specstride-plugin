/**
 * T007 — CT-110-102, the rules of spelling of §K.2 (F110-FR-002).
 *
 * The four things the requirement asks for, each its own suite below:
 *
 * - an unknown key refuses the launch, and the message names the file, the key
 *   and the nearest known key, found ignoring case and underscores (rule 2);
 * - a key under `x-` is ignored (rule 5);
 * - the environment name of a key is derived by rule 3, and the as-is name
 *   replaces the derived name where the baseline has one;
 * - every key is reachable through `--set <path>=<value>` (rule 4).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CATALOGUE, CATALOGUE_KEYS, matchCatalogueKey } from "../../src/schema/catalogue.ts";
import {
  ENVIRONMENT_PREFIX,
  classifyKey,
  comparableSpelling,
  derivedEnvironmentName,
  environmentNameOf,
  isIgnoredExtensionKey,
  nearestKey,
  parseSetFlag,
  setFlagFor,
} from "../../src/schema/spelling.ts";
import { UnknownKeyError, type LayerCode } from "../../src/schema/types.ts";
import { validateKeyValue } from "../../src/schema/validate.ts";

/** A value of each parameter of a template key, so that a concrete key can be built. */
const PARAMETER_VALUE: Readonly<Record<string, string>> = Object.freeze({
  "<N>": "3",
  "<id>": "claude",
  "<role>": "proposer",
  "<taskId>": "T042",
  "<name>": "cpu",
  "<commandId>": "lint",
  "<slug>": "110-config-and-terms",
});

/** A concrete spelling of a key of the catalogue, with every parameter bound. */
function concrete(key: string): string {
  return key.replace(/<[A-Za-z]+>/g, (p) => {
    const value = PARAMETER_VALUE[p];
    assert.ok(value !== undefined, `no value is known for the parameter ${p} of ${key}`);
    return value;
  });
}

describe("CT-110-102 rule 2 — an unknown key is refused, with the nearest known key", () => {
  it("the nearest key is found ignoring case and underscores", () => {
    // The example of §K.2 rule 2 itself.
    assert.equal(nearestKey("closingCheck"), "loop.micro.closing_check");
    assert.equal(nearestKey("loop.micro.closingCheck"), "loop.micro.closing_check");
    assert.equal(nearestKey("LOOP.MICRO.CLOSING_CHECK"), "loop.micro.closing_check");
    // The example of the quickstart, scenario 3.
    assert.equal(nearestKey("loop.maxIters"), "loop.maxIter");
    assert.equal(nearestKey("LOOP.MAX_ITER"), "loop.maxIter");
    assert.equal(nearestKey("verification.paralellism"), "verification.parallelism");
    assert.equal(nearestKey("rolez.proposer.timeoutSek"), "roles.proposer.timeoutSec");
    assert.equal(nearestKey("quota_headroom"), "loop.parallel.quota_headroom");
  });

  it("two spellings that differ only in case and underscores compare equal", () => {
    assert.equal(
      comparableSpelling("loop.micro.closing_check"),
      comparableSpelling("LOOP.MICRO.closingCheck"),
    );
    assert.notEqual(comparableSpelling("loop.maxIter"), comparableSpelling("loop.maxIters"));
  });

  it("nothing is suggested where no key is near", () => {
    assert.equal(nearestKey("totallyUnrelatedXyzzyPlughFoo"), undefined);
  });

  it("the launch is refused, and the message names the file, the key and the nearest key", () => {
    const verdict = validateKeyValue("loop.maxIters", 5, "P", {
      place: "/work/specstride.yaml",
    });
    assert.equal(verdict.ok, false);
    assert.ok(verdict.ok === false);
    const error = verdict.error;
    assert.ok(error instanceof UnknownKeyError);
    assert.equal(error.file, "/work/specstride.yaml");
    assert.equal(error.key, "loop.maxIters");
    assert.equal(error.nearest, "loop.maxIter");
    assert.match(error.message, /\/work\/specstride\.yaml/);
    assert.match(error.message, /`loop\.maxIters`/);
    assert.match(error.message, /`loop\.maxIter`/);
  });

  it("an unknown key with nothing near it still names the file and the key", () => {
    const verdict = validateKeyValue("totallyUnrelatedXyzzyPlughFoo", 1, "U", {
      place: "~/.config/specstride/config.yaml",
    });
    assert.ok(verdict.ok === false && verdict.error instanceof UnknownKeyError);
    assert.equal((verdict.error as UnknownKeyError).nearest, undefined);
    assert.match(verdict.error.message, /closed list of exact spellings/);
  });

  it("a known key is not refused", () => {
    assert.deepEqual(classifyKey("loop.maxIter"), { kind: "known", key: "loop.maxIter" });
    assert.equal(validateKeyValue("loop.maxIter", 5, "P").ok, true);
  });
});

describe("CT-110-102 rule 5 — a key under `x-` is ignored", () => {
  it("at the top and at any depth", () => {
    assert.equal(isIgnoredExtensionKey("x-mine"), true);
    assert.equal(isIgnoredExtensionKey("x-mine.anything.at.all"), true);
    assert.equal(isIgnoredExtensionKey("loop.x-mine"), true);
    assert.equal(isIgnoredExtensionKey("roles.proposer.x-note.text"), true);
    assert.equal(isIgnoredExtensionKey("loop.maxIter"), false);
    assert.equal(isIgnoredExtensionKey("loop.xMine"), false);
  });

  it("is ignored, not refused: no nearest key is offered for it", () => {
    const verdict = classifyKey("loop.x-mine");
    assert.deepEqual(verdict, { kind: "ignored", key: "loop.x-mine" });
  });

  it("no key of the catalogue is under `x-`", () => {
    for (const key of CATALOGUE_KEYS) assert.equal(isIgnoredExtensionKey(key), false, key);
  });
});

describe("CT-110-102 rule 3 — the environment name of a key", () => {
  it("is `SPECSTRIDE_` with the path in upper case, dots and camelCase boundaries as underscores", () => {
    assert.equal(derivedEnvironmentName("loop.maxIter"), "SPECSTRIDE_LOOP_MAX_ITER");
    assert.equal(
      derivedEnvironmentName("roles.proposer.timeoutSec"),
      "SPECSTRIDE_ROLES_PROPOSER_TIMEOUT_SEC",
    );
    assert.equal(
      derivedEnvironmentName("telemetry.otel.maxBatchBytes"),
      "SPECSTRIDE_TELEMETRY_OTEL_MAX_BATCH_BYTES",
    );
    assert.equal(
      derivedEnvironmentName("critic.autoPickMaxUsd"),
      "SPECSTRIDE_CRITIC_AUTO_PICK_MAX_USD",
    );
    assert.equal(derivedEnvironmentName("state.dir"), "SPECSTRIDE_STATE_DIR");
  });

  it("does not double the underscores that rule 1 keeps", () => {
    assert.equal(
      derivedEnvironmentName("loop.micro.closing_check"),
      "SPECSTRIDE_LOOP_MICRO_CLOSING_CHECK",
    );
    assert.equal(
      derivedEnvironmentName("loop.parallel.quota_headroom"),
      "SPECSTRIDE_LOOP_PARALLEL_QUOTA_HEADROOM",
    );
    assert.equal(
      derivedEnvironmentName("attempt.tier_bump_after"),
      "SPECSTRIDE_ATTEMPT_TIER_BUMP_AFTER",
    );
    assert.equal(
      derivedEnvironmentName("verification.step_runner"),
      "SPECSTRIDE_VERIFICATION_STEP_RUNNER",
    );
  });

  it("keeps the parameter of a template key, which the caller binds", () => {
    assert.equal(
      derivedEnvironmentName("phases.<N>.critic.timeoutSec"),
      "SPECSTRIDE_PHASES_<N>_CRITIC_TIMEOUT_SEC",
    );
    assert.equal(
      derivedEnvironmentName("harnesses.<id>.endpoint.base"),
      "SPECSTRIDE_HARNESSES_<ID>_ENDPOINT_BASE",
    );
  });

  it("derives one name for every key of the catalogue, and no two keys share one", () => {
    const seen = new Map<string, string>();
    for (const key of CATALOGUE_KEYS) {
      const name = derivedEnvironmentName(key);
      assert.ok(name.startsWith(ENVIRONMENT_PREFIX), `${key}: ${name}`);
      assert.equal(name, name.toUpperCase(), `${key}: ${name} is not upper case`);
      assert.doesNotMatch(name, /\./, `${key}: ${name} still holds a dot`);
      assert.doesNotMatch(name, /__/, `${key}: ${name} doubles an underscore`);
      const already = seen.get(name);
      assert.equal(already, undefined, `${key} and ${already} derive the same name ${name}`);
      seen.set(name, key);
    }
    assert.equal(seen.size, 259);
  });

  it("the as-is name of the baseline replaces the derived name where there is one", () => {
    // §K.2 rule 3, second sentence, with §K.8: `SPECSTRIDE_MAX_ITER` is the
    // baseline's name for `loop.maxIter`, so the derived name is not read.
    const aliases = new Map([
      ["loop.maxIter", "SPECSTRIDE_MAX_ITER"],
      ["roles.proposer.timeoutSec", "SPECSTRIDE_PROPOSER_TIMEOUT"],
    ]);
    assert.equal(environmentNameOf("loop.maxIter", aliases), "SPECSTRIDE_MAX_ITER");
    assert.notEqual(
      environmentNameOf("loop.maxIter", aliases),
      derivedEnvironmentName("loop.maxIter"),
    );
    assert.equal(
      environmentNameOf("roles.proposer.timeoutSec", aliases),
      "SPECSTRIDE_PROPOSER_TIMEOUT",
    );
    // A key the baseline has no name for keeps the derived name.
    assert.equal(
      environmentNameOf("telemetry.otel.maxBatchBytes", aliases),
      "SPECSTRIDE_TELEMETRY_OTEL_MAX_BATCH_BYTES",
    );
    assert.equal(environmentNameOf("loop.maxIter"), "SPECSTRIDE_LOOP_MAX_ITER");
  });
});

describe("CT-110-102 rule 4 — `--set <path>=<value>` reaches every key", () => {
  it("reads the flag in each of its forms", () => {
    assert.deepEqual(parseSetFlag("--set loop.maxIter=3"), { key: "loop.maxIter", rawValue: "3" });
    assert.deepEqual(parseSetFlag("--set=loop.maxIter=3"), { key: "loop.maxIter", rawValue: "3" });
    assert.deepEqual(parseSetFlag("loop.maxIter=3"), { key: "loop.maxIter", rawValue: "3" });
    assert.equal(parseSetFlag("loop.maxIter"), undefined);
    assert.equal(parseSetFlag("=3"), undefined);
  });

  it("keeps a value that holds `=`", () => {
    assert.deepEqual(parseSetFlag("--set harnesses.claude.gitInstructions=a=b"), {
      key: "harnesses.claude.gitInstructions",
      rawValue: "a=b",
    });
  });

  it("reaches all 259 keys of the catalogue, templates bound to a concrete segment", () => {
    assert.equal(CATALOGUE.length, 259);
    for (const entry of CATALOGUE) {
      const key = concrete(entry.key);
      const flag = setFlagFor(key, "x");
      const read = parseSetFlag(flag);
      assert.ok(read !== undefined, `${entry.key}: \`${flag}\` is no --set flag`);
      assert.equal(read.key, key);
      const match = matchCatalogueKey(read.key);
      assert.ok(match !== undefined, `${entry.key}: \`${key}\` reaches no key of the catalogue`);
      assert.equal(match.entry.key, entry.key, `${key} reached ${match.entry.key}`);
    }
  });

  it("a flag may set a key only where the catalogue lists the flag layer", () => {
    // `--set` exists for every key (rule 4); whether the flag layer may set it is
    // the separate rule of F110-FR-001, and one key of the catalogue is pinnable
    // by the contract only.
    const flagOnly = CATALOGUE.filter((e) => !e.layers.includes("F"));
    assert.ok(flagOnly.length > 0, "the catalogue holds a key no flag may set");
    for (const entry of flagOnly) {
      const verdict = validateKeyValue(concrete(entry.key), "x", "F" as LayerCode, {
        place: "flag",
      });
      assert.equal(verdict.ok, false, `${entry.key} was accepted from a flag`);
      assert.ok(verdict.ok === false && !(verdict.error instanceof UnknownKeyError));
    }
  });
});
