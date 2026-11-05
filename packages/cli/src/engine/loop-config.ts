/**
 * The loop configuration of a run (feature 115, F115-FR-001): the strategy
 * `loop.strategy` (default `micro`), the closing-check switch
 * `loop.micro.closing_check` and the caps `loop.micro.caps.*`, resolved
 * through the REAL configuration of feature 110 — the user file, the project
 * file `specstride.yaml` of the workspace, the environment and the defaults
 * of the catalogue — never a copy of the merge.
 *
 * There is no environment alias for `loop.strategy`: the value comes from a
 * configuration file or from the default, which is what the catalogue's
 * layers and the merge give us on their own.
 */
import { realpathSync } from "node:fs";
import {
  loadConfigFiles,
  resolveConfiguration,
  type ResolvedConfiguration,
} from "@specstride/config";
import { capsFor, type Caps } from "../../../layer-micro/src/caps/caps.ts";
import {
  ALLOW_DETECT_KEY,
  UNITS_KEY,
  WORKERS_KEY,
  WORKERS_MAX_KEY,
  type AllowDetectConfiguration,
  type UnitsConfiguration,
  type WorkerCountConfiguration,
} from "../../../layer-parallel/src/index.ts";

/** The strategies of the closed set of row 55 (`classic`, `micro`). */
export type LoopStrategy = "micro" | "classic";

/** The loop configuration of a run, as the composition root reads it. */
export type LoopConfiguration = {
  /** The strategy in force (`micro` by default, F115-FR-001). */
  readonly strategy: LoopStrategy;
  /** `loop.micro.closing_check` (on by default, F115-FR-028). */
  readonly closingCheck: boolean;
  /** `loop.micro.caps.checkMin`, the time limit of one inner check, minutes. */
  readonly checkMin: number;
  /** The caps of F115-FR-022, with the defaults where the configuration is silent. */
  readonly caps: Caps;
  /** Where the strategy came from: a configuration file or the default. */
  readonly source: "configured" | "default";
  /** The configured value, as the configuration named it, when one did. */
  readonly configuredValue: unknown;
  /** The keys of the loop layer `parallel`, as the ranks the layer reads. */
  readonly parallel: ParallelLoopConfiguration;
};

/**
 * The keys of the loop layer `parallel` (feature 142), as the real merge of
 * feature 110 resolved them. The layer reads ranks by name (annex X §X.2), the
 * merge gives the winning rank layer and everything a higher rank shadowed, so
 * this record maps one onto the other: no rank of the layer is re-implemented
 * here, and no value of the merge is read twice.
 */
export type ParallelLoopConfiguration = {
  /** The ranks of `loop.parallel.units` the layer reads, filled from the merge. */
  readonly units: UnitsConfiguration;
  /** The two worker-count keys, by the source the layer trusts for each. */
  readonly workers: WorkerCountConfiguration;
  /** `loop.parallel.quota_headroom`, in per cent, where configuration set it. */
  readonly quotaHeadroomPerCent?: number;
  /** Where `loop.parallel.allow_detect` was found, for the layer's own reading. */
  readonly allowDetect: AllowDetectConfiguration;
};

/** The rank layer of the merge a rank name of the units switch answers to. */
const UNITS_RANK_OF_LAYER: Readonly<Partial<Record<string, keyof UnitsConfiguration>>> =
  Object.freeze({
    "launch-contract-pin": "launchContractPin",
    flag: "flag",
    environment: "environment",
    "project-configuration": "projectConfiguration",
    "user-configuration": "userConfiguration",
  });

/** The rank layer of the merge a source of the worker count answers to. */
const WORKERS_SOURCE_OF_LAYER: Readonly<
  Partial<Record<string, keyof Omit<WorkerCountConfiguration, never>>>
> = Object.freeze({
  "launch-contract-pin": "launchContract",
  "user-configuration": "userConfiguration",
  "project-configuration": "projectConfiguration",
});

/** The rank layer of the merge a source of `allow_detect` answers to. */
const ALLOW_DETECT_SOURCE_OF_LAYER: Readonly<
  Partial<Record<string, keyof AllowDetectConfiguration>>
> = Object.freeze({
  environment: "environment",
  flag: "flag",
  "project-configuration": "projectConfiguration",
  "user-configuration": "userConfiguration",
});

/**
 * The effective value of one key and everything a higher rank shadowed, as
 * the sources the layer names: the winner first, then the shadowed values.
 */
function offersOf(
  resolved: ResolvedConfiguration,
  key: string,
): readonly { readonly layer: string; readonly value: unknown }[] {
  const merged = resolved.values.get(key);
  if (merged === undefined) return Object.freeze([]);
  return Object.freeze([
    { layer: merged.source as string, value: merged.value },
    ...merged.shadowed.map((shadowed) => ({
      layer: shadowed.layer as string,
      value: shadowed.value,
    })),
  ]);
}

/** The merge's value of a boolean-kind key, as the two values of the switch say it. */
function unitsValueOfMerge(value: unknown): "on" | "off" | undefined {
  if (value === true || value === "on") return "on";
  if (value === false || value === "off") return "off";
  // A value that is neither is no value of the switch: the layer passes it
  // over, and the rank is left out rather than filled with a foreign value.
  return undefined;
}

/** The keys of the layer `parallel`, read from the one real merge. */
function parallelConfigurationOf(resolved: ResolvedConfiguration): ParallelLoopConfiguration {
  const units: { -readonly [K in keyof UnitsConfiguration]: UnitsConfiguration[K] } = {};
  const mergedUnits = resolved.values.get(UNITS_KEY);
  if (mergedUnits !== undefined) {
    const rank = UNITS_RANK_OF_LAYER[mergedUnits.source];
    const value = unitsValueOfMerge(mergedUnits.value);
    if (rank !== undefined && value !== undefined) units[rank] = value;
  }
  if (resolved.profile !== undefined) units.profile = resolved.profile;

  const workers: { -readonly [K in keyof WorkerCountConfiguration]: WorkerCountConfiguration[K] } =
    {};
  for (const [key, field] of [
    [WORKERS_KEY, "workers"],
    [WORKERS_MAX_KEY, "workersMax"],
  ] as const) {
    for (const offer of offersOf(resolved, key)) {
      const source = WORKERS_SOURCE_OF_LAYER[offer.layer];
      if (source === undefined || typeof offer.value !== "number") continue;
      workers[source] = { ...workers[source], [field]: offer.value };
    }
  }

  const allowDetect: {
    -readonly [K in keyof AllowDetectConfiguration]: AllowDetectConfiguration[K];
  } = {};
  for (const offer of offersOf(resolved, ALLOW_DETECT_KEY)) {
    const source = ALLOW_DETECT_SOURCE_OF_LAYER[offer.layer];
    if (source === undefined || typeof offer.value !== "boolean") continue;
    allowDetect[source] = offer.value;
  }

  const headroom = resolved.values.get("loop.parallel.quota_headroom");
  const headroomValue = Number(headroom?.value);
  return Object.freeze({
    units: Object.freeze(units),
    workers: Object.freeze(workers),
    ...(Number.isFinite(headroomValue) && headroom !== undefined
      ? { quotaHeadroomPerCent: headroomValue }
      : {}),
    allowDetect: Object.freeze(allowDetect),
  });
}

/** The key of the strategy in the catalogue. */
export const STRATEGY_KEY = "loop.strategy";

const NUMBER_KEYS: Readonly<Record<keyof Caps, string>> = Object.freeze({
  repairs: "loop.micro.caps.repairs",
  proposalMinutes: "loop.micro.caps.proposalMin",
  unitMinutes: "loop.micro.caps.unitMin",
  cyclesExtra: "loop.micro.caps.cyclesExtra",
  cyclesMin: "loop.micro.caps.cyclesMin",
  unresolvedUnits: "loop.micro.caps.unresolvedUnits",
});

/**
 * Resolve the loop keys of a run through the real configuration: the files
 * the loader finds (the user file of `user:config`, the project file
 * `specstride.yaml` of the workspace), the environment and the defaults of
 * the catalogue, merged through the eight ranks of F110-FR-014.
 */
export function loopConfigurationOf(input: {
  readonly home: string;
  readonly workdir: string;
  readonly environment: NodeJS.ProcessEnv;
}): LoopConfiguration {
  const files = loadConfigFiles({
    home: input.home,
    workspaceRealPath: realpathSync(input.workdir),
    startDir: input.workdir,
  });
  const resolved = resolveConfiguration({
    ...(files.user === undefined ? {} : { user: files.user }),
    ...(files.project === undefined ? {} : { project: files.project }),
    environment: input.environment,
  });
  const valueOf = (key: string): { value: unknown; source: string } => {
    const merged = resolved.values.get(key);
    return merged === undefined
      ? { value: undefined, source: "default" }
      : { value: merged.value, source: merged.source };
  };

  const strategy = valueOf(STRATEGY_KEY);
  const configured = strategy.source !== "default" && strategy.value !== undefined;
  const caps = capsFor(
    Object.fromEntries(
      (Object.keys(NUMBER_KEYS) as (keyof Caps)[]).map((name) => {
        const read = valueOf(NUMBER_KEYS[name]);
        const number = Number(read.value);
        return [name, Number.isFinite(number) ? number : undefined];
      }),
    ),
  );
  return Object.freeze({
    strategy: strategy.value === "classic" ? ("classic" as const) : ("micro" as const),
    // The catalogue types the switch `on, off`, which the merge reads as a
    // boolean; both spellings of "off" switch it off.
    closingCheck: (() => {
      const read = valueOf("loop.micro.closing_check").value;
      return read !== "off" && read !== false;
    })(),
    checkMin: Number(valueOf("loop.micro.caps.checkMin").value) || 5,
    caps,
    source: configured ? ("configured" as const) : ("default" as const),
    configuredValue: configured ? strategy.value : undefined,
    parallel: parallelConfigurationOf(resolved),
  });
}
