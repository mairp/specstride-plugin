/**
 * T032 — the registry of schemes, the missing-secret handling and inline
 * detection through the redactor (F110-FR-027, F110-FR-032, F110-FR-034,
 * F110-FR-035).
 *
 * The registry is OPEN (F110-FR-035): it holds no list of schemes of its own,
 * one resolver registers one scheme, and the three resolvers of Wave 1 are
 * registered by `createWave1Registry` exactly as the sample resolver of the
 * scheme `test:` is registered from the test tree. A reference whose scheme no
 * resolver handles is a configuration error — `unknownValueOutcome` of the
 * contract of feature 100 decides WHICH of the three errors it is, so the
 * registry never invents a fourth.
 */
import type { Redactor } from "@specstride/contracts/ep/redactor";

import { matchCatalogueKey } from "../schema/catalogue.ts";
import { ConfigValueError } from "../schema/types.ts";
import {
  EXISTENCE_RESULTS,
  RESOLVER_ERRORS,
  RESOLVER_OPERATIONS,
  SecretError,
  STATE_WHEN_MISSING_IN_A_RUN,
  inlineSecretError,
  isSecretReferenceText,
  parseSecretReference,
  unknownValueOutcome,
  type ConfigSecretResolver,
  type Existence,
  type ResolvedSecret,
  type SecretReference,
  type SecretRegistrar,
} from "./reference.ts";
import { createEnvResolver, ENV_SCHEME } from "./env.ts";
import { createFileResolver, FILE_SCHEME, type FileSeam } from "./file.ts";
import { createKeychainResolver, KEYCHAIN_SCHEME, type ToolRunner } from "./keychain.ts";
import { createSecretBindings, type SecretBindings, type SecretDeclaration } from "./binding.ts";

export { EXISTENCE_RESULTS, RESOLVER_ERRORS, RESOLVER_OPERATIONS, STATE_WHEN_MISSING_IN_A_RUN };

/** F110-FR-035, first sentence — the registry of schemes is open. */
export const REGISTRY_IS_OPEN = true as const;

/** F110-FR-032, first sentence — when a secret is resolved. */
export const SECRET_IS_RESOLVED_AT = "the moment of use" as const;

/** F110-FR-032, third sentence — the two ways a secret reaches a harness. */
export const SECRET_IS_PASSED_BY = ["environment", "standard input"] as const;

/** F110-FR-032, third sentence — and never in an argument list. */
export const SECRET_IN_AN_ARGUMENT_LIST = false as const;

/**
 * F110-FR-032, fourth sentence — the nine places a secret is never written to.
 * The canary test of CT-110-127 reads this list and scans one artefact per
 * entry, so a place added here is a place the test must then cover.
 */
export const SINKS_A_SECRET_IS_NEVER_WRITTEN_TO = [
  "the run snapshot",
  "the launch record",
  "the launch contract",
  "an event",
  "a log",
  "the digest",
  "the status output",
  "the read model",
  "the output of `config show`",
] as const;
export type SecretSink = (typeof SINKS_A_SECRET_IS_NEVER_WRITTEN_TO)[number];

/** A scheme registered twice: the registration is refused, not silently won. */
export class DuplicateSchemeError extends Error {
  readonly scheme: string;
  readonly registered: string;
  readonly offered: string;
  constructor(fields: { scheme: string; registered: string; offered: string }) {
    super(
      `the scheme \`${fields.scheme}\` is already handled by the resolver ` +
        `\`${fields.registered}\`; \`${fields.offered}\` may not replace it ` +
        `(F110-FR-035: the registry is open, not overridable)`,
    );
    this.name = "DuplicateSchemeError";
    this.scheme = fields.scheme;
    this.registered = fields.registered;
    this.offered = fields.offered;
  }
}

/** The registry of schemes (F110-FR-035). */
export interface SecretRegistry {
  /** Register one resolver for one scheme. The registry is open. */
  register(resolver: ConfigSecretResolver): void;
  /** The schemes a resolver handles, in the order they were registered. */
  readonly schemes: readonly string[];
  /** The ids of the registered resolvers. */
  readonly resolverIds: readonly string[];
  /** The resolver of a reference, or `undefined` where no scheme handles it. */
  resolverFor(reference: SecretReference): ConfigSecretResolver | undefined;
  /** True where some resolver handles the scheme of the reference. */
  handles(reference: SecretReference): boolean;
  /** `exists` of the resolver of the reference; never the value. */
  exists(reference: SecretReference): Promise<Existence>;
  /** `resolve` of the resolver of the reference, at the moment of use. */
  resolve(reference: SecretReference): Promise<ResolvedSecret>;
  /** `boundHost` of the resolver of the reference (F110-FR-033). */
  boundHost(reference: SecretReference): string | null;
  /** The references resolved so far, in order — references, never values. */
  resolved(): readonly SecretReference[];
}

/**
 * F110-FR-035, second sentence — the error of a reference no resolver handles.
 * `unknownValueOutcome` of feature 100 decides it: a value with no scheme is
 * `inline-secret`, and a scheme nothing handles is `missing`. Both refuse the
 * launch, which is what "a configuration error" means here.
 */
export function unknownSchemeError(
  reference: string,
  schemes: readonly string[],
  key?: string | undefined,
): SecretError {
  const outcome = unknownValueOutcome(reference, [...schemes]);
  if (outcome === "inline-secret" || outcome === undefined) {
    return inlineSecretError(
      reference,
      "carries no scheme, so it is not a reference at all (F110-FR-027)",
      key,
    );
  }
  const scheme = parseSecretReference(reference)?.scheme;
  return new SecretError({
    reason: outcome,
    reference,
    ...(key === undefined ? {} : { key }),
    ...(scheme === undefined ? {} : { scheme }),
    isConfigurationError: true,
    detail:
      `carries the scheme \`${scheme ?? "(none)"}\`, which no resolver handles. ` +
      `The registered schemes are ${schemes.length === 0 ? "(none)" : schemes.join(", ")} ` +
      `(F110-FR-035)`,
  });
}

/** Build an empty registry. Every scheme comes from a `register` call. */
export function createSecretRegistry(): SecretRegistry {
  const order: string[] = [];
  const byScheme = new Map<string, ConfigSecretResolver>();
  const resolvedReferences: string[] = [];

  const resolverFor = (reference: SecretReference): ConfigSecretResolver | undefined => {
    const scheme = parseSecretReference(reference)?.scheme;
    if (scheme === undefined) return undefined;
    const resolver = byScheme.get(scheme);
    // `handles` is the resolver's own answer and not the map's: a resolver that
    // refuses its own scheme is not used (F110-FR-028, first operation).
    return resolver !== undefined && resolver.handles(scheme) ? resolver : undefined;
  };

  const required = (reference: SecretReference): ConfigSecretResolver => {
    const resolver = resolverFor(reference);
    if (resolver === undefined) throw unknownSchemeError(reference, order);
    return resolver;
  };

  return Object.freeze({
    register(resolver: ConfigSecretResolver): void {
      const seen = byScheme.get(resolver.scheme);
      if (seen !== undefined) {
        throw new DuplicateSchemeError({
          scheme: resolver.scheme,
          registered: seen.id,
          offered: resolver.id,
        });
      }
      byScheme.set(resolver.scheme, resolver);
      order.push(resolver.scheme);
    },
    get schemes(): readonly string[] {
      return Object.freeze([...order]);
    },
    get resolverIds(): readonly string[] {
      return Object.freeze(order.map((scheme) => byScheme.get(scheme)?.id ?? ""));
    },
    resolverFor,
    handles(reference: SecretReference): boolean {
      return resolverFor(reference) !== undefined;
    },
    exists(reference: SecretReference): Promise<Existence> {
      let resolver: ConfigSecretResolver;
      try {
        resolver = required(reference);
      } catch (error) {
        return Promise.reject(error as Error);
      }
      return resolver.exists(reference);
    },
    async resolve(reference: SecretReference): Promise<ResolvedSecret> {
      const resolver = required(reference);
      const resolved = await resolver.resolve(reference);
      resolvedReferences.push(reference);
      return resolved;
    },
    boundHost(reference: SecretReference): string | null {
      return resolverFor(reference)?.boundHost(reference) ?? null;
    },
    resolved(): readonly SecretReference[] {
      return Object.freeze([...resolvedReferences]);
    },
  });
}

/** What the three resolvers of Wave 1 need to be built (F110-FR-029 to F110-FR-031). */
export interface Wave1Options {
  /** The redactor every resolved value is registered with (F110-FR-032). */
  readonly redactor: SecretRegistrar;
  /** The environment of the runtime, for `env:`. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** The real path of the workspace root, for `file:`. */
  readonly workspaceRoot: string;
  /** The real path of the control plane, for `file:`. */
  readonly controlRoot: string;
  /** The home directory, for a leading `~/` of a `file:` target. */
  readonly home: string;
  /** The bindings of the declarations, for `boundHost` (F110-FR-033). */
  readonly bindings?: SecretBindings | undefined;
  /** The platform, for `keychain:`; `process.platform` when none is named. */
  readonly platform?: string | undefined;
  /** The keychain command, where the caller pins one (a fake tool in a test). */
  readonly keychainCommand?: string | undefined;
  /** The keychain runner; the `node:child_process` one when none is named. */
  readonly keychainRun?: ToolRunner | undefined;
  /** The file seam; the `node:fs` one when none is named. */
  readonly fs?: FileSeam | undefined;
}

/**
 * The registry of Wave 1: `env:`, `file:` and `keychain:`, in the order §K.7
 * lists them. Nothing is built in: the three are REGISTERED, through the same
 * `register` call the sample resolver of the scheme `test:` uses from the test
 * tree (F110-FR-035).
 */
export function createWave1Registry(options: Wave1Options): SecretRegistry {
  const registry = createSecretRegistry();
  registry.register(
    createEnvResolver({
      environment: options.environment,
      redactor: options.redactor,
      bindings: options.bindings,
    }),
  );
  registry.register(
    createFileResolver({
      workspaceRoot: options.workspaceRoot,
      controlRoot: options.controlRoot,
      home: options.home,
      redactor: options.redactor,
      bindings: options.bindings,
      fs: options.fs,
    }),
  );
  registry.register(
    createKeychainResolver({
      redactor: options.redactor,
      platform: options.platform,
      command: options.keychainCommand,
      run: options.keychainRun,
      bindings: options.bindings,
    }),
  );
  return registry;
}

/** The three schemes `createWave1Registry` registers, in order. */
export const WAVE_1_REGISTERED_SCHEMES: readonly string[] = Object.freeze([
  ENV_SCHEME,
  FILE_SCHEME,
  KEYCHAIN_SCHEME,
]);

/* ------------------------------------------------------------------ *
 * F110-FR-027 — inline detection, by the type of the key and through
 * the redactor.
 * ------------------------------------------------------------------ */

/** The size cap the inline check gives the redactor; nothing is cut at this size. */
export const INLINE_CHECK_SIZE_CAP = 1_048_576 as const;

/** How an inline secret was found (F110-FR-027, the two sentences). */
export const INLINE_DETECTORS = ["type", "redactor"] as const;
export type InlineDetector = (typeof INLINE_DETECTORS)[number];

/** One value offered to the configuration, as the inline check reads it. */
export interface ValueCandidate {
  readonly key: string;
  readonly value: unknown;
  /** The layer that offered it, for the message. */
  readonly layer: string;
  /** The file or the place, where there is one. */
  readonly place?: string | undefined;
}

/** What the inline check found: a `ConfigValueError` and how it was found. */
export interface InlineSecretFinding {
  readonly key: string;
  readonly detectedBy: InlineDetector;
  readonly error: ConfigValueError;
}

/** The text the error carries in place of the value (F110-FR-027, last sentence). */
export const VALUE_WITHHELD = "(withheld)" as const;

/**
 * F110-FR-027 — the inline check over the values of a launch.
 *
 * Two readings of the requirement, both implemented:
 *
 * 1. "A key of the type secret ref whose value is not a reference of a scheme
 *    that a resolver handles MUST be `inline-secret`" — judged by the catalogue
 *    type of the key and by the registry, so a reference of a scheme that is
 *    registered passes and one of a scheme that is not does not.
 * 2. "A value in any string key, in a file or in the environment, that the
 *    redactor of annex X §X.4 changes when it passes through `redact` MUST be
 *    an `inline-secret` error as well" — judged by handing the value to the
 *    redactor and comparing. The pattern set is feature 111's data, so this
 *    check is exactly as wide as that set, which is the point: the port holds no
 *    pattern of its own.
 *
 * Neither branch ever repeats the value: the error carries `(withheld)`.
 */
export function inlineSecretFindings(input: {
  readonly values: readonly ValueCandidate[];
  readonly redactor: Redactor;
  readonly registry?: SecretRegistry | undefined;
}): readonly InlineSecretFinding[] {
  const findings: InlineSecretFinding[] = [];
  for (const candidate of input.values) {
    if (typeof candidate.value !== "string") continue;
    const text = candidate.value;
    const entry = matchCatalogueKey(candidate.key)?.entry;
    const isSecretKey = entry?.type.kind === "secret-ref";
    const where = candidate.place ?? candidate.layer;

    if (isSecretKey) {
      const handled =
        input.registry === undefined ? isSecretReferenceText(text) : input.registry.handles(text);
      if (!handled) {
        findings.push(
          Object.freeze({
            key: candidate.key,
            detectedBy: "type" as const,
            error: new ConfigValueError({
              reason: "inline-secret",
              key: candidate.key,
              value: VALUE_WITHHELD,
              layer: candidate.layer,
              range: entry?.cells.typeAndRange ?? "secret ref",
              message:
                `${where}: the key \`${candidate.key}\` is of the type secret ref and ` +
                `its value is not a reference of a scheme a resolver handles. A secret ` +
                `is named by a reference of §K.7 (\`env:\`, \`file:\` or ` +
                `\`keychain:\`), never by its value; the value is not repeated here ` +
                `(F110-FR-027)`,
            }),
          }),
        );
        continue;
      }
      // A reference is not a secret; it is not handed to the redactor.
      continue;
    }

    const redacted = input.redactor.redact(text, INLINE_CHECK_SIZE_CAP);
    const changed =
      redacted.dropped === true || redacted.replacements > 0 || redacted.text !== text;
    if (!changed) continue;
    findings.push(
      Object.freeze({
        key: candidate.key,
        detectedBy: "redactor" as const,
        error: new ConfigValueError({
          reason: "inline-secret",
          key: candidate.key,
          value: VALUE_WITHHELD,
          layer: candidate.layer,
          range: entry?.cells.typeAndRange ?? "text",
          message:
            `${where}: the value of the key \`${candidate.key}\` is changed by the ` +
            `redactor of annex X §X.4 when it passes through \`redact\`, so it holds a ` +
            `secret in clear. Write a reference of §K.7 instead; the value is not ` +
            `repeated here (F110-FR-027)`,
        }),
      }),
    );
  }
  return Object.freeze(findings);
}

/* ------------------------------------------------------------------ *
 * F110-FR-034 — a missing secret of a role in use.
 * ------------------------------------------------------------------ */

/** F110-FR-034, second sentence — the state a missing secret leads to in a run. */
export const MISSING_IN_A_RUN_LEADS_TO: string = STATE_WHEN_MISSING_IN_A_RUN;

/** F110-FR-034, first sentence — when the launch is refused. */
export const REFUSED_BEFORE = "the first pass" as const;

/** One secret reference a role in use declared. */
export interface SecretInUse {
  /** The configuration key that holds the reference. */
  readonly key: string;
  /** The reference as it was written. */
  readonly reference: SecretReference;
  /** The role that uses it, where the key names one. */
  readonly role?: string | undefined;
}

/** One refusal of the launch (F110-FR-034, first sentence). */
export interface SecretRefusal {
  readonly key: string;
  readonly reference: SecretReference;
  readonly reason: string;
  /** The message, which names the reference and the key and never the value. */
  readonly message: string;
}

/** What `refuseLaunchOnMissingSecrets` decided. */
export interface MissingSecretOutcome {
  /** True where the launch is refused. */
  readonly refuses: boolean;
  /** When the refusal happens (F110-FR-034, first sentence). */
  readonly before: typeof REFUSED_BEFORE;
  /** One refusal per reference that resolved to `missing`. */
  readonly refusals: readonly SecretRefusal[];
  /** The state the same condition leads to inside a run. */
  readonly stateInARun: string;
}

/**
 * F110-FR-034, first sentence — check every reference of a role in use and
 * refuse the launch, before the first pass, for each that resolves to
 * `missing`. The message names the reference and the key.
 *
 * `exists` is used and not `resolve`: a check that does not need the value must
 * not fetch it (F110-FR-032, "resolved at the moment of use and not earlier").
 * A reference whose `exists` is `unprobed` is NOT a refusal: the platform could
 * not answer, and a refusal would turn an unknown into a no.
 */
export async function refuseLaunchOnMissingSecrets(input: {
  readonly registry: Pick<SecretRegistry, "exists">;
  readonly inUse: readonly SecretInUse[];
}): Promise<MissingSecretOutcome> {
  const refusals: SecretRefusal[] = [];
  for (const use of input.inUse) {
    let existence: Existence;
    try {
      existence = await input.registry.exists(use.reference);
    } catch (error) {
      const secretError = error as SecretError;
      refusals.push(
        Object.freeze({
          key: use.key,
          reference: use.reference,
          reason: secretError.reason ?? "missing",
          message:
            `the secret reference \`${use.reference}\` of the key \`${use.key}\` ` +
            `cannot be used: ${secretError.message} (F110-FR-034)`,
        }),
      );
      continue;
    }
    if (existence !== "no") continue;
    refusals.push(
      Object.freeze({
        key: use.key,
        reference: use.reference,
        reason: "missing",
        message:
          `the secret reference \`${use.reference}\` of the key \`${use.key}\` ` +
          `resolves to \`missing\`${
            use.role === undefined ? "" : `, and the role ` + `\`${use.role}\` is in use`
          }: the launch is refused before ${REFUSED_BEFORE} ` +
          `(F110-FR-034). In a run the same condition leads to the state ` +
          `\`${MISSING_IN_A_RUN_LEADS_TO}\``,
      }),
    );
  }
  return Object.freeze({
    refuses: refusals.length > 0,
    before: REFUSED_BEFORE,
    refusals: Object.freeze(refusals),
    stateInARun: MISSING_IN_A_RUN_LEADS_TO,
  });
}

/** What the doctor learned about one reference, with `exists` alone. */
export interface SecretDoctorFinding {
  readonly key: string;
  readonly reference: SecretReference;
  readonly existence: Existence | "error";
  readonly message: string;
}

/**
 * F110-FR-034, third sentence — the doctor checks a reference with `exists`
 * alone. The parameter type is `Pick<SecretRegistry, "exists">`, so a caller
 * CANNOT hand this function anything it could resolve with: the narrowing is
 * the proof.
 */
export async function doctorSecretCheck(input: {
  readonly registry: Pick<SecretRegistry, "exists">;
  readonly references: readonly SecretInUse[];
}): Promise<readonly SecretDoctorFinding[]> {
  const findings: SecretDoctorFinding[] = [];
  for (const use of input.references) {
    try {
      const existence = await input.registry.exists(use.reference);
      findings.push(
        Object.freeze({
          key: use.key,
          reference: use.reference,
          existence,
          message:
            `the secret reference \`${use.reference}\` of the key \`${use.key}\` ` +
            `exists: \`${existence}\``,
        }),
      );
    } catch (error) {
      findings.push(
        Object.freeze({
          key: use.key,
          reference: use.reference,
          existence: "error" as const,
          message:
            `the secret reference \`${use.reference}\` of the key \`${use.key}\` ` +
            `cannot be checked: ${(error as Error).message}`,
        }),
      );
    }
  }
  return Object.freeze(findings);
}

/**
 * The references of a resolved configuration that a role in use declared
 * (F110-FR-034, "a secret reference of a role in use"). A key under
 * `roles.<role>.` belongs to that role; any other key of the type secret ref is
 * in use when the launch uses it, which the caller states with `alsoInUse`.
 */
export function secretReferencesInUse(input: {
  readonly values: ReadonlyMap<string, { readonly value: unknown }>;
  readonly rolesInUse: readonly string[];
  readonly alsoInUse?: readonly string[] | undefined;
}): readonly SecretInUse[] {
  const out: SecretInUse[] = [];
  const also = new Set(input.alsoInUse ?? []);
  for (const [key, merged] of input.values) {
    if (typeof merged.value !== "string" || merged.value === "") continue;
    if (matchCatalogueKey(key)?.entry.type.kind !== "secret-ref") continue;
    const role = /^roles\.([^.]+)\./.exec(key)?.[1];
    if (role !== undefined) {
      if (!input.rolesInUse.includes(role)) continue;
      out.push(Object.freeze({ key, reference: merged.value, role }));
      continue;
    }
    if (!also.has(key)) continue;
    out.push(Object.freeze({ key, reference: merged.value }));
  }
  return Object.freeze(out);
}

/* ------------------------------------------------------------------ *
 * F110-FR-032 — use: at the moment of use, by environment or standard
 * input, never in an argument list, never to an unbound host.
 * ------------------------------------------------------------------ */

/** A secret sent to a host it is not bound to (F110-FR-033, first sentence). */
export class SecretHostRefusedError extends Error {
  readonly reference: SecretReference;
  readonly host: string;
  readonly boundHost: string | null;
  /** The value is never a field of this error either. */
  readonly valueIsNeverCarried = true as const;
  constructor(fields: { reference: string; host: string; boundHost: string | null }) {
    super(
      `the secret reference \`${fields.reference}\` is bound to ` +
        `${fields.boundHost === null ? "the process of its harness and to no host" : `\`${fields.boundHost}\``} ` +
        `and may not be sent to \`${fields.host}\` (F110-FR-033). The value is not printed`,
    );
    this.name = "SecretHostRefusedError";
    this.reference = fields.reference;
    this.host = fields.host;
    this.boundHost = fields.boundHost;
  }
}

/** One use of a secret: the key, the reference and the host it is sent to. */
export interface SecretUse {
  readonly key: string;
  readonly reference: SecretReference;
  /** The host the value is about to be sent to; omitted for a `cli` harness. */
  readonly host?: string | undefined;
}

/**
 * F110-FR-032, first sentence, with F110-FR-033 — resolve a reference AT THE
 * MOMENT OF USE. The bound host is checked before the value is fetched, so a
 * reference bound elsewhere is refused without the secret ever being read.
 */
export async function resolveAtUse(input: {
  readonly registry: SecretRegistry;
  readonly bindings?: SecretBindings | undefined;
  readonly use: SecretUse;
}): Promise<ResolvedSecret> {
  const { registry, use } = input;
  if (use.host !== undefined) {
    const bound = input.bindings?.hostOf(use.reference) ?? registry.boundHost(use.reference);
    const allowed =
      input.bindings !== undefined
        ? input.bindings.mayBeSentTo(use.reference, use.host)
        : bound !== null && bound.toLowerCase() === use.host.toLowerCase();
    if (!allowed) {
      throw new SecretHostRefusedError({
        reference: use.reference,
        host: use.host,
        boundHost: bound,
      });
    }
  }
  return registry.resolve(use.reference);
}

/** One secret found in an argument list: the index and which secret it was. */
export interface ArgumentListHit {
  /** The index of the argument the secret was found in. */
  readonly index: number;
  /** The argument, with the secret cut out, so the report prints no value. */
  readonly redacted: string;
}

/**
 * F110-FR-032, third sentence — find every resolved value in an argument list.
 * An empty result is the pass. The report carries the index and the argument
 * with the value cut out, never the value.
 */
export function secretsInArgumentList(
  argv: readonly string[],
  secrets: readonly string[],
): readonly ArgumentListHit[] {
  const hits: ArgumentListHit[] = [];
  for (const [index, argument] of argv.entries()) {
    let redacted = argument;
    let found = false;
    for (const secret of secrets) {
      if (secret === "" || !redacted.includes(secret)) continue;
      found = true;
      redacted = redacted.split(secret).join("[redacted]");
    }
    if (found) hits.push(Object.freeze({ index, redacted }));
  }
  return Object.freeze(hits);
}

/** The call of a harness: the argument list, the environment and the input. */
export interface HarnessCall {
  /** The argument list, which holds no secret (F110-FR-032). */
  readonly argv: readonly string[];
  /** The environment of the child, which may carry a secret. */
  readonly environment: Readonly<Record<string, string>>;
  /** The standard input of the child, which may carry a secret. */
  readonly stdin: string;
}

/**
 * F110-FR-032, third sentence — build the call of a harness. A secret is put in
 * the environment of the child or on its standard input; the argument list is
 * checked and the build THROWS where a secret reached it, so the rule cannot be
 * broken by a caller that forgets it.
 */
export function harnessCallWithSecrets(input: {
  readonly argv: readonly string[];
  /** The secrets to pass by environment: the variable name and the value. */
  readonly byEnvironment?: Readonly<Record<string, string>> | undefined;
  /** The secret to pass on standard input. */
  readonly byStandardInput?: string | undefined;
  /** The environment of the child before the secrets are added. */
  readonly environment?: Readonly<Record<string, string>> | undefined;
}): HarnessCall {
  const byEnvironment = input.byEnvironment ?? {};
  const secrets = [
    ...Object.values(byEnvironment),
    ...(input.byStandardInput === undefined ? [] : [input.byStandardInput]),
  ];
  const hits = secretsInArgumentList(input.argv, secrets);
  if (hits.length > 0) {
    throw new Error(
      `a secret reached the argument list of a harness at ` +
        `${hits.map((hit) => `index ${hit.index} (\`${hit.redacted}\`)`).join(", ")}: a ` +
        `secret is passed by environment or standard input and never in an argument ` +
        `list (F110-FR-032)`,
    );
  }
  return Object.freeze({
    argv: Object.freeze([...input.argv]),
    environment: Object.freeze({ ...(input.environment ?? {}), ...byEnvironment }),
    stdin: input.byStandardInput ?? "",
  });
}

/* ------------------------------------------------------------------ *
 * The declarations of a launch.
 * ------------------------------------------------------------------ */

export { createSecretBindings };
export type { SecretBindings, SecretDeclaration };
