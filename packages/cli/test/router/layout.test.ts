/**
 * T001 — the layout witness of the router directory (F119-FR-056).
 *
 * Phase 1 creates the module layout only: the router directory exists, is
 * importable, and carries its layout marker. The behaviour lands with T007 to
 * T016. The negative case of the criterion is here too: the published package
 * has no install script and no native module, so a plain `npm install` never
 * needs a compiler.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ROUTER_LAYOUT } from "../../src/router/index.ts";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

test("T001: the router directory of the layout is importable and marked", () => {
  assert.equal(ROUTER_LAYOUT, "119-front-door-and-presenter/router");
});

test("T001: the cli package has no install script and no native module", () => {
  const manifest = JSON.parse(readFileSync(`${PACKAGE_ROOT}package.json`, "utf8"));
  for (const hook of ["preinstall", "install", "postinstall"]) {
    assert.equal(
      (manifest.scripts as Record<string, string> | undefined)?.[hook],
      undefined,
      `the manifest defines an install script: ${hook}`,
    );
  }
  /** Walk the package: no compiled native part (.node) anywhere. */
  const native: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${name.name}`;
      if (name.isDirectory()) walk(path);
      else if (name.name.endsWith(".node")) native.push(path);
    }
  };
  walk(PACKAGE_ROOT);
  assert.deepEqual(native, [], "the package carries a native module");
});
