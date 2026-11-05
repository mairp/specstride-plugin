/**
 * Builds the installable plugin: `<out>/.claude-plugin/marketplace.json` and
 * `<out>/plugin/`, with the packed CLI inside it, so that installing the plugin
 * is the whole install. Usage: node scripts/build-plugin.ts <out>
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

// Hook paths that survive a space in the install directory.
const hooks = join(plugin, "hooks", "hooks.json");
writeFileSync(
  hooks,
  readFileSync(hooks, "utf8").replace(
    /"command": "(\$\{CLAUDE_PLUGIN_ROOT\}[^"]*)"/g,
    (_, path: string) => `"command": "\\"${path}\\""`,
  ),
);

execFileSync("npm", ["run", "-s", "pack:cli", "-w", "packages/cli"], {
  cwd: root,
  stdio: "ignore",
});
cpSync(join(root, "packages", "cli", ".build", "pack"), join(plugin, "cli"), { recursive: true });

// The host runs a hook by its path, so each one must be executable.
for (const name of readdirSync(join(plugin, "hooks"))) {
  if (name.endsWith(".sh")) chmodSync(join(plugin, "hooks", name), 0o755);
}

for (const file of ["LICENSE", "NOTICE"]) copyFileSync(join(root, file), join(plugin, file));
copyFileSync(join(here, "plugin-README.md"), join(plugin, "README.md"));

console.log(`built ${plugin}`);
