// CT-116-139 (IR-39; F116-FR-011): suppression markers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countMarkersPerFile } from "../../src/protected/markers.ts";

test("IR-39 markers are counted per file from the versioned pattern set", () => {
  const counts = countMarkersPerFile(
    { "a.ts": "// skip: old\n" },
    { "a.ts": "// skip: old\n// skip: new\n" },
    ["skip"],
  );
  assert.deepEqual(counts, [{ path: "a.ts", added: 1, removed: 0 }]);
});

test("IR-39 a removal and an addition in different files are counted separately", () => {
  const counts = countMarkersPerFile(
    { "a.ts": "// skip\n", "b.ts": "// skip\n" },
    { "a.ts": "", "b.ts": "// skip\n// skip\n" },
    ["skip"],
  );
  assert.deepEqual(
    counts.sort((x, y) => x.path.localeCompare(y.path)),
    [
      { path: "a.ts", added: 0, removed: 1 },
      { path: "b.ts", added: 1, removed: 0 },
    ],
  );
});

test("IR-39 no count of tests is produced", () => {
  const counts = countMarkersPerFile({}, {}, ["skip"]);
  assert.deepEqual(counts, []);
});
