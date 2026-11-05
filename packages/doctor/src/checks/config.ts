/**
 * T027 (feature 112) — the checks of the groups `config` and `secret`
 * (F112-FR-018, CT-112-118; catalogue rows 30 to 36; DV-068).
 *
 * What they do (F112-FR-018): validate every configuration layer against the
 * schema of the config envelope (an unknown key and an inline secret are
 * `fail`); show which layer supplied each effective key where it matters (a
 * shadowed value, a pin of the launch contract); warn for each widening key
 * set in project configuration (the key is ignored); report input of the three
 * as-is systems that is not read; fail when a `file:` reference lies inside
 * the workspace and warn when it is readable by others; and show that children
 * receive only the variables their harness declares. A finding shows the path
 * and the key name of an inline secret and at most four characters of its
 * value (never the value).
 *
 * Every probe reads the resolved configuration through the probe bag — project
 * files were parsed by a loader that runs no code (research D-12).
 */
import type { Check, ProbeBag } from "../registry/types.ts";
import { cfg } from "./read.ts";

/** At most four characters of an inline secret are ever shown (F112-FR-018). */
export const SECRET_SHOWN_CHARS = 4 as const;

/** The first characters of a secret that a finding may show. */
export function shownOf(value: string): string {
  return value.slice(0, SECRET_SHOWN_CHARS);
}

/** One configuration layer as the loader of feature 110 resolved it. */
export type ConfigLayer = {
  readonly path: string;
  readonly scope: "user" | "project" | "pin";
  readonly valid: boolean;
  readonly unknownKey?: string;
  readonly suggestion?: string;
};

/** `config.schema` — a layer that does not validate is a failure (row 30, lb). */
export const configSchemaCheck: Check = {
  id: "config.schema",
  group: "config",
  lb: true,
  order: 30,
  messageTemplate: "{path}: {problem}",
  fixHint: "correct the key",
  severityRule: (o: unknown) => {
    const s = o as { invalid: readonly ConfigLayer[] };
    return s.invalid.length > 0 ? "fail" : "ok";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const layers = cfg<ConfigLayer[]>(b, "config.layers", []);
    const invalid = layers.filter((l) => !l.valid || l.unknownKey !== undefined);
    return {
      invalid,
      // The first broken layer names the problem: a schema breach or an
      // unknown key, with the "did you mean" the loader suggested.
      path: invalid[0]?.path ?? "",
      problem:
        invalid[0] === undefined
          ? ""
          : invalid[0].unknownKey !== undefined
            ? `${invalid[0].unknownKey} unknown key${invalid[0].suggestion ? ` (did you mean ${invalid[0].suggestion}?)` : ""}`
            : "does not validate against the config schema",
    };
  },
};

/** `config.precedence` — which layer supplied the effective key (row 31). */
export const configPrecedenceCheck: Check = {
  id: "config.precedence",
  group: "config",
  lb: false,
  order: 31,
  messageTemplate: "{variable} ignored: contract pins it",
  fixHint: "remove the variable or derive the contract again",
  severityRule: (o: unknown) => {
    const s = o as { shadowed: readonly unknown[] };
    return s.shadowed.length > 0 ? "warn" : "info";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const shadowed = cfg<readonly { variable: string }[]>(b, "config.shadowed", []);
    return {
      shadowed,
      variable: shadowed[0]?.variable ?? "",
    };
  },
};

/** The keys that only user configuration may set; a project value is ignored. */
export const WIDENING_KEYS: readonly string[] = Object.freeze([
  "harnesses",
  "critic",
  "endpoint",
  "roles",
]);

/** `config.projectWiden` — a widening key in project configuration (row 32). */
export const configProjectWidenCheck: Check = {
  id: "config.projectWiden",
  group: "config",
  lb: false,
  order: 32,
  messageTemplate: "{path}: {key} ignored (user scope only)",
  fixHint: "move it to user configuration",
  severityRule: (o: unknown) => {
    const s = o as { widened: readonly unknown[] };
    return s.widened.length > 0 ? "warn" : "info";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const widened = cfg<readonly { path: string; key: string }[]>(
      b,
      "config.projectWidened",
      [],
    ).filter((w) => WIDENING_KEYS.includes(w.key));
    return { widened, path: widened[0]?.path ?? "", key: widened[0]?.key ?? "" };
  },
};

/** `config.legacy` — input of the three as-is systems that is not read (row 33). */
export const configLegacyCheck: Check = {
  id: "config.legacy",
  group: "config",
  lb: false,
  order: 33,
  messageTemplate: "ignored: {what}",
  fixHint: "none",
  severityRule: () => "info",
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const legacy = cfg<readonly { what: string }[]>(b, "config.legacyInputs", []);
    return { legacy, what: legacy[0]?.what ?? "" };
  },
};

/** An inline secret the loader found, as the redacted view of it. */
export type InlineSecret = { readonly where: string; readonly key: string; readonly value: string };

/** `secret.inline` — an inline secret in any layer is a failure (row 34, lb). */
export const secretInlineCheck: Check = {
  id: "secret.inline",
  group: "secret",
  lb: true,
  order: 34,
  messageTemplate: "{where}: {key} is inline; use a reference",
  fixHint: "replace it with an env: reference",
  severityRule: (o: unknown) => {
    const s = o as { inline: readonly InlineSecret[] };
    return s.inline.length > 0 ? "fail" : "ok";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const inline = cfg<readonly InlineSecret[]>(b, "config.secrets.inline", []);
    return {
      inline,
      // The redactor keeps at most four characters; the value itself never
      // reaches the finding (F112-FR-018).
      where: inline[0]?.where ?? "",
      key: inline[0]?.key ?? "",
      shown: inline[0] !== undefined ? shownOf(inline[0].value) : "",
    };
  },
};

/** `secret.file` — a file: reference inside the workspace, or too open (row 35, lb). */
export const secretFileCheck: Check = {
  id: "secret.file",
  group: "secret",
  lb: true,
  order: 35,
  messageTemplate: "file: target {problem}",
  fixHint: "move it and restrict its mode",
  severityRule: (o: unknown) => {
    const s = o as { insideWorkspace: boolean; readableByOthers: boolean };
    if (s.insideWorkspace) return "fail";
    if (s.readableByOthers) return "warn";
    return "ok";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const refs = cfg<
      readonly { target: string; insideWorkspace: boolean; readableByOthers: boolean }[]
    >(b, "config.secretFiles", []);
    const first = refs[0];
    return {
      refs,
      insideWorkspace: first?.insideWorkspace ?? false,
      readableByOthers: first?.readableByOthers ?? false,
      problem: first?.insideWorkspace
        ? "inside the workspace"
        : first?.readableByOthers
          ? "is readable by others"
          : "ok",
    };
  },
};

/** `secret.envLeak` — children get only their declared variables (row 36). */
export const secretEnvLeakCheck: Check = {
  id: "secret.envLeak",
  group: "secret",
  lb: false,
  order: 36,
  messageTemplate: "children get only their declared credential variables",
  fixHint: "none",
  severityRule: () => "info",
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const declared = cfg<readonly string[]>(b, "config.credentialVars.declared", []);
    const passed = cfg<readonly string[]>(b, "config.credentialVars.passed", []);
    return {
      declared: declared.length,
      passed: passed.length,
      leaked: passed.filter((v) => !declared.includes(v)).length,
    };
  },
};

/** The seven checks of the groups `config` and `secret`, in catalogue order. */
export const configChecks: readonly Check[] = Object.freeze([
  configSchemaCheck,
  configPrecedenceCheck,
  configProjectWidenCheck,
  configLegacyCheck,
  secretInlineCheck,
  secretFileCheck,
  secretEnvLeakCheck,
]);
