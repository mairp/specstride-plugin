/**
 * The two fixture trees of T029 of feature 140 — the parity test
 * `PT-140-C-131-entry-points-units` (F140-FR-023):
 *
 *  * `units140-over`, a tree whose kept text is OVER THE TOTAL LIMIT at the
 *    default value (21,000,000 bytes against the 20 MiB of
 *    `DEFAULT_MAX_TOTAL_BYTES`), so `oversize` is true with no setting at all,
 *    and which has NO workspace — its units are therefore the top-level
 *    directories plus `.` for the root files. It carries an entry point of
 *    each of the seven kinds of F140-FR-023.
 *  * `units140-ws`, a tree WITH WORKSPACES — from a root `package.json`
 *    (including a `!` glob that excludes one) and from `pnpm-workspace.yaml`
 *    (including one glob with `**`), plus a workspace NESTED inside another, a
 *    directory under `packages/` that holds no manifest, and a Cargo workspace
 *    whose members the product cannot read because it bundles no TOML reader
 *    (F140-FR-022) — so its units are the workspace packages, the longest
 *    prefix owning each file, plus `.` for everything they do not own.
 *
 * Like `./reference-tree.ts` these trees are described ONCE, here, and the
 * reference values in `./data/units-reference.json` were produced by running
 * the Specstride baseline at `9cab15d` (`lib/reverse_inventory.py`) over the
 * trees THIS file writes. Two builders would drift; one cannot.
 *
 * The base names matter: the summary's title is `# Inventory — <base name>`
 * (F140-FR-025), so a byte comparison against the baseline's output only
 * holds when the generator and the test build under the same name.
 */
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The base name of the oversize tree; the generator used exactly this. */
export const OVERSIZE_TREE_NAME = "units140-over" as const;

/** The base name of the workspaces tree; the generator used exactly this. */
export const WORKSPACES_TREE_NAME = "units140-ws" as const;

/** How many filler files the oversize tree holds. */
export const BULK_FILES = 21;

/** The bytes of one filler file: under the per-file limit, so it is KEPT. */
export const BULK_FILE_BYTES = 1_000_000;

/**
 * The kept text of the oversize tree, which must exceed
 * `DEFAULT_MAX_TOTAL_BYTES` (20 MiB = 20,971,520). 21 × 1,000,000 =
 * 21,000,000 does, and each file is under the 1 MiB per-file limit, so not
 * one of them is skipped and every byte counts towards the total.
 */
export const BULK_TOTAL_BYTES = BULK_FILES * BULK_FILE_BYTES;

/** The text files of the OVERSIZE tree, by source-relative path. */
export const OVERSIZE_FILES: Readonly<Record<string, string>> = Object.freeze({
  // No `workspaces` key: this tree must have NO workspace, so that its units
  // are the top-level directories (F140-FR-023, the second branch).
  "package.json": JSON.stringify(
    {
      name: "units-over",
      version: "1.0.0",
      bin: { "over-tool": "bin/tool" },
      exports: { ".": "./src/lib.ts", "./app": "./src/app.py" },
      scripts: { build: "tsc -p ." },
      dependencies: { react: "^18.0.0" },
    },
    null,
    2,
  ),
  // A manifest that is NOT a `package.json`, so its scripts ARE entry points.
  "setup.cfg": [
    "[metadata]",
    "name = units-over-cfg",
    "",
    "[options.entry_points]",
    "console_scripts =",
    "    over = units.cli:main",
    "    over-two = units.cli:other",
    "",
  ].join("\n"),
  Dockerfile: ["FROM node:22-alpine", 'ENTRYPOINT ["node", "bin/tool"]', ""].join("\n"),
  "src/lib.ts": "export const value = 1;\n",
  "src/app.py":
    'import sys\n\n\ndef main():\n    return 0\n\n\nif __name__ == "__main__":\n    sys.exit(main())\n',
  "cmd/main.go": 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println(1)\n}\n',
  "scripts/run.sh": "#!/usr/bin/env bash\nset -euo pipefail\necho run\n",
  "bin/tool": "#!/usr/bin/env node\nconsole.log('tool');\n",
  "docs/guide.md": "# Guide\n",
  "README.md": "# Units over the total limit\n",
});

/** The text files of the WORKSPACES tree, by source-relative path. */
export const WORKSPACES_FILES: Readonly<Record<string, string>> = Object.freeze({
  // `!packages/skip` excludes one directory that holds a `package.json`.
  "package.json": JSON.stringify(
    {
      name: "@units/root",
      version: "1.0.0",
      workspaces: ["packages/*", "!packages/skip"],
      dependencies: { express: "^4.0.0" },
    },
    null,
    2,
  ),
  // A second source of globs, which is CONCATENATED with the first. One of
  // them holds `**`, which the detection reads as a single `*`.
  "pnpm-workspace.yaml": ["packages:", "  - 'extra/*'", "  - 'deep/**'", ""].join("\n"),
  "packages/one/package.json": JSON.stringify(
    {
      name: "@units/one",
      version: "0.1.0",
      bin: { one: "bin/one" },
      exports: { ".": "./src/main.ts" },
    },
    null,
    2,
  ),
  "packages/one/src/main.ts": "export const one = 1;\n",
  "packages/one/src/cli.py": 'if __name__ == "__main__":\n    print(1)\n',
  // No `name`: the workspace name falls back to the directory path.
  "packages/two/package.json": JSON.stringify({ version: "0.2.0" }, null, 2),
  "packages/two/src/index.ts": "export const two = 2;\n",
  // Excluded by the `!` glob, and so its files belong to the ROOT unit.
  "packages/skip/package.json": JSON.stringify({ name: "@units/skip" }, null, 2),
  "packages/skip/src/index.ts": "export const skip = 3;\n",
  // A workspace NESTED INSIDE another workspace: both hold a `package.json`
  // and `packages/*` matches both, because the glob subset is Python's
  // `fnmatch`, in which `*` crosses `/` (decision D-1 of phase 4). The files
  // of the inner one belong to the LONGEST prefix that owns them, and
  // `packages/nested/notes.md`, which the inner one does not own, belongs to
  // the outer.
  "packages/nested/package.json": JSON.stringify({ name: "@units/nested" }, null, 2),
  "packages/nested/notes.md": "# Inside the OUTER workspace only\n",
  "packages/nested/inner/package.json": JSON.stringify({ name: "@units/inner" }, null, 2),
  "packages/nested/inner/src/index.ts": "export const inner = 4;\n",
  // A directory under `packages/` that holds NO manifest: it is no workspace,
  // so its file belongs to the ROOT unit and to no unit of its own.
  "packages/loose/notes.md": "# Inside no workspace at all\n",
  "extra/widget/package.json": JSON.stringify({ name: "@units/widget" }, null, 2),
  "extra/widget/index.js": "module.exports = 5;\n",
  // Matched by the `deep/**` glob of `pnpm-workspace.yaml`.
  "deep/leaf/package.json": JSON.stringify({ name: "@units/leaf" }, null, 2),
  "deep/leaf/index.js": "module.exports = 6;\n",
  // A Cargo workspace. Its members are unreadable without a TOML reader, so
  // the `cargo` kind cannot appear in the document (F140-FR-022).
  "Cargo.toml": [
    "[workspace]",
    'members = ["crates/*"]',
    "",
    "[workspace.dependencies]",
    'tokio = "1"',
    "",
  ].join("\n"),
  "crates/alpha/Cargo.toml": ["[package]", 'name = "alpha"', ""].join("\n"),
  "crates/alpha/src/lib.rs": "pub fn alpha() -> u8 { 1 }\n",
  "crates/beta/Cargo.toml": ["[package]", 'name = "beta"', ""].join("\n"),
  "crates/beta/src/lib.rs": "pub fn beta() -> u8 { 2 }\n",
  "scripts/ws.sh": "#!/usr/bin/env bash\necho ws\n",
  // Role `script` (it is under `scripts/`) AND a Python file with a `__main__`
  // line: the three file tests are a CHAIN, so this is `python-main` and never
  // also `script` (F140-FR-023).
  "scripts/pytool.py": '#!/usr/bin/env python3\nif __name__ == "__main__":\n    print("tool")\n',
  "README.md": "# Units with workspaces\n",
});

/**
 * The links of the WORKSPACES tree: path to target, in creation order. A link
 * is one entry of its unit and never a file entry point — the walk gives every
 * link the language `symlink` and the role `other` (F140-FR-020).
 */
export const WORKSPACES_LINKS: readonly (readonly [string, string])[] = Object.freeze([
  ["packages/one/src/linked-cli.py", "cli.py"],
]);

/** Write a tree of plain text files at `root`, removing whatever was there. */
function writeTree(root: string, files: Readonly<Record<string, string>>): string {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return root;
}

/**
 * Write the OVERSIZE tree at `root`. The filler is generated rather than
 * stored, so the repository carries no 21 megabytes of it.
 */
export function buildOversizeTree(root: string): string {
  writeTree(root, OVERSIZE_FILES);
  mkdirSync(join(root, "bulk"), { recursive: true });
  const filler = Buffer.alloc(BULK_FILE_BYTES, 0x61);
  for (let index = 0; index < BULK_FILES; index += 1) {
    writeFileSync(join(root, "bulk", `part-${String(index).padStart(2, "0")}.txt`), filler);
  }
  return root;
}

/** Write the WORKSPACES tree at `root`, its one link included. */
export function buildWorkspacesTree(root: string): string {
  writeTree(root, WORKSPACES_FILES);
  for (const [relative, target] of WORKSPACES_LINKS) {
    symlinkSync(target, join(root, relative));
  }
  return root;
}
