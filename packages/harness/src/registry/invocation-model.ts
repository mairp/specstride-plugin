/**
 * The defaults of an entry and the invocation model (T031; F109-FR-007).
 *
 * An entry that names no stream format is read as raw text. An entry that
 * declares no overlay has none. The invocation model of a harness reference
 * is the model the caller named, unless the reference also carries a
 * qualifier, in which case no model is reported; a qualifier counts as the
 * model only for an entry whose qualifier label says that the qualifier
 * names provider and model (`provider/model` — today only `dsh`).
 *
 * Ported from as-is `invocation_model_value` of `lib/backends.py` (research
 * R5): an explicit model beats the qualifier unless both are given, in which
 * case picking either would be a guess — so neither is reported.
 */
import { type HarnessRegistry } from "./registry.ts";

/** What an entry that names no stream format is read as. */
export const RAW_TEXT = "raw text";

/** The stream format an entry is read as; null means `RAW_TEXT`. */
export function streamOrDefault(entry: { stream: string | null }): string {
  return entry.stream ?? RAW_TEXT;
}

/** The overlay an entry is read as; null means the entry has none. */
export function overlayOrDefault<T>(entry: { overlay: T | null }): T | null {
  return entry.overlay;
}

/** The label that makes a qualifier count as a model id. */
export const MODEL_QUALIFIER_LABEL = "provider/model";

/**
 * The invocation model for SPEC (`id` or `id:qualifier`) and the explicit
 * MODEL the caller named. Returns the model to report, or null where there
 * is none. Unknown names are the caller's refusal (queries.ts returns 1);
 * this function reads the registry only.
 */
export function invocationModel(
  registry: HarnessRegistry,
  spec: string,
  model: string,
): string | null {
  const colon = spec.indexOf(":");
  const bare = colon === -1 ? spec : spec.slice(0, colon);
  const qualifier = colon === -1 ? "" : spec.slice(colon + 1);
  const entry = registry.find(bare);
  if (entry === null) return null;
  if (model) return qualifier ? null : model;
  const q = entry.roles.proposer?.served ? entry.roles.proposer : null;
  if (qualifier && q !== null && q.form !== "none" && q.label === MODEL_QUALIFIER_LABEL) {
    return qualifier;
  }
  return null;
}
