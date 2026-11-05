/**
 * T031 — the resolver of the scheme `env:` (F110-FR-029).
 *
 * "The scheme `env:` MUST resolve to the value of the named variable of the
 * environment of the runtime. A name that is not a valid variable name MUST be
 * `inline-secret`. An unset or empty variable MUST be `missing`."
 *
 * The resolver reads the environment it is handed, never `process.env` of its
 * own accord, so a caller — and a test — decides what the runtime's environment
 * is. `exists` returns `yes` or `no` and never the value; `resolve` registers
 * the value with the redactor before it returns it (F110-FR-032).
 */
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

/** The scheme this resolver handles (§K.7). */
export const ENV_SCHEME = "env:" as const;

/**
 * A name of an environment variable: a letter or underscore, then letters,
 * digits or underscores. The form POSIX fixes for a shell name; anything else
 * is not a variable name and is therefore `inline-secret` (F110-FR-029, second
 * sentence) — a value that was pasted where a reference belongs.
 */
export const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** True for a name the environment of a process can carry. */
export function isEnvironmentName(name: string): boolean {
  return ENVIRONMENT_NAME.test(name);
}

/** What the `env:` resolver is built with. */
export interface EnvResolverOptions {
  /** The environment of the runtime (F110-FR-029, first sentence). */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** The redactor every resolved value is registered with (F110-FR-032). */
  readonly redactor: SecretRegistrar;
  /** Where the references were declared, for `boundHost` (F110-FR-033). */
  readonly bindings?: BoundHostLookup | undefined;
}

/** The id the conformance report prints for this resolver. */
export const ENV_RESOLVER_ID = "config-secret-resolver-env" as const;

/**
 * Build the `env:` resolver. It opens no file, starts no process and makes no
 * network call: it reads one entry of a map (F110-FR-028).
 */
export function createEnvResolver(options: EnvResolverOptions): ConfigSecretResolver {
  const nameOf = (reference: SecretReference): string | undefined => {
    const parsed = parseSecretReference(reference);
    if (parsed === undefined || parsed.scheme !== ENV_SCHEME) return undefined;
    return parsed.target;
  };

  const checkedName = (reference: SecretReference, key?: string | undefined): string => {
    const name = nameOf(reference);
    if (name === undefined) {
      throw missingError(reference, `is no reference of the scheme \`${ENV_SCHEME}\``, key);
    }
    if (!isEnvironmentName(name)) {
      throw inlineSecretError(
        reference,
        `names \`${name}\`, which is not the name of an environment variable ` +
          `(F110-FR-029): a value was written where a reference belongs`,
        key,
      );
    }
    return name;
  };

  return Object.freeze({
    id: ENV_RESOLVER_ID,
    scheme: ENV_SCHEME,
    makesANetworkCall: false as const,

    /** F110-FR-028 — `handles` takes a scheme and answers yes or no. */
    handles(scheme: string): boolean {
      return scheme === ENV_SCHEME;
    },

    /**
     * F110-FR-029, third sentence — an unset or empty variable is `no`; a set,
     * non-empty one is `yes`. The value never leaves this function.
     */
    exists(reference: SecretReference): Promise<Existence> {
      if (nameOf(reference) === undefined) return Promise.resolve<Existence>("no");
      let name: string;
      try {
        name = checkedName(reference);
      } catch (error) {
        // A malformed reference is reported as a rejected promise and never as
        // a synchronous throw, so one `await` is the whole call of any of the
        // four operations.
        return Promise.reject(error as Error);
      }
      const value = options.environment[name];
      return Promise.resolve<Existence>(value === undefined || value === "" ? "no" : "yes");
    },

    /**
     * F110-FR-029 — the value of the named variable, in memory only, registered
     * with the redactor for exact-match removal (F110-FR-032). An unset or
     * empty variable is `missing`.
     */
    resolve(reference: SecretReference): Promise<ResolvedSecret> {
      let name: string;
      try {
        name = checkedName(reference);
      } catch (error) {
        return Promise.reject(error as Error);
      }
      const value = options.environment[name];
      if (value === undefined || value === "") {
        return Promise.reject(
          missingError(
            reference,
            `names the variable \`${name}\`, which is ` +
              `${value === undefined ? "not set" : "set to the empty value"} ` +
              `(F110-FR-029)`,
          ),
        );
      }
      options.redactor.register(value);
      return Promise.resolve(Object.freeze({ value, registeredWithTheRedactor: true as const }));
    },

    /**
     * F110-FR-033 — the host the secret may be sent to, as the declaration of
     * the reference binds it; `null` where the binding is to a process and not
     * to a host, and where no declaration is known.
     */
    boundHost(reference: SecretReference): string | null {
      return options.bindings?.hostOf(reference) ?? null;
    },
  });
}
