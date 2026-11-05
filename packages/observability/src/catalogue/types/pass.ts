/**
 * T025 — the `data` schemas of the types of F111-FR-007: the pass, the tool
 * call and the prompt.
 *
 * *A pass MUST be explained by its events. `pass.started` MUST carry the
 * `sessionId`; every event inside the pass MUST carry it; the activity of a
 * subagent MUST carry `parentSessionId`. `pass.ended` MUST carry `endCause`, a
 * member of the closed set "End causes of a pass" (annex X §X.6 row 271), the
 * split of time into model, tool, wait and idle time, `firstEditAt`,
 * `usageComplete` and a reference to the raw transcript by logical name, hash
 * and size. `tool.call` MUST carry a category (`read`, `edit`, `exec`, `wait`,
 * `search`, `other`) and a duration, the references `argsRef` and `resultRef`
 * to the arguments and to the result (logical name, hash and size, never the
 * body), and the four marks `redacted`, `truncated`, `originalBytes` and
 * `retainedBytes`, as `stream.text` does. `prompt.built` MUST be written for
 * every pass and every critic-class call, with the bytes and the token
 * estimate of each block, the blocks dropped, and the total, and never the
 * text.*
 *
 * THE FOUR MARKS ARE FOUR, NOT THREE. `redacted` and `truncated` say what was
 * done; `originalBytes` and `retainedBytes` say how much. Without the pair of
 * numbers a reader cannot tell a tool call that was cut to nothing from one
 * that was short, so all four are required and none is optional.
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import {
  refine,
  CONTENT_REFERENCE_FIELD,
  COUNT,
  FLAG,
  TEXT,
  TIME_OR_NULL,
  type TypeRefinement,
} from "./refinement.ts";

export const PASS_STARTED = "pass.started" as const;
export const PASS_ENDED = "pass.ended" as const;
export const TOOL_CALL = "tool.call" as const;
export const PROMPT_BUILT = "prompt.built" as const;

/** The end causes of a pass: annex X §X.6 row 271. */
export const PASS_END_CAUSES: readonly string[] = Object.freeze([
  ...(closedSet(271)?.members ?? []),
]);

/** The categories of a tool call: annex X §X.6 row 95. */
export const TOOL_CATEGORIES: readonly string[] = Object.freeze([
  ...(closedSet(95)?.members ?? []),
]);

/** The split of the time of a pass (F111-FR-007). */
export const TIME_BREAKDOWN_PARTS = ["model", "tool", "wait", "idle"] as const;

/** The two references of a tool call: the arguments and the result. */
export const TOOL_CALL_REFERENCES = ["argsRef", "resultRef"] as const;

/** The four marks of a tool call, as `stream.text` carries them. */
export const TOOL_CALL_MARKS = ["redacted", "truncated", "originalBytes", "retainedBytes"] as const;

/** The end cause a killed pass carries. */
export const KILLED = "killed" as const;

/** The shape of one block of a built prompt: sizes, never the text. */
export const PROMPT_BLOCK = Object.freeze({
  required: Object.freeze(["name", "bytes", "tokensEst", "dropped"]),
  additional: false,
});

/**
 * The findings of an event against the session rules of F111-FR-007. An event
 * inside a pass carries the `sessionId`; the activity of a subagent carries
 * `parentSessionId` as well.
 */
export function sessionFindings(
  event: Readonly<Record<string, unknown>>,
  insideAPass: boolean,
  isASubagent = false,
): readonly string[] {
  const findings: string[] = [];
  if (insideAPass && typeof event.sessionId !== "string") {
    findings.push(
      `every event inside a pass carries the \`sessionId\`; ${String(event.type)} carries ` +
        `${JSON.stringify(event.sessionId)}`,
    );
  }
  if (isASubagent && typeof event.parentSessionId !== "string") {
    findings.push(
      `the activity of a subagent carries \`parentSessionId\`; ${String(event.type)} carries none`,
    );
  }
  return Object.freeze(findings);
}

/** The refinements of F111-FR-007. */
export const REFINEMENTS: readonly TypeRefinement[] = Object.freeze([
  refine({
    requirement: "F111-FR-007",
    type: PASS_STARTED,
    required: ["sessionId"],
    fields: { sessionId: TEXT },
  }),
  refine({
    requirement: "F111-FR-007",
    type: PASS_ENDED,
    required: ["endCause", "timeBreakdown", "firstEditAt", "usageComplete", "transcriptRef"],
    fields: {
      endCause: { enum: PASS_END_CAUSES },
      timeBreakdown: {
        type: ["object"],
        shape: { required: [...TIME_BREAKDOWN_PARTS], additional: false },
        note: "model, tool, wait and idle time",
      },
      firstEditAt: TIME_OR_NULL,
      usageComplete: FLAG,
      transcriptRef: CONTENT_REFERENCE_FIELD,
    },
    rules: [
      {
        name: "a-killed-pass-has-no-complete-usage",
        check: (data) =>
          data.endCause === KILLED && data.usageComplete === true
            ? "a killed pass ends with `usageComplete` false and the last partial usage"
            : null,
      },
    ],
  }),
  refine({
    requirement: "F111-FR-007",
    type: TOOL_CALL,
    required: ["category", "durationMs", ...TOOL_CALL_REFERENCES, ...TOOL_CALL_MARKS],
    fields: {
      category: { enum: TOOL_CATEGORIES },
      durationMs: COUNT,
      argsRef: CONTENT_REFERENCE_FIELD,
      resultRef: CONTENT_REFERENCE_FIELD,
      redacted: FLAG,
      truncated: FLAG,
      originalBytes: COUNT,
      retainedBytes: COUNT,
    },
  }),
  refine({
    requirement: "F111-FR-007",
    type: PROMPT_BUILT,
    required: ["promptRef", "blocks", "totalTokensEst"],
    fields: {
      promptRef: CONTENT_REFERENCE_FIELD,
      blocks: {
        type: ["array"],
        items: PROMPT_BLOCK,
        note: "per block: the bytes, the token estimate and whether it was dropped; never the text",
      },
      totalTokensEst: COUNT,
    },
  }),
]);
