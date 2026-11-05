// CT-116-11 (F116-FR-011): suppression markers per file; no test counts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countMarkersPerFile, NO_TEST_COUNTS } from "../../src/protected/markers.ts";

const before = {
  "test/a.test.ts": "it('a', () => {}); // skip: reason\nit('b', () => {});\n",
  "src/app.ts": "const x = 1; // skip: legacy\n",
};

test("CT-116-11 a marker added since phase entry is counted for its file", () => {
  const after = {
    ...before,
    "test/a.test.ts": "it('a', () => {}); // skip: reason\nit('b', () => {}); // skip: added\n",
  };
  const counts = countMarkersPerFile(before, after, ["skip"]);
  const a = counts.find((c) => c.path === "test/a.test.ts");
  assert.equal(a && a.added, 1);
  assert.equal(a && a.removed, 0);
});

test("CT-116-11 a marker removed since phase entry is counted for its file", () => {
  const after = { ...before, "src/app.ts": "const x = 1;\n" };
  const counts = countMarkersPerFile(before, after, ["skip"]);
  const app = counts.find((c) => c.path === "src/app.ts");
  assert.equal(app && app.removed, 1);
});

test("CT-116-11 no count of tests is produced, only marker counts", () => {
  const counts = countMarkersPerFile(before, before, ["skip"]);
  for (const c of counts) {
    for (const key of Object.keys(c)) {
      assert.match(key, /path|added|removed/); // no test-count field exists
    }
  }
  assert.equal(NO_TEST_COUNTS, true);
});
