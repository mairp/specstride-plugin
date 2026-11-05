/**
 * T055 — the compatibility text of the inspection verbs (F119-FR-029).
 *
 * In compatibility output every line an inspection verb prints is the
 * baseline's byte for byte (F119-FR-029). The baseline's shapes, pinned by
 * the FX-28 golden captures of feature 141's oracle (commit `9cab15d`):
 *
 * - `tail` prints the engine log itself;
 * - `events` prints one rendered line per milestone event,
 *   `<HH:MM:SS>  <event padded to 18> <k=v ...>`, and `events --json` prints
 *   one JSON object per line as the file holds it (F119-FR-018);
 * - `verdicts` prints each transcript under a rule of box characters with
 *   the path of the transcript;
 * - `feedback N` prints the feedback record itself (F119-FR-032: the text as
 *   the baseline prints it, after the redactor);
 * - `phases` prints `<spec> — <n> phase(s):` and one row per phase.
 *
 * Text that leaves through here still passes the redactor at the call site
 * (F119-FR-032); this module only shapes the bytes.
 */

import { Ingress } from "@specstride/observability";

/**
 * The ingress of the compatibility text: the same redaction point and the
 * same 16,384-byte cap the front door hands to a framed text (F119-FR-032 —
 * in compatibility output the text is printed as the baseline prints it,
 * AFTER the redactor).
 */
const compatIngress = new Ingress({ limits: { textMaxBytes: 16384 } });

/** The text of compatibility output: redacted, empty where the point fails. */
export function compatText(text: string): string {
  const through = compatIngress.text(text, "compat-text");
  return through.ok ? through.text : "";
}

/** The rule the `verdicts` transcripts are printed under (FX-28/verdicts-ok). */
export const VERDICTS_BOX = "═".repeat(64);

/** The text `verdicts` prints for the transcript files, in name order. */
export function verdictsCompatText(
  dir: string,
  entries: readonly { readonly name: string; readonly text: string }[],
): string {
  let out = "";
  for (const entry of entries) {
    out += `${VERDICTS_BOX}\n# ${joinPath(dir, entry.name)}\n${VERDICTS_BOX}\n${entry.text}`;
  }
  return out;
}

/** `path.join` without a second import at the call sites. */
function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

/** The event fields the rendered line never prints (F119-FR-026's keys). */
const EVENT_KEYS_LEFT_OUT: readonly string[] = Object.freeze([
  "time",
  "ts",
  "event",
  "task",
  "backend",
  "run_id",
]);

/** The clock of one event line: the `HH:MM:SS` of the event's time value. */
export function eventClockOf(time: unknown): string {
  if (typeof time === "string") {
    const clock = time.match(/(\d{2}:\d{2}:\d{2})/);
    if (clock !== null) return clock[1] as string;
    return time.slice(-8);
  }
  return "??:??:??";
}

/** One rendered event line of compatibility output (FX-28/events-ok). */
export function compatEventLine(record: Record<string, unknown>): string | undefined {
  const type = record.event ?? record.type;
  if (typeof type !== "string") return undefined;
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (EVENT_KEYS_LEFT_OUT.includes(key)) continue;
    if (value === undefined || value === null) continue;
    pairs.push(`${key}=${String(value)}`);
  }
  return `${eventClockOf(record.time)}  ${type.padEnd(18)} ${pairs.join(" ")}`;
}

/**
 * The rendered event stream of compatibility output, from the bytes of the
 * event file: one line per milestone record the file holds, in stream order.
 */
export function renderCompatEvents(raw: string): string {
  const lines: string[] = [];
  for (const row of raw.split("\n")) {
    if (row.trim() === "") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row) as Record<string, unknown>;
    } catch {
      continue;
    }
    const line = compatEventLine(parsed);
    if (line !== undefined) lines.push(line);
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/**
 * The compatibility label of one phase state (F119-FR-020). The FX-28
 * capture pins `APPROVED`; the labels of the other states follow the closed
 * literals of the old language's text normaliser (N-19): REJECTED, EVIDENCE,
 * PENDING.
 */
export function compatPhaseStateOf(state: string): string {
  if (state === "APPROVED") return "APPROVED";
  if (state.startsWith("rejected")) return "REJECTED";
  if (state === "evidence-written") return "EVIDENCE";
  return "PENDING";
}

/** One row of the `phases` table of compatibility output (FX-28/phases-ok). */
export function compatPhaseRow(number: number, title: string, state: string): string {
  // The capture pins the row `  Phase 1   The only phase ... [APPROVED]`:
  // two spaces, `Phase <n>`, three spaces, the title, then the bracketed
  // state — the title field runs to column 53, where `[` opens.
  const TITLE_FIELD = 41;
  const padded =
    title.length > TITLE_FIELD ? `${title.slice(0, TITLE_FIELD - 1)} ` : title.padEnd(TITLE_FIELD);
  return `  Phase ${number}   ${padded}[${compatPhaseStateOf(state)}]`;
}

/** The whole `phases` text of compatibility output (FX-28/phases-ok). */
export function phasesCompatText(
  specPath: string,
  phases: readonly { readonly number: number; readonly title: string; readonly state: string }[],
): string {
  const head = `${specPath} — ${phases.length} phase(s):`;
  return `${[head, ...phases.map((p) => compatPhaseRow(p.number, p.title, p.state))].join("\n")}\n`;
}
