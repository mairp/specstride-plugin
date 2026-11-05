/**
 * T249 — the envelope validator of a configuration file (annex X, §X.2 and
 * §X.8; F100-FR-203).
 *
 * `schema` is required; an unknown key at any level refuses the launch; a key
 * under `x-` is ignored; an inline secret is an error; the as-is environment
 * variables are read through the alias table of `data/normalization.json`;
 * and a value that arrives through an alias the baseline reads late is not
 * refused at launch under the `parity` profile — it fails where the baseline
 * fails, and the owner of the key states the place.
 */
import normalization from "../../data/normalization.json" with { type: "json" };
import configEnvelopeSchema from "../../schemas/config-envelope.schema.json" with { type: "json" };
import { validate } from "../records/compile.ts";

/** The schema id of a configuration file, and the major this reader supports. */
export const SCHEMA_ID = "specstride.config/1" as const;
export const MAJOR = 1 as const;

/** Keys under this prefix are free for the consumer and ignored (F100-FR-203). */
export const FREE_PREFIX = "x-" as const;

/** What the schema file says about an unknown field (contracts/README.md). */
export const UNKNOWN_FIELD_RULE: string =
  (configEnvelopeSchema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";

type RawAlias = { "As-is variable": string; Key: string };

/** One row of the environment alias table of §X.8. */
export type EnvironmentAlias = {
  /** The as-is variable names of the row, without back-ticks. */
  readonly variables: readonly string[];
  /** The keys of the row, without back-ticks. */
  readonly keys: readonly string[];
  /** The row as the annex writes it, for a message. */
  readonly asIs: string;
};

/** Every back-ticked token of a cell, in order; a cell may qualify them in prose. */
const unbacktick = (cell: string): string[] =>
  [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);

const RAW_ALIASES = (normalization as { environmentAliases: RawAlias[] }).environmentAliases;

/** The environment alias table of §X.8 (F100-FR-203). */
export const environmentAliases: readonly EnvironmentAlias[] = Object.freeze(
  RAW_ALIASES.map((row) =>
    Object.freeze({
      variables: Object.freeze(unbacktick(row["As-is variable"])),
      keys: Object.freeze(unbacktick(row.Key)),
      asIs: row["As-is variable"],
    }),
  ),
);

/** The key an as-is environment variable is an alias of, where the table names one. */
export function keyOfEnvironmentVariable(variable: string): string | undefined {
  for (const row of environmentAliases) {
    const i = row.variables.indexOf(variable);
    if (i >= 0) return row.keys[i] ?? row.keys[0];
  }
  return undefined;
}

/** Every as-is variable the alias table names. */
export const AS_IS_VARIABLES: readonly string[] = Object.freeze(
  environmentAliases.flatMap((r) => [...r.variables]),
);

/** One finding of the validator. */
export type ConfigFinding = {
  /** The path of the key inside the file, `roles.proposer.harness`. */
  readonly key: string;
  readonly kind: "missing-schema" | "different-major" | "unknown-key" | "inline-secret";
  readonly message: string;
  /** True when the finding refuses the launch (F100-FR-203). */
  readonly refusesLaunch: boolean;
};

/** A value that looks like a secret written inline (F100-FR-203). */
const INLINE_SECRET_KEY = /(secret|password|passwd|apikey|api_key|token|credential)$/i;
/** A reference is the allowed form: a scheme such as `env:` or `keychain:`. */
const IS_A_REFERENCE = /^[a-z][a-z0-9+.-]*:/;

/** What the caller must give so that an unknown key can be told from a known one. */
export type ConfigValidateOptions = {
  /** Every key feature 110 owns, as dotted paths; `undefined` accepts any key. */
  readonly knownKeys?: readonly string[] | undefined;
  /** True under the `parity` profile (F100-FR-203). */
  readonly parityProfile?: boolean | undefined;
  /** Keys that arrived through an alias the baseline reads late. */
  readonly arrivedThroughLateAlias?: readonly string[] | undefined;
};

/**
 * Validate a configuration file (F100-FR-203). The findings that refuse the
 * launch are the ones whose `refusesLaunch` is true.
 */
export function validateConfigFile(
  file: unknown,
  options: ConfigValidateOptions = {},
): readonly ConfigFinding[] {
  const findings: ConfigFinding[] = [];
  if (typeof file !== "object" || file === null) {
    return Object.freeze([
      {
        key: "(file)",
        kind: "missing-schema",
        message: "a configuration file is a record and carries `schema` (F100-FR-203)",
        refusesLaunch: true,
      },
    ]);
  }
  const record = file as Record<string, unknown>;
  const schema = record.schema;
  if (schema === undefined) {
    findings.push({
      key: "schema",
      kind: "missing-schema",
      message: "a configuration file MUST carry `schema` (F100-FR-203)",
      refusesLaunch: true,
    });
  } else if (schema !== MAJOR) {
    findings.push({
      key: "schema",
      kind: "different-major",
      message:
        `refused the configuration file: the major found is ${String(schema)}, ` +
        `the major supported is ${MAJOR} (F100-FR-203, F100-FR-049)`,
      refusesLaunch: true,
    });
  }
  const late = options.arrivedThroughLateAlias ?? [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith(FREE_PREFIX)) continue; // free for the consumer; ignored
      const here = path === "" ? key : `${path}.${key}`;
      if (here === "schema") continue;
      if (typeof v === "string" && INLINE_SECRET_KEY.test(key) && !IS_A_REFERENCE.test(v)) {
        findings.push({
          key: here,
          kind: "inline-secret",
          message:
            `the key \`${here}\` holds an inline secret; a configuration file carries ` +
            `the reference of a secret, never its value (F100-FR-203)`,
          refusesLaunch: true,
        });
      }
      const known = options.knownKeys;
      const isLeaf = typeof v !== "object" || v === null || Array.isArray(v);
      if (known !== undefined && isLeaf && !known.includes(here)) {
        // Under the `parity` profile a value that arrives through an alias the
        // baseline reads late is not refused at launch: it fails where the
        // baseline fails, and the owner of the key states the place.
        const tolerated = options.parityProfile === true && late.includes(here);
        findings.push({
          key: here,
          kind: "unknown-key",
          message: tolerated
            ? `the key \`${here}\` arrived through an alias the baseline reads late; ` +
              `under the \`parity\` profile it is not refused at launch and fails where ` +
              `the baseline fails (F100-FR-203)`
            : `the key \`${here}\` is unknown; an unknown key refuses the launch (F100-FR-203)`,
          refusesLaunch: !tolerated,
        });
      }
      walk(v, here);
    }
  };
  walk(record, "");
  return Object.freeze(findings);
}

/** True when the file may be used: no finding refuses the launch. */
export function launchIsRefused(findings: readonly ConfigFinding[]): boolean {
  return findings.some((f) => f.refusesLaunch);
}

/** The envelope alone, through the schema file of the package. */
export function envelopeIsValid(file: unknown): boolean {
  return validate(SCHEMA_ID, file).ok;
}
