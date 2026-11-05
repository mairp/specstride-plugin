/**
 * T025 — the test CT-110-105 of the launch defaults (F110-FR-005).
 *
 * The requirement states four things and the test checks each of them in both
 * directions:
 *
 * 1. Where no role is named, the proposer and the critic are both Claude, on
 *    different model tiers.
 * 2. `verification.mode` is `required`.
 * 3. The proposer comes from a flag, the environment, a configuration file or
 *    the shipped default only, and an absent proposer refuses the launch and
 *    names the discovered candidates.
 * 4. Lisa's defaults — one model for both roles, verification `off` — do not
 *    apply.
 *
 * The defaults are read through the catalogue and through
 * `resolveConfiguration`, which is the path a launch takes, so that the test
 * cannot pass on a constant the module repeats beside the catalogue.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { catalogueEntry } from "../../src/schema/catalogue.ts";
import {
  AbsentProposerError,
  LAUNCH_DEFAULT_KEYS,
  LISA_DEFAULTS,
  LISA_DEFAULTS_APPLY,
  SHIPPED_HARNESS,
  VERIFICATION_MODE_DEFAULT,
  launchDefaults,
  proposerLayers,
  proposerMayComeFrom,
  resolveProposerHarness,
  rolesShareAModel,
} from "../../src/schema/launch-defaults.ts";
import { resolveConfiguration } from "../../src/load/merge.ts";
import { LAYER_CODES, type LayerCode } from "../../src/schema/types.ts";

/** The configuration a launch resolves when nothing at all is set. */
const bare = () => resolveConfiguration({});

describe("CT-110-105: the default roles (F110-FR-005, first clause)", () => {
  it("the proposer and the critic are both the shipped harness, Claude in Wave 1", () => {
    const defaults = launchDefaults();
    assert.equal(defaults.proposerHarness, "claude");
    assert.equal(defaults.criticHarness, "claude");
    assert.equal(SHIPPED_HARNESS, "claude");
    // The catalogue is where the fact lives; the module reads it and does not
    // repeat it beside it.
    assert.match(
      catalogueEntry(LAUNCH_DEFAULT_KEYS.proposerHarness)?.cells.default ?? "",
      /the shipped default, Claude in Wave 1/,
    );
  });

  it("the two roles stand on different model tiers", () => {
    const defaults = launchDefaults();
    assert.match(defaults.criticModel, /tier other than the proposer's/);
    assert.equal(defaults.proposerModel, "the harness default");
    assert.notEqual(defaults.criticModel, defaults.proposerModel);
    // The honesty half: `rolesShareAModel` is what the launch would refuse on,
    // and it says `true` only when the two resolved models are one.
    assert.equal(rolesShareAModel("sonnet", "sonnet"), true);
    assert.equal(rolesShareAModel("opus", "sonnet"), false);
    assert.equal(rolesShareAModel(undefined, "sonnet"), false);
    assert.equal(rolesShareAModel("opus", undefined), false);
  });

  it("the two harness keys and the two model keys are keys of the catalogue", () => {
    for (const key of Object.values(LAUNCH_DEFAULT_KEYS)) {
      assert.notEqual(catalogueEntry(key), undefined, key);
    }
  });
});

describe("CT-110-105: verification `required` (F110-FR-005, second clause)", () => {
  it("the catalogue default of `verification.mode` is `required`", () => {
    const entry = catalogueEntry(LAUNCH_DEFAULT_KEYS.verificationMode);
    assert.equal(entry?.default.kind, "value");
    assert.equal(entry?.default.kind === "value" ? entry.default.value : undefined, "required");
    assert.equal(VERIFICATION_MODE_DEFAULT, "required");
    assert.equal(launchDefaults().verificationMode, "required");
  });

  it("a launch with nothing set resolves it to `required` at rank 8", () => {
    const resolved = bare().values.get(LAUNCH_DEFAULT_KEYS.verificationMode);
    assert.equal(resolved?.value, "required");
    assert.equal(resolved?.source, "default");
    assert.equal(resolved?.rank, 8);
  });

  it("`required` is one of the three members the type names, and is the strictest", () => {
    const entry = catalogueEntry(LAUNCH_DEFAULT_KEYS.verificationMode);
    assert.deepEqual([...(entry?.type.members ?? [])], ["required", "plan", "off"]);
    assert.match(entry?.cells.trustClass ?? "", /required is stricter than plan/);
  });
});

describe("CT-110-105: the proposer's layers and the refusal (F110-FR-005, third clause)", () => {
  it("the layers are a flag, the environment and a configuration file", () => {
    assert.deepEqual([...proposerLayers()], ["F", "E", "P", "U"]);
    for (const layer of ["F", "E", "P", "U"] as const) {
      assert.equal(proposerMayComeFrom(layer), true, layer);
    }
    // The negative half: no other layer of §K.1 may name the proposer. The pin
    // of the launch contract is the one remaining code, and it may not.
    const refused = LAYER_CODES.filter((code: LayerCode) => !proposerMayComeFrom(code));
    assert.deepEqual([...refused], ["C"]);
  });

  it("a proposer named by each allowed layer is taken, with the layer recorded", () => {
    for (const layer of ["F", "E", "P", "U"] as const) {
      const resolved = resolveProposerHarness({ resolved: { value: "codex", layer } });
      assert.equal(resolved.harness, "codex");
      assert.equal(resolved.from, layer);
    }
    const shipped = resolveProposerHarness({ shippedDefaultApplies: true });
    assert.equal(shipped.harness, SHIPPED_HARNESS);
    assert.equal(shipped.from, "default");
  });

  it("an absent proposer refuses the launch and names the discovered candidates", () => {
    assert.throws(
      () => resolveProposerHarness({ candidates: ["claude", "codex", "dsh"] }),
      (error: unknown) => {
        assert.ok(error instanceof AbsentProposerError);
        assert.equal(error.reason, "no-proposer");
        assert.deepEqual([...error.candidates], ["claude", "codex", "dsh"]);
        // Every candidate is in the message, and so are the layers a proposer
        // may come from.
        for (const candidate of ["claude", "codex", "dsh"]) {
          assert.match(error.message, new RegExp(`\`${candidate}\``));
        }
        assert.match(error.message, /no proposer is named/);
        assert.match(error.message, /flag, the environment, a configuration file/);
        assert.match(error.message, /F E P U/);
        return true;
      },
    );
  });

  it("an absent proposer with no candidate says so rather than naming none", () => {
    assert.throws(
      () => resolveProposerHarness({}),
      (error: unknown) => {
        assert.ok(error instanceof AbsentProposerError);
        assert.deepEqual([...error.candidates], []);
        assert.match(error.message, /No harness was discovered/);
        return true;
      },
    );
  });

  it("a proposer offered by a layer the catalogue does not list is no proposer", () => {
    assert.throws(
      () => resolveProposerHarness({ resolved: { value: "claude", layer: "C" } }),
      AbsentProposerError,
    );
    assert.throws(
      () => resolveProposerHarness({ resolved: { value: "", layer: "F" } }),
      AbsentProposerError,
    );
    assert.throws(
      () => resolveProposerHarness({ resolved: { value: 7, layer: "F" } }),
      AbsentProposerError,
    );
  });

  it("nothing at all set leaves `roles.proposer.harness` without a value", () => {
    // Its default is deferred ("the shipped default, Claude in Wave 1"), so no
    // rank offers a value and the launch must decide: that is what makes the
    // refusal of the third clause reachable at all.
    assert.equal(catalogueEntry(LAUNCH_DEFAULT_KEYS.proposerHarness)?.default.kind, "deferred");
    assert.equal(bare().values.get(LAUNCH_DEFAULT_KEYS.proposerHarness), undefined);
  });

  it("a proposer named by a flag reaches the launch through the eight ranks", () => {
    const resolved = resolveConfiguration({ argv: ["--set", "roles.proposer.harness=codex"] });
    const merged = resolved.values.get(LAUNCH_DEFAULT_KEYS.proposerHarness);
    assert.equal(merged?.value, "codex");
    assert.equal(merged?.source, "flag");
    assert.equal(
      resolveProposerHarness({ resolved: { value: merged?.value, layer: "F" } }).harness,
      "codex",
    );
  });
});

describe("CT-110-105: Lisa's defaults do not apply (F110-FR-005, last sentence)", () => {
  it("one model for both roles and verification `off` are both refused", () => {
    assert.equal(LISA_DEFAULTS_APPLY, false);
    assert.equal(LISA_DEFAULTS.oneModelForBothRoles, true);
    assert.equal(LISA_DEFAULTS.verificationMode, "off");
    // The port's defaults are the other way round on both counts.
    assert.notEqual(launchDefaults().verificationMode, LISA_DEFAULTS.verificationMode);
    assert.equal(bare().values.get(LAUNCH_DEFAULT_KEYS.verificationMode)?.value, "required");
    assert.notEqual(launchDefaults().criticModel, launchDefaults().proposerModel);
  });
});
