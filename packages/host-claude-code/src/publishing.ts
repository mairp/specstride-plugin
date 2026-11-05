/**
 * T036 — the publishing rule of the host package, written into the build
 * (F113-FR-042).
 *
 * F113-FR-042: the host package MUST be published only as part of the one
 * published package, under F100-FR-236 — by the build, from a protected
 * branch, with the attestation. The plugin directory MUST NOT be published
 * apart from the package, from a working copy or by hand. The marketplace
 * entry and the documentation MUST name the exact package and the exact
 * version, and no range. Because the plugin directory lies inside the package
 * (`files` of the manifest of this package carries `plugin/`), the release
 * check of F100-FR-236 covers it; this feature adds NO second attestation.
 *
 * The release check of F100-FR-236 itself is feature 100's
 * `tests/release/100/publish-attestation.ts` (CT-100-336); this module adds
 * the rule of THIS package to the build and never re-implements the check.
 * Nothing here calls a model, starts a process or opens a connection.
 */

/** The plugin directory of this package, as `packaging.ts` builds it. */
import { PLUGIN_DIRECTORY } from "./packaging.ts";
export { PLUGIN_DIRECTORY };

/** The package the marketplace entry and the documentation name (F113-FR-042). */
export const PLUGIN_PACKAGE_NAME = "@specstride/host-claude-code" as const;

/**
 * The rule, as data, so that a test reads the rule and not a paraphrase of it.
 */
export const PLUGIN_PUBLISHING_RULE = Object.freeze({
  requirement: "F113-FR-042",
  publishedOnlyAsPartOf: "@specstride/specstride (the one published package)",
  underReleaseCheck: "F100-FR-236 (CT-100-336): by the build, protected branch, attestation",
  pluginDirectoryInsideThePackage: true,
  secondAttestation: false,
  marketplaceEntryNamesExactPackageAndVersion: true,
  documentationNamesExactPackageAndVersion: true,
});

/** One publishing target a build step declares: what it would push, and where. */
export type PublishTarget = {
  /** What names the step, e.g. `npm publish --workspace @specstride/specstride`. */
  readonly step: string;
  /** The package the step publishes, where it publishes a package. */
  readonly package?: string;
  /** The directory the step pushes, where it pushes a directory. */
  readonly directory?: string;
};

/**
 * The publishing steps that would put the plugin directory apart from the
 * package (F113-FR-042): any step that pushes the plugin directory itself, or
 * that pushes a package other than the one the plugin directory is a `files`
 * entry of while naming the plugin directory.
 */
export function stepsThatPublishThePluginDirectoryApart(
  targets: readonly PublishTarget[],
): readonly PublishTarget[] {
  return targets.filter((target) => {
    if (target.directory === undefined) return false;
    if (target.directory === PLUGIN_DIRECTORY) return true; // the directory alone
    if (target.directory.includes(`/${PLUGIN_DIRECTORY}`)) return true; // apart, at any depth
    return false;
  });
}

/**
 * The error the build fails with when a step would publish the plugin
 * directory apart from the package (F113-FR-042, threat T-43).
 */
export class PluginPublishedApartError extends Error {
  override readonly name = "PluginPublishedApartError";
  readonly offenders: readonly PublishTarget[];
  constructor(offenders: readonly PublishTarget[]) {
    super(
      `the build fails: ${offenders.length} publishing step(s) would publish the plugin ` +
        `directory apart from the package (F113-FR-042): ` +
        offenders.map((target) => target.step).join("; "),
    );
    this.offenders = Object.freeze([...offenders]);
  }
}

/**
 * The build rule: the plugin directory is published only inside the package.
 * `files` of the package manifest must carry it (so the one package carries
 * it, and the release check of F100-FR-236 covers it), and no publishing step
 * may push it apart. Throws — the build fails — on a violation.
 */
export function assertPluginIsPublishedOnlyInsideThePackage(options: {
  readonly packageFiles: readonly string[];
  readonly publishTargets: readonly PublishTarget[];
}): void {
  const files = options.packageFiles.map((entry) => entry.replace(/\/$/, ""));
  if (!files.includes(PLUGIN_DIRECTORY)) {
    throw new Error(
      `the plugin directory \`${PLUGIN_DIRECTORY}\` is not a \`files\` entry of the package ` +
        `manifest, so the one published package would not carry it (F113-FR-042)`,
    );
  }
  const offenders = stepsThatPublishThePluginDirectoryApart(options.publishTargets);
  if (offenders.length > 0) throw new PluginPublishedApartError(offenders);
}

/* -------------------------------------------------------------------------
 * The exact package and the exact version (threat T-45)
 * ---------------------------------------------------------------------- */

/** What an EXACT version looks like: `1.2.3`, with an optional prerelease. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[-0-9A-Za-z.]+)?$/;

/** The refusals of a marketplace entry that does not name the exact pair. */
export type MarketplaceEntryRefusal = {
  /** `version-range` or `another-package` or `wrong-version`. */
  readonly kind: "version-range" | "another-package" | "wrong-version" | "missing";
  /** What was observed. */
  readonly detail: string;
};

/**
 * F113-FR-042 — the marketplace entry MUST name the exact package and the
 * exact version, and no range. `entry` is one entry of the `plugins` array of
 * the marketplace file.
 */
export function validateMarketplaceEntryExactness(
  entry: { readonly package?: unknown; readonly version?: unknown },
  expected: { readonly packageName: string; readonly version: string },
): readonly MarketplaceEntryRefusal[] {
  const refusals: MarketplaceEntryRefusal[] = [];
  const name = typeof entry.package === "string" ? entry.package : undefined;
  const version = typeof entry.version === "string" ? entry.version : undefined;
  if (name === undefined || version === undefined) {
    return [{ kind: "missing", detail: "the entry names no package or no version" }];
  }
  if (name !== expected.packageName) {
    refusals.push({
      kind: "another-package",
      detail: `the entry names ${name}, not ${expected.packageName} (F113-FR-042)`,
    });
  }
  if (!EXACT_VERSION.test(version)) {
    refusals.push({
      kind: "version-range",
      detail: `the entry carries the version range "${version}", not the exact version (F113-FR-042)`,
    });
  } else if (version !== expected.version) {
    refusals.push({
      kind: "wrong-version",
      detail: `the entry pins ${version}, not the package version ${expected.version} (F113-FR-042)`,
    });
  }
  return refusals;
}

/**
 * F113-FR-042 — the documentation MUST name the exact package and the exact
 * version, and no range. True where `text` names the package with its exact
 * version (`@specstride/host-claude-code@1.2.3`) and carries no range form of
 * it (`^`, `~`, `>`, `<`, `*`, `x`, `||`, or `latest`).
 */
export function documentationNamesTheExactPackage(
  text: string,
  expected: { readonly packageName: string; readonly version: string },
): boolean {
  const exact = `${expected.packageName}@${expected.version}`;
  if (!text.includes(exact)) return false;
  const rangePattern = new RegExp(
    `${expected.packageName.replace(/[@/]/g, "\\$&")}@(\\^|~|>|<|\\*|x\\d*|latest|workspace:)`,
  );
  return !rangePattern.test(text);
}
