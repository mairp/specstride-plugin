/**
 * T031 — the handlers of `verdicts` and `feedback` (F119-FR-019).
 *
 * `verdicts` prints every transcript of the feature's verdict records — one
 * `[SPECSTRIDE-VERDICT]` line per transcript, referring to the transcript by
 * logical name, byte count and result — or only those of phase `N` when `N`
 * is given. With no `N` and no transcript it prints nothing and exits 0.
 * `feedback N` prints the feedback of phase `N` of the newest phase attempt:
 * one `[SPECSTRIDE-FEEDBACK]` line that names the record by logical name,
 * byte count and line count. Under `--verbose` the text is framed as data
 * (F119-FR-032); `--json` prints the record of F119-FR-033.
 *
 * Neither handler writes a file (F119-FR-016): the verdict text is read, not
 * copied.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { verdictsDirOf, feedbackPathOf, type ControlPlane } from "../router/guards.ts";
import { phaseNumberArg, parseInspectArgs } from "../router/inspect-args.ts";
import type { RoutedCall } from "../router/route.ts";
import { verdictLine, feedbackLine } from "../output/default.ts";
import { redactWord } from "../output/free-text.ts";
import { outsideTextLines, hashPrefix } from "../output/free-text.ts";
import { isCompatibilityMode } from "../output/mode.ts";
import { compatText, verdictsCompatText } from "../output/compat.ts";
import { select } from "./select.ts";
import { emit } from "./tail-events.ts";

/** The logical name of the feedback record of one phase (annex B §B.5). */
export function feedbackLogicalName(phase: number): string {
  return `gate:${phase}:feedback`;
}

/** The logical name of the verdict record of one phase (annex B §B.5). */
export function verdictLogicalName(file: string): string {
  const match = file.match(/phase-(\d+)/);
  const phase = match === null ? "0" : (match[1] as string);
  return `gate:${phase}:verdict`;
}

/** The verdict result a transcript records, as its text holds it. */
export function verdictResultOf(text: string): string {
  const marked = text.match(/VERDICT:\s*([A-Za-z][A-Za-z-]*)/);
  if (marked !== null) return marked[1] as string;
  for (const row of text.split("\n")) {
    const line = row.trim();
    if (line === "" || line.startsWith("#")) continue;
    return line.split(/\s+/)[0] ?? line;
  }
  return "unknown";
}

/** The transcript files of one feature, in name order. */
export function transcriptsOf(
  cp: ControlPlane,
  slug: string,
  phase?: number | undefined,
): readonly string[] {
  const dir = verdictsDirOf(cp, slug);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => {
      if (
        phase !== undefined &&
        !name.startsWith(`phase-${phase}-`) &&
        name !== `phase-${phase}.md`
      ) {
        return false;
      }
      try {
        return statSync(join(dir, name)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/** The handler of `verdicts [N]` (F119-FR-019). */
export function verdictsHandler(call: RoutedCall): number {
  const args = parseInspectArgs(call.extras);
  const phase = phaseNumberArg(args);
  const chosen = select(args, call.controlPlane);
  const files = transcriptsOf(call.controlPlane, chosen.feature, phase);
  // F119-FR-019 — with no `N` and no transcript: nothing, exit 0. In
  // compatibility output the baseline refuses instead (the FX-28 capture
  // `verdicts-no-verdicts` ends 1 with its message).
  if (files.length === 0 && phase === undefined && !isCompatibilityMode(call.mode)) return 0;
  if (files.length === 0) {
    // F119-FR-029 — in compatibility output the refusal is the baseline's
    // message on the error stream, exit 1 (the FX-28 captures
    // `verdicts-no-verdicts` / `verdicts-no-verdict-for-phase`).
    if (isCompatibilityMode(call.mode)) {
      const dir = verdictsDirOf(call.controlPlane, chosen.feature);
      call.io.err(
        phase === undefined
          ? `no verdicts recorded yet (${dir})\n`
          : `no verdicts for phase ${phase}\n`,
      );
      return 1;
    }
    return emit(
      call,
      args,
      "verdicts",
      [],
      { feature: chosen.feature },
      phase === undefined ? "no-verdicts" : "no-verdict-for-phase",
    );
  }
  const texts = files.map((file) =>
    readFileSync(join(verdictsDirOf(call.controlPlane, chosen.feature), file), "utf8"),
  );
  // F119-FR-029 — in compatibility output every transcript is printed under
  // the box rule with its path, as the baseline prints it, after the redactor.
  if (isCompatibilityMode(call.mode)) {
    const dir = verdictsDirOf(call.controlPlane, chosen.feature);
    call.io.out(
      compatText(
        verdictsCompatText(
          dir,
          files.map((file, at) => ({ name: file, text: texts[at] as string })),
        ),
      ),
    );
    return 0;
  }
  const lines = files.map((file, at) =>
    verdictLine({
      name: verdictLogicalName(file),
      bytes: Buffer.byteLength(texts[at] as string, "utf8"),
      result: redactWord(verdictResultOf(texts[at] as string)),
    }),
  );
  const verbose = args.verbose === true;
  for (let at = 0; at < files.length; at += 1) {
    if (verbose) {
      lines.push(
        ...outsideTextLines("", verdictLogicalName(files[at] as string), texts[at] as string, args),
      );
    }
  }
  const json = {
    feature: chosen.feature,
    verdicts: files.map((file, at) => ({
      name: verdictLogicalName(file),
      bytes: Buffer.byteLength(texts[at] as string, "utf8"),
      hash: hashPrefix(texts[at] as string),
      result: redactWord(verdictResultOf(texts[at] as string)),
    })),
    left: 0,
  };
  return emit(call, args, "verdicts", lines, json, undefined);
}

/** The handler of `feedback N` (F119-FR-019). */
export function feedbackHandler(call: RoutedCall): number {
  const args = parseInspectArgs(call.extras);
  const phase = phaseNumberArg(args);
  const chosen = select(args, call.controlPlane);
  const cp: ControlPlane = call.controlPlane;
  if (phase === undefined)
    return emit(call, args, "feedback", [], { feature: chosen.feature }, "usage");
  const path = feedbackPathOf(cp, chosen.feature, phase);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return emit(call, args, "feedback", [], { feature: chosen.feature }, "no-feedback");
  }
  const bytes = Buffer.byteLength(text, "utf8");
  // F119-FR-029 / F119-FR-032 — in compatibility output the feedback record
  // is printed as the baseline prints it: the record itself, after the
  // redactor.
  if (isCompatibilityMode(call.mode)) {
    call.io.out(compatText(text));
    return 0;
  }
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  const name = feedbackLogicalName(phase);
  const line = feedbackLine({ phase, name, bytes, lines });
  const parts = args.verbose === true ? [line, ...outsideTextLines("", name, text, args)] : [line];
  return emit(
    call,
    args,
    "feedback",
    parts,
    { feature: chosen.feature, phase, name, bytes, lines, hash: hashPrefix(text) },
    undefined,
  );
}
