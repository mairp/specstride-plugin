#!/usr/bin/env node
/**
 * The import-boundary check over the package graph (F100-FR-001,
 * F100-FR-012; research.md D-4). Wired as the root script `check:imports`
 * (T016).
 *
 * The check reads
 *
 * - the package graph, `packages/contracts/data/package-graph.json`
 *   (override with `--graph <path>`);
 * - the `package.json` of every workspace package of `--root`
 *   (default: the repository root);
 * - the import statements of every source file under each package's
 *   `src/`, read with the TypeScript compiler (T011, `rules.ts`).
 *
 * and fails with the file, the import and the rule on
 *
 * - an import that `mayImport` does not list, or that goes to a higher
 *   layer — or from L3/L4 to L1, or between L6 and L5 — (LR-1,
 *   `rules.ts`, T011);
 * - an import of a core package that the core rule forbids: any package of
 *   the graph other than `@specstride/contracts` and `@specstride/kernel`,
 *   a provider SDK or any external package, `node:fs` or
 *   `node:fs/promises`, and `node:child_process`, `node:net`, `node:http`,
 *   `node:https` or `node:dgram` (`core-rule.ts`, T013);
 * - a file of a core package that names a sample of the test kit or a Wave
 *   1 implementation of an extension point (`core-names.ts`, T236);
 * - an import that a rule file of `tools/import-boundary/rules/` forbids:
 *   a source file that the rule's `from` matches importing a module that its
 *   `forbid` matches (`rule-files.ts`, T300; F149-FR-007);
 * - a `node:` built-in where the graph entry says `nodeBuiltins: false`;
 * - an external package that is not declared in the `package.json` of the
 *   importing package.
 *
 * Usage:
 *   node tools/import-boundary/src/index.ts [--root <dir>] [--graph <path>] [--help]
 *
 * Exit codes: 0 no violation, 1 a violation was found, 2 usage or environment error.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { coreImportViolation } from "./core-rule.ts";
import { coreNamingViolations } from "./core-names.ts";
import { entryOf, graphPackageOf, importsOfSource, judgeImport, loadGraph } from "./rules.ts";
import { RuleFileError, loadRuleFiles, ruleFileViolations, type ImportRule } from "./rule-files.ts";

type Pkg = {
  dir: string;
  rel: string;
  name: string;
  declared: string[];
};

type Violation = {
  file: string;
  line: number;
  spec: string;
  rule: string;
  detail: string;
};

type Report = {
  violations: Violation[];
  notes: string[];
  packagesChecked: number;
  filesChecked: number;
  importsChecked: number;
};

function failUsage(message: string): never {
  process.stderr.write(message + "\n");
  process.exit(2);
}

function parseArgs(argv: string[]): { root?: string; graph?: string } {
  const out: { root?: string; graph?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(
        "usage: specstride-import-boundary [--root <dir>] [--graph <path>] [--help]\n",
      );
      process.exit(0);
    } else if (a === "--root" || a === "--graph") {
      const value = argv[i + 1];
      if (value === undefined) failUsage(`missing value for ${a}`);
      i++;
      if (a === "--root") out.root = value;
      else out.graph = value;
    } else {
      failUsage(`unknown argument: ${a}\n`);
    }
  }
  return out;
}

function readJson<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (err) {
    failUsage(`cannot read ${file}: ${String(err)}`);
  }
}

/** The repository root: four levels up from this file (tools/import-boundary/src). */
function defaultRoot(): string {
  const file = dirname(fileURLToPath(import.meta.url)); // …/tools/import-boundary/src
  return dirname(dirname(dirname(file))); // …/
}

function isDirectory(file: string): boolean {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/** Every workspace package: the directories of the root workspaces that hold a package.json. */
function collectPackages(root: string): Pkg[] {
  const rootPkg = readJson<{ workspaces?: string[] }>(join(root, "package.json"));
  const patterns = rootPkg.workspaces ?? [];
  const dirs: string[] = [];
  for (const pattern of patterns) {
    const baseDir = join(root, pattern.replace(/\/\*$/, "/"));
    if (!isDirectory(baseDir)) continue;
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(baseDir, entry.name, "package.json"))) {
        dirs.push(join(baseDir, entry.name));
      }
    }
  }
  const out: Pkg[] = [];
  for (const dir of dirs.sort()) {
    const pkg = readJson<{
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>(join(dir, "package.json"));
    if (typeof pkg.name !== "string") continue;
    out.push({
      dir,
      rel: relative(root, dir).split(sep).join("/"),
      name: pkg.name,
      // A package that declares a dependency (a runtime one or a
      // development one) may import it; the undeclared-dependency rule
      // fires only on an import that is declared nowhere in the
      // package.json.
      declared: [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})],
    });
  }
  return out;
}

/** Every source file of a package: the recursive contents of its src/. */
function listSourceFiles(pkgDir: string): string[] {
  const srcDir = join(pkgDir, "src");
  if (!isDirectory(srcDir)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(full);
      } else if (/\.(ts|mts|cts|tsx|js|mjs|cjs)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(srcDir);
  return out.sort();
}

/**
 * The path a workspace package specifier resolves to, through the `exports`
 * of that package's package.json. `@specstride/contracts/codes/engine` gives
 * `packages/contracts/src/codes/engine.ts`, so a rule file may forbid a module
 * whether it is reached by a relative path or through a package export (T300).
 */
function packageExportPath(packages: Pkg[], name: string, spec: string): string | undefined {
  const owner = packages.find((p) => spec === p.name || spec.startsWith(p.name + "/"));
  if (owner === undefined) return undefined;
  const subpath = spec === owner.name ? "." : "./" + spec.slice(owner.name.length + 1);
  const pkg = readJson<{ exports?: Record<string, string> | string }>(
    join(owner.dir, "package.json"),
  );
  const exports_ = pkg.exports;
  const target =
    typeof exports_ === "string" ? (subpath === "." ? exports_ : undefined) : exports_?.[subpath];
  if (target === undefined) return undefined;
  return (owner.rel + "/" + target.replace(/^\.\//, "")).split(sep).join("/");
}

/** Run the check over one workspace root and its graph. */
export function run(root: string, graphFile: string, rulesDir?: string): Report {
  const graph = loadGraph(graphFile);
  // T300 — the rule files, which separate modules inside one package where
  // `mayImport` per package cannot (F149-FR-007). A rule file that lacks a
  // field is refused at load: the check fails rather than pass a rule it
  // cannot read.
  let ruleFiles: readonly ImportRule[];
  try {
    ruleFiles = loadRuleFiles(rulesDir ?? join(root, "tools/import-boundary/rules"), root);
  } catch (err) {
    // A rule file the check cannot read is a refusal, not a crash: it is
    // reported like a violation, with the file and what is missing, and
    // `check:imports` fails (exit 1).
    if (!(err instanceof RuleFileError)) throw err;
    return {
      violations: [
        {
          file: err.file,
          line: 0,
          spec: err.field ?? "",
          rule: "rule-file",
          detail: err.message,
        },
      ],
      notes: [],
      packagesChecked: 0,
      filesChecked: 0,
      importsChecked: 0,
    };
  }
  const packages = collectPackages(root);
  // A package that imports another package of the workspace does not
  // declare it in its package.json; the undeclared-dependency rule fires
  // only on an import that is declared nowhere.
  const workspaceNames = new Set<string>(packages.map((p) => p.name));
  const declared = new Map<string, Set<string>>();
  for (const pkg of packages) {
    declared.set(pkg.name, new Set<string>([...pkg.declared, ...workspaceNames]));
  }

  const report: Report = {
    violations: [],
    notes: [],
    packagesChecked: packages.length,
    filesChecked: 0,
    importsChecked: 0,
  };
  for (const pkg of packages) {
    const entry = entryOf(graph, pkg.name);
    for (const file of listSourceFiles(pkg.dir)) {
      report.filesChecked++;
      const rel = relative(root, file).split(sep).join("/");
      const content = readFileSync(file, "utf8");

      for (const statement of importsOfSource(file)) {
        report.importsChecked++;
        const spec = statement.spec;

        // T300 — the rule files hold over EVERY import of a matched file,
        // a relative one included: they separate modules, not packages.
        for (const violation of ruleFileViolations(
          ruleFiles,
          rel,
          statement.line,
          spec,
          root,
          (name) => packageExportPath(packages, name, spec),
        )) {
          report.violations.push({
            file: violation.file,
            line: violation.line,
            spec: violation.spec,
            rule: violation.rule,
            detail: violation.detail,
          });
        }

        if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")) continue;

        // The core rule of F100-FR-012 stands over the generic rules: when
        // the importing package is core and the core rule fails (a package,
        // an external package or a forbidden built-in), it reports the
        // import and the generic rules stay silent for that import.
        const coreViolation = coreImportViolation(graph, pkg.name, rel, statement.line, spec);
        if (coreViolation !== undefined) {
          report.violations.push(coreViolation);
          continue;
        }

        if (spec.startsWith("node:")) {
          if (entry !== undefined && entry.nodeBuiltins === false) {
            report.violations.push({
              file: rel,
              line: statement.line,
              spec,
              rule: "graph:nodeBuiltins",
              detail: `${pkg.name} must not use node built-ins (the graph entry says nodeBuiltins: false)`,
            });
          }
          continue;
        }

        const inGraph = graphPackageOf(graph, spec) !== undefined;

        if (inGraph) {
          const verdict = judgeImport(graph, pkg.name, spec);
          if (!verdict.ok) {
            report.violations.push({
              file: rel,
              line: statement.line,
              spec,
              rule: verdict.rule,
              detail: verdict.reason,
            });
          }
          continue;
        }

        // an external package: it must be declared in the package.json
        // (a sub-path of a declared package, `ajv/dist/2020.js`, counts as
        // declared through `ajv`)
        const declaredNames = declared.get(pkg.name);
        const isDeclared =
          declaredNames !== undefined &&
          [...declaredNames].some((name) => spec === name || spec.startsWith(name + "/"));
        if (!inGraph && !isDeclared) {
          report.violations.push({
            file: rel,
            line: statement.line,
            spec,
            rule: "undeclared-dependency",
            detail: `${pkg.name}: ${spec} is not declared in package.json`,
          });
        }
      }

      // The naming rule (F100-FR-012, F100-FR-018) holds over the whole
      // content of a file of a core package.
      for (const naming of coreNamingViolations(graph, pkg.name, rel, content)) {
        report.violations.push({
          file: naming.file,
          line: naming.line,
          spec: naming.name,
          rule: naming.rule,
          detail: naming.detail,
        });
      }
    }
  }
  return report;
}

function main(): void {
  const { root: rootArg, graph: graphArg } = parseArgs(process.argv.slice(2));
  const root = rootArg ?? defaultRoot();
  const graphFile = graphArg ?? join(root, "packages/contracts/data/package-graph.json");
  if (!existsSync(graphFile)) failUsage(`package graph not found: ${graphFile}`);

  const report = run(root, graphFile);
  for (const v of report.violations) {
    process.stdout.write(
      `VIOLATION ${v.file}:${v.line} imports "${v.spec}" [${v.rule}] ${v.detail}\n`,
    );
  }
  process.stdout.write(
    `import-boundary: ${report.packagesChecked} packages, ${report.filesChecked} files, ` +
      `${report.importsChecked} imports checked; ${report.violations.length} violation(s)\n`,
  );
  process.exit(report.violations.length > 0 ? 1 : 0);
}

// Only as the entry of the command. The module exports `run`, which T209
// calls to measure the check; a self-executing `main()` would run the whole
// check — and exit the process — on every import of this file.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
