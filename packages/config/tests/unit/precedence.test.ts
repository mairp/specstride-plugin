/**
 * T012 — CT-110-113 and CT-110-114 (F110-FR-014, F110-FR-016).
 *
 * CT-110-113 (F110-FR-014): each key is resolved through the eight ranks of
 * annex X §X.2, highest first — contract pin, flag, run snapshot (on `resume`
 * only), environment, project file, user file, learned value, default — and
 * between two flags for one key the last wins. The default is the built-in value,
 * the value detected from the machine, or the value of the profile.
 *
 * CT-110-114 (F110-FR-016): a list replaces and never concatenates, with one
 * exception — entries of `harnesses` merge by id, and for one id the entry of
 * highest precedence wins in the order declared by the consumer, tested harness
 * adapter, bundled descriptor, detected.
 *
 * Every case walks the ranks one at a time: the offer of the winning rank is
 * removed and the next rank must win, so no case can pass by accident on a
 * single comparison. The negative half of each is asserted too — a list that
 * concatenated, or a table of harnesses that replaced, fails the case.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RANK_LAYERS,
  effectiveRank,
  rankOfLayer,
  type RankLayer,
} from "@specstride/contracts/envelope/config";

import { catalogueEntry } from "../../src/schema/catalogue.ts";
import {
  CODE_OF_RANK_LAYER,
  EIGHT_RANKS,
  HARNESS_ENTRY_ORIGINS,
  LISTS_REPLACE,
  RANK_COUNT,
  THE_ONE_LIST_EXCEPTION,
  defaultOffers,
  flagOffers,
  keyClassOf,
  mergeConfiguration,
  mergeHarnessEntries,
  mergeKey,
  precedenceOfOrigin,
  profileOffers,
  resolveConfiguration,
  type ConfigOffer,
} from "../../src/load/merge.ts";

/** One offer per rank for one key, the value being the rank's own name. */
function oneOfferPerRank(key: string): ConfigOffer[] {
  return RANK_LAYERS.map((layer, index) => ({
    key,
    layer,
    value: index + 1,
    place: `the place of ${layer}`,
  }));
}

describe("CT-110-113 — the eight ranks of annex X §X.2, highest first (F110-FR-014)", () => {
  it("the ranks are the eight of the annex, in the order the requirement names", () => {
    assert.equal(RANK_COUNT, 8);
    assert.equal(EIGHT_RANKS.length, 8);
    assert.deepEqual(
      [...EIGHT_RANKS],
      [
        "launch-contract-pin",
        "flag",
        "run-snapshot",
        "environment",
        "project-configuration",
        "user-configuration",
        "learned-value",
        "default",
      ],
    );
    // The rank numbers are the annex's own, and no two are alike.
    const numbers = EIGHT_RANKS.map((layer) => rankOfLayer[layer]);
    assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("the whole ladder: each rank in turn wins and then yields to the next", () => {
    const key = "loop.maxIter";
    // The class is passed, so that the run snapshot keeps rank 3 through the
    // walk; a tunable key moves it, which the next case asserts.
    const options = { class: "pinned" as const };
    let offers = oneOfferPerRank(key);
    const seen: RankLayer[] = [];
    while (offers.length > 0) {
      const merged = mergeKey(key, offers, options);
      assert.notEqual(merged, undefined);
      assert.ok(merged !== undefined);
      seen.push(merged.source);
      assert.equal(merged.rank, rankOfLayer[merged.source]);
      // Every remaining offer is recorded as shadowed, with its own rank.
      assert.equal(merged.shadowed.length, offers.length - 1);
      assert.deepEqual(
        merged.shadowed.map((s) => s.rank),
        offers
          .filter((o) => o.layer !== merged.source)
          .map((o) => rankOfLayer[o.layer])
          .sort((a, b) => a - b),
      );
      offers = offers.filter((o) => o.layer !== merged.source);
    }
    assert.deepEqual(seen, [...EIGHT_RANKS]);
  });

  it("the run snapshot of a tunable key ranks below the environment (F110-FR-022)", () => {
    assert.equal(keyClassOf("loop.maxIter"), "tunable");
    assert.equal(keyClassOf("roles.proposer.harness"), "pinned");
    // The arithmetic is feature 100's: a tunable snapshot stands at 4.5.
    assert.equal(effectiveRank("run-snapshot", { class: "tunable" }), 4.5);
    const merged = mergeKey("loop.maxIter", [
      { key: "loop.maxIter", layer: "environment", value: 7, place: "SPECSTRIDE_LOOP_MAX_ITER" },
      { key: "loop.maxIter", layer: "run-snapshot", value: 11, place: "the run snapshot" },
    ]);
    assert.equal(merged?.value, 7, "the environment beats a tunable snapshot");
    assert.equal(merged?.source, "environment");
  });

  it("a key no rank offers has no value at all", () => {
    assert.equal(mergeKey("loop.maxIter", []), undefined);
    assert.equal(
      mergeKey("loop.maxIter", [{ key: "loop.maxIter", layer: "flag", value: undefined }]),
      undefined,
      "an offer of `undefined` is no offer",
    );
  });

  it("between two flags for one key the last wins, and the first is shadowed", () => {
    const { offers, errors } = flagOffers(["--set", "loop.maxIter=9", "--set", "loop.maxIter=3"]);
    assert.deepEqual([...errors], []);
    assert.equal(offers.length, 2);
    const merged = mergeKey("loop.maxIter", offers);
    assert.equal(merged?.value, 3);
    assert.equal(merged?.source, "flag");
    assert.equal(merged?.rank, 2);
    assert.equal(merged?.place, "--set loop.maxIter=3");
    assert.equal(merged?.shadowed.length, 1);
    assert.equal(merged?.shadowed[0]?.value, 9);
    assert.equal(merged?.shadowed[0]?.rank, 2, "the shadowed flag keeps rank 2");
  });

  it("three flags: the last of the three wins, whatever the order of the values", () => {
    for (const values of [
      ["1", "2", "3"],
      ["3", "2", "1"],
      ["5", "1", "4"],
    ]) {
      const { offers } = flagOffers(values.flatMap((v) => ["--set", `loop.maxIter=${v}`]));
      assert.equal(mergeKey("loop.maxIter", offers)?.value, Number(values[2]));
    }
  });

  it("the default is the built-in value of the catalogue or the value of the profile", () => {
    const builtIn = defaultOffers().find((o) => o.key === "loop.maxIter");
    assert.equal(builtIn?.value, 30, "the built-in default of §K.5");
    assert.equal(catalogueEntry("loop.maxIter")?.default.kind, "value");

    // The profile supplies a default at the rank of the default, and nothing above.
    const fromProfile = profileOffers("parity");
    assert.ok(fromProfile.length > 0);
    assert.ok(fromProfile.every((o) => o.layer === "default"));
    assert.ok(fromProfile.every((o) => o.profile === "parity"));
    const strategy = fromProfile.find((o) => o.key === "loop.strategy");
    assert.equal(strategy?.value, "classic", "row 1 of annex X §X.7");

    // Of the two offers at rank 8 the profile's is the one that stands.
    const merged = mergeKey("loop.strategy", [
      ...defaultOffers().filter((o) => o.key === "loop.strategy"),
      ...fromProfile.filter((o) => o.key === "loop.strategy"),
    ]);
    assert.equal(merged?.value, "classic");
    assert.equal(merged?.profile, "parity");
    assert.equal(merged?.rank, 8);
  });

  it("the profile loses to every explicit setting above rank 8", () => {
    const resolved = resolveConfiguration({
      argv: ["--set", "profile=parity", "--set", "loop.strategy=micro"],
    });
    assert.equal(resolved.profile, "parity");
    assert.equal(resolved.values.get("loop.strategy")?.value, "micro");
    assert.equal(resolved.values.get("loop.strategy")?.source, "flag");
    // and with no explicit setting, the profile's value stands.
    const bare = resolveConfiguration({ argv: ["--set", "profile=parity"] });
    assert.equal(bare.values.get("loop.strategy")?.value, "classic");
    assert.equal(bare.values.get("loop.strategy")?.profile, "parity");
  });

  it('every rank layer the column "Layers" of §K.1 names has a code, and back', () => {
    for (const [layer, code] of Object.entries(CODE_OF_RANK_LAYER)) {
      assert.equal(code === undefined ? undefined : layer, layer);
    }
    assert.equal(CODE_OF_RANK_LAYER["project-configuration"], "P");
    assert.equal(CODE_OF_RANK_LAYER["launch-contract-pin"], "C");
    assert.equal(CODE_OF_RANK_LAYER["learned-value"], undefined, "no `Layers` code: it is learned");
    assert.equal(CODE_OF_RANK_LAYER["default"], undefined);
  });

  it("the whole configuration is merged key by key, each with its own ranks", () => {
    const merged = mergeConfiguration([
      { key: "loop.maxIter", layer: "user-configuration", value: 10 },
      { key: "loop.maxIter", layer: "flag", value: 3 },
      { key: "loop.maxRejects", layer: "environment", value: 1 },
    ]);
    assert.equal(merged.get("loop.maxIter")?.value, 3);
    assert.equal(merged.get("loop.maxRejects")?.value, 1);
    assert.equal(merged.get("loop.maxRejects")?.source, "environment");
    assert.equal(merged.size, 2);
  });
});

describe("CT-110-114 — a list replaces and never concatenates (F110-FR-016)", () => {
  it("the rule is stated and the one exception is named", () => {
    assert.equal(LISTS_REPLACE, true);
    assert.equal(THE_ONE_LIST_EXCEPTION, "harnesses");
  });

  it("a list of the higher rank replaces the list of the lower, item for item", () => {
    const key = "loop.promptProtectedBlocks";
    assert.equal(catalogueEntry(key)?.type.kind, "list");
    const merged = mergeKey(key, [
      { key, layer: "user-configuration", value: ["yield_contract", "facts"] },
      { key, layer: "flag", value: ["facts"] },
    ]);
    assert.deepEqual(merged?.value, ["facts"]);
    // The negative half: nothing of the lower list survives in the value.
    assert.equal((merged?.value as string[]).includes("yield_contract"), false);
    assert.equal((merged?.value as string[]).length, 1);
    // The lower list is recorded as shadowed, whole.
    assert.deepEqual(merged?.shadowed[0]?.value, ["yield_contract", "facts"]);
  });

  it("an empty list of a higher rank replaces a full list of a lower one", () => {
    const key = "budget.alerts.thresholds";
    const merged = mergeKey(key, [
      { key, layer: "user-configuration", value: [50, 75, 90] },
      { key, layer: "environment", value: [] },
    ]);
    assert.deepEqual(merged?.value, []);
  });

  it("the list rule holds through the whole loader, not only through `mergeKey`", () => {
    const resolved = resolveConfiguration({
      argv: ["--set", "loop.promptProtectedBlocks=facts"],
      environment: { SPECSTRIDE_LOOP_PROMPT_PROTECTED_BLOCKS: "yield_contract,facts" },
    });
    assert.deepEqual(resolved.values.get("loop.promptProtectedBlocks")?.value, ["facts"]);
  });
});

describe("CT-110-114 — entries of `harnesses` merge by id (F110-FR-016)", () => {
  it("the four origins are those of the requirement, highest precedence first", () => {
    assert.deepEqual(
      [...HARNESS_ENTRY_ORIGINS],
      ["consumer-declared", "tested-adapter", "bundled-descriptor", "detected"],
    );
    assert.equal(precedenceOfOrigin("consumer-declared"), 0);
    assert.equal(precedenceOfOrigin("detected"), 3);
    assert.ok(
      precedenceOfOrigin("tested-adapter") < precedenceOfOrigin("bundled-descriptor"),
      "a tested adapter beats a bundled descriptor",
    );
  });

  it("for one id the entry of highest precedence wins, and the rest are shadowed", () => {
    const merged = mergeHarnessEntries([
      { id: "claude", entry: { bin: "/detected/claude" }, origin: "detected" },
      { id: "claude", entry: { bin: "/bundled/claude" }, origin: "bundled-descriptor" },
      { id: "claude", entry: { bin: "/tested/claude" }, origin: "tested-adapter" },
      { id: "claude", entry: { bin: "/declared/claude" }, origin: "consumer-declared" },
    ]);
    assert.equal(merged.get("claude")?.origin, "consumer-declared");
    assert.deepEqual(merged.get("claude")?.entry, { bin: "/declared/claude" });
    assert.equal(merged.get("claude")?.shadowed.length, 3);
    assert.deepEqual(
      merged.get("claude")?.shadowed.map((s) => s.origin),
      ["tested-adapter", "bundled-descriptor", "detected"],
    );
  });

  it("each origin in turn wins once the one above it is gone", () => {
    const all = [
      { id: "dsh", entry: { bin: "/declared" }, origin: "consumer-declared" as const },
      { id: "dsh", entry: { bin: "/tested" }, origin: "tested-adapter" as const },
      { id: "dsh", entry: { bin: "/bundled" }, origin: "bundled-descriptor" as const },
      { id: "dsh", entry: { bin: "/detected" }, origin: "detected" as const },
    ];
    for (let i = 0; i < all.length; i += 1) {
      const merged = mergeHarnessEntries(all.slice(i));
      assert.equal(merged.get("dsh")?.origin, HARNESS_ENTRY_ORIGINS[i]);
    }
  });

  it("the table merges and never replaces: an id only a lower place holds survives", () => {
    const merged = mergeHarnessEntries([
      { id: "codex", entry: { bin: "/detected/codex" }, origin: "detected" },
      { id: "prime", entry: { bin: "/bundled/prime" }, origin: "bundled-descriptor" },
      { id: "claude", entry: { bin: "/declared/claude" }, origin: "consumer-declared" },
    ]);
    assert.deepEqual([...merged.keys()].sort(), ["claude", "codex", "prime"]);
    // The negative half: the consumer's one entry did not replace the table.
    assert.equal(merged.size, 3);
    assert.equal(merged.get("codex")?.origin, "detected");
  });

  it("two entries of one origin are decided by the ranks, then by the order", () => {
    const merged = mergeHarnessEntries([
      {
        id: "pi",
        entry: { bin: "/user/pi" },
        origin: "consumer-declared",
        layer: "user-configuration",
      },
      { id: "pi", entry: { bin: "/flag/pi" }, origin: "consumer-declared", layer: "flag" },
    ]);
    assert.deepEqual(merged.get("pi")?.entry, { bin: "/flag/pi" });
    assert.equal(merged.get("pi")?.layer, "flag");
  });

  it("`harnesses.<id>` is the template key of the catalogue the exception is about", () => {
    const entry = catalogueEntry("harnesses.<id>");
    assert.notEqual(entry, undefined);
    assert.equal(entry?.isTemplate, true);
    assert.deepEqual([...(entry?.parameters ?? [])], ["<id>"]);
    assert.equal(entry?.cells.typeAndRange, "descriptor of feature 109's schema");
    assert.equal(entry?.key.split(".")[0], THE_ONE_LIST_EXCEPTION);
  });
});
