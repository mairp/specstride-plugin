/**
 * Builds the installable plugin: `<out>/.claude-plugin/marketplace.json` and
 * `<out>/plugin/`, with the packed CLI inside it, so that installing the plugin
 * is the whole install. Usage: node scripts/build-plugin.ts <out>
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PLUGIN_DIRECTORY,
  PLUGIN_MANIFEST_PATH,
  strictPluginValidation,
  writePluginPackaging,
} from "../packages/host-claude-code/src/packaging.ts";
import {
  RELEASE_VERSION,
  releaseManifest,
  releaseMarketplace,
} from "../packages/host-claude-code/src/release-build.ts";

const given = process.argv[2];
if (given === undefined) throw new Error("usage: build-plugin.ts <out>");
const out = resolve(given);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const plugin = join(out, PLUGIN_DIRECTORY);
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, ".claude-plugin"), { recursive: true });
mkdirSync(plugin, { recursive: true });

// The specified package passes its own strict validation, and its skill is
// what ships: the release no longer replaces `specstride-run` with the
// foreground skill of `release-build.ts`, because the verbs that path needs
// (derive, the judgment exchange, validate, promote, render, launch, wait)
// are in the CLI. The reverse skill still does not ship: `reverse` is not in
// this build, and a shipped skill must not name a verb that refuses.
writePluginPackaging(plugin);
strictPluginValidation(plugin);

rmSync(join(plugin, ".claude-plugin", "marketplace.json"), { force: true });
rmSync(join(plugin, "skills", "specstride-reverse"), { recursive: true, force: true });
writeFileSync(join(plugin, PLUGIN_MANIFEST_PATH), json(releaseManifest()));
writeFileSync(join(out, ".claude-plugin", "marketplace.json"), json(releaseMarketplace()));

// One version everywhere.
for (const file of ["bin/specstride.mjs", "skills/specstride-doctor/SKILL.md"]) {
  const path = join(plugin, file);
  writeFileSync(path, readFileSync(path, "utf8").replaceAll("0.0.0", RELEASE_VERSION));
}

// The release ships no host hooks (owner ruling 2026-11-05): no run depends on
// them (`noRunDependsOnAHostHook`), and the directory will accept command hooks
// only from verified organizations.
rmSync(join(plugin, "hooks"), { recursive: true, force: true });

execFileSync("npm", ["run", "-s", "pack:cli", "-w", "packages/cli"], {
  cwd: root,
  stdio: "ignore",
});
cpSync(join(root, "packages", "cli", ".build", "pack"), join(plugin, "cli"), { recursive: true });

for (const file of ["LICENSE", "NOTICE"]) copyFileSync(join(root, file), join(plugin, file));
copyFileSync(join(here, "plugin-README.md"), join(plugin, "README.md"));
// The directory listing icon: the specstride.ai mark on a white square, 1024 px (the portal takes it at the first save).
copyFileSync(join(here, "plugin-icon.png"), join(plugin, ".claude-plugin", "icon.png"));

console.log(`built ${plugin}`);
