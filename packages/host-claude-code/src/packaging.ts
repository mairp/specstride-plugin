/**
 * T021 — the manifest, the marketplace entry, the explicit plugin version and
 * the strict validation step of the build (F113-FR-030, F113-FR-031).
 *
 * F113-FR-030: one published package holds the plugin directory, with an
 * EXPLICIT plugin version equal to the package version, a marketplace entry,
 * no install script and nothing that compiles at install; the build validates
 * the plugin strictly. F113-FR-031: the plugin holds the skills and its
 * manifest, and holds NO server of the model context protocol in Wave 1; the
 * `evals` directory MUST NOT ship to consumers. Directory policy (2026-11-10)
 * adds: NO `bin/` folder, NO hooks, NO `#!` file, no file outside the allowed
 * types, and only the allowed manifest fields — an organization that is not
 * Verified is refused for each.
 *
 * The bundling of the plugin directory INTO the one published package is task
 * T064 of feature 119 (`specs/119-front-door-and-presenter/tasks.md`, review
 * item W-119-01): this module writes and validates the plugin directory, and
 * claims nothing about how the published package is assembled.
 *
 * The plugin directory is a BUILD OUTPUT (plan.md, "Structure Decision"); the
 * repository carries only the `.gitkeep` placeholders, so no built artifact is
 * committed.
 */
import { readFileSync, statSync, chmodSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderShim } from "./render/index.ts";
import { renderPluginSkills } from "./skills.ts";

/** The directory of the plugin inside the package, as plan.md draws it. */
export const PLUGIN_DIRECTORY = "plugin" as const;

/** The directory of the manifest and the marketplace entry, as plan.md draws it. */
export const PLUGIN_MANIFEST_DIRECTORY = ".claude-plugin" as const;

/** The file of the manifest, in the host's own format (R3 F9 option A'). */
export const PLUGIN_MANIFEST_PATH = `${PLUGIN_MANIFEST_DIRECTORY}/plugin.json` as const;

/** The file of the marketplace entry (R3v P26: npm-sourced, inside a marketplace hosted elsewhere). */
export const MARKETPLACE_ENTRY_PATH = `${PLUGIN_MANIFEST_DIRECTORY}/marketplace.json` as const;

/** The source of a plugin entry: npm (R3v P26). */
export const PLUGIN_SOURCE = "npm" as const;

/** The package the marketplace entry names, exactly and with no range (F113-FR-042). */
export const PLUGIN_PACKAGE_NAME = "@specstride/host-claude-code" as const;

/* -------------------------------------------------------------------------
 * The explicit plugin version
 * ---------------------------------------------------------------------- */

/** The package.json of this package, read at build time only. */
const PACKAGE_JSON_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), "package.json");

/** The version of the package, read from its manifest — never retyped. */
export function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as { version?: string };
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`${PLUGIN_PACKAGE_NAME} has no version in its package.json`);
  }
  return manifest.version;
}

/**
 * F113-FR-030 — the EXPLICIT plugin version. It is read from the package
 * manifest, so "equal to the package version" cannot drift.
 */
export function pluginVersion(): string {
  return packageVersion();
}

/* -------------------------------------------------------------------------
 * The manifest and the marketplace entry
 * ---------------------------------------------------------------------- */

/**
 * The manifest of the plugin, in the host's own format. It carries the version
 * EXPLICITLY (F113-FR-030), names the directories the plugin ships and
 * declares NO server of the model context protocol (F113-FR-031).
 */
export function renderManifest(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    name: "specstride",
    version: pluginVersion(),
    description:
      "Specstride for Claude Code: the host skills `specstride-run` and `specstride-reverse` " +
      "and the doctor skill, as a thin layer over the Specstride CLI.",
    // F113-FR-031 — no server of the model context protocol in Wave 1. The key
    // is present with the empty record so that its absence is observable.
    mcpServers: Object.freeze({}),
  });
}

/**
 * The marketplace entry (R3v P26): an npm-sourced plugin entry that names the
 * EXACT package and the EXACT version, never a range (plan.md, "Publishing";
 * F113-FR-042). A marketplace itself cannot come from npm — the marketplace is
 * hosted elsewhere and only the entry is written here.
 */
export function renderMarketplaceEntry(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    name: "specstride-marketplace",
    owner: "specstride",
    plugins: Object.freeze([
      Object.freeze({
        name: "specstride",
        source: PLUGIN_SOURCE,
        package: PLUGIN_PACKAGE_NAME,
        // The exact version, never a range: T038 fails the build on a range.
        version: pluginVersion(),
      }),
    ]),
  });
}

/** The packaging artifacts: the manifest and the marketplace entry. */
export function renderPackagingArtifacts(): readonly {
  path: string;
  bytes: number;
  content: string;
}[] {
  const files = [
    [PLUGIN_MANIFEST_PATH, renderManifest()],
    [MARKETPLACE_ENTRY_PATH, renderMarketplaceEntry()],
  ] as const;
  return Object.freeze(
    files.map(([path, value]) => {
      const content = `${JSON.stringify(value, null, 2)}\n`;
      return Object.freeze({
        path,
        bytes: Buffer.byteLength(content, "utf8"),
        content,
      });
    }),
  );
}

/* -------------------------------------------------------------------------
 * The build step: write the whole plugin directory
 * ---------------------------------------------------------------------- */

/** One file the packaging build step wrote, with its content hash. */
export type WrittenPackagingFile = {
  /** The path inside the plugin directory, with `/` as the separator. */
  readonly path: string;
  /** The bytes the file measures. */
  readonly bytes: number;
  /** The SHA-256 of its content, in lower-case hexadecimal. */
  readonly sha256: string;
};

function writeArtifact(
  pluginDirectory: string,
  artifact: {
    path: string;
    bytes: number;
    content: string;
    mode?: number;
  },
): WrittenPackagingFile {
  const file = join(pluginDirectory, artifact.path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, artifact.content, "utf8");
  if (artifact.mode !== undefined) chmodSync(file, artifact.mode);
  return Object.freeze({
    path: artifact.path,
    bytes: artifact.bytes,
    sha256: createHash("sha256").update(artifact.content, "utf8").digest("hex"),
  });
}

/**
 * The build step for the shim of T007 (found in phase 5): the shim of the
 * plugin, written with the mode `0755` that the shim tests rely on.
 */
export function writePluginShim(pluginDirectory: string): WrittenPackagingFile {
  const artifact = renderShim();
  return writeArtifact(pluginDirectory, { ...artifact, mode: 0o755 });
}

/** Everything the packaging build step writes: the skills and the manifests.
 *
 * The plugin ships NO executable and NO hooks (directory policy 2026-11-10):
 * the registry accepts a `bin/` folder, a `#!` file and a hooks configuration
 * only from Verified organizations, so the build writes none of them. The CLI
 * is whatever `specstride` the consumer has on the search path; the skills
 * carry the resolution order and the install line.
 */
export function writePluginPackaging(pluginDirectory: string): readonly WrittenPackagingFile[] {
  return Object.freeze([
    ...renderPluginSkills().map((artifact) => writeArtifact(pluginDirectory, artifact)),
    ...renderPackagingArtifacts().map((artifact) => writeArtifact(pluginDirectory, artifact)),
  ]);
}

/* -------------------------------------------------------------------------
 * The strict validation step (F113-FR-030)
 * ---------------------------------------------------------------------- */

/** One line of the validation report. */
export type ValidationFinding = {
  /** The check the finding is of. */
  readonly check: string;
  /** True when the check passed. */
  readonly ok: boolean;
  /** What was observed, as one line. */
  readonly detail: string;
};

/** The checks the strict validation runs, in order (F113-FR-030, F113-FR-031). */
export const VALIDATION_CHECKS: readonly string[] = Object.freeze([
  "manifest-present",
  "plugin-version-explicit-and-equal",
  "marketplace-entry-names-the-exact-version",
  "skills-present",
  "no-bin-directory",
  "no-hooks-directory",
  "directory-policy-files",
  "no-install-script",
  "nothing-compiles-at-install",
  "no-mcp-server",
  "evals-do-not-ship",
]);

/** The scripts that would run at install time; the package must have none (F113-FR-030). */
export const INSTALL_SCRIPT_NAMES: readonly string[] = Object.freeze([
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "prepare",
]);

/** The names a manifest key or a file may carry for the product to refuse it (F113-FR-031). */
export const MCP_MARKERS: readonly string[] = Object.freeze(["mcpServers", ".mcp.json", "mcp"]);

/**
 * The strict validation of a BUILT plugin directory: every check of
 * `VALIDATION_CHECKS` must pass, or `strictPluginValidation` throws.
 */
export function validatePlugin(pluginDirectory: string): readonly ValidationFinding[] {
  const root = resolve(pluginDirectory);
  const findings: ValidationFinding[] = [];
  const has = (relativePath: string): boolean => {
    try {
      return statSync(join(root, relativePath)).isFile();
    } catch {
      return false;
    }
  };
  const listRelative = (relativePath: string): readonly string[] => {
    try {
      return readdirSync(join(root, relativePath));
    } catch {
      return [];
    }
  };

  // manifest-present
  const manifestPresent = has(PLUGIN_MANIFEST_PATH);
  findings.push({
    check: "manifest-present",
    ok: manifestPresent,
    detail: manifestPresent ? PLUGIN_MANIFEST_PATH : `${PLUGIN_MANIFEST_PATH} is missing`,
  });

  // plugin-version-explicit-and-equal
  let manifestValue: Record<string, unknown> = {};
  try {
    manifestValue = JSON.parse(readFileSync(join(root, PLUGIN_MANIFEST_PATH), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    manifestValue = {};
  }
  const explicit = typeof manifestValue.version === "string" ? manifestValue.version : undefined;
  const versionOk = explicit !== undefined && explicit === packageVersion();
  findings.push({
    check: "plugin-version-explicit-and-equal",
    ok: versionOk,
    detail:
      explicit === undefined
        ? "the manifest carries no version"
        : `plugin version ${explicit} against package version ${packageVersion()}`,
  });

  // marketplace-entry-names-the-exact-version
  let entryValue: Record<string, unknown> = {};
  try {
    entryValue = JSON.parse(readFileSync(join(root, MARKETPLACE_ENTRY_PATH), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    entryValue = {};
  }
  const plugins = Array.isArray(entryValue.plugins) ? entryValue.plugins : [];
  const own = plugins.find(
    (p) => (p as Record<string, unknown>).package === PLUGIN_PACKAGE_NAME,
  ) as Record<string, unknown> | undefined;
  const entryOk =
    own !== undefined &&
    own.source === PLUGIN_SOURCE &&
    own.version === packageVersion() &&
    typeof own.version === "string" &&
    // A range is never an exact version: no `^`, `~`, `>`, `<`, `*`, `x` or `||`.
    !/[~^>*x|]/.test(own.version) === true;
  findings.push({
    check: "marketplace-entry-names-the-exact-version",
    ok: entryOk,
    detail:
      own === undefined
        ? `${MARKETPLACE_ENTRY_PATH} holds no entry for ${PLUGIN_PACKAGE_NAME}`
        : `entry names ${PLUGIN_PACKAGE_NAME}@${String(own.version)} from ${String(own.source)}`,
  });

  // skills-present
  const skills = renderPluginSkills().map((artifact) => artifact.path);
  const skillsOk = skills.every((path) => has(path));
  findings.push({
    check: "skills-present",
    ok: skillsOk,
    detail: skillsOk
      ? `${skills.length} skills at ${skills.join(", ")}`
      : `a skill is missing of ${skills.join(", ")}`,
  });

  // no-bin-directory (directory policy 2026-11-10: bin/ only for Verified)
  const binOk = !listRelative(".").includes("bin");
  findings.push({
    check: "no-bin-directory",
    ok: binOk,
    detail: binOk ? "no `bin/` directory in the plugin" : "the plugin ships a `bin/` directory",
  });

  // no-hooks-directory (directory policy: command hooks only for Verified)
  const hooksDirOk = !listRelative(".").includes("hooks");
  findings.push({
    check: "no-hooks-directory",
    ok: hooksDirOk,
    detail: hooksDirOk
      ? "no `hooks/` directory in the plugin"
      : "the plugin ships a `hooks/` directory",
  });

  // no-executable-and-allowed-types-only (directory policy: no `#!` file, no
  // file outside Markdown, text, JSON, YAML, PNG, JPEG, GIF, WebP, ICO; every
  // text file UTF-8 with no NUL byte)
  const ALLOWED_EXTENSIONS = new Set([
    ".md",
    ".txt",
    ".json",
    ".yaml",
    ".yml",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
  ]);
  const policyOffenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = dir === "." ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(rel);
        continue;
      }
      if (!ALLOWED_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase())) {
        policyOffenders.push(`${rel}: extension outside the allowed types`);
        continue;
      }
      const bytes = readFileSync(join(root, rel));
      if (bytes.includes(0)) {
        policyOffenders.push(`${rel}: a NUL byte`);
        continue;
      }
      if (/\.(md|txt|json|yaml|yml)$/.test(rel)) {
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          if (text.startsWith("#!")) policyOffenders.push(`${rel}: starts with \`#!\``);
        } catch {
          policyOffenders.push(`${rel}: not valid UTF-8`);
        }
      }
    }
  };
  walk(".");
  findings.push({
    check: "directory-policy-files",
    ok: policyOffenders.length === 0,
    detail:
      policyOffenders.length === 0
        ? "every file is an allowed type, UTF-8 with no NUL byte, and no file starts with `#!`"
        : policyOffenders.slice(0, 5).join("; "),
  });

  // no-install-script, nothing-compiles-at-install
  let packageScripts: Record<string, unknown> = {};
  try {
    packageScripts =
      (
        JSON.parse(readFileSync(join(dirname(PACKAGE_JSON_PATH), "package.json"), "utf8")) as {
          scripts?: Record<string, string>;
        }
      ).scripts ?? {};
  } catch {
    packageScripts = {};
  }
  const installScripts = INSTALL_SCRIPT_NAMES.filter((name) => name in packageScripts);
  findings.push({
    check: "no-install-script",
    ok: installScripts.length === 0,
    detail:
      installScripts.length === 0
        ? "the package declares no preinstall, install or postinstall script"
        : `the package declares ${installScripts.join(", ")}`,
  });
  const buildHookedToInstall = INSTALL_SCRIPT_NAMES.some(
    (name) =>
      typeof packageScripts[name] === "string" &&
      /tsc|build|compile/.test(packageScripts[name] as string),
  );
  findings.push({
    check: "nothing-compiles-at-install",
    ok: !buildHookedToInstall,
    detail: buildHookedToInstall
      ? "an install script compiles or builds"
      : "nothing of the install compiles or builds",
  });

  // no-mcp-server
  const mcpKey =
    "mcpServers" in manifestValue && Object.keys(manifestValue.mcpServers ?? {}).length > 0;
  const mcpFile = MCP_MARKERS.some((marker) => marker.endsWith(".json") && has(marker));
  findings.push({
    check: "no-mcp-server",
    ok: !mcpKey && !mcpFile,
    detail:
      mcpKey || mcpFile
        ? "the plugin declares a server of the model context protocol"
        : "the plugin holds no server of the model context protocol (Wave 1)",
  });

  // evals-do-not-ship (F113-FR-031)
  const evalsDirectory = listRelative(".").includes("evals");
  findings.push({
    check: "evals-do-not-ship",
    ok: !evalsDirectory,
    detail: evalsDirectory
      ? "the `evals` directory ships to consumers, which F113-FR-031 forbids"
      : "no `evals` directory in the plugin",
  });

  return Object.freeze(findings);
}

/** The error `strictPluginValidation` throws: the build fails (F113-FR-030). */
export class PluginValidationError extends Error {
  readonly findings: readonly ValidationFinding[];
  constructor(findings: readonly ValidationFinding[]) {
    const failed = findings.filter((f) => !f.ok);
    super(
      `the strict validation of the plugin failed: ${failed
        .map((f) => `${f.check} (${f.detail})`)
        .join("; ")}`,
    );
    this.name = "PluginValidationError";
    this.findings = Object.freeze([...findings]);
  }
}

/** The strict validation step of the build: it throws on the first failing check. */
export function strictPluginValidation(pluginDirectory: string): readonly ValidationFinding[] {
  const findings = validatePlugin(pluginDirectory);
  if (findings.some((f) => !f.ok)) throw new PluginValidationError(findings);
  return findings;
}

/* -------------------------------------------------------------------------
 * The host CLI half of the validation
 * ---------------------------------------------------------------------- */

/** The host CLI the build would ask to validate the plugin (plan.md, "Primary Dependencies"). */
export const HOST_CLI = "claude" as const;

/** The command of the host CLI that validates a plugin, and the one that prints details. */
export const HOST_CLI_VALIDATE_COMMAND = "plugin validate" as const;

/**
 * The host CLI half of the strict validation. `claude` is not a dependency of
 * the build and makes no model call when it runs, but it is not present in
 * every environment: where it is absent the step is a SKIP WITH ITS REASON
 * (Principle XVII), never a pass and never a fake.
 */
export function hostCliValidationStep(pluginDirectory: string): {
  ran: boolean;
  skippedReason?: string;
  command?: string;
} {
  const path = process.env.PATH ?? "";
  const found = path.split(":").some((dir) => {
    if (dir.length === 0) return false;
    try {
      return statSync(resolve(dir, HOST_CLI)).isFile();
    } catch {
      return false;
    }
  });
  if (!found) {
    return {
      ran: false,
      skippedReason: `the host CLI \`${HOST_CLI}\` is absent: \`${HOST_CLI_VALIDATE_COMMAND}\` is a skip with its reason, never a pass (Principle XVII)`,
    };
  }
  return {
    ran: true,
    command: `${HOST_CLI} ${HOST_CLI_VALIDATE_COMMAND} ${relative(process.cwd(), resolve(pluginDirectory))}`,
  };
}
