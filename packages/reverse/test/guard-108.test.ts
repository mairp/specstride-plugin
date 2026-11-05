/**
 * T023 — the rules of the guard's RE-WALK, which the comparison of
 * F108-FR-027 rests on.
 *
 * `walk.ts` is this feature's own walk: `@specstride/reverse` sits at layer L6
 * and may import contracts, kernel and spec-formats only, so it cannot reach
 * the inventory's walk, which feature 140 owns. The re-walk must therefore
 * AGREE with the rules feature 140's specification fixes — a disagreement would
 * make the guard report a change that never happened. These tests hold it to
 * each of those rules one at a time.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import * as walk from "../src/guard/walk.ts";
import * as git from "../src/guard/git.ts";
import * as theGuard from "../src/guard/guard.ts";

let root: string | undefined;
afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function sourceTree(files: Readonly<Record<string, string>>): string {
  root = mkdtempSync(join(tmpdir(), "specstride-108-guard-walk-"));
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return root;
}

describe("T023 — the exclusions of the re-walk (F140-FR-017, B-1928)", () => {
  it("strips the slashes, de-duplicates and sorts by code point", () => {
    assert.deepEqual(
      [...walk.guardExcludes(["/b/", "a", "b", "/c"], "specs/001-as-is-x")],
      ["a", "b", "c", "specs/001-as-is-x"],
    );
  });

  it("adds the output directory, and tolerates none", () => {
    assert.deepEqual([...walk.guardExcludes([], "out")], ["out"]);
    assert.deepEqual([...walk.guardExcludes(["a"], undefined)], ["a"]);
    assert.deepEqual([...walk.guardExcludes([], "")], []);
  });

  it("an exclusion matches itself and everything under it", () => {
    assert.equal(walk.isUnderAnExclusion("out", ["out"]), true);
    assert.equal(walk.isUnderAnExclusion("out/a/b.ts", ["out"]), true);
    assert.equal(walk.isUnderAnExclusion("outer/a.ts", ["out"]), false);
  });

  it("an excluded path is not a candidate of the file-system walk", () => {
    const src = sourceTree({ "a.ts": "a\n", "out/b.ts": "b\n", "out/deep/c.ts": "c\n" });
    assert.deepEqual([...walk.fileSystemCandidates(src, ["out"])], ["a.ts"]);
  });
});

describe("T023 — the deny list and the names of state (F140-FR-017, F140-FR-018)", () => {
  it("the lists are the ones B-1910 and B-1911 name", () => {
    assert.deepEqual([...walk.STATE_DIRECTORY_NAMES], [".specstride", ".lisa"]);
    assert.deepEqual(
      [...walk.DENY_DIRECTORIES],
      [
        ".git",
        "node_modules",
        ".venv",
        "venv",
        "__pycache__",
        "dist",
        "build",
        "target",
        "vendor",
        "testautomation",
      ],
    );
  });

  it("the file-system walk skips a denied directory at ANY depth", () => {
    const src = sourceTree({
      "a.ts": "a\n",
      "node_modules/x/index.js": "x\n",
      "deep/node_modules/y/index.js": "y\n",
      "deep/dist/z.js": "z\n",
      ".git/HEAD": "ref\n",
      "testautomation/report.json": "{}\n",
      ".specstride/features/x/state.json": "{}\n",
      ".lisa/old.json": "{}\n",
      "keep/b.ts": "b\n",
    });
    assert.deepEqual([...walk.fileSystemCandidates(src, [])], ["a.ts", "keep/b.ts"]);
  });

  it("in GIT mode the deny list does NOT apply, but a state component still drops", () => {
    const listing = [
      "a.ts",
      "dist/bundle.js",
      "node_modules/x/index.js",
      ".specstride/features/x/state.json",
      ".lisa/old.json",
      "out/spec.md",
    ];
    assert.deepEqual(
      [...walk.gitCandidates(listing, ["out"])],
      ["a.ts", "dist/bundle.js", "node_modules/x/index.js"],
    );
  });

  it("a state directory NAME at the top level drops in git mode too", () => {
    assert.deepEqual([...walk.gitCandidates([".specstride", "a.ts"], [])], ["a.ts"]);
  });

  it("candidate paths are sorted by code point, never by locale", () => {
    assert.deepEqual([...walk.gitCandidates(["b", "A", "a", "B"], [])], ["A", "B", "a", "b"]);
  });
});

describe("T023 — the root `.gitignore`, as the glob subset (F140-FR-018, B-1919, B-1920)", () => {
  it("only the ROOT ignore file is read", () => {
    const src = sourceTree({
      ".gitignore": "ignored.txt\n",
      "ignored.txt": "x\n",
      "deep/.gitignore": "kept.txt\n",
      "deep/kept.txt": "y\n",
    });
    const found = walk.fileSystemCandidates(src, []);
    assert.ok(!found.includes("ignored.txt"));
    assert.ok(found.includes("deep/kept.txt"), "a nested ignore file is not honoured");
  });

  it("`!` negates and the LAST matching rule wins", () => {
    const rules = walk.compileIgnoreRules("*.log\n!keep.log\n");
    assert.equal(walk.isIgnored(rules, "a.log", false), true);
    assert.equal(walk.isIgnored(rules, "keep.log", false), false);
    const reversed = walk.compileIgnoreRules("!keep.log\n*.log\n");
    assert.equal(walk.isIgnored(reversed, "keep.log", false), true);
  });

  it("a trailing `/` is directory-only", () => {
    const rules = walk.compileIgnoreRules("cache/\n");
    assert.equal(walk.isIgnored(rules, "cache", true), true);
    assert.equal(walk.isIgnored(rules, "cache", false), false);
  });

  it("a pattern with `/` is anchored to the source-relative path", () => {
    const rules = walk.compileIgnoreRules("src/generated\n");
    assert.equal(walk.isIgnored(rules, "src/generated", false), true);
    assert.equal(walk.isIgnored(rules, "deep/src/generated", false), false);
  });

  it("a pattern without `/` matches the base name at any depth", () => {
    const rules = walk.compileIgnoreRules("tags\n");
    assert.equal(walk.isIgnored(rules, "tags", false), true);
    assert.equal(walk.isIgnored(rules, "deep/inner/tags", false), true);
  });

  it("`**/` is removed and a trailing `/**` is read as `/*`", () => {
    const removed = walk.compileIgnoreRules("**/build\n");
    assert.equal(removed[0]?.anchored, false, "`**/` is gone, so the pattern is a base name");
    assert.equal(walk.isIgnored(removed, "deep/build", false), true);
    const trailing = walk.compileIgnoreRules("logs/**\n");
    assert.equal(walk.isIgnored(trailing, "logs/a.log", false), true);
    assert.equal(walk.isIgnored(trailing, "logs/a/b.log", false), false);
  });

  it("a comment and a blank line are no rule", () => {
    assert.equal(walk.compileIgnoreRules("# a comment\n\n   \n").length, 0);
  });

  it("an ignored DIRECTORY is not descended", () => {
    const src = sourceTree({ ".gitignore": "cache/\n", "cache/deep/a.ts": "a\n", "b.ts": "b\n" });
    assert.deepEqual([...walk.fileSystemCandidates(src, [])], [".gitignore", "b.ts"]);
  });
});

describe("T023 — the entry of one path (F140-FR-020, F108-FR-032)", () => {
  it("a regular file gives its size and the canonical hash of its content", () => {
    const src = sourceTree({ "a.ts": "export const a = 1;\n" });
    const entry = walk.entryOf(src, "a.ts");
    assert.ok(entry !== undefined);
    assert.equal(entry.bytes, Buffer.byteLength("export const a = 1;\n"));
    assert.equal(entry.sha256, createHash("sha256").update("export const a = 1;\n").digest("hex"));
    assert.equal(entry.symlink, false);
  });

  it("a link gives the size and the hash of its TARGET STRING, and is never followed", () => {
    const src = sourceTree({ "a.ts": "export const a = 1;\n" });
    symlinkSync("a.ts", join(src, "link.ts"));
    const entry = walk.entryOf(src, "link.ts");
    assert.ok(entry !== undefined);
    assert.equal(entry.symlink, true);
    assert.equal(entry.bytes, Buffer.byteLength("a.ts"));
    assert.equal(entry.sha256, createHash("sha256").update("a.ts").digest("hex"));
  });

  it("a directory, and a path that vanished, give no entry at all", () => {
    const src = sourceTree({ "deep/a.ts": "a\n" });
    assert.equal(walk.entryOf(src, "deep"), undefined);
    assert.equal(walk.entryOf(src, "gone.ts"), undefined);
  });

  it("the content is read in 64 KiB chunks (B-1915) and comes out whole", () => {
    assert.equal(walk.READ_CHUNK_BYTES, 64 * 1024);
    const big = "x".repeat(walk.READ_CHUNK_BYTES * 2 + 7);
    const src = sourceTree({ "big.txt": big });
    const entry = walk.entryOf(src, "big.txt");
    assert.ok(entry !== undefined);
    assert.equal(entry.bytes, big.length);
    assert.equal(entry.sha256, createHash("sha256").update(big).digest("hex"));
  });
});

describe("T023 — the fingerprint (F140-FR-021)", () => {
  it("is the SHA-256 of the compact JSON of the SORTED triples", () => {
    const entries = [
      { path: "b.ts", bytes: 2, sha256: "bb" },
      { path: "a.ts", bytes: 1, sha256: "aa" },
    ];
    const expected = createHash("sha256").update('[["a.ts",1,"aa"],["b.ts",2,"bb"]]').digest("hex");
    assert.equal(walk.fingerprintOfEntries(entries), expected);
  });

  it("escapes non-ASCII characters, as the baseline's `json.dumps` default does", () => {
    assert.equal(walk.compactAsciiJson(["café"]), '["caf\\u00e9"]');
    assert.equal(walk.compactAsciiJson({ a: 1 }), '{"a":1}', "no space after `:` or `,`");
  });

  it("the order of the input does not change it", () => {
    const a = [
      { path: "a", bytes: 1, sha256: "x" },
      { path: "b", bytes: 2, sha256: "y" },
    ];
    assert.equal(walk.fingerprintOfEntries(a), walk.fingerprintOfEntries([...a].reverse()));
  });
});

describe("T023 — the git seam (F108-FR-030; B-1917, B-1918, B-1921)", () => {
  it("HEAD is the verified commit, or null when git says no", () => {
    assert.equal(
      git.gitHead("/x", () => ({ status: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" })),
      "a".repeat(40),
    );
    assert.equal(
      git.gitHead("/x", () => ({ status: 1, stdout: "", stderr: "" })),
      null,
    );
    assert.equal(
      git.gitHead("/x", () => ({ status: 0, stdout: "\n", stderr: "" })),
      null,
    );
  });

  it("the status is the sorted porcelain entries, with a rename's source dropped", () => {
    const stdout = "R  new.ts\0old.ts\0 M b.ts\0?? a.ts\0";
    assert.deepEqual(
      [...git.gitStatus("/x", () => ({ status: 0, stdout, stderr: "" }))],
      [" M b.ts", "?? a.ts", "R  new.ts"],
    );
  });

  it("a copy's source record is dropped too", () => {
    assert.deepEqual([...git.parsePorcelainZ("C  copy.ts\0from.ts\0")], ["C  copy.ts"]);
  });

  it("a failing status gives no entries rather than a false problem", () => {
    assert.deepEqual(
      [...git.gitStatus("/x", () => ({ status: 128, stdout: "", stderr: "x" }))],
      [],
    );
  });

  it("a failing listing throws the as-is message of B-1874", () => {
    assert.throws(
      () => git.gitListing("/src", () => ({ status: 128, stdout: "", stderr: "fatal: no\n" })),
      /^Error: git ls-files failed in \/src: fatal: no$/,
    );
  });

  it("the path of a status entry is everything after `XY `", () => {
    assert.equal(git.pathOfAStatusEntry("?? a/b.ts"), "a/b.ts");
    assert.equal(git.pathOfAStatusEntry(" M a.ts"), "a.ts");
  });
});

describe("T023 — the pure pieces of the guard (F108-FR-028, F108-FR-030, F108-FR-031)", () => {
  it("the comparison sorts each kind and reports nothing else", () => {
    const baseline = new Map([
      ["gone.ts", { bytes: 1, sha256: "a" }],
      ["same.ts", { bytes: 2, sha256: "b" }],
      ["moved.ts", { bytes: 3, sha256: "c" }],
    ]);
    const comparison = theGuard.compareEntries(baseline, [
      { path: "same.ts", bytes: 2, sha256: "b", symlink: false },
      { path: "moved.ts", bytes: 3, sha256: "z", symlink: false },
      { path: "b-new.ts", bytes: 4, sha256: "d", symlink: false },
      { path: "a-new.ts", bytes: 5, sha256: "e", symlink: false },
    ]);
    assert.deepEqual([...comparison.deleted], ["gone.ts"]);
    assert.deepEqual([...comparison.added], ["a-new.ts", "b-new.ts"]);
    assert.deepEqual([...comparison.changed], ["moved.ts"]);
  });

  it("a size that differs while the hash agrees is still `changed`", () => {
    const comparison = theGuard.compareEntries(new Map([["a", { bytes: 1, sha256: "h" }]]), [
      { path: "a", bytes: 2, sha256: "h", symlink: false },
    ]);
    assert.deepEqual([...comparison.changed], ["a"]);
  });

  it("the problems of an empty comparison are the fingerprint line alone", () => {
    assert.deepEqual(
      [...theGuard.problemsOfTheComparison({ deleted: [], added: [], changed: [] })],
      ["fingerprint differs from the baseline"],
    );
  });

  it("the status exemptions are the three of F108-FR-030", () => {
    const exemptions = { out: "specs/001-x", statePart: ".specstride" };
    assert.equal(theGuard.isAnExemptStatusEntry("?? specs/001-x/a.md", [], exemptions), true);
    assert.equal(theGuard.isAnExemptStatusEntry("?? .specstride/s.json", [], exemptions), true);
    assert.equal(theGuard.isAnExemptStatusEntry(" M a.ts", [" M a.ts"], exemptions), true);
    assert.equal(theGuard.isAnExemptStatusEntry(" M a.ts", [], exemptions), false);
  });

  it("a sibling of the output directory is NOT exempt", () => {
    assert.equal(
      theGuard.isAnExemptStatusEntry("?? specs/001-xtra/a.md", [], {
        out: "specs/001-x",
        statePart: undefined,
      }),
      false,
    );
  });

  it("the git problems are the moved HEAD and each new entry", () => {
    const fields = {
      fingerprint: "f",
      files: [],
      skipped: [],
      excludes: [],
      walk: "git" as const,
      git_head: "a".repeat(40),
      git_status: [" M kept.ts"],
      testautomation: null,
      oversize: false,
      units: [],
      project: {},
      specify: {},
    };
    assert.deepEqual(
      [
        ...theGuard.gitProblems(fields, "b".repeat(40), [" M kept.ts", "?? new.ts"], {
          out: undefined,
          statePart: undefined,
        }),
      ],
      [`git HEAD moved: ${"a".repeat(40)} -> ${"b".repeat(40)}`, "git status: ?? new.ts"],
    );
  });

  it("a HEAD that did not move gives no line", () => {
    const fields = {
      fingerprint: "f",
      files: [],
      skipped: [],
      excludes: [],
      walk: "git" as const,
      git_head: "a".repeat(40),
      git_status: null,
      testautomation: null,
      oversize: false,
      units: [],
      project: {},
      specify: {},
    };
    assert.deepEqual(
      [
        ...theGuard.gitProblems(fields, "a".repeat(40), [], {
          out: undefined,
          statePart: undefined,
        }),
      ],
      [],
    );
  });

  it("the lines and the exit codes are F108-FR-031's", () => {
    assert.deepEqual([...theGuard.guardLines([], "out")], [theGuard.GUARD_OK_LINE]);
    assert.deepEqual(
      [...theGuard.guardLines(["changed: a", "added: b"], "out")],
      [
        "guard: changed: a",
        "guard: added: b",
        "guard: FAILED — 2 change(s) outside out and the state dir",
      ],
    );
    assert.equal(theGuard.guardExitCode([]), 0);
    assert.equal(theGuard.guardExitCode(["x"]), 3);
  });

  it("a path is resolved against the SOURCE, not the working directory", () => {
    assert.equal(theGuard.sourceRelative("/src", "specs/001-x"), "specs/001-x");
    assert.equal(theGuard.sourceRelative("/src", "/src/specs/001-x"), "specs/001-x");
    assert.equal(theGuard.sourceRelative("/src", "/elsewhere"), undefined);
    assert.equal(theGuard.sourceRelative("/src", "/src"), undefined);
  });
});
