/**
 * T012 (feature 112) — the safe read of untrusted files (F112-FR-010).
 *
 * A project configuration file is untrusted input: the repository the doctor
 * runs in may be a clone an attacker wrote (research D-12, R16 open question
 * 9; R11 T-13). The rules:
 *
 * - the file is read only after its size is checked against a cap
 *   (`UNTRUSTED_MAX_BYTES`); a file over the cap is never parsed at all;
 * - the text is parsed by the loader of feature 110
 *   (`parseConfigText` of `@specstride/config`), whose parser is the npm
   package `yaml` in the mode that constructs no code (T044): YAML 1.2 core
 *   schema, no custom tag, no merge key, duplicate keys refused. A custom tag
 *   in a hostile document therefore names no constructor: nothing in the file
 *   is executed, and anchors resolve to data, never to code;
 * - the read gives data or a reason, and never throws past this module, so a
 *   hostile file cannot break the doctor (the doctor never blocks a run by
 *   being unhealthy).
 */
import { readFileSync, statSync } from "node:fs";
import { parseConfigText } from "@specstride/config";

/**
 * The size cap of an untrusted file, in bytes. A file over the cap is refused
 * before it is read or parsed.
 */
export const UNTRUSTED_MAX_BYTES = 1_048_576 as const;

/** Why an untrusted file was not read as configuration. */
export type UntrustedReadReason =
  /** The file is over the size cap; it was never parsed. */
  | "too-large"
  /** The file cannot be read as a YAML 1.2 document (a custom tag, a syntax error). */
  | "not-parseable"
  /** The parsed document is not a mapping of keys. */
  | "not-a-mapping"
  /** The metadata read failed (no file, no permission). */
  | "unreadable";

/** What the safe read gives back: data, or a reason and no value. */
export type UntrustedRead =
  | {
      readonly ok: true;
      /** The parsed mapping, as data. Nothing in it executed. */
      readonly value: Record<string, unknown>;
      readonly bytes: number;
    }
  | {
      readonly ok: false;
      readonly reason: UntrustedReadReason;
      /** The size of the file, when it was read as metadata. */
      readonly bytes?: number;
      /** A detail for the finding; never echoes the content of the file. */
      readonly detail?: string;
    };

/**
 * F112-FR-010 — read one untrusted file safely: size cap first, then a parse
 * that constructs no code. Nothing in the file is ever executed, evaluated or
 * interpolated; the result is data or a reason.
 */
export function readUntrustedFile(
  path: string,
  maxBytes: number = UNTRUSTED_MAX_BYTES,
): UntrustedRead {
  let bytes: number;
  try {
    bytes = statSync(path).size;
  } catch (error) {
    return {
      ok: false,
      reason: "unreadable",
      detail: (error as NodeJS.ErrnoException).code ?? "unreadable",
    };
  }
  if (bytes > maxBytes) {
    return { ok: false, reason: "too-large", bytes };
  }
  let text: string;
  try {
    text = readText(path);
  } catch (error) {
    return {
      ok: false,
      reason: "unreadable",
      bytes,
      detail: (error as NodeJS.ErrnoException).code ?? "unreadable",
    };
  }
  try {
    const value = parseConfigText(text, { logicalName: "project:config", path });
    return { ok: true, value, bytes };
  } catch (error) {
    return {
      ok: false,
      reason: "not-parseable",
      bytes,
      detail: (error as Error).message,
    };
  }
}

/** Read the text of a file as UTF-8; a non-UTF-8 file is not parseable data. */
function readText(path: string): string {
  // Synchronous, bounded: the size was already checked against the cap.
  return readFileSync(path, "utf8");
}
