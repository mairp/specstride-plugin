/**
 * CT-115-1 — the boundary test of the package (T002, F115-FR-002): the
 * manifest names `@specstride/contracts` and `@specstride/kernel` only, no
 * install script exists, and no file of `src/` imports a file-system module
 * (`node:fs`, `node:fs/promises`) or anything else the core rule forbids.
 *
 * The same rules hold mechanically in `npm run check:imports` over the
 * package graph; this test observes the package itself, so the boundary of
 * this package alone is provable without running the whole workspace check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = join(fileURLToPath(import.meta.url), "..", "..");

test("T002: the manifest declares the two allowed imports and no install script", () => {
  const manifest = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as {
    name: string;
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
  };
  assert.equal(manifest.name, "@specstride/layer-micro");
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    "@specstride/contracts",
    "@specstride/kernel",
  ]);
  assert.equal(
    manifest.scripts["install"],
    undefined,
    "no install script: the package is installed with the workspace, never built in place",
  );
  assert.match(manifest.scripts["test"] ?? "", /isolate\.ts/, "a test script exists");
});

test("T002: no file of src/ imports a file-system module or an unlisted package", () => {
  const forbidden =
    /from\s+["'](node:fs|node:fs\/promises|node:child_process|node:net|node:http|node:https)\b/;
  const allowed =
    /^(@specstride\/(contracts|kernel)|\.\.?\/|node:(?!(fs|fs\/promises|child_process|net|http|https)))/;
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) {
        const text = readFileSync(full, "utf8");
        for (const line of text.split("\n")) {
          const match = line.match(/from\s+["']([^"']+)["']/);
          if (!match) continue;
          if (forbidden.test(line) || !allowed.test(match[1])) {
            offenders.push(`${full}: ${match[1]}`);
          }
        }
      }
    }
  };
  walk(join(PKG, "src"));
  assert.deepEqual(
    offenders,
    [],
    "imports are @specstride/contracts, @specstride/kernel, relative or an allowed node: builtin",
  );
});
