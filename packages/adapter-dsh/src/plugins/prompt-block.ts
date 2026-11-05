/**
 * T032 — the `iter_done` plugin variant fields and the order of the prompt
 * blocks (F130-FR-019, F130-FR-020).
 *
 * `iter_done`: when a pass ends without phase evidence the event carries
 * `evidence=missing`; after a pass that ended with a plugin install it ALSO
 * carries `plugin_restart=true`. The compatibility projection renders the
 * fields as the as-is literals. The order of the prompt blocks: the standing
 * prompt, then the section of the plugin protocol (a block this adapter
 * contributes through the prompt block provider, at the place of the
 * baseline; it never reaches the critic), then the block of the status of a
 * long job, then the block of the note of a killed pass, then the block for
 * the resume of a yield, then the block of the short-pass nudge. The blocks
 * are joined by a blank line, and each is present only when it is not empty.
 */

/** The as-is literal of the missing-evidence field. */
export const ITER_DONE_EVIDENCE_MISSING = "evidence=missing" as const;

/** The as-is literal of the plugin variant field. */
export const ITER_DONE_PLUGIN_RESTART = "plugin_restart=true" as const;

/** The fields of one `iter_done` event, before the projection. */
export type IterDoneFields = {
  readonly event: "iter_done";
  /** `"missing"` where the pass ended without phase evidence. */
  readonly evidence: "missing" | "present";
  /** True only after a pass that ended with a plugin install. */
  readonly pluginRestart: boolean;
};

/** Builds the fields of `iter_done` (F130-FR-019). */
export function iterDoneFields(input: {
  readonly hasEvidence: boolean;
  readonly endedWithPluginInstall: boolean;
}): IterDoneFields {
  return {
    event: "iter_done",
    evidence: input.hasEvidence ? "present" : "missing",
    pluginRestart: input.endedWithPluginInstall,
  };
}

/**
 * The compatibility projection of `iter_done`: the as-is literals, space
 * separated, in the as-is order — `evidence=missing` first, the plugin
 * variant `plugin_restart=true` after it (DV-007, F130-FR-019).
 */
export function projectIterDone(fields: IterDoneFields): string {
  const parts = [`evidence=${fields.evidence}`];
  if (fields.pluginRestart) parts.push(ITER_DONE_PLUGIN_RESTART);
  return `${fields.event} ${parts.join(" ")}`;
}

/** The heading of the section of the plugin protocol (F130-FR-035). */
export const PLUGIN_SECTION_HEADING = "## Optional DSH plugin request protocol" as const;

/** The block names, in the order of F130-FR-020. */
export const PROMPT_BLOCK_ORDER = Object.freeze([
  "standing",
  "protocolSection",
  "longJobStatus",
  "killNote",
  "yieldResume",
  "shortPassNudge",
] as const);

/** One name of `PROMPT_BLOCK_ORDER`. */
export type PromptBlockName = (typeof PROMPT_BLOCK_ORDER)[number];

/** The input of the assembler: each block, empty where absent. */
export type PromptBlocks = Partial<Record<PromptBlockName, string>>;

/**
 * Assembles the pass prompt (F130-FR-020): the blocks in the stated order,
 * joined by a blank line, each present only when it is not empty. The section
 * of the plugin protocol stands AFTER the standing prompt and is a block of
 * this adapter; outside `parity` the assembler may reorder stable blocks, the
 * section stays a block of the adapter.
 */
export function assemblePrompt(blocks: PromptBlocks): string {
  const parts = PROMPT_BLOCK_ORDER.map((name) => blocks[name]?.trim() ?? "").filter(
    (part) => part !== "",
  );
  return parts.join("\n\n");
}

/** The input of the protocol section (F130-FR-035). */
export type ProtocolSectionInput = {
  readonly requestPath: string;
  readonly schema: string;
  /** The allowed exact specs, as the allowlist of the run states them. */
  readonly allowedSpecs: readonly string[];
};

/**
 * The section of the plugin protocol, headed as F130-FR-035 states, telling
 * the proposer the request path, the schema, the allowed exact specs, and to
 * stop without writing phase evidence after writing a request.
 */
export function protocolPromptSection(input: ProtocolSectionInput): string {
  return [
    PLUGIN_SECTION_HEADING,
    "",
    `Request path: ${input.requestPath}`,
    `Request schema: ${input.schema}`,
    `Allowed exact specs: ${input.allowedSpecs.join(", ")}`,
    "",
    "After writing a request, stop without writing phase evidence.",
  ].join("\n");
}
