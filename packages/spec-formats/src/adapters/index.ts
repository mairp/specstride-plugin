/**
 * T024 to T026 — the three adapters of Wave 1, wired to their detection halves.
 *
 * `registry.ts` (T008, T016) holds the DETECTION half of each adapter: which
 * step of F104-FR-005 claims a path or a content, and in which priority band.
 * `adapters/native.ts`, `adapters/speckit-tasks.ts` and
 * `adapters/openspec-change.ts` (T024 to T026) hold the GRAMMAR half. This
 * module joins the two, so that one registered adapter answers `detect`,
 * `parse`, `validate`, `tick` and `inputs` through one record (F104-FR-009,
 * annex C §C.7).
 *
 * The direction of the imports is one way: `registry.ts` knows the TYPE
 * `SpecGrammar` (declared in `model.ts`, which imports nothing of this
 * package) and never imports an adapter. `validate.ts`, `tick.ts` and
 * `context.ts` reach a grammar through `grammarOf` below, so an added format
 * of F104-FR-009 is parsed, validated and ticked with no change to a core file
 * (F104-SC-006).
 */
import type { FormatName, SpecGrammar } from "../model.ts";
import {
  type RegisteredAdapter,
  SpecFormatRegistry,
  nativeDetection,
  openspecChangeDetection,
  speckitTasksDetection,
} from "../registry.ts";
import { grammar as nativeGrammar } from "./native.ts";
import { grammar as speckitTasksGrammar } from "./speckit-tasks.ts";
import { grammar as openspecChangeGrammar } from "./openspec-change.ts";

export * as native from "./native.ts";
export * as speckitTasks from "./speckit-tasks.ts";
export * as openspecChange from "./openspec-change.ts";

/** The grammar of each format of Wave 1, by the name a model may carry. */
export const GRAMMARS: Readonly<Record<FormatName, SpecGrammar>> = Object.freeze({
  native: nativeGrammar,
  "speckit-tasks": speckitTasksGrammar,
  "openspec-change": openspecChangeGrammar,
});

/** The three adapters of Wave 1, detection half and grammar half joined. */
export function nativeAdapter(): RegisteredAdapter {
  return Object.freeze({ ...nativeDetection(), grammar: nativeGrammar });
}

export function speckitTasksAdapter(): RegisteredAdapter {
  return Object.freeze({ ...speckitTasksDetection(), grammar: speckitTasksGrammar });
}

export function openspecChangeAdapter(): RegisteredAdapter {
  return Object.freeze({ ...openspecChangeDetection(), grammar: openspecChangeGrammar });
}

/**
 * A registry with the three FULL adapters, in the registration order the error
 * of F104-FR-006 lists: `native`, `speckit-tasks`, `openspec-change`.
 */
export function createFullRegistry(): SpecFormatRegistry {
  const registry = new SpecFormatRegistry();
  registry.register(nativeAdapter());
  registry.register(speckitTasksAdapter());
  registry.register(openspecChangeAdapter());
  return registry;
}

/** The registry the package's own operations use; built once (research D-8). */
export const fullRegistry: SpecFormatRegistry = createFullRegistry();

/**
 * The grammar of a format name. The name is resolved through the alias
 * `openspec` first, so that `--format openspec` reaches the
 * `openspec-change` grammar (F104-FR-006). An added format brings its own
 * grammar through the registry; `undefined` is `unknown-format`.
 */
export function grammarOf(
  name: string,
  registry: SpecFormatRegistry = fullRegistry,
): SpecGrammar | undefined {
  const resolved = registry.resolveExplicit(name);
  return registry.adapterOf(resolved)?.grammar;
}
