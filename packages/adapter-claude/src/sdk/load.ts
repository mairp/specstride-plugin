// @specstride/adapter-claude — src/sdk/load.ts
//
// T066 — the loader of the OPTIONAL peer dependency
// `@anthropic-ai/claude-agent-sdk` (F125-FR-036; contracts/transport-and-sdk.md,
// "How the optional dependency is declared and loaded"):
//
//   - DECLARATION: the package lists the SDK under optional peer dependencies
//     with `peerDependenciesMeta.…optional: true` (package.json). Never under
//     `dependencies`, `optionalDependencies` or `devDependencies`.
//   - INSTALLED BY THE PRODUCT: never. No install script; nothing compiled.
//   - BUNDLING: the bundler treats it as external; nothing of it is imported
//     statically and no specifier of it is inlined — the dynamic import below
//     is the ONLY occurrence of the package name in product code.
//   - LOADING: a dynamic import by package name, resolved from the CONSUMER'S
//     installation (the workspace of the run first, then the location of the
//     product's entry), inside a function called only when the transport
//     `sdk-in-process` is chosen. Failure to import is the availability state
//     `absent-dependency`, NOT an error of the run.
//   - TYPES: nothing of the SDK is imported at build time. The adapter
//     declares a narrow STRUCTURAL type for the one call it uses (`query`),
//     and the tests inject a fake — the shape of Lisa's `queryImpl`.
//   - VERSION RANGE: read from the INSTALLED package's own manifest, never
//     guessed; outside the 0.3 line from the tested 0.3.284 is a doctor
//     WARNING (F125-FR-037), never a refusal.

/** The package name of the optional peer dependency. */
export const SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";

/** The tested version of the SDK and the range (the 0.3 line, CQ-148). */
export const SDK_TESTED_VERSION = "0.3.284";
export const SDK_VERSION_RANGE = ">=0.3.284 <0.4.0";

/** The narrow STRUCTURAL type of the one SDK call this adapter uses. */
export type QueryImpl = (args: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

/** What the loader needs of the installed module — structure, never SDK types. */
export type ClaudeAgentSdkModule = {
  readonly query: QueryImpl;
};

/** The closed availability set of the SDK transport (contracts/transport-and-sdk.md). */
export const SDK_AVAILABILITY_STATES = [
  "available",
  "absent-dependency",
  "out-of-range",
  "refused-at-tier",
  "not-chosen",
] as const;
export type SdkAvailability = (typeof SDK_AVAILABILITY_STATES)[number];

/** The result of a load attempt: a module, or a named availability state. */
export type SdkLoadOutcome =
  | {
      readonly available: true;
      readonly module: ClaudeAgentSdkModule;
      readonly version: string | null;
      readonly resolvedFrom: string;
    }
  | {
      readonly available: false;
      readonly availability: Extract<SdkAvailability, "absent-dependency">;
      /** WHY the doctor names it: the package and where resolution looked. */
      readonly reason: string;
    };

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Reads the version and the entry point out of the installed package's own
 * manifest, WITHOUT importing it. `null` where the manifest states neither —
 * the version is never guessed (F125-FR-037).
 */
function readInstalledManifest(packageDir: string): {
  version: string | null;
  entry: string | null;
} {
  const manifestPath = join(packageDir, "package.json");
  if (!existsSync(manifestPath)) return { version: null, entry: null };
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const version = typeof manifest["version"] === "string" ? manifest["version"] : null;
  const main =
    typeof manifest["main"] === "string"
      ? manifest["main"]
      : typeof manifest["exports"] === "string"
        ? manifest["exports"]
        : null;
  return { version, entry: main !== null ? join(packageDir, main) : null };
}

/**
 * Resolves the SDK from the consumer's installation: the WORKSPACE OF THE RUN
 * first (process.cwd()), then the location of the PRODUCT'S ENTRY (this
 * package). Returns `null` where neither installation holds the package —
 * that is the state `absent-dependency`, not an error.
 */
export function resolveSdkLocation(
  runWorkspace: string = process.cwd(),
  productEntry: string = import.meta.url,
): { packageDir: string; version: string | null; entry: string | null } | null {
  const starts: readonly string[] = [resolve(runWorkspace), dirname(fileUrlToPath(productEntry))];
  for (const start of starts) {
    try {
      const require = createRequire(join(start, "package.json"));
      const resolved = require.resolve(`${SDK_PACKAGE}/package.json`);
      if (typeof resolved !== "string" || !isAbsolute(resolved)) continue;
      const packageDir = dirname(resolved);
      const { version, entry } = readInstalledManifest(packageDir);
      return { packageDir, version, entry };
    } catch {
      // Not installed at this root: try the next one.
    }
  }
  return null;
}

function fileUrlToPath(url: string): string {
  return url.startsWith("file://") ? new URL(url).pathname : url;
}

/**
 * True when `version` sits in the tested range: the 0.3 line from the tested
 * 0.3.284 (CQ-148). An unknown version is NOT in the range — the doctor
 * warns, nothing more.
 */
export function sdkVersionInRange(version: string | null | undefined): boolean {
  if (typeof version !== "string" || version === "") return false;
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match === null) return false;
  const numbers = [Number(match[1]), Number(match[2]), Number(match[3])];
  // Inside the range: the same 0.3 line, at or above the tested patch.
  return numbers[0] === 0 && numbers[1] === 3 && numbers[2] >= 284;
}

/**
 * The doctor WARNING for a version outside the range (F125-FR-037): a
 * warning, never a refusal, never an error of the run.
 */
export function sdkVersionWarning(version: string | null | undefined): string | null {
  if (sdkVersionInRange(version)) return null;
  const shown = typeof version === "string" && version !== "" ? version : "unknown";
  return (
    `the installed ${SDK_PACKAGE} is version ${shown}, outside the tested range ` +
    `${SDK_VERSION_RANGE} (tested ${SDK_TESTED_VERSION}); the SDK transport may misbehave`
  );
}

/**
 * THE loader (F125-FR-036). Called ONLY when the transport
 * `sdk-in-process` is chosen — never at module load, never on any other
 * transport. A failure to import is `absent-dependency`, not an error of
 * the run.
 */
export async function loadSdk(
  input: { readonly runWorkspace?: string } = {},
): Promise<SdkLoadOutcome> {
  const location = resolveSdkLocation(input.runWorkspace);
  if (location === null) {
    return {
      available: false,
      availability: "absent-dependency",
      reason:
        `the SDK transport (${SDK_PACKAGE}) is not installed: it is an optional peer ` +
        `dependency the consumer installs; looked from the workspace of the run and ` +
        `from the product's entry (F125-FR-036)`,
    };
  }
  let module: unknown;
  if (location.entry !== null && existsSync(location.entry)) {
    module = await import(pathToFileURL(location.entry).href);
  } else {
    // No readable entry: import by package name from the consumer's root.
    try {
      module = await import(SDK_PACKAGE);
    } catch {
      return {
        available: false,
        availability: "absent-dependency",
        reason: `${SDK_PACKAGE} is present at ${location.packageDir} but exports no readable entry`,
      };
    }
  }
  const record = module as Record<string, unknown>;
  if (typeof record["query"] !== "function") {
    return {
      available: false,
      availability: "absent-dependency",
      reason: `${SDK_PACKAGE} at ${location.packageDir} exports no \`query\` function`,
    };
  }
  return {
    available: true,
    module: record as unknown as ClaudeAgentSdkModule,
    version: location.version,
    resolvedFrom: location.packageDir,
  };
}
