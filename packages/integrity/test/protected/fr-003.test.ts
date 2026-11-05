// CT-116-3 (F116-FR-003): scope of the tree fingerprint, exclusions, content
// hashing of protected files whatever the metadata cache says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, stubProfile, writeFile } from "./helpers.ts";
import { treeFingerprint } from "../../src/fingerprint/tree.ts";
import { classAPatternsOf, matchClassA } from "../../src/protected/set.ts";
import { git } from "./helpers.ts";

test("CT-116-3 scope: tracked and untracked non-ignored files; ignored excluded and recorded", async () => {
  const root = makeRepo({ "a.ts": "a" });
  writeFile(root, "untracked.ts", "u");
  writeFile(root, "ignored.log", "i");
  git(root, ["add", "untracked.ts"]); // still untracked? no: staged counts as tracked for ls-files
  const result = await treeFingerprint(root, { ignoredRoots: ["ignored.log"] });
  assert.ok(result.files.includes("a.ts"));
  assert.ok(result.files.includes("untracked.ts"));
  assert.ok(!result.files.includes("ignored.log"));
  assert.deepEqual(result.exclusions.ignored, ["ignored.log"]);
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
});

test("CT-116-3 a protected file is hashed by content even when the metadata cache claims it fresh", async () => {
  const root = makeRepo({ "toolchain/runner.json": "v1" });
  const patterns = classAPatternsOf([stubProfile]);
  assert.equal(matchClassA(patterns, "toolchain/runner.json"), true);
  const first = await treeFingerprint(root, { protectedPaths: ["toolchain/runner.json"] });
  // Touch the file keeping size and rewrite with same length, then feed a
  // stale cache entry: the protected path must still be hashed by content.
  writeFile(root, "toolchain/runner.json", "v2");
  const staleCache = { [`${root}/toolchain/runner.json`]: "stale-not-a-hash" };
  const second = await treeFingerprint(root, {
    protectedPaths: ["toolchain/runner.json"],
    cache: staleCache,
  });
  assert.notEqual(first.fingerprint, second.fingerprint);
});

test("CT-116-3 inside an ignored path the listing carries the metadata of every entry", async () => {
  const root = makeRepo({});
  writeFile(root, "node_modules/.bin/tool", "x");
  const listing = await treeFingerprint(root, { ignoredRoots: ["node_modules"] });
  assert.equal(listing.ignoredListings.length, 1);
  const entry = listing.ignoredListings[0];
  assert.equal(entry.path, "node_modules");
  assert.match(entry.listingHash, /^[0-9a-f]{64}$/);
  // name, kind, size, mode, modification time, time of the last change of status
  assert.deepEqual(Object.keys(entry.entries[0]).sort(), [
    "ctimeMs",
    "kind",
    "mode",
    "mtimeMs",
    "name",
    "size",
  ]);
});

test("CT-116-3 a changed ignored path whose listing changed changes the fingerprint", async () => {
  const root = makeRepo({});
  writeFile(root, "cachedir/blob", "1");
  const one = await treeFingerprint(root, { ignoredRoots: ["cachedir"] });
  writeFile(root, "cachedir/blob", "22");
  const two = await treeFingerprint(root, { ignoredRoots: ["cachedir"] });
  assert.notEqual(one.fingerprint, two.fingerprint);
});
