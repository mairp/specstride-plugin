/**
 * T001 — unit tests of the grounding source extracted from Lisa at `363e6a3`
 * and brought to F117-FR-003 – F117-FR-012 (see LISA-ALIGNMENT.md).
 *
 * Covered here: the extraction rules (locators, ellipsis, trailing characters,
 * brace cap, scheme/@v/whitespace drops, dotfile rule), the cap of 80 presence
 * lines with the NOT-SHOWN line beyond it, wildcard expansion at snapshot time
 * (never at extraction), the as-is presence-line shapes, the drop of a bare
 * token that does not resolve, the escape rule, and the grounding gap.
 *
 * The module itself imports no `node:fs` (F100-FR-012: a core package reads no
 * file itself); the tests carry the Node adapter of the `GroundingIo` port.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  globSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BUDGETS,
  GROUNDING_MAX_FILES,
  NOT_SHOWN_LINE,
  MISSING_LINE,
  SNAPSHOT_HEADING,
  type GroundingIo,
  extractPaths,
  expandBraceCitation,
  groundingGap,
  groundingSnapshot,
  renderSnapshot,
} from "../../src/critic-input/grounding/index.ts";

/** The Node adapter of the read-only port (the edge packages own the shipped one). */
function nodeIo(): GroundingIo {
  return {
    realpath: (path) => {
      try {
        return realpathSync(path);
      } catch {
        return undefined;
      }
    },
    stat: (path) => {
      try {
        const st = statSync(path);
        return {
          isDirectory: st.isDirectory(),
          isFile: st.isFile(),
          size: st.size,
          mtimeMs: st.mtimeMs,
        };
      } catch {
        return undefined;
      }
    },
    listDir: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return undefined;
      }
    },
    readHeadTail: (path, headBytes, tailBytes, threshold) => {
      let st;
      try {
        st = statSync(path);
        if (!st.isFile()) return undefined;
      } catch {
        return undefined;
      }
      const fd = openSync(path, "r");
      try {
        const head = Buffer.alloc(Math.min(headBytes, st.size));
        if (head.length > 0) readSync(fd, head, 0, head.length, 0);
        let tail = Buffer.alloc(0);
        if (st.size > threshold) {
          tail = Buffer.alloc(Math.min(tailBytes, st.size - headBytes));
          readSync(fd, tail, 0, tail.length, st.size - tail.length);
        }
        return { head, tail, size: st.size };
      } catch {
        return undefined;
      } finally {
        closeSync(fd);
      }
    },
    glob: (pattern) => {
      try {
        return globSync(pattern);
      } catch {
        return [];
      }
    },
    repositoryFiles: (workdir) => {
      try {
        const raw = execFileSync(
          "git",
          ["-C", workdir, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
          { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
        );
        return raw.split("\0").filter(Boolean);
      } catch {
        // No git repo: a bounded filesystem inventory instead.
        const skipped = new Set([".git", "node_modules", "dist", "coverage"]);
        const out: string[] = [];
        const pending: Array<{ abs: string; rel: string }> = [{ abs: workdir, rel: "" }];
        while (pending.length > 0 && out.length < 100_000) {
          const current = pending.shift()!;
          let entries;
          try {
            entries = readdirSync(current.abs, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const entry of entries) {
            const rel = current.rel ? join(current.rel, entry.name) : entry.name;
            if (entry.isDirectory()) {
              if (!skipped.has(entry.name))
                pending.push({ abs: join(current.abs, entry.name), rel });
              continue;
            }
            if (entry.isFile()) out.push(rel);
          }
        }
        return out;
      }
    },
  };
}

function tmpWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "f117-grounding-"));
}

test("extraction strips line locators before resolution (F117-FR-003)", () => {
  const out = extractPaths(
    "reads `src/a.ts:101`, src/b.ts:10-20, src/c.py:12:5, src/d.ts#L12-L20 and tests/e.test.ts::test_y.",
  );
  assert.deepEqual(out, ["src/a.ts", "src/b.ts", "src/c.py", "src/d.ts", "tests/e.test.ts"]);
});

test("extraction strips a leading ellipsis and trailing characters (F117-FR-003)", () => {
  const out = extractPaths("… packages/core/src/index.ts. (see docs/x.md), then lib/y.rs;");
  assert.deepEqual(out, ["packages/core/src/index.ts", "docs/x.md", "lib/y.rs"]);
});

test("extraction drops schemes, white space, @v tags and honours the brace cap of 16 (F117-FR-003)", () => {
  assert.deepEqual(extractPaths("`https://example.com/a.ts`"), []);
  assert.deepEqual(extractPaths("`jobs.run@v1`"), []);
  assert.deepEqual(extractPaths("`a b/c.ts`"), []);
  const expanded = expandBraceCitation("src/{a,b,c}.ts");
  assert.deepEqual(expanded, ["src/a.ts", "src/b.ts", "src/c.ts"]);
  const many = expandBraceCitation("src/{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17}.ts");
  assert.deepEqual(many, ["src/{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17}.ts"]);
  assert.equal(BUDGETS.braceExpansions, 16);
});

test("a bare leading-dot token is a dotfile only with a lower-case letter after the dot (F117-FR-003)", () => {
  const out = extractPaths("`.envrc` and `.Eslint` appear; only one is a path token");
  assert.deepEqual(out, [".envrc"]);
});

test("a wildcard is kept at extraction and expanded only at snapshot time (F117-FR-010)", () => {
  const workdir = tmpWorkspace();
  try {
    mkdirSync(join(workdir, "docs"));
    writeFileSync(join(workdir, "docs", "one.md"), "first\n");
    writeFileSync(join(workdir, "docs", "two.md"), "second\n");
    writeFileSync(join(workdir, "docs", "notes.txt"), "not matched\n");
    const cited = extractPaths("see `docs/*.md` here");
    assert.deepEqual(cited, ["docs/*.md"]);
    const snap = groundingSnapshot(["docs/*.md"], workdir, [""], nodeIo(), []);
    const line = snap.lines.map((l) => l.text).find((t) => t.includes("wildcard"));
    assert.ok(line, "the wildcard citation keeps one presence line");
    assert.match(
      line!,
      /present: wildcard matches 2 file\(s\) on disk: `docs\/one\.md`, `docs\/two\.md`/,
    );
    assert.ok(!line!.includes("not matched"), "no content of matched files is excerpted");
    assert.equal(snap.lines.filter((l) => l.kind === "wildcard").length, 1);
    assert.ok(snap.lines.every((l) => !l.text.includes("```\n")));
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("the cap is 80 and the paths beyond it render one NOT-SHOWN line, never MISSING (F117-FR-008/009)", () => {
  assert.equal(GROUNDING_MAX_FILES, BUDGETS.presenceLineCap);
  assert.equal(GROUNDING_MAX_FILES, 80);
  const workdir = tmpWorkspace();
  try {
    const paths: string[] = [];
    for (let i = 0; i < 85; i++) {
      const dir = `d${String(Math.floor(i / 20)).padStart(2, "0")}`;
      mkdirSync(join(workdir, dir), { recursive: true });
      const rel = `${dir}/f${String(i).padStart(2, "0")}.txt`;
      writeFileSync(join(workdir, rel), "x\n");
      paths.push(rel);
    }
    // Two of the beyond-cap citations are slash paths that do not exist: a path
    // beyond the cap must never be reported as missing.
    paths.push("no/such-a.ts", "no/such-b.ts");
    const snap = groundingSnapshot(paths, workdir, [""], nodeIo(), []);
    const presence = snap.lines.filter((l) => l.text.startsWith("- `"));
    assert.equal(presence.length, GROUNDING_MAX_FILES);
    assert.equal(snap.notShown, 7);
    const last = snap.lines.at(-1)!;
    assert.equal(last.kind, "not-shown");
    assert.equal(last.text, NOT_SHOWN_LINE.replace("<n>", "7"));
    assert.ok(!snap.lines.some((l) => l.text.includes("no/such-a.ts")));
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("presence lines follow the as-is shapes of F117-FR-007", () => {
  const workdir = tmpWorkspace();
  try {
    writeFileSync(join(workdir, "present.txt"), "hello\n");
    mkdirSync(join(workdir, "adir"));
    const snap = groundingSnapshot(
      ["present.txt", "adir", "gone/missing.ts"],
      workdir,
      [""],
      nodeIo(),
      [],
    );
    const texts = snap.lines.map((l) => l.text);
    assert.ok(
      texts.some((t) =>
        /^- `present\.txt` — exists, 6 bytes, mtime \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(t),
      ),
    );
    assert.ok(texts.some((t) => t === "- `adir` — directory, 0 entries"));
    assert.ok(texts.includes(MISSING_LINE.replace("<path>", "gone/missing.ts")));
    assert.equal(snap.lines.find((l) => l.text.startsWith("- `adir`"))!.kind, "directory");
    assert.equal(snap.lines.find((l) => l.text.includes("missing.ts"))!.kind, "missing");
    // A bare token without a slash that does not resolve is dropped (F117-FR-003).
    const bare = groundingSnapshot(["nosuchtoken.txt"], workdir, [""], nodeIo(), []);
    assert.equal(bare.lines.length, 0);
    const rendered = renderSnapshot(snap);
    assert.ok(rendered.includes(SNAPSHOT_HEADING));
    assert.ok(
      rendered.startsWith("\n" + SNAPSHOT_HEADING + "\nThe following is the ACTUAL on-disk state"),
    );
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("a relative citation that escapes the workspace root never resolves (F117-FR-005)", () => {
  const workdir = tmpWorkspace();
  try {
    writeFileSync(join(workdir, "inside.txt"), "x\n");
    const snap = groundingSnapshot(["../outside-secret.txt"], workdir, [""], nodeIo(), []);
    assert.equal(snap.lines.length, 1);
    assert.equal(snap.lines[0]!.kind, "missing");
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("the grounding gap is a loosely cited resolving file the extractor missed (F117-FR-014)", () => {
  const workdir = tmpWorkspace();
  try {
    writeFileSync(join(workdir, "gapfile.md"), "gap\n");
    mkdirSync(join(workdir, "gapdir"));
    writeFileSync(join(workdir, "cited.md"), "cited\n");
    const extracted = ["cited.md"];
    const gap = groundingGap(
      "the notes mention gapfile.md and gapdir/ and a phantom token as well",
      extracted,
      workdir,
      [""],
      nodeIo(),
      ["cited.md", "gapfile.md"],
    );
    assert.deepEqual(gap, ["gapfile.md"]);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});
