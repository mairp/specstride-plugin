/**
 * T059 (feature 112) — the `doctor` command entry (F112-FR-028, CT-112-128).
 *
 * The doctor is ONE engine function (`runDoctorChecks` plus the renderers)
 * with THREE exposures: `specstride doctor` on the CLI; the doctor skill of
 * Claude Code, which runs the CLI and relays its output; and the doctor skill
 * of the dsh host in Wave 2. A host reaches the doctor through its rendering
 * of the command `doctor` (EP-01 `renderEntry`) and through the CLI protocol
 * only; a host skill is user-invoked where the host allows it.
 *
 * Every exposure calls this entry, and the entry names the calling host in
 * the rendered output (`host=<id>`, the proposal of CQ-071 made concrete:
 * the host names itself when it calls, and the default host of a direct CLI
 * call is `cli`).
 */
import { renderText, type DoctorSubject } from "./text.ts";
import { exitCodeFor } from "../runner/exit.ts";
import type { Finding } from "../registry/types.ts";

/** The logical id of the command every host renders (annex H §H.1). */
export const DOCTOR_COMMAND_ID = "doctor" as const;

/** The three exposures of the one engine function (F112-FR-028). */
export const DOCTOR_EXPOSURES = Object.freeze(["cli", "claude-code", "dsh"] as const);
export type DoctorExposure = (typeof DOCTOR_EXPOSURES)[number];

/**
 * How each exposure reaches the same engine (F112-FR-028): the CLI runs the
 * command; a host skill runs the CLI and relays its output, reached through
 * its `renderEntry` of the command `doctor`.
 */
export const EXPOSURE_REACHES_ENGINE_VIA: Readonly<Record<DoctorExposure, string>> = Object.freeze({
  cli: "the command `specstride doctor`",
  "claude-code": "the doctor skill runs the CLI and relays its output",
  dsh: "the doctor skill of the dsh host runs the CLI and relays its output",
});

/** The host a direct CLI call names when no host names itself (CQ-071). */
export const DEFAULT_DOCTOR_HOST = "cli" as const;

/** The input of the `doctor` command entry. */
export type DoctorEntryInput = {
  /** The calling host, as the host names itself; `cli` for a direct call. */
  readonly host?: string;
  readonly audience?: string;
  readonly proposer?: string;
  readonly critic?: string;
  readonly findings: readonly Finding[];
  /** The exit code in force; the findings table decides when omitted. */
  readonly exit?: number;
};

/** What the `doctor` command entry returns. */
export type DoctorEntryResult = {
  readonly commandId: typeof DOCTOR_COMMAND_ID;
  /** The calling host, named in `text` as `host=<id>` (F112-FR-028). */
  readonly host: string;
  readonly exit: number;
  /** The rendered output, exactly what the CLI prints and a host relays. */
  readonly text: string;
};

/**
 * The one engine function behind all three exposures (F112-FR-028): the
 * findings table decides the exit code, the text renderer renders it, and
 * the calling host is named in the first line of the output.
 */
export function doctorEntry(input: DoctorEntryInput): DoctorEntryResult {
  const host = input.host ?? DEFAULT_DOCTOR_HOST;
  const subject: DoctorSubject = {
    host,
    audience: input.audience ?? "local",
    proposer: input.proposer ?? "unpicked",
    critic: input.critic ?? "unpicked",
  };
  const exit = input.exit ?? exitCodeFor(input.findings);
  return {
    commandId: DOCTOR_COMMAND_ID,
    host,
    exit,
    text: renderText(input.findings, subject, exit),
  };
}
