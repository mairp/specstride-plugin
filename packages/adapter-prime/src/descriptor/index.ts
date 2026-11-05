/**
 * The descriptor of the prime harness adapter, as data (T008; covers
 * F138-FR-001 and F138-FR-004).
 *
 * The descriptor is data under `packages/adapter-prime/data/`
 * (`data/descriptor.prime.json`), checked against the harness-descriptor
 * schema of feature 100 at load. The contract of the feature
 * (`specs/138-adapter-prime/contracts/descriptor-prime.json`) is the same
 * content and is kept for traceability; the package data file is what ships.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "@specstride/contracts/records/compile";

/** The schema id of the harness descriptor, version 1 (annex C, §C.2). */
export const DESCRIPTOR_SCHEMA_ID = "specstride.harness/1:descriptor";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The package data file the descriptor ships from, resolved from this module. */
export const PRIME_DESCRIPTOR_PATH = join(HERE, "..", "..", "data", "descriptor.prime.json");

/** The contract file the descriptor was first written in (traceability only). */
export const PRIME_DESCRIPTOR_CONTRACT_PATH = join(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "specs",
  "138-adapter-prime",
  "contracts",
  "descriptor-prime.json",
);

/** The prime descriptor: the fields of annex C §C.2, validated. */
export type PrimeDescriptor = {
  descriptorVersion: number;
  id: string;
  kind: string;
  [key: string]: unknown;
};

/** One refusal to load the descriptor: the schema errors of the check. */
export class DescriptorRefusedError extends Error {
  readonly errors: { keyword: string; path: string; message: string }[];
  constructor(errors: { keyword: string; path: string; message: string }[]) {
    super(
      `the prime descriptor does not satisfy ${DESCRIPTOR_SCHEMA_ID}: ` +
        errors.map((e) => `${e.path}: ${e.message}`).join("; "),
    );
    this.name = "DescriptorRefusedError";
    this.errors = errors;
  }
}

/** Read and validate the descriptor from a path (the contract by default). */
export function loadPrimeDescriptor(path: string = PRIME_DESCRIPTOR_PATH): PrimeDescriptor {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const result = validate(DESCRIPTOR_SCHEMA_ID, value);
  if (!result.ok) throw new DescriptorRefusedError(result.errors);
  return result.record as PrimeDescriptor;
}

/** The prime descriptor, loaded once at first import. */
export const primeDescriptor: PrimeDescriptor = loadPrimeDescriptor();

/** The profile a registry entry is projected for. */
export type RegistryProfile = "parity" | "default";

/**
 * The registry entry the engine reports for prime (T011; F138-FR-001,
 * parity item C-035 / B-0430). The qualifier of both roles is OPTIONAL with
 * the label `variant`, spelled `prime[:variant]`. Under the `parity` profile
 * the entry names NO stream format and declares NO overlay: a structured pass
 * reaches the reader through the dialect row of the adapter
 * (the stream dialect -> the row's provider format `prime-v3`), never through
 * the registry entry.
 */
export function primeRegistryEntry(profile: RegistryProfile) {
  const parity = profile === "parity";
  const descriptor = primeDescriptor;
  return {
    id: descriptor.id,
    kind: descriptor.kind,
    origin: descriptor.origin,
    qualifier: { form: "optional", label: "variant", spelling: "prime[:variant]" },
    roles: {
      proposer: { supported: true },
      critic: { supported: true, toolless: "flag", freshSession: true },
    },
    ...(parity
      ? {}
      : {
          stream: {
            format: (descriptor.stream as { format: string }).format,
            dialect: (descriptor.stream as { dialect: string }).dialect,
          },
          overlay: (descriptor.isolation as { configHome: unknown }).configHome,
        }),
  };
}
