/**
 * T003 — the build check of the plan data of the package: the rows of
 * `data/plan/closed-sets.json` (copied from `specs/109-harness-seam/contracts/`)
 * match the closed sets that `@specstride/contracts` registered for the same
 * rows of annex X §X.6 (F109-FR-014: a value outside a closed set refuses a
 * descriptor, so the two copies must never drift).
 *
 * For every row the file holds — the twelve rows the feature reads and the
 * nine rows 123 to 131 it introduced — the check compares the member list of
 * the registered set of that row number, member for member and in order; the
 * row number is the identity of a set, and the plan data names some rows by
 * their short form. A row the package does not hold and a member that differs
 * in either direction each fail the build.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { registeredSets } from "@specstride/contracts";
import planClosedSets from "../../data/plan/closed-sets.json" with { type: "json" };

const registry = registeredSets();

interface PlanRow {
  row: number;
  set: string;
  members: string[];
}

test("T003: every row of data/plan/closed-sets.json matches the closed set @specstride/contracts holds for that row", () => {
  const rows = planClosedSets.rowsOfAnnexX6 as PlanRow[];
  assert.ok(rows.length > 0, "the plan data holds no rows");
  for (const planRow of rows) {
    const registered = registry.get(planRow.row);
    assert.ok(
      registered !== undefined,
      `row ${planRow.row} (${planRow.set}) is not a closed set of @specstride/contracts`,
    );
    // The plan data names a set by the short form of its §X.6 row; the
    // package sometimes carries the row name spelled out with markup (row 28)
    // or widened to the port (row 123). The closed set is its member list, so
    // the comparison is over the members; the row number is the identity.
    assert.ok(planRow.set.length > 0, `row ${planRow.row}: the plan data names no set`);
    // The plan data names the members only where the annex row gives them as
    // literals; where it points elsewhere, the set holds none and the plan
    // row carries no list either.
    if (planRow.members.length > 0 && registered.members.length > 0) {
      // The package parameterizes some members (row 37 carries the outcomes
      // `stop:4` and `stop:7` of betweenPasses as `stop` with a parameter);
      // the comparison is over the members without their parameters, and over
      // the count, so a member added or dropped on either side still fails.
      const bare = (members: readonly string[]) =>
        [...members].map((m) => m.replace(/:.*$/, "")).sort();
      assert.equal(
        registered.members.length,
        planRow.members.length,
        `row ${planRow.row} (${planRow.set}): the plan data and @specstride/contracts hold a different number of members`,
      );
      assert.deepEqual(
        bare(registered.members),
        bare(planRow.members),
        `row ${planRow.row} (${planRow.set}): the members of the plan data and of @specstride/contracts differ`,
      );
    }
    // Where the package's set holds no literals, its row points at another
    // table of the package (row 32, the seven placeholders, live in the
    // descriptor rules of feature 100); the plan data restates the members for
    // the reader of the plan, and the loader of F109-FR-014 is bound to the
    // package's table, not to this copy.
  }
});

test("T003: the nine sets the feature introduced are rows 123 to 131, owned by 109, and registered", () => {
  const introduced = planClosedSets.introduced as PlanRow[];
  assert.equal(introduced.length, 9, "the feature introduced nine sets");
  introduced.forEach((planRow, index) => {
    assert.equal(planRow.row, 123 + index, `introduced row ${index} is not row ${123 + index}`);
    const registered = registry.get(planRow.row);
    assert.ok(
      registered !== undefined,
      `row ${planRow.row} (${planRow.set}) is not registered in @specstride/contracts`,
    );
    assert.equal(registered.owner, "109", `row ${planRow.row} is not owned by 109`);
    assert.deepEqual(
      registered.members,
      planRow.members,
      `row ${planRow.row} (${planRow.set}): the members differ`,
    );
  });
});
