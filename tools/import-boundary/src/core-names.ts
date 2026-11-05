/**
 * T236 — the second core rule (annex A, §A.3, F100-FR-012; annex A, §A.4,
 * F100-FR-018).
 *
 * A source file of a core package that names
 *
 * - a sample of the test kit (`packages/testkit/src/samples/EP-nn/`), or
 * - a Wave 1 implementation of any of the nineteen extension points — every
 *   package of the graph that is not marked `core: true` and is not
 *   `@specstride/contracts` or `@specstride/kernel`: the harness adapters of
 *   L1, the sinks, the hosts of L7, the router rules and prompt blocks of
 *   annex D among them —
 *
 * by its package name or its path fails the check, with the file, the name
 * and the rule. What one core package may import from another is the
 * `mayImport` rule of T011; this rule is about naming, in imports and in
 * any other form, and holds over the whole content of the file.
 */
import type { GraphEntry, PackageGraph } from "./rules.ts";

/** The two packages a core file may name freely: the shared sources. */
const SHARED_PACKAGES = ["@specstride/contracts", "@specstride/kernel"];

/** The sample tree of the test kit (F100-FR-018). */
export const SAMPLE_PATHS = ["packages/testkit/src/samples/"] as const;

/** A sample directory of the test kit: `samples/EP-nn`. */
export const SAMPLE_DIR_RE = /samples\/EP-\d{2}/;

export type NamingViolation = {
  file: string;
  line: number;
  name: string;
  rule: string;
  detail: string;
};

/**
 * The Wave 1 implementation packages: every package of the graph that is
 * not marked `core: true` and is not `@specstride/contracts` or
 * `@specstride/kernel`.
 */
export function wave1ImplementationPackages(graph: PackageGraph): GraphEntry[] {
  return graph.packages.filter((p) => p.core !== true && !SHARED_PACKAGES.includes(p.name));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The line (1-based) of the first character at or after `index`. */
function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * The index of the first naming of `name` in `content`, where the name is
 * not part of a longer word (`@specstride/harness` does not match
 * `@specstride/harness-descriptor`, and a sub-path of the package
 * (`@specstride/harness/overlay`) still names it by its path).
 */
function firstNaming(content: string, name: string): number {
  const re = new RegExp(`(?<![\\w@-])${escapeRegExp(name)}(?![\\w-])`, "g");
  const match = re.exec(content);
  return match === null ? -1 : match.index;
}

/**
 * The naming violations of one source file of a core package. Returns an
 * empty list for a file of a non-core package and for a file that names no
 * sample and no Wave 1 implementation.
 */
export function coreNamingViolations(
  graph: PackageGraph,
  pkgName: string,
  file: string,
  content: string,
): NamingViolation[] {
  const entry = graph.packages.find((p) => p.name === pkgName);
  if (entry === undefined || entry.core !== true) return [];

  const out: NamingViolation[] = [];
  for (const wave of wave1ImplementationPackages(graph)) {
    const at = firstNaming(content, wave.name);
    if (at >= 0) {
      out.push({
        file,
        line: lineAt(content, at),
        name: wave.name,
        rule: "core:names-wave1",
        detail: `a core file names the Wave 1 implementation ${wave.name} (F100-FR-012, F100-FR-018): adding or removing the sample must change no core file`,
      });
    }
  }
  for (const path of SAMPLE_PATHS) {
    const at = content.indexOf(path);
    if (at >= 0) {
      out.push({
        file,
        line: lineAt(content, at),
        name: path,
        rule: "core:names-sample",
        detail: `a core file names the test kit sample path ${path} (F100-FR-012, F100-FR-018)`,
      });
    }
  }
  const sampleDir = SAMPLE_DIR_RE.exec(content);
  if (sampleDir !== null && sampleDir.index >= 0) {
    const already = out.some((v) => v.rule === "core:names-sample");
    if (!already) {
      out.push({
        file,
        line: lineAt(content, sampleDir.index),
        name: sampleDir[0],
        rule: "core:names-sample",
        detail: `a core file names the test kit sample directory ${sampleDir[0]} (F100-FR-012, F100-FR-018)`,
      });
    }
  }
  return out;
}
