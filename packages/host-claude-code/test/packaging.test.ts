/**
 * T021 — the witness tests of the packaging: the manifest, the marketplace
 * entry, the explicit plugin version and the strict validation step
 * (F113-FR-030, F113-FR-031), plus `writePluginShim` (the phase-5 finding).
 *
 * Every case builds a WHOLE plugin directory into a temporary tree with
 * `writePluginPackaging()` — skills, hooks, shim, manifest, marketplace entry —
 * and reads it back from disk. The negative cases mutate one thing at a time
 * in the temporary tree and hold that the strict validation FAILS on it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  INSTALL_SCRIPT_NAMES,
  MARKETPLACE_ENTRY_PATH,
  PLUGIN_MANIFEST_PATH,
  PLUGIN_PACKAGE_NAME,
  VALIDATION_CHECKS,
  hostCliValidationStep,
  packageVersion,
  pluginVersion,
  renderMarketplaceEntry,
  renderManifest,
  strictPluginValidation,
  validatePlugin,
  writePluginPackaging,
  writePluginShim,
} from "../src/packaging.ts";
import { SHIM_PATH } from "../src/render/index.ts";
import { HOOK_CONFIG_PATH } from "../src/hooks.ts";

function aPluginTree(): string {
  const dir = mkdtempSync(join(tmpdir(), "specstride-plugin-"));
  const written = writePluginPackaging(dir);
  // Three skills (run, reverse, doctor) + two manifests: the directory policy
  // of 2026-11-10 removed the shim, the hooks configuration and the bundled
  // CLI from what ships.
  assert.equal(written.length, 5);
  return dir;
}

test("the explicit plugin version equals the package version, and both are read from the manifest", () => {
  assert.equal(pluginVersion(), packageVersion());
  assert.equal(pluginVersion().length > 0, true);
});

test("the manifest carries the version explicitly and declares no MCP server (F113-FR-030, F113-FR-031)", () => {
  const manifest = renderManifest();
  assert.equal(manifest.version, pluginVersion());
  assert.deepEqual(manifest.mcpServers, {});
});

test("the marketplace entry names the exact package and the exact version from npm, never a range", () => {
  const entry = renderMarketplaceEntry() as unknown as {
    plugins: readonly { package: string; source: string; version: string }[];
  };
  assert.equal(entry.plugins.length, 1);
  assert.equal(entry.plugins[0]!.package, PLUGIN_PACKAGE_NAME);
  assert.equal(entry.plugins[0]!.source, "npm");
  assert.equal(entry.plugins[0]!.version, pluginVersion());
  assert.equal(/[~^>*x|]/.test(entry.plugins[0]!.version), false);
});

test("the whole plugin directory builds, and the strict validation passes on it (F113-FR-030)", () => {
  const dir = aPluginTree();
  try {
    const findings = strictPluginValidation(dir);
    assert.deepEqual(
      findings.map((f) => f.check),
      [...VALIDATION_CHECKS],
    );
    assert.equal(
      findings.every((f) => f.ok),
      true,
    );
    // The plugin holds its manifest, and ships NO executable part: no hooks
    // configuration, no shim, no `bin/`, no `hooks/`, no bundled `cli/`
    // (directory policy 2026-11-10).
    assert.equal(existsSync(join(dir, PLUGIN_MANIFEST_PATH)), true);
    assert.equal(existsSync(join(dir, HOOK_CONFIG_PATH)), false);
    assert.equal(existsSync(join(dir, SHIM_PATH)), false);
    assert.equal(existsSync(join(dir, "bin")), false);
    assert.equal(existsSync(join(dir, "hooks")), false);
    assert.equal(existsSync(join(dir, "cli")), false);
    // Every file the build wrote exists on disk, including the three SKILL.md files.
    for (const path of writePluginPackaging(dir).map((f) => f.path)) {
      assert.equal(existsSync(join(dir, path)), true, `${path} is missing`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the shim is written executable (the phase-5 finding)", () => {
  const dir = mkdtempSync(join(tmpdir(), "specstride-shim-"));
  try {
    const written = writePluginShim(dir);
    assert.equal(written.path, SHIM_PATH);
    const mode = statSync(join(dir, SHIM_PATH)).mode;
    assert.equal((mode & 0o111) !== 0, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the validation fails a manifest version that differs from the package version", () => {
  const dir = aPluginTree();
  try {
    const manifestPath = join(dir, PLUGIN_MANIFEST_PATH);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.version = "9.9.9";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    const finding = validatePlugin(dir).find(
      (f) => f.check === "plugin-version-explicit-and-equal",
    );
    assert.equal(finding?.ok, false);
    assert.throws(() => strictPluginValidation(dir), /plugin-version-explicit-and-equal/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the validation fails a marketplace entry that names a version range", () => {
  const dir = aPluginTree();
  try {
    const entryPath = join(dir, MARKETPLACE_ENTRY_PATH);
    const entry = JSON.parse(readFileSync(entryPath, "utf8")) as Record<string, unknown>;
    (entry.plugins as { version: string }[])[0]!.version = `^${pluginVersion()}`;
    writeFileSync(entryPath, JSON.stringify(entry, null, 2), "utf8");
    const finding = validatePlugin(dir).find(
      (f) => f.check === "marketplace-entry-names-the-exact-version",
    );
    assert.equal(finding?.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the validation fails a plugin that ships the evals directory (F113-FR-031)", () => {
  const dir = aPluginTree();
  try {
    mkdirSync(join(dir, "evals"), { recursive: true });
    writeFileSync(join(dir, "evals", "cases.json"), "{}", "utf8");
    const finding = validatePlugin(dir).find((f) => f.check === "evals-do-not-ship");
    assert.equal(finding?.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the validation fails a plugin that declares a server of the model context protocol", () => {
  const dir = aPluginTree();
  try {
    const manifestPath = join(dir, PLUGIN_MANIFEST_PATH);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.mcpServers = { "specstride-mcp": { command: "specstride" } };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    const finding = validatePlugin(dir).find((f) => f.check === "no-mcp-server");
    assert.equal(finding?.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the validation fails a plugin that ships a bin/ directory, a #! file or a disallowed type", () => {
  const dir = aPluginTree();
  try {
    mkdirSync(join(dir, "bin"), { recursive: true });
    writeFileSync(join(dir, "bin", "specstride.mjs"), "#!/usr/bin/env node\n", "utf8");
    assert.equal(validatePlugin(dir).find((f) => f.check === "no-bin-directory")?.ok, false);
    assert.equal(validatePlugin(dir).find((f) => f.check === "directory-policy-files")?.ok, false);
    rmSync(join(dir, "bin"), { recursive: true, force: true });
    writeFileSync(join(dir, "run.sh"), "#!/bin/sh\n", "utf8");
    assert.equal(validatePlugin(dir).find((f) => f.check === "directory-policy-files")?.ok, false);
    rmSync(join(dir, "run.sh"), { force: true });
    writeFileSync(join(dir, "skills", "specstride-run", "note.md"), "a\0b", "utf8");
    assert.equal(validatePlugin(dir).find((f) => f.check === "directory-policy-files")?.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the package itself declares no install script and nothing that compiles at install", () => {
  const scripts =
    (
      JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      }
    ).scripts ?? {};
  for (const name of INSTALL_SCRIPT_NAMES) {
    assert.equal(name in scripts, false, `the package declares ${name}`);
  }
});

test("the host CLI half of the validation is a skip with its reason where the CLI is absent", () => {
  const step = hostCliValidationStep("/tmp");
  if (step.ran) {
    assert.match(step.command ?? "", /claude plugin validate/);
  } else {
    assert.match(step.skippedReason ?? "", /absent|skip/);
  }
});
