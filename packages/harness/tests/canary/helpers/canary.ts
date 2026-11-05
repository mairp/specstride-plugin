/**
 * The helper of the canary tests (T015): one run of discovery over the
 * fixture home, driven by the environment of the process it runs in. The
 * child of the operating-system trace imports this file, so the traced
 * process runs exactly the discovery the test runs.
 */
import { join } from "node:path";
import { discover } from "../../../src/discovery/discover.ts";
import { GuardedReader } from "../../../src/discovery/guarded-reader.ts";
import { fileURLToPath } from "node:url";

/** The fixture home of T001. */
export const FIXTURE_HOME = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "fixtures",
  "home",
);

/** The planted credential files of the fixture home, by name. */
export const PLANTED_FILES: readonly string[] = [
  ".netrc",
  ".aws/credentials",
  ".ssh/id_ed25519",
  ".config/harness/credentials.json",
];

/**
 * A resolver that answers from the environment of the process: the
 * presence of a name, never its value, unless the run itself resolves a
 * reference — which the canary proves discovery never does.
 */
export function environmentResolver(): import("@specstride/contracts/ep/secret-resolver").SecretResolver & {
  readonly resolveCalls: string[];
} {
  const resolveCalls: string[] = [];
  return {
    resolveCalls,
    handles: (scheme) => scheme === "env:",
    exists: (reference) =>
      Promise.resolve(
        reference.startsWith("env:") && process.env[reference.slice(4)] !== undefined
          ? "yes"
          : "no",
      ),
    resolve: (reference) => {
      resolveCalls.push(reference);
      const value = reference.startsWith("env:") ? process.env[reference.slice(4)] : undefined;
      return Promise.resolve({ value: value ?? "", registeredWithTheRedactor: true });
    },
    boundHost: () => null,
  };
}

/** One run of discovery over the fixture home. No metadata pass, no network. */
export async function runCanaryDiscovery(): Promise<{
  readonly candidateIds: readonly string[];
  readonly trace: readonly unknown[];
  readonly resolveCalls: readonly string[];
}> {
  const resolver = environmentResolver();
  const reader = new GuardedReader({
    secretResolver: resolver,
    readSearchPath: () => process.env.CANARY_BIN ?? join(FIXTURE_HOME, "bin"),
  });
  const result = await discover({
    resolver,
    reader,
    switches: { discoveryEnabled: true, metadataPassEnabled: false, parityProfile: false },
  });
  return {
    candidateIds: result.candidates.map((candidate) => candidate.id),
    trace: reader.trace,
    resolveCalls: resolver.resolveCalls,
  };
}
