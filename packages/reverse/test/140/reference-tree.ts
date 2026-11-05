/**
 * The REFERENCE TREE of feature 140's inventory tests: one source tree that
 * exercises every rule of F140-FR-017 to F140-FR-025 at once.
 *
 * It is built here, in TypeScript, and NOT also described in Python, because
 * it is the input of a byte-for-byte comparison: the golden record in
 * `./data/baseline-reference.json` was produced by running the Specstride
 * baseline at `9cab15d` (`lib/reverse_inventory.py`) over a tree THIS builder
 * wrote. Two builders would drift; one cannot.
 *
 * What each part of the tree is for:
 *
 * | Part | The rule it exercises |
 * |---|---|
 * | `naïve/ünïcode-😀.md` | the escaped fingerprint of a non-ASCII path (F140-FR-021) |
 * | `order/pair-😀.md` against `order/pair-�.md` | code-point order, where UTF-16 order disagrees (F140-FR-021, D-2) |
 * | `binary.bin` | the NUL sniff, before the size test (F140-FR-020) |
 * | `big.txt` | the per-file limit and `limit` (F140-FR-020) |
 * | `link-inside`, `link-escape`, `link-broken`, `linkdir` | the four link cases (F140-FR-020) |
 * | `.gitignore` | the glob subset, `!` and the last-rule-wins (F140-FR-018) |
 * | `node_modules/`, `build/`, `.specstride/`, `testautomation/` | the deny list and the state names (F140-FR-018) |
 * | the eleven manifests | the readers, the frameworks, the entry points (F140-FR-022, F140-FR-023) |
 * | `packages/alpha`, `packages/beta` | the workspaces and the units (F140-FR-023) |
 * | `.specify/`, `specs/` | the Spec Kit facts (F140-FR-024) |
 * | `scripts/run.sh`, `bin/tool`, `src/app.py`, `cmd/main.go` | the roles and the file entry points (F140-FR-019, F140-FR-023) |
 */
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The BASE NAME the reference tree must be built under. The summary's title is
 * `# Inventory — <source base name>` (F140-FR-025), so a comparison against
 * the baseline's summary bytes only holds when both trees carry the same base
 * name. The generator of the golden record uses `/tmp/<this name>`.
 */
export const REFERENCE_TREE_NAME = "ref140" as const;

/** The bytes of the oversize file: one past the default per-file limit. */
export const OVERSIZE_BYTES = 1024 * 1024 + 10;

/** The text files of the reference tree, by source-relative path. */
export const REFERENCE_FILES: Readonly<Record<string, string>> = Object.freeze({
  ".gitignore": [
    "# the glob subset of F140-FR-018",
    "*.log",
    "!keep.log",
    "build/",
    "/rooted.txt",
    "ignored-everywhere",
    "",
  ].join("\n"),
  "package.json": JSON.stringify(
    {
      name: "reference-root",
      version: "1.0.0",
      bin: { "ref-tool": "bin/tool" },
      main: "./src/lib.ts",
      types: "src/lib.d.ts",
      exports: { ".": "./src/lib.ts", "./extra": "./src/extra.ts" },
      scripts: { build: "tsc -p .", test: "node --test" },
      workspaces: ["packages/*"],
      dependencies: { react: "^18.0.0", express: "^4.0.0" },
      devDependencies: { typescript: "^5.0.0", vitest: "^1.0.0" },
      peerDependencies: { vue: "^3.0.0" },
    },
    null,
    2,
  ),
  "packages/alpha/package.json": JSON.stringify({ name: "@ref/alpha", version: "0.1.0" }, null, 2),
  "packages/alpha/src/index.ts": "export const alpha = 1;\n",
  "packages/beta/package.json": JSON.stringify({ version: "0.2.0" }, null, 2),
  "packages/beta/src/index.ts": "export const beta = 2;\n",
  "packages/gamma/package.json": "{ this is not json",
  "pnpm-workspace.yaml": ["packages:", "  - 'packages/*'", "  - '!packages/gamma'", ""].join("\n"),
  "pyproject.toml": [
    "[project]",
    'name = "reference"',
    'dependencies = ["flask>=2", "click"]',
    "",
    "[tool.pytest.ini_options]",
    'testpaths = ["tests"]',
    "",
    "[build-system]",
    'build-backend = "hatchling.build"',
    "",
  ].join("\n"),
  "setup.cfg": [
    "[metadata]",
    "name = reference-cfg",
    "",
    "[options]",
    "install_requires =",
    "    django>=4",
    "    pydantic",
    "",
    "[options.entry_points]",
    "console_scripts =",
    "    ref = reference.cli:main",
    "    ref-two = reference.cli:other",
    "",
  ].join("\n"),
  "go.mod": [
    "module example.com/reference",
    "",
    "go 1.22",
    "",
    "require (",
    "\tgithub.com/spf13/cobra v1.8.0",
    "\tgithub.com/gin-gonic/gin v1.9.1",
    ")",
    "",
  ].join("\n"),
  "Cargo.toml": [
    "[package]",
    'name = "reference-rs"',
    "",
    "[[bin]]",
    'name = "refbin"',
    "",
    "[dependencies]",
    'tokio = "1"',
    "",
  ].join("\n"),
  Dockerfile: [
    "FROM node:22-alpine",
    "WORKDIR /app",
    "EXPOSE 8080",
    'ENTRYPOINT ["node", "bin/tool"]',
    'CMD ["--help"]',
    "",
  ].join("\n"),
  "Dockerfile.dev": ["FROM node:22", 'ENTRYPOINT ["sh"]', ""].join("\n"),
  Makefile: [
    "all: build test",
    "\t@true",
    "",
    "build:",
    "\t@true",
    "",
    "test:",
    "\t@true",
    "",
  ].join("\n"),
  "docker-compose.yml": [
    "version: '3'",
    "services:",
    "  web:",
    "  worker:",
    "volumes:",
    "  data:",
    "",
  ].join("\n"),
  ".github/workflows/ci.yml": [
    "name: CI",
    "on: [push]",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "  lint:",
    "    runs-on: ubuntu-latest",
    "",
  ].join("\n"),
  "pom.xml": [
    "<project>",
    "  <artifactId>reference-jvm</artifactId>",
    "  <artifactId>second-one</artifactId>",
    "</project>",
    "",
  ].join("\n"),
  "README.md": "# Reference\n\nA tree for the inventory tests.\n",
  "CHANGELOG.md": "# Changelog\n",
  LICENSE: "MIT\n",
  "docs/guide.md": "# Guide\n",
  "docs/notes.txt": "notes without a final line end",
  "scripts/run.sh": "#!/usr/bin/env bash\nset -euo pipefail\necho run\n",
  "bin/tool": "#!/usr/bin/env node\nconsole.log('tool');\n",
  "src/app.py":
    'import sys\n\n\ndef main():\n    return 0\n\n\nif __name__ == "__main__":\n    sys.exit(main())\n',
  "src/lib.ts": "export const value = 1;\n",
  "src/extra.ts": "export const extra = 2;\n",
  "cmd/main.go": 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println(1)\n}\n',
  "tests/test_thing.py": "def test_thing():\n    assert True\n",
  "tests/conftest.py": "import pytest\n",
  "schemas/thing.schema.json": '{"type": "object"}\n',
  "templates/page.j2": "{{ value }}\n",
  "naïve/ünïcode-😀.md": "# Non-ASCII\n\nA path with an astral character.\n",
  "naïve/Ünïcode-ÿ.md": "# Another\n",
  // These two share a prefix and then diverge at U+FFFD against U+1F600. By
  // CODE POINT the replacement character comes first (0xFFFD < 0x1F600); by
  // UTF-16 UNIT the astral one does (its first unit is 0xD83D < 0xFFFD). They
  // are the pair that makes the two orders disagree, and so the pair that
  // makes `compareCodePoint` observable in the walk (F140-FR-021, D-2).
  "order/pair-\u{1F600}.md": "# Astral\n",
  "order/pair-\uFFFD.md": "# Replacement\n",
  "app.log": "ignored by *.log\n",
  "keep.log": "un-ignored by !keep.log\n",
  "rooted.txt": "ignored by /rooted.txt\n",
  "deep/rooted.txt": "NOT ignored: /rooted.txt is anchored\n",
  "ignored-everywhere": "ignored by its bare name\n",
  "deep/ignored-everywhere": "also ignored: a bare name matches the base name\n",
  "build/out.txt": "inside an ignored directory\n",
  "node_modules/pkg/index.js": "module.exports = 1;\n",
  "testautomation/kept.txt": "a file the walk denies and the snapshot records\n",
  "testautomation/nested/also.txt": "nested in the snapshot\n",
  ".specstride/state.json": '{"never": "walked"}\n',
  ".lisa/old.json": '{"never": "walked"}\n',
  ".specify/memory/constitution.md": "# Constitution\n",
  ".specify/templates/spec-template.md": "# Spec template\n",
  ".specify/templates/notes.txt": "not a template\n",
  ".specify/feature.json": '{"number": 7, "slug": "reference"}\n',
  "specs/001-first/spec.md": "# First\n",
  "specs/123-third/spec.md": "# Third\n",
  "specs/42-too-short/spec.md": "# Two digits: not a spec number\n",
  ".env.example": "KEY=value\n",
});

/** The links of the reference tree: path to target, in creation order. */
export const REFERENCE_LINKS: readonly (readonly [string, string])[] = Object.freeze([
  ["link-inside", "src/lib.ts"],
  ["link-escape", "/etc/hostname"],
  ["link-broken", "/nonexistent-reference-target/nope"],
  ["linkdir", "src"],
]);

/**
 * Write the reference tree at `root`, removing whatever was there. The
 * oversize file and the binary file are generated rather than stored, so that
 * the repository carries no megabyte of filler.
 */
export function buildReferenceTree(root: string): string {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  for (const [relative, content] of Object.entries(REFERENCE_FILES)) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  // A NUL byte inside the 8192-byte sniff window: the reason `binary`.
  writeFileSync(join(root, "binary.bin"), Buffer.from([0x50, 0x4b, 0x00, 0x01, 0x02, 0x0a]));
  // One byte past the default per-file limit: the reason `oversize`.
  writeFileSync(join(root, "big.txt"), Buffer.alloc(OVERSIZE_BYTES, 0x61));
  for (const [relative, target] of REFERENCE_LINKS) {
    symlinkSync(target, join(root, relative));
  }
  return root;
}
