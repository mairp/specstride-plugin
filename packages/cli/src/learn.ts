/**
 * `specstride learn` — the across-runs layer's command. Owners: feature 106
 * (`specs/106-learning/`), F106-FR-022 to F106-FR-026.
 *
 * This module is the front-door wiring only (annex G §G.1): it strips the
 * front door's own options (`-w`/`--workspace`, `--feature`), resolves the
 * feature name from the environment the way the front door does, and hands
 * the rest — the mode and its options — to `runLearn` of
 * `@specstride/learning`. Every behaviour (the mode spellings, the input
 * selection, the line texts, the exit codes) lives in the learning package.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { runLearn, type LearnPorts } from "@specstride/learning";
import { validate, registry, adapters, model } from "@specstride/spec-formats";

/**
 * The learning surface the engine's loop of one run composes, re-exported so
 * this front door stays the ONE product importer of the learning package
 * (T079, LR-1: no source outside `packages/learning` reads the decision log
 * or a learned value). `engine/learning-loop.ts` routes through here, exactly
 * as `engine/run-feature.ts` routes its `phaseShapesOfSpec` through here.
 */
export {
  engineEvaluate,
  engineObserve,
  lastEvaluationsReport,
  learningFailureLine,
  learningPaths,
  resolveMode,
  summarizeFromPaths,
  OBSERVED_EVENT_TYPE,
  type LearningMode,
  type ResolvedMode,
} from "@specstride/learning";

/** The environment file the front door reads for the feature name (annex G §G.1). */
export const SPECSTRIDE_ENV_FILE = ".env" as const;

/** The feature name of a workspace, as the front door resolves it. */
export function featureOf(workspace: string): string | undefined {
  const envPath = `${workspace}/${SPECSTRIDE_ENV_FILE}`;
  if (existsSync(envPath)) {
    try {
      for (const line of readFileSync(envPath, "utf8").split("\n")) {
        const at = line.indexOf("=");
        if (at > 0 && line.slice(0, at).trim() === "SPECSTRIDE_FEATURE") {
          const value = line.slice(at + 1).trim();
          if (value) return value;
        }
      }
    } catch {
      /* fall through to the directory scan */
    }
  }
  const featuresDir = `${workspace}/.specstride/features`;
  if (existsSync(featuresDir)) {
    try {
      const names = readdirSync(featuresDir).filter((n) => !n.startsWith("."));
      if (names.length === 1) return names[0];
    } catch {
      /* no feature derivable */
    }
  }
  return undefined;
}

/**
 * The phase shapes of one spec file, read through the canonical model of
 * feature 104 (F104-FR-014, F104-FR-021): the registry detects the format,
 * the grammar of that format reads the phases, and the shape of a phase is
 * the ONE hasher's shape over its number, title and criteria. The cli is the
 * layer that owns this reader — learning may import only the contracts and
 * kernel packages (LR-1, annex A §A.2) — and hands it to the verb as a port.
 */
export function phaseShapesOfSpec(specsPath: string, feature: string): Record<number, string> {
  const text = readFileSync(specsPath, "utf8");
  const format = registry.detectFormatOfPath(specsPath, undefined, adapters.createFullRegistry());
  const parsed = validate.parse({ file: specsPath, text, format, feature });
  const shapes: Record<number, string> = {};
  for (const phase of model.phaseNumbers(parsed)) {
    shapes[phase] = validate.shapeOf(parsed, phase);
  }
  return shapes;
}

/** Run `specstride learn` with the arguments that follow its word; the exit code is the result. */
export function learn(argv: readonly string[]): number {
  const ports: {
    workspace?: string;
    feature?: string;
    env?: Record<string, string | undefined>;
    phaseShapesOf?: (specsPath: string) => Record<number, string>;
  } = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-w" || arg === "--workspace" || arg === "--workdir") {
      ports.workspace = argv[++i];
      continue;
    }
    if (arg === "--feature") {
      ports.feature = argv[++i];
      continue;
    }
    rest.push(arg);
  }
  if (ports.workspace !== undefined && ports.feature === undefined) {
    ports.feature = featureOf(ports.workspace);
  }
  ports.env = { ...process.env } as Record<string, string | undefined>;
  ports.phaseShapesOf = (specsPath: string) =>
    phaseShapesOfSpec(specsPath, ports.feature ?? "feature");
  const result = runLearn(rest, ports as LearnPorts);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exit;
}
