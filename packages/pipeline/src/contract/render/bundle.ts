/**
 * T038 — the launch bundle (F107-FR-029; C-222, C-224).
 *
 * Content-addressed: the address is the FIRST 20 hexadecimal characters of
 * the hash of the canonical bytes of the promoted launch contract. The bundle
 * holds the canonical launch contract, the implementation artifacts that
 * execute it, and a manifest that lists every OTHER file of the bundle with
 * its content hash. The hash of the bundle — the one the launcher and the
 * launch record name — is the content hash of the manifest.
 *
 * The bundle is published from a temporary name, forced to disk, and renamed
 * into place (the atomic write of the kernel). An existing bundle is reused
 * only when its launch contract hashes to the contract hash; otherwise render
 * fails with `content-addressed bundle is inconsistent`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { canonicalRecordText, contentHash } from "@specstride/kernel";

import { atomicWrite, atomicWriteJson as writeAtomicallyJson } from "@specstride/kernel";
import { physicalStatePath } from "../draft/verification-commands.ts";
import { bundleStateName } from "../layout.ts";

/** The length of the bundle address in hexadecimal characters (F107-FR-029). */
export const BUNDLE_ADDRESS_LENGTH = 20;

/** The address of the bundle: the first 20 hex characters of the contract hash. */
export function bundleAddress(contractHash: string): string {
  return contractHash.slice(0, BUNDLE_ADDRESS_LENGTH);
}

/** The hash of the canonical bytes of the promoted launch contract. */
export function contractHashOf(record: unknown): string {
  return contentHash(`${canonicalRecordText(record)}\n`);
}

/** The manifest of a bundle: every other file of the bundle, with its hash. */
export type BundleManifest = {
  readonly schema_version: "1.0";
  readonly contract_sha256: string;
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
};

/** The files of the bundle, as published. */
export type PublishedBundle = {
  /** The logical name of the bundle (F107-FR-026). */
  readonly logicalName: string;
  /** The physical directory of the bundle. */
  readonly path: string;
  readonly address: string;
  readonly contractHash: string;
  /** The content hash of the manifest: the hash of the launch bundle. */
  readonly bundleHash: string;
};

/** The file name of the canonical contract inside a bundle. */
export const CONTRACT_FILE = "launch-contract.json";
/** The file name of the manifest inside a bundle. */
export const MANIFEST_FILE = "manifest.json";

/** The manifest for a contract and the implementation files that join it. */
export function manifestOf(
  contract: unknown,
  contractHash: string,
  implementationFiles: readonly { readonly path: string; readonly bytes: Uint8Array | string }[],
): BundleManifest {
  const files = [
    {
      path: CONTRACT_FILE,
      sha256: contentHash(`${canonicalRecordText(contract)}\n`),
    },
    ...implementationFiles.map((one) => ({
      path: one.path,
      sha256: contentHash(one.bytes),
    })),
  ];
  return { schema_version: "1.0", contract_sha256: contractHash, files };
}

/** The bytes of one bundle file: the canonical contract, or the given bytes. */
function fileBytes(
  contract: unknown,
  entry: { readonly path: string; readonly bytes?: Uint8Array | string },
): string | Uint8Array {
  return entry.path === CONTRACT_FILE ? `${canonicalRecordText(contract)}\n` : (entry.bytes ?? "");
}

/**
 * Publish the launch bundle under its logical name. Returns the bundle and
 * its hash; throws nothing — a failure is the refusal string of F107-FR-029.
 */
export function publishBundle(input: {
  readonly root: string;
  readonly pipelineId: string;
  readonly contract: unknown;
  readonly contractHash?: string | undefined;
  readonly implementationFiles?: readonly {
    readonly path: string;
    readonly bytes: Uint8Array | string;
  }[];
}):
  | { readonly ok: true; readonly bundle: PublishedBundle }
  | { readonly ok: false; readonly reason: string } {
  const contractHash = input.contractHash ?? contractHashOf(input.contract);
  const address = bundleAddress(contractHash);
  const logicalName = bundleStateName(input.pipelineId, address);
  const path = physicalStatePath(input.root, logicalName);
  const manifest = manifestOf(input.contract, contractHash, input.implementationFiles ?? []);

  // The reuse check (F107-FR-029): an existing bundle is reused only when its
  // launch contract hashes to the contract hash.
  const existingManifest = path === undefined ? undefined : readManifest(join(path, MANIFEST_FILE));
  if (existingManifest !== undefined) {
    if (existingManifest.contract_sha256 !== contractHash) {
      return { ok: false, reason: "content-addressed bundle is inconsistent" };
    }
    const contractFile = join(path, CONTRACT_FILE);
    if (!existsSync(contractFile)) {
      return { ok: false, reason: "content-addressed bundle is inconsistent" };
    }
    let existingContract: unknown;
    try {
      existingContract = JSON.parse(readFileSync(contractFile, "utf8"));
    } catch {
      return { ok: false, reason: "content-addressed bundle is inconsistent" };
    }
    if (contentHash(`${canonicalRecordText(existingContract)}\n`) !== contractHash) {
      return { ok: false, reason: "content-addressed bundle is inconsistent" };
    }
    return {
      ok: true,
      bundle: {
        logicalName,
        path,
        address,
        contractHash,
        bundleHash: contentHash(canonicalManifestBytes(existingManifest)),
      },
    };
  }

  // Publish from a temporary name, forced to disk, renamed into place.
  // Publish from a temporary name, forced to disk, renamed into place. The
  // contract is written in its CANONICAL bytes — the form the manifest entry
  // and every later integrity check hash (assertion 3 of F107-FR-031).
  atomicWrite(join(path, CONTRACT_FILE), fileBytes(input.contract, { path: CONTRACT_FILE }), {
    createDirectory: true,
  });
  for (const file of input.implementationFiles ?? []) {
    // An implementation file holds its OWN bytes — never the JSON form of
    // them, which would not hash to the manifest entry (assertion 3).
    atomicWrite(join(path, file.path), fileBytes(input.contract, file), {
      createDirectory: true,
    });
  }
  writeAtomicallyJson(join(path, MANIFEST_FILE), manifest, { createDirectory: true });
  return {
    ok: true,
    bundle: {
      logicalName,
      path,
      address,
      contractHash,
      bundleHash: contentHash(canonicalManifestBytes(manifest)),
    },
  };
}

/** The canonical bytes of a manifest: its JSON text, compact, no final line end. */
export function canonicalManifestBytes(manifest: unknown): string {
  return canonicalRecordText(manifest);
}

/** Read a manifest, or `undefined` where there is none. */
function readManifest(file: string): BundleManifest | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as BundleManifest;
  } catch {
    return undefined;
  }
}

/**
 * The four assertions of F107-FR-031 over a published bundle, on disk.
 * Empty when every hash holds.
 */
export function bundleInconsistencies(
  bundlePath: string,
  expectedContractHash: string,
): readonly string[] {
  const problems: string[] = [];
  const manifest = readManifest(join(bundlePath, MANIFEST_FILE));
  if (manifest === undefined) return [`the manifest of the bundle is missing: ${MANIFEST_FILE}`];
  for (const file of manifest.files) {
    const full = join(bundlePath, file.path);
    if (!existsSync(full) || !statSync(full).isFile()) {
      problems.push(`the file of the bundle is missing: ${file.path}`);
      continue;
    }
    if (contentHash(readFileSync(full)) !== file.sha256) {
      problems.push(`the hash of a file of the bundle changed: ${file.path}`);
    }
  }
  let contract: unknown;
  try {
    contract = JSON.parse(readFileSync(join(bundlePath, CONTRACT_FILE), "utf8"));
  } catch {
    return [...problems, "the launch contract of the bundle is not JSON"];
  }
  if (contentHash(`${canonicalRecordText(contract)}\n`) !== expectedContractHash) {
    problems.push("the launch contract of the bundle changed after the render");
  }
  return problems;
}

/** Every file of a published bundle, relative (the launcher's own checks). */
export function bundleFiles(bundlePath: string): readonly string[] {
  const names: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else names.push(full);
    }
  };
  walk(bundlePath);
  return names;
}
