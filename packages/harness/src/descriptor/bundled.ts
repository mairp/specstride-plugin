/**
 * T059 — the loader of the bundled descriptors (F109-FR-023).
 *
 * The product ships a small set of harness descriptors as data, in
 * `data/descriptors/`, with the origin `bundled`. Each is read by its
 * logical name `package:harness:<id>` (feature 100, annex B §B.5),
 * validated by the SAME loader as a descriptor of the consumer, and read
 * from the directory at call time — so removing a bundled descriptor
 * changes no code. No bundled descriptor holds a path, an account, a model,
 * a gateway or a name that is specific to one machine; the conformance
 * check `bundledNamesAreMachineFree` pins that.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDescriptorYaml } from "./yaml-data.ts";
import {
  loadDescriptors,
  type DescriptorFinding,
  type DescriptorOrigin,
  type LoadedDescriptor,
  type OpenSetRegistries,
} from "./loader.ts";

/** The directory the bundled descriptors ship in, as data. */
export const BUNDLED_DESCRIPTORS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "descriptors",
);

/** The logical name a bundled descriptor is read by (annex B §B.5). */
export function bundledLogicalName(id: string): string {
  return `package:harness:${id}`;
}

/**
 * The names that are specific to one machine. A bundled descriptor holds
 * none of them: no absolute path, no account, no model of a machine, no
 * gateway, no host name.
 */
const MACHINE_SPECIFIC: readonly RegExp[] = Object.freeze([
  /\/home\/[a-z0-9_]/i, // a home directory of a machine
  /\/Users\//, // a macOS user directory
  /\/root\//, // this host's root home
  /localhost:\d+/, // a pinned port of a machine
  /\b(api|gateway|[a-z]+)\.(openai|anthropic)\.com\b/i, // a named gateway
  // A model name of a machine. (The names of the registry's entries are
  // deliberately not spelled here: the core names no harness, CT-109-8.)
  /\b(?:gpt|o\d|gemini|llama|mistral|qwen|deepseek)[-. ]?\d/i,
  /\b[a-z]{3,8}-\d[-.]\d[-.a-z0-9]*\b/i,
  /\b(?:sk|xox)[-_][a-zA-Z0-9]/, // an account's credential material
]);

/** True where a text carries a machine-specific name (F109-FR-023). */
export function textIsMachineSpecific(text: string): string | null {
  for (const pattern of MACHINE_SPECIFIC) {
    const match = text.match(pattern);
    if (match !== null) return match[0];
  }
  return null;
}

export type BundledLoadResult = {
  /** Every bundled descriptor that validated, with `origin: "bundled"`. */
  readonly entries: readonly LoadedDescriptor[];
  /** Every finding: an invalid descriptor refuses with its reason. */
  readonly findings: readonly DescriptorFinding[];
  /** The logical name of every file that was read, keyed by the file name. */
  readonly logicalNames: Readonly<Record<string, string>>;
};

/**
 * F109-FR-023 — read every bundled descriptor from the directory, validate
 * it, and return the winners. The directory is read at call time; a
 * descriptor removed from it simply stops being shipped, with no code
 * change.
 */
export function loadBundledDescriptors(input?: {
  /** Another directory, for a test; the shipped directory by default. */
  readonly dir?: string;
  /** The registries the open sets resolve through. */
  readonly registries?: OpenSetRegistries;
}): BundledLoadResult {
  const dir = input?.dir ?? BUNDLED_DESCRIPTORS_DIR;
  const registries: OpenSetRegistries = input?.registries ?? {
    kinds: ["cli", "openai-chat", "anthropic-messages"],
    streamFormats: ["text", "jsonl", "sse-openai", "sse-anthropic"],
  };
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".yaml"))
    .sort();
  const sources = names.map((name) => {
    const text = readFileSync(join(dir, name), "utf8");
    return { raw: parseDescriptorYaml(text) as unknown, origin: "bundled" as DescriptorOrigin };
  });
  const loaded = loadDescriptors(sources, registries);
  const logicalNames: Record<string, string> = {};
  for (const entry of loaded.entries) {
    const id = entry.descriptor.id;
    if (typeof id === "string") {
      logicalNames[id] = bundledLogicalName(id);
    }
  }
  return {
    entries: loaded.entries,
    findings: loaded.findings,
    logicalNames,
  };
}
