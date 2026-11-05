/**
 * T028 — the bound of the proposer prompt and the split at spaces
 * (F130-FR-011; shared with the critic, F130-FR-027).
 *
 * The descriptor declares the limit of ONE argument, 120 KiB
 * (`descriptor.invoke.proposer.promptLimitBytes`, the argument table's
 * `promptLimitBytes`). A prompt within the limit travels as ONE argument
 * (F130-FR-007). A prompt over the limit is split ONLY at ASCII spaces into
 * chunks within the limit, with no chunk starting with a dash — the harness
 * joins its task arguments with one space — and a single token over the limit
 * FAILS the pass with a message that names the limit.
 */

/** The limit of one argument, 120 KiB (the descriptor's `promptLimitBytes`). */
export const PROMPT_LIMIT_BYTES = 122_880 as const;

/** The human name of the limit, used in the failure message. */
export const PROMPT_LIMIT_LABEL = "120 KiB" as const;

/** The ASCII space, the only character a prompt is ever split at. */
const ASCII_SPACE = 0x20;

/** The error of a prompt that cannot travel: one token over the limit. */
export class PromptTooLargeError extends Error {
  /** The byte length of the token that does not fit. */
  readonly tokenBytes: number;

  constructor(tokenBytes: number) {
    super(
      `dsh prompt: a single token of ${tokenBytes} bytes exceeds the argument limit ` +
        `of ${PROMPT_LIMIT_BYTES} bytes (${PROMPT_LIMIT_LABEL}); the pass fails`,
    );
    this.name = "PromptTooLargeError";
    this.tokenBytes = tokenBytes;
  }
}

/** The byte length of TEXT in UTF-8. */
function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Splits TEXT at ASCII spaces only, into chunks each within
 * `PROMPT_LIMIT_BYTES`, with no chunk starting with a dash. One token over
 * the limit throws `PromptTooLargeError` (the pass fails, F130-FR-011).
 */
export function splitPromptAtSpaces(text: string): string[] {
  const tokens = text.split(String.fromCharCode(ASCII_SPACE)).filter((t) => t !== "");
  for (const token of tokens) {
    if (byteLength(token) > PROMPT_LIMIT_BYTES) throw new PromptTooLargeError(byteLength(token));
  }
  const chunks: string[] = [];
  let current = "";
  for (const token of tokens) {
    const candidate = current === "" ? token : `${current} ${token}`;
    if (byteLength(candidate) <= PROMPT_LIMIT_BYTES) {
      current = candidate;
      continue;
    }
    if (current !== "") chunks.push(current);
    current = token;
  }
  if (current !== "") chunks.push(current);
  // No chunk may start with a dash: the joined task arguments would read it
  // as a flag. One leading space keeps the bytes apart when the harness
  // rejoins with one space.
  return chunks.map((chunk) => (chunk.startsWith("-") ? ` ${chunk}` : chunk));
}

/**
 * The arguments that carry PROMPT (F130-FR-007, F130-FR-011): one argument
 * within the limit; the space-split chunks over it. The proposer and the
 * critic share this function (F130-FR-027).
 */
export function promptArguments(prompt: string): string[] {
  if (byteLength(prompt) <= PROMPT_LIMIT_BYTES) return [prompt];
  return splitPromptAtSpaces(prompt);
}
