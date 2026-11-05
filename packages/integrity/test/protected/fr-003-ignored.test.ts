// CT-116-3 (F116-FR-003; IR-35) — cases of an ignored path from which a check
// executes: the listing holds name, kind, size, mode, modification time and
// the time of the last change of status; a change of content that restores
// size and modification time still changes the listing; a pinned executable
// and a file matched by a class A pattern are hashed by content; the record
// of the protected set names the path and the files hashed by content.
import { test } from "node:test";
import assert from "node:assert/strict";
import { utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, writeFile } from "./helpers.ts";
import { listIgnoredPath } from "../../src/protected/listing.ts";
import { validatorFor } from "../../../../packages/contracts/src/records/compile.ts";
import { writeProtectedSetRecord } from "../../src/result/record.ts";

test("CT-116-3 ignored: the listing holds name, kind, size, mode, mtime and ctime per entry", () => {
  const root = makeRepo({});
  writeFile(root, "node_modules/pkg/index.js", "export {};");
  writeFile(root, "node_modules/pkg/other.js", "other");
  const listing = listIgnoredPath(root, "node_modules", { patterns: [] });
  assert.equal(listing.path, "node_modules");
  assert.match(listing.listingHash, /^[0-9a-f]{64}$/);
  const entry = listing.entries.find((e) => e.name === "pkg/index.js");
  assert.ok(entry);
  assert.deepEqual(Object.keys(entry).sort(), [
    "ctimeMs",
    "kind",
    "mode",
    "mtimeMs",
    "name",
    "size",
  ]);
  assert.equal(entry.kind, "file");
  assert.equal(entry.size, "export {};".length);
  assert.equal(typeof entry.mode, "number");
  assert.equal(typeof entry.mtimeMs, "number");
  assert.equal(typeof entry.ctimeMs, "number");
});

test("CT-116-3 ignored: content changed with size and mtime restored still changes the listing", () => {
  const root = makeRepo({});
  writeFile(root, "cachedir/blob", "aaaa");
  const before = listIgnoredPath(root, "cachedir", { patterns: [] });
  const first = listIgnoredPath(root, "cachedir", { patterns: [] });
  // Same size, same modification time: only the content and the time of the
  // last change of status differ.
  const full = join(root, "cachedir/blob");
  const mtime = new Date();
  writeFileSync(full, "bbbb");
  utimesSync(full, mtime, mtime);
  const after = listIgnoredPath(root, "cachedir", { patterns: [] });
  assert.notEqual(before.listingHash, after.listingHash);
  assert.equal(first.listingHash, before.listingHash); // stable when nothing changed
  const entry = after.entries.find((e) => e.name === "blob");
  assert.ok(entry);
  assert.notEqual(entry.ctimeMs, before.entries[0].ctimeMs);
});

test("CT-116-3 ignored: pinned executable and class A pattern file hashed by content, other file not", () => {
  const root = makeRepo({});
  writeFile(root, "node_modules/.bin/stub-run", "ELF");
  writeFile(root, "node_modules/toolchain/runner.json", "v1");
  writeFile(root, "node_modules/plain/readme.txt", "hello");
  const listing = listIgnoredPath(root, "node_modules", {
    patterns: ["toolchain/**"],
    pinnedExecutables: ["node_modules/.bin/stub-run"],
  });
  const hashed = listing.contentHashed.map((c) => c.path).sort();
  assert.deepEqual(hashed, ["node_modules/.bin/stub-run", "node_modules/toolchain/runner.json"]);
  assert.ok(listing.contentHashed.every((c) => /^[0-9a-f]{64}$/.test(c.hash)));
});

test("CT-116-3 ignored: the record of the protected set names the path and the files hashed by content", () => {
  const root = makeRepo({});
  writeFile(root, "node_modules/toolchain/runner.json", "v1");
  const listing = listIgnoredPath(root, "node_modules", { patterns: ["toolchain/**"] });
  const record = writeProtectedSetRecord({
    phase: 1,
    profiles: [],
    basic: false,
    classAPatterns: ["toolchain/**"],
    ignoredListings: [
      {
        path: listing.path,
        listingHash: listing.listingHash,
        contentHashed: listing.contentHashed,
      },
    ],
    classBFiles: [],
    authorised: {},
    atLaunch: { set: "s0", tree: "t0" },
    atPhaseEntry: { set: "s1", tree: "t1" },
    exclusions: ["node_modules"],
    effectiveConfig: null,
  });
  const validate = validatorFor("specstride.protected-set/1").validate;
  assert.equal(validate(record), true);
  assert.equal(record.schema, "specstride.protected-set/1");
  assert.equal(record.classA.ignoredListings[0].path, "node_modules");
  assert.deepEqual(record.classA.ignoredListings[0].contentHashed, listing.contentHashed);
});
