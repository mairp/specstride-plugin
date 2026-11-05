/**
 * T093 — discovery of the entry points of a toolchain (F105-FR-017).
 *
 * The LIST OF TOOLCHAINS IS DATA (`../../data/discovery.json`, T003;
 * `research.md` D-16, Principle VI): a further toolchain — a type check, a new
 * language — enters as a ROW of that file and needs no code here. The rows of
 * Wave 1 are the baseline's at `9cab15d`, read from `discover_project`
 * (`lib/verification_plan.py`:419), and `../../data/word-lists.json` carries
 * the list of build words the suite of a phase is selected with.
 *
 * `./lisa-discovery.ts` beside this file is the EXTRACTED module of Lisa with
 * the same table in code, pinned by CT-105-2 as it was extracted. This module
 * is the one the planner uses, and it is on the data — that is the move
 * `research.md` D-16 asks for, and CT-105-2 compares the two so that it cannot
 * change behaviour silently.
 *
 * A manager or interpreter that is not on the search path is an AMBIGUITY and
 * never an error (F105-FR-017).
 */
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import discoveryData from "../../data/discovery.json" with { type: "json" };
import {
  canonicalJson,
  commandSeed,
  projectFingerprint,
  sha256Bytes,
  stableId,
} from "../plan/hash.ts";
import { VerificationError, type PlanCommand } from "../plan/record.ts";

type EntryPoint = {
  readonly script?: string;
  readonly kind: string;
  readonly label: string;
  readonly timeoutSec: number;
  readonly args?: readonly string[];
};

type Toolchain = {
  readonly id: string;
  readonly framework?: string;
  readonly frameworks?: readonly string[];
  readonly detect: readonly string[];
  readonly manifest?: string;
  readonly executable?: string;
  readonly manager?: {
    readonly fromManifest: string;
    readonly separator: string;
    readonly fromLockFile: Readonly<Record<string, string>>;
    readonly default: string;
    readonly argumentForms: Readonly<Record<string, readonly string[]>>;
    readonly notOnSearchPath: { readonly as: string; readonly text: string };
  };
  readonly frameworksFromDependencies?: Readonly<Record<string, string>>;
  readonly runnerNamedInManifest?: {
    readonly needle: string;
    readonly caseInsensitive: boolean;
    readonly framework: string;
  };
  readonly notOnSearchPath?: { readonly as: string; readonly text: string };
  readonly entryPoints: readonly EntryPoint[];
};

type DiscoveryData = {
  readonly toolchains: readonly Toolchain[];
  readonly fingerprintFiles: readonly string[];
  readonly ambiguities: Readonly<Record<string, string>>;
  readonly assumptions: Readonly<Record<string, string>>;
  readonly placeholders: Readonly<Record<string, string>>;
};

const DATA = discoveryData as unknown as DiscoveryData;

/** The rows of `../../data/discovery.json`, open to further rows. */
export const TOOLCHAINS: readonly Toolchain[] = Object.freeze(DATA.toolchains);
/** The ids of the toolchains of Wave 1, in the order of the data. */
export const TOOLCHAIN_IDS: readonly string[] = Object.freeze(TOOLCHAINS.map((one) => one.id));
/** The root files `project.fingerprint` is taken over (F105-FR-011). */
export const FINGERPRINT_FILES: readonly string[] = Object.freeze(DATA.fingerprintFiles);

/** The as-is ambiguity of a project with no test command (F105-FR-017). */
export function noTestCommandAmbiguity(workdir: string): string {
  return DATA.ambiguities["noTestCommand"]!.replace("%s", workdir);
}
/** The second ambiguity, which names the phases without one (F105-FR-017). */
export function phasesWithoutCommandAmbiguity(phases: readonly number[]): string {
  return DATA.ambiguities["phasesWithoutCommand"]!.replace("%s", phases.join(", "));
}
/** The assumption of a project with no framework at all (`:538`). */
export function noFrameworkAssumption(workdir: string): string {
  return DATA.assumptions["noFramework"]!.replace("%s", workdir);
}

/** Resolve a bare name on a search path, as `shutil.which` does. */
export function which(name: string, searchPath: string): string | undefined {
  if (isAbsolute(name)) {
    try {
      accessSync(name, constants.X_OK);
      return statSync(name).isFile() ? name : undefined;
    } catch {
      return undefined;
    }
  }
  for (const directory of searchPath.split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Continue with the next entry of the search path.
    }
  }
  return undefined;
}

/** One discovered command (`lib/verification_plan.py`:183). */
function discoveredCommand(input: {
  readonly kind: string;
  readonly label: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly workdir: string;
  readonly timeoutSec: number;
}): PlanCommand {
  const executable = realpathSync(input.executable);
  const seed = commandSeed({
    kind: input.kind,
    executable,
    args: input.args,
    workdir: input.workdir,
  });
  return Object.freeze({
    id: stableId("CMD", seed),
    kind: input.kind,
    label: input.label,
    executable,
    args: Object.freeze([...input.args]),
    cwd: input.workdir,
    timeoutSec: input.timeoutSec,
  });
}

/** The placeholders of the data file, resolved for one toolchain. */
function withPlaceholders(
  args: readonly string[],
  values: { readonly workdir: string; readonly script?: string; readonly manifest?: string },
): readonly string[] {
  return args.map((one) =>
    one === "<workdir>"
      ? values.workdir
      : one === "<script>"
        ? (values.script ?? one)
        : one === "<manifest>"
          ? (values.manifest ?? one)
          : one,
  );
}

/** What discovery found (F105-FR-017). */
export type ProjectDiscovery = {
  readonly workdir: string;
  readonly fingerprint: string;
  readonly frameworks: readonly string[];
  readonly commands: readonly PlanCommand[];
  readonly assumptions: readonly string[];
  readonly ambiguities: readonly string[];
};

/**
 * The real place of a path, AS `os.path.realpath` GIVES IT (`:110`): the links
 * of the part that exists are resolved and the part that does not exist is
 * kept. `realpathSync` of `node:fs` REFUSES a path that is not there, so a
 * caller that must name a place in a refusal — `requireAbsoluteDirectory`
 * below does, and the public command `verify create` is the caller that makes
 * it reachable (B-1046) — cannot use it directly.
 */
export function realPathOrResolved(path: string): string {
  const absolute = resolve(path);
  let at = absolute;
  const rest: string[] = [];
  for (;;) {
    try {
      return rest.length === 0 ? realpathSync(at) : join(realpathSync(at), ...rest.reverse());
    } catch {
      const parent = dirname(at);
      if (parent === at) return absolute;
      rest.push(basename(at));
      at = parent;
    }
  }
}

/** A directory that must be absolute and must exist (`:107`). */
export function requireAbsoluteDirectory(path: string, label: string): string {
  if (!isAbsolute(path)) {
    throw new VerificationError(`${label} must be an absolute path: ${path}`);
  }
  const real = realPathOrResolved(path);
  let isADirectory = false;
  try {
    isADirectory = statSync(real).isDirectory();
  } catch {
    isADirectory = false;
  }
  if (!isADirectory) {
    throw new VerificationError(`${label} is not a directory: ${real}`);
  }
  return real;
}

/** The root files of the toolchains with their content hashes (`:158`). */
export function projectFiles(
  workdir: string,
): readonly { readonly path: string; readonly sha256: string }[] {
  const out: { path: string; sha256: string }[] = [];
  for (const name of FINGERPRINT_FILES) {
    const path = join(workdir, name);
    let isAFile = false;
    try {
      isAFile = statSync(path).isFile();
    } catch {
      isAFile = false;
    }
    if (!isAFile) continue;
    out.push({ path, sha256: sha256Bytes(readFileSync(path)) });
  }
  return Object.freeze(out);
}

/** A JSON record of a file, or `undefined` where it cannot be read. */
function readJsonRecord(path: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The text of every manifest of a toolchain that exists (`:481`). */
function manifestText(workdir: string, names: readonly string[]): string {
  let text = "";
  for (const name of names) {
    const path = join(workdir, name);
    if (!existsSync(path)) continue;
    text += `${readFileSync(path, "utf8")}\n`;
  }
  return text;
}

/**
 * Discovery of the entry points of every toolchain of the data
 * (F105-FR-017). The order of the rows of the data file is the order the
 * baseline runs its four blocks in: node, python, rust, go.
 */
export function discoverProject(input: {
  readonly workdir: string;
  readonly searchPath: string;
}): ProjectDiscovery {
  const workdir = requireAbsoluteDirectory(input.workdir, "workdir");
  const frameworks = new Set<string>();
  const commands: PlanCommand[] = [];
  const assumptions: string[] = [];
  const ambiguities: string[] = [];

  for (const toolchain of TOOLCHAINS) {
    const detected = toolchain.detect.filter((name) => existsSync(join(workdir, name)));
    if (detected.length === 0) continue;
    if (toolchain.framework !== undefined) frameworks.add(toolchain.framework);
    for (const name of toolchain.frameworks ?? []) frameworks.add(name);

    // A toolchain with a manager named in its manifest: the node row.
    if (toolchain.manager !== undefined) {
      const manifestPath = join(workdir, toolchain.manifest ?? detected[0]!);
      const manifest = readJsonRecord(manifestPath);
      if (manifest === undefined) {
        // The baseline lets its JSON reader raise and records the message as an
        // AMBIGUITY, not an error, and goes on with an empty manifest
        // (`lib/verification_plan.py`:425). The form of the message is the
        // baseline's; the text after the colon is the JSON reader's own and is
        // no as-is literal of the contract of this feature.
        ambiguities.push(`cannot read JSON ${manifestPath}: the file is no JSON record`);
      }
      const dependencies = {
        ...((manifest?.["dependencies"] as Record<string, unknown>) ?? {}),
        ...((manifest?.["devDependencies"] as Record<string, unknown>) ?? {}),
      };
      for (const [dependency, framework] of Object.entries(
        toolchain.frameworksFromDependencies ?? {},
      )) {
        if (dependency in dependencies) frameworks.add(framework);
      }
      const fromManifest = manifest?.[toolchain.manager.fromManifest];
      const declared = (typeof fromManifest === "string" ? fromManifest : "").split(
        toolchain.manager.separator,
      )[0];
      let managerName = declared ?? "";
      if (managerName === "") {
        for (const [lockFile, name] of Object.entries(toolchain.manager.fromLockFile)) {
          if (existsSync(join(workdir, lockFile))) {
            managerName = name;
            break;
          }
        }
      }
      if (managerName === "") managerName = toolchain.manager.default;
      const executable = which(managerName, input.searchPath);
      if (executable === undefined) {
        ambiguities.push(toolchain.manager.notOnSearchPath.text.replace("%s", managerName));
        continue;
      }
      const scripts = (manifest?.["scripts"] as Record<string, unknown>) ?? {};
      for (const entry of toolchain.entryPoints) {
        if (entry.script === undefined || !(entry.script in scripts)) continue;
        const form =
          toolchain.manager.argumentForms[managerName] ?? toolchain.manager.argumentForms["other"]!;
        commands.push(
          discoveredCommand({
            kind: entry.kind,
            label: entry.label,
            executable,
            args: withPlaceholders(form, { workdir, script: entry.script }),
            workdir,
            timeoutSec: entry.timeoutSec,
          }),
        );
      }
      continue;
    }

    // A toolchain that names its runner inside its manifest: the python row.
    if (toolchain.runnerNamedInManifest !== undefined) {
      const text = manifestText(workdir, toolchain.detect);
      const needle = toolchain.runnerNamedInManifest.needle;
      const found = toolchain.runnerNamedInManifest.caseInsensitive
        ? text.toLowerCase().includes(needle.toLowerCase())
        : text.includes(needle);
      if (!found) continue;
      frameworks.add(toolchain.runnerNamedInManifest.framework);
    }

    const executable = which(toolchain.executable ?? "", input.searchPath);
    if (executable === undefined) {
      if (toolchain.notOnSearchPath !== undefined) ambiguities.push(toolchain.notOnSearchPath.text);
      continue;
    }
    for (const entry of toolchain.entryPoints) {
      commands.push(
        discoveredCommand({
          kind: entry.kind,
          label: entry.label,
          executable,
          args: withPlaceholders(entry.args ?? [], {
            workdir,
            manifest: join(workdir, toolchain.manifest ?? ""),
          }),
          workdir,
          timeoutSec: entry.timeoutSec,
        }),
      );
    }
  }

  if (frameworks.size === 0) assumptions.push(noFrameworkAssumption(workdir));
  if (!commands.some((command) => command.kind === "test")) {
    ambiguities.push(noTestCommandAmbiguity(workdir));
  }

  return Object.freeze({
    workdir,
    fingerprint: projectFingerprint(workdir, projectFiles(workdir)),
    frameworks: Object.freeze([...frameworks].sort()),
    // The baseline sorts the discovered commands by id (`:556`).
    commands: Object.freeze(
      [...commands].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    ),
    assumptions: Object.freeze(assumptions),
    ambiguities: Object.freeze(ambiguities),
  });
}

/** The text form the fingerprint is taken over, for a test that reads it. */
export function fingerprintText(workdir: string): string {
  return canonicalJson({ workdir, entries: projectFiles(workdir).map((one) => ({ ...one })) });
}
