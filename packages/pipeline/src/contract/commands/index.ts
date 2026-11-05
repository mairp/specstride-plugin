/**
 * T008 — the exit-code and line tables of the launch-contract commands and of
 * `launch` (annex G §G.4; contracts/commands.md), and the state-argument
 * helper every command of the verb `contract` shares.
 */
export * from "./exit-codes.ts";
export * from "./lines.ts";

import { holdsLogicalName, LOGICAL_NAMES } from "@specstride/contracts/ids/logical-names";
import { isAbsolute } from "node:path";

/**
 * True when the text is a logical name of the table of §B.5, either in its
 * template form (`pipeline:<pipelineId>:contract`) or with its parameters
 * filled in (`pipeline:abc123:contract`).
 */
function isLogicalName(text: string): boolean {
  if (holdsLogicalName(text)) return true;
  return LOGICAL_NAMES.some((template) => {
    const pattern =
      "^" + template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/<[^<>]+>/g, "[^:]+") + "$";
    return new RegExp(pattern).test(text);
  });
}

/**
 * T008 (F107-FR-039): an argument that names the launch contract, the
 * launcher or the launch bundle takes a path OR a logical name
 * (`pipeline:<pipelineId>:contract`); a host passes logical names only. The
 * argument is handed on unchanged either way — a logical name is resolved by
 * the reader through the layout, a path is used as the caller typed it — and
 * an argument that is neither is refused by the command that took it.
 *
 * Returns the kind of the argument, so the wiring can say in its error which
 * of the two forms it missed.
 */
export function stateArgumentKind(text: string): "logical-name" | "path" | "neither" {
  if (text.includes(":")) return isLogicalName(text) ? "logical-name" : "neither";
  if (text === "-" || isAbsolute(text)) return "path";
  // A relative path is a path too; the commands resolve it against the cwd.
  return "path";
}
