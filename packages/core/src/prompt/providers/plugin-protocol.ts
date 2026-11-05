/**
 * T065 of feature 103 — the PLUGIN PROTOCOL SLOT of one harness
 * (F103-FR-030, F103-FR-031).
 *
 * The ninth of the nine shipped providers, and a SLOT rather than a block of
 * its own. F103-FR-031 says where the section goes: inside the first of the
 * five blocks of the set `as-is`, "the standing prompt (WITH THE PLUGIN
 * PROTOCOL SECTION OF THE HARNESS WHEN IT IS ENABLED)", and B-0764 records the
 * same ordering at `proposer.sh:2007`.
 *
 * ## Why this is a slot and not a text
 *
 * The section's CONTENT belongs to the harness adapter that has a plugin
 * protocol, which `spec.md` of this feature assigns to feature 130 — "the
 * variants of the dsh harness are the content of the feature of its harness
 * adapter" (F103-FR-031). This feature owns only the PLACE and the rule that
 * the section is present only when the protocol is ENABLED. So this provider
 * takes the text from the harness capability and returns no bytes of its own;
 * `OWNER_OF_THE_CONTENT` names who does, and no name of a harness appears in
 * this file, exactly as `../../pass-loop/loop.ts` tests no harness by name.
 *
 * ## It is part of the STANDING PROMPT, not a block after it
 *
 * `appendToStandingPrompt` is the operation the as-is set uses: the section is
 * joined INTO the standing prompt, so the five blocks stay five and the order
 * of B-0764 is unchanged. Returning it as a sixth block would put it after the
 * standing prompt instead of inside it, and the golden prompts would differ.
 */
import { blockOf } from "../assembler.ts";
import type {
  Block,
  PassContext,
  PromptBlockProvider,
} from "@specstride/contracts/ep/prompt-block";

/** The id of the block, for the set `current` where it stands on its own. */
export const BLOCK_ID = "plugin_protocol" as const;
export const WRITER = "core/prompt/providers/plugin-protocol" as const;

/** The feature that owns the CONTENT of the section. */
export const OWNER_OF_THE_CONTENT = "130" as const;

/** F103-FR-031 — under `as-is` the section is INSIDE the standing prompt. */
export const PART_OF_THE_STANDING_PROMPT_UNDER_AS_IS = true as const;

/** F103-FR-031 — the section is present only when the protocol is enabled. */
export const PRESENT_ONLY_WHEN_ENABLED = true as const;

/** The size the provider declares. */
export const DECLARED_SIZE = 16_000 as const;

/** What the provider is given, from the capability of the harness. */
export type PluginProtocolInput = {
  /** Whether the harness's plugin protocol is enabled for this pass. */
  readonly enabled: boolean;
  /** The section the harness adapter supplies. */
  readonly section?: string | undefined;
};

/** The text of the section, or the empty text where it is not enabled. */
export function pluginProtocolText(input: PluginProtocolInput): string {
  if (!input.enabled) return "";
  return input.section ?? "";
}

/**
 * F103-FR-031 — the section joined INTO the standing prompt, which is where
 * the baseline puts it. The join is one blank line, as every join of the set
 * `as-is` is.
 */
export function appendToStandingPrompt(standingPrompt: string, input: PluginProtocolInput): string {
  const section = pluginProtocolText(input);
  if (section === "") return standingPrompt;
  if (standingPrompt === "") return section;
  return `${standingPrompt}\n\n${section}`;
}

/**
 * The provider, for the block set `current`, where the section may stand as a
 * block of its own. The block is STABLE: a harness's protocol does not change
 * between the passes of a phase attempt.
 */
export function pluginProtocolProvider(input: PluginProtocolInput): PromptBlockProvider & {
  readonly id: typeof BLOCK_ID;
  readonly writer: typeof WRITER;
} {
  return Object.freeze({
    id: BLOCK_ID,
    writer: WRITER,
    declaredSize: DECLARED_SIZE,
    blocks(_context: PassContext): readonly Block[] {
      const text = pluginProtocolText(input);
      if (text === "") return Object.freeze([]);
      return Object.freeze([blockOf({ id: BLOCK_ID, text, writer: WRITER, stability: "stable" })]);
    },
  });
}
