/**
 * T031 — the resolver of the scheme `keychain:` (F110-FR-031).
 *
 * "The scheme `keychain:` MUST name an entry by service and account. `exists`
 * MUST use a query that prints nothing of the value. Where no such query is
 * known on a platform, as on Linux until one is found, `exists` MUST return
 * `unprobed` and MUST NOT fall back to a query that prints the value. The
 * behaviour on macOS is `unverified`."
 *
 * The probe of task T001 (research.md §T001) settles what is known on Linux:
 * `secret-tool lookup` WRITES THE SECRET TO STDOUT when the entry exists — the
 * probe captured 25 bytes of the probe value when stdout was not discarded. A
 * query whose output has to be thrown away is exactly the "fall back to a query
 * that prints the value" that F110-FR-031 forbids, so this resolver runs
 * NOTHING for `exists` on Linux and returns `unprobed`, as
 * `KEYCHAIN_EXISTENCE_ON_LINUX` of the contract of feature 100 also states.
 * `resolve` still works where the tool is present (spec.md, "Edge Cases").
 *
 * On macOS `security find-generic-password` without `-w` prints the attributes
 * of the entry and not the value, so it is a silent existence query; that row
 * is `unverified` (no macOS runner; owner ruling of 2026-09-30), and the row
 * itself carries the fact.
 *
 * The service and the account travel in the argument list of the KEYCHAIN TOOL.
 * That is not the argument list F110-FR-032 forbids: the names of an entry are
 * not the secret, and the VALUE only ever comes back on the tool's standard
 * output. `keychainArgvCarriesNoValue` is the check of that.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

import { KEYCHAIN_EXISTENCE_ON_LINUX } from "@specstride/contracts/ep/secret-resolver";

import {
  inlineSecretError,
  missingError,
  parseSecretReference,
  type BoundHostLookup,
  type ConfigSecretResolver,
  type Existence,
  type ResolvedSecret,
  type SecretReference,
  type SecretRegistrar,
} from "./reference.ts";
import { stripOneFinalLineEnd } from "./file.ts";

export { KEYCHAIN_EXISTENCE_ON_LINUX };

/** The scheme this resolver handles (§K.7). */
export const KEYCHAIN_SCHEME = "keychain:" as const;

/** The id the conformance report prints for this resolver. */
export const KEYCHAIN_RESOLVER_ID = "config-secret-resolver-keychain" as const;

/** The reference form of §K.7: `keychain:SERVICE/ACCOUNT`, one slash. */
export const KEYCHAIN_TARGET = /^([^/]+)\/([^/]+)$/;

/** An entry of the keychain, named by service and account (F110-FR-031). */
export interface KeychainEntry {
  readonly service: string;
  readonly account: string;
}

/** The service and the account of a target, or `undefined` where it is malformed. */
export function parseKeychainTarget(target: string): KeychainEntry | undefined {
  const match = KEYCHAIN_TARGET.exec(target);
  if (match === null) return undefined;
  const [, service, account] = match;
  if (service === undefined || account === undefined) return undefined;
  return Object.freeze({ service, account });
}

/**
 * The tool of one platform. `silentExistenceArgv` is `null` where NO query is
 * known that prints nothing of the value: `exists` then returns `unprobed` and
 * runs nothing (F110-FR-031, third sentence).
 */
export interface KeychainTool {
  /** The platform, as `process.platform` names it. */
  readonly platform: string;
  /** The command, looked up on the path unless the caller names an absolute one. */
  readonly command: string;
  /** The argument list that reads the value out, on standard output. */
  readonly resolveArgv: (entry: KeychainEntry) => readonly string[];
  /**
   * The argument list of an existence query that prints nothing of the value,
   * or `null` where none is known on this platform.
   */
  readonly silentExistenceArgv: ((entry: KeychainEntry) => readonly string[]) | null;
  /** Whether the row is `verified` by a probe on that platform (T001). */
  readonly verified: boolean;
  /** Why the row is `unverified`, where it is. */
  readonly unverifiedReason?: string | undefined;
}

/**
 * The tool of each platform of the target platforms of this feature (plan.md,
 * "Target Platform": Linux and macOS).
 */
export const KEYCHAIN_TOOLS: Readonly<Record<string, KeychainTool>> = Object.freeze({
  linux: Object.freeze({
    platform: "linux",
    command: "secret-tool",
    resolveArgv: (entry: KeychainEntry): readonly string[] =>
      Object.freeze(["lookup", "service", entry.service, "account", entry.account]),
    // F110-FR-031 — `secret-tool lookup` prints the value (research.md §T001,
    // finding 2), so no silent existence query is known on Linux.
    silentExistenceArgv: null,
    verified: true,
  }),
  darwin: Object.freeze({
    platform: "darwin",
    command: "security",
    resolveArgv: (entry: KeychainEntry): readonly string[] =>
      Object.freeze(["find-generic-password", "-s", entry.service, "-a", entry.account, "-w"]),
    // Without `-w` the command prints the attributes of the entry and not the
    // value, so this is a query that prints nothing of the value.
    silentExistenceArgv: (entry: KeychainEntry): readonly string[] =>
      Object.freeze(["find-generic-password", "-s", entry.service, "-a", entry.account]),
    verified: false,
    unverifiedReason:
      "the behaviour on macOS is `unverified` (F110-FR-031, last sentence): no " +
      "macOS runner exists in this repository, and task T041 re-opens the check " +
      "when one does",
  }),
});

/**
 * F110-FR-031, third sentence — the result of `exists` on a platform whose row
 * knows no silent query. On Linux that is `unprobed`, which is also what
 * `KEYCHAIN_EXISTENCE_ON_LINUX` of the contract of feature 100 states.
 */
export function existenceOnPlatform(platform: string): Existence | undefined {
  const tool = KEYCHAIN_TOOLS[platform];
  if (tool === undefined) return "unprobed";
  return tool.silentExistenceArgv === null ? "unprobed" : undefined;
}

/**
 * F110-FR-031, third sentence, second half — the resolver never falls back to a
 * query that prints the value. True for every row whose `silentExistenceArgv`
 * is `null`: `exists` runs nothing at all on it.
 */
export const FALLS_BACK_TO_A_QUERY_THAT_PRINTS_THE_VALUE = false as const;

/** What one run of the keychain tool reported. */
export interface ToolRun {
  /** The exit status; `null` where the tool could not be started. */
  readonly status: number | null;
  /** The standard output, verbatim. */
  readonly stdout: string;
}

/** The seam that runs the keychain tool. */
export type ToolRunner = (command: string, argv: readonly string[]) => ToolRun;

/** How long a call of the keychain tool may take. */
export const TOOL_TIME_LIMIT_MS = 5000 as const;

/**
 * The runner over `node:child_process` the resolver uses when the caller names
 * no other. The argument list is DATA — `shell: false` — so nothing of the
 * service or the account is ever interpreted by a shell (F100-FR-084).
 */
export const nodeToolRunner: ToolRunner = (command, argv) => {
  const run = spawnSync(command, [...argv], {
    encoding: "utf8",
    shell: false,
    timeout: TOOL_TIME_LIMIT_MS,
    windowsHide: true,
  });
  return Object.freeze({
    status: run.error !== undefined && run.error !== null ? null : run.status,
    stdout: typeof run.stdout === "string" ? run.stdout : "",
  });
};

/**
 * True where no element of the argument list holds the secret value: the check
 * of this module's own argument lists against F110-FR-032's third sentence.
 */
export function keychainArgvCarriesNoValue(argv: readonly string[], value: string): boolean {
  return value === "" || !argv.some((argument) => argument.includes(value));
}

/** What the `keychain:` resolver is built with. */
export interface KeychainResolverOptions {
  /** The redactor every resolved value is registered with (F110-FR-032). */
  readonly redactor: SecretRegistrar;
  /** The platform; `process.platform` when the caller names none. */
  readonly platform?: string | undefined;
  /** The command to run, where the caller pins one (a fake tool in a test). */
  readonly command?: string | undefined;
  /** The runner; `nodeToolRunner` when the caller names none. */
  readonly run?: ToolRunner | undefined;
  /** Where the references were declared, for `boundHost` (F110-FR-033). */
  readonly bindings?: BoundHostLookup | undefined;
}

/**
 * Build the `keychain:` resolver. It starts a process and makes no network call
 * (F110-FR-028).
 */
export function createKeychainResolver(options: KeychainResolverOptions): ConfigSecretResolver {
  const platform = options.platform ?? process.platform;
  const runner = options.run ?? nodeToolRunner;
  const tool = KEYCHAIN_TOOLS[platform];
  const command = options.command ?? tool?.command;

  const entryOf = (reference: SecretReference, key?: string | undefined): KeychainEntry => {
    const parsed = parseSecretReference(reference);
    if (parsed === undefined || parsed.scheme !== KEYCHAIN_SCHEME) {
      throw missingError(reference, `is no reference of the scheme \`${KEYCHAIN_SCHEME}\``, key);
    }
    const entry = parseKeychainTarget(parsed.target);
    if (entry === undefined) {
      throw inlineSecretError(
        reference,
        `names \`${parsed.target}\`, which is not \`SERVICE/ACCOUNT\` (§K.7): a ` +
          `value was written where a reference belongs`,
        key,
      );
    }
    return entry;
  };

  return Object.freeze({
    id: KEYCHAIN_RESOLVER_ID,
    scheme: KEYCHAIN_SCHEME,
    makesANetworkCall: false as const,

    handles(scheme: string): boolean {
      return scheme === KEYCHAIN_SCHEME;
    },

    /**
     * F110-FR-031 — `unprobed` on a platform that knows no query which prints
     * nothing of the value, and NOTHING is run in that case; otherwise the
     * silent query, whose exit status is the whole answer.
     */
    exists(reference: SecretReference): Promise<Existence> {
      if (parseSecretReference(reference)?.scheme !== KEYCHAIN_SCHEME) {
        return Promise.resolve<Existence>("no");
      }
      let entry: KeychainEntry;
      try {
        entry = entryOf(reference);
      } catch (error) {
        return Promise.reject(error as Error);
      }
      const unprobed = existenceOnPlatform(platform);
      if (unprobed !== undefined) return Promise.resolve(unprobed);
      const silent = tool?.silentExistenceArgv;
      if (silent === null || silent === undefined || command === undefined) {
        return Promise.resolve<Existence>("unprobed");
      }
      const run = runner(command, silent(entry));
      return Promise.resolve<Existence>(run.status === 0 ? "yes" : "no");
    },

    /**
     * F110-FR-031 — the value of the entry, read on the standard output of the
     * tool, in memory only, registered with the redactor (F110-FR-032). A tool
     * that is absent, that fails, or that prints nothing gives `missing`
     * (F110-FR-028, last sentence).
     */
    resolve(reference: SecretReference): Promise<ResolvedSecret> {
      let entry: KeychainEntry;
      try {
        entry = entryOf(reference);
      } catch (error) {
        return Promise.reject(error as Error);
      }
      if (tool === undefined || command === undefined) {
        return Promise.reject(
          missingError(
            reference,
            `names an entry of the keychain, and no keychain tool is known on ` +
              `the platform \`${platform}\``,
          ),
        );
      }
      const run = runner(command, tool.resolveArgv(entry));
      if (run.status !== 0) {
        return Promise.reject(
          missingError(
            reference,
            `names an entry the keychain tool \`${command}\` did not return ` +
              `(exit ${run.status === null ? "none: the tool could not be started" : String(run.status)})`,
          ),
        );
      }
      const value = stripOneFinalLineEnd(run.stdout);
      if (value === "") {
        return Promise.reject(
          missingError(reference, "names an entry whose value the keychain tool printed empty"),
        );
      }
      options.redactor.register(value);
      return Promise.resolve(Object.freeze({ value, registeredWithTheRedactor: true as const }));
    },

    boundHost(reference: SecretReference): string | null {
      return options.bindings?.hostOf(reference) ?? null;
    },
  });
}
