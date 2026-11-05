/**
 * T300 — the rule files of the import-boundary check (plan.md, the entry of
 * `tools/import-boundary`; F149-FR-007).
 *
 * `mayImport` of the package graph separates PACKAGES. Some rules of the
 * product separate MODULES inside one package, which the graph cannot express.
 * Those rules live as one JSON file per rule under
 * `tools/import-boundary/rules/`, each of the form
 *
 *   { rule, owner, requirement, from: [path globs],
 *     forbid: [path globs of modules], reason }
 *
 * The check refuses a rule file that lacks a field, and fails `check:imports`
 * with the file, the import and the rule id when a source file that `from`
 * matches imports a module that `forbid` matches. The import is matched as the
 * caller resolves it: a relative specifier is resolved against the importing
 * file, and a package specifier is matched as it is written and, where the
 * package is a workspace package, through its export map.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve as resolvePath, sep } from "node:path";

/** One rule file, as it is on disk. */
export type ImportRule = {
  /** The id of the rule, reported with every violation. */
  readonly rule: string;
  /** The feature that owns the rule. */
  readonly owner: string;
  /** The requirement the rule enforces. */
  readonly requirement: string;
  /** The source files the rule is about, as path globs. */
  readonly from: readonly string[];
  /** The modules those files may not import, as path globs. */
  readonly forbid: readonly string[];
  /** Why the rule stands; reported with the violation. */
  readonly reason: string;
  /** The file the rule was read from, relative to the repository root. */
  readonly file: string;
};

/** The six fields every rule file carries. */
export const RULE_FILE_FIELDS = [
  "rule",
  "owner",
  "requirement",
  "from",
  "forbid",
  "reason",
] as const;

/** A rule file that is unreadable, or that lacks a field. */
export class RuleFileError extends Error {
  readonly file: string;
  readonly field: string | undefined;
  constructor(file: string, message: string, field?: string) {
    super(`${file}: ${message}`);
    this.name = "RuleFileError";
    this.file = file;
    this.field = field;
  }
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

/**
 * Read one rule file. A file that lacks a field, or whose field has the wrong
 * shape, is REFUSED: the check fails rather than passing a rule it cannot read.
 */
export function readRuleFile(file: string, displayName = file): ImportRule {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new RuleFileError(displayName, `cannot be read as JSON (${String(err)})`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RuleFileError(displayName, "a rule file holds one JSON object");
  }
  const raw = parsed as Record<string, unknown>;
  for (const field of RULE_FILE_FIELDS) {
    if (!(field in raw)) {
      throw new RuleFileError(
        displayName,
        `the rule file lacks the field \`${field}\`; a rule file holds ` +
          `{ ${RULE_FILE_FIELDS.join(", ")} }`,
        field,
      );
    }
  }
  for (const field of ["rule", "owner", "requirement", "reason"] as const) {
    const value = raw[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new RuleFileError(displayName, `the field \`${field}\` is a non-empty text`, field);
    }
  }
  for (const field of ["from", "forbid"] as const) {
    if (!isStringArray(raw[field]) || (raw[field] as string[]).length === 0) {
      throw new RuleFileError(
        displayName,
        `the field \`${field}\` is a non-empty list of path globs`,
        field,
      );
    }
  }
  return Object.freeze({
    rule: raw["rule"] as string,
    owner: raw["owner"] as string,
    requirement: raw["requirement"] as string,
    from: Object.freeze([...(raw["from"] as string[])]),
    forbid: Object.freeze([...(raw["forbid"] as string[])]),
    reason: raw["reason"] as string,
    file: displayName,
  });
}

/**
 * Every rule file of `tools/import-boundary/rules/`, sorted by file name. A
 * missing directory is no rule and no error: a workspace may carry none.
 */
export function loadRuleFiles(rulesDir: string, root?: string): readonly ImportRule[] {
  if (!existsSync(rulesDir)) return Object.freeze([]);
  const out: ImportRule[] = [];
  for (const entry of readdirSync(rulesDir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const full = join(rulesDir, entry.name);
    const display = root === undefined ? full : relative(root, full).split(sep).join("/");
    out.push(readRuleFile(full, display));
  }
  return Object.freeze(out);
}

/**
 * A path glob of a rule file, as a regular expression. `*` matches inside one
 * segment, `**` across segments, and the pattern is anchored at both ends.
 */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` swallows the separator too, so `a/**/b.ts` matches `a/b.ts`.
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if ("\\^$.|?+()[]{}".includes(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

/** True when any glob of the list matches the path. */
export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

/** One violation of a rule file. */
export type RuleFileViolation = {
  /** The source file that holds the import, relative to the root. */
  readonly file: string;
  /** The line of the import statement. */
  readonly line: number;
  /** The specifier as it is written. */
  readonly spec: string;
  /** The module the import resolved to, as the rule matched it. */
  readonly resolved: string;
  /** The id of the rule, reported with the violation. */
  readonly rule: string;
  /** The owner, the requirement and the reason of the rule. */
  readonly detail: string;
};

/** How a package specifier is resolved to a path of the workspace. */
export type PackagePathResolver = (spec: string) => string | undefined;

/**
 * The paths an import may be matched against: the path the specifier resolves
 * to, and the specifier itself, so that a rule may forbid either a module by
 * path or a package export by name.
 */
export function resolvedPathsOfImport(
  importingFile: string,
  spec: string,
  root: string,
  resolvePackage?: PackagePathResolver,
): readonly string[] {
  const out: string[] = [spec];
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const abs = resolvePath(dirname(resolvePath(root, importingFile)), spec);
    out.push(relative(root, abs).split(sep).join("/"));
  } else if (spec.startsWith("/")) {
    out.push(relative(root, spec).split(sep).join("/"));
  } else if (resolvePackage !== undefined) {
    const through = resolvePackage(spec);
    if (through !== undefined) out.push(through.split(sep).join("/"));
  }
  return Object.freeze(out);
}

/**
 * Judge one import against every rule file. A source file that `from` matches
 * may not import a module that `forbid` matches; the violation names the file,
 * the import and the rule id.
 */
export function ruleFileViolations(
  rules: readonly ImportRule[],
  importingFile: string,
  line: number,
  spec: string,
  root: string,
  resolvePackage?: PackagePathResolver,
): readonly RuleFileViolation[] {
  const out: RuleFileViolation[] = [];
  const candidates = resolvedPathsOfImport(importingFile, spec, root, resolvePackage);
  for (const rule of rules) {
    if (!matchesAny(importingFile, rule.from)) continue;
    const hit = candidates.find((candidate) => matchesAny(candidate, rule.forbid));
    if (hit === undefined) continue;
    out.push({
      file: importingFile,
      line,
      spec,
      resolved: hit,
      rule: rule.rule,
      detail:
        `${rule.reason} (rule ${rule.rule}, owner ${rule.owner}, ` +
        `${rule.requirement}; ${rule.file})`,
    });
  }
  return Object.freeze(out);
}
