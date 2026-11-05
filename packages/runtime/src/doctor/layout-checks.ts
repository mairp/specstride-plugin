/**
 * T073 — the doctor check of the layout version file (F122-FR-043; EP-14,
 * annex G §G.7).
 *
 * F122-FR-043 ends *…and with a doctor finding*, and *the doctor MUST be able
 * to show the layout version found and the one supported through a registered
 * check of feature 100 annex G §G.7*. This is that check.
 *
 * LIKE THE CONTROL-ROOT CHECKS, the doctor runs the SAME reading the launch
 * runs — `readLayoutVersion` of `../root/layout-version.ts` — so the doctor
 * and a launch cannot disagree about what the file holds. The check is
 * **launch-blocking** (`lb`): a file whose major the launch refuses must not
 * pass the doctor, because EP-14 guarantees that the launch checks are
 * exactly the `lb` subset.
 *
 * The severity is `fail` where the file names a major the product does not
 * support or where it cannot be read as a layout version at all, `ok` where
 * the file is missing (the workspace part simply counts as not written by the
 * product, F100-FR-041, and the first launch writes it) or where it holds the
 * supported major. There is no `warn` reading: a version the product cannot
 * read is the condition under which the next launch is refused, and that is
 * `fail`, not a smell.
 */
import {
  MESSAGE_TEMPLATE_CAP_BYTES,
  type DoctorCheck,
  type DoctorRegistry,
  type Severity,
} from "@specstride/contracts/ep/doctor";
import {
  LAYOUT_VERSION_CHECK_ID,
  LAYOUT_VERSION_LOGICAL_NAME,
  layoutVersionFindingDetail,
  layoutVersionPathOf,
  readLayoutVersion,
  supportedLayoutVersion,
  type LayoutVersionReading,
  type LockPlace,
} from "../root/layout-version.ts";

/** The requirement this check carries. */
export const LAYOUT_VERSION_CHECK_REQUIREMENTS = ["F122-FR-043"] as const;

/**
 * The id of the check. A hyphen in a segment makes a dotted literal a check
 * id and never a configuration key (§K.2, rule 1); ids are never renamed
 * (EP-14, `CORE_GUARANTEES`), so this string is fixed from here.
 */
export { LAYOUT_VERSION_CHECK_ID };

/** The check is launch-blocking, so the doctor and a launch cannot disagree. */
export const LAYOUT_VERSION_CHECK_IS_LAUNCH_BLOCKING = true as const;

/** Where in the doctor's order this check runs (after the lock checks, 230+). */
export const LAYOUT_VERSION_CHECK_ORDER = 250 as const;

/** The key the place arrives under in the doctor's injected probes. */
export const LAYOUT_VERSION_PROBE_KEY = "workspacePlace" as const;

/** What the check observed, as the probe reports it. */
export type LayoutVersionProbe = {
  /** The path of the file, or `null` where no place was given. */
  readonly path: string | null;
  /** The reading of the file, or `null` where there was no place. */
  readonly reading: LayoutVersionReading | null;
  /** The layout version this product supports. */
  readonly supported: string;
};

/** Read the place out of the injected probes. */
export function workspacePlaceFrom(injected: Readonly<Record<string, unknown>>): LockPlace | null {
  const value = injected[LAYOUT_VERSION_PROBE_KEY];
  if (value === null || typeof value !== "object") return null;
  const candidate = value as { controlRoot?: unknown; workspaceRealPath?: unknown };
  if (typeof candidate.controlRoot !== "string") return null;
  if (typeof candidate.workspaceRealPath !== "string") return null;
  return Object.freeze({
    controlRoot: candidate.controlRoot,
    workspaceRealPath: candidate.workspaceRealPath,
  });
}

/** Run the shared reading of `../root/layout-version.ts` for a probe. */
export function probeLayoutVersion(
  injected: Readonly<Record<string, unknown>>,
): LayoutVersionProbe {
  const place = workspacePlaceFrom(injected);
  if (place === null) {
    return Object.freeze({ path: null, reading: null, supported: supportedLayoutVersion() });
  }
  return Object.freeze({
    path: layoutVersionPathOf(place),
    reading: readLayoutVersion(place),
    supported: supportedLayoutVersion(),
  });
}

/**
 * The severity of the check. `fail` where the file holds another major or
 * cannot be read as a layout version, `ok` where it is missing or holds the
 * supported major, and `warn` where there was no place to read — the default
 * of §G.7 for a reading a check cannot take, and never `ok`.
 */
export function layoutVersionSeverity(observed: unknown): Severity {
  const probe = observed as LayoutVersionProbe | undefined;
  if (probe?.reading == null) return "warn";
  const reading = probe.reading;
  if (!reading.present) return "ok";
  if (!reading.readable) return "fail";
  return reading.major === probe.supported.split(".", 1).map(Number)[0] ? "ok" : "fail";
}

/**
 * The message template. At most 200 bytes (`MESSAGE_TEMPLATE_CAP_BYTES`),
 * which the load-time assertion below checks, so a template that grew past
 * the cap fails at module load and not in a consumer's terminal. The version
 * found and the one supported travel in the evidence line, where the cap does
 * not apply, because §G.7 asks the finding to show both.
 */
export const LAYOUT_VERSION_MESSAGE_TEMPLATE =
  `the layout version file of the workspace part must hold the major this product supports ` +
  `or be absent; the launch is refused over another major (F122-FR-043)`;

/** The fix hint. */
export const LAYOUT_VERSION_FIX_HINT =
  `write the layout version file with the version of the layout table of this product, or ` +
  `work in a workspace the product has written before`;

/** The evidence line: the logical name, the version found, the one supported. */
export function layoutVersionEvidence(observed: unknown): string {
  const probe = observed as LayoutVersionProbe | undefined;
  if (probe?.reading == null) {
    return `no workspace was given to the check (the key is \`${LAYOUT_VERSION_PROBE_KEY}\`)`;
  }
  return (
    `${LAYOUT_VERSION_LOGICAL_NAME}=${probe.path} supported=${probe.supported} ` +
    `${layoutVersionFindingDetail(probe.reading)}`
  );
}

/** The check of F122-FR-043. */
export const layoutVersionCheck: DoctorCheck = Object.freeze({
  id: LAYOUT_VERSION_CHECK_ID,
  severityRule: layoutVersionSeverity,
  lb: LAYOUT_VERSION_CHECK_IS_LAUNCH_BLOCKING,
  order: LAYOUT_VERSION_CHECK_ORDER,
  probe: (injected: Readonly<Record<string, unknown>>): Promise<unknown> =>
    Promise.resolve(probeLayoutVersion(injected)),
  messageTemplate: LAYOUT_VERSION_MESSAGE_TEMPLATE,
  fixHint: LAYOUT_VERSION_FIX_HINT,
});

/** The check, as it is registered. */
export const LAYOUT_VERSION_CHECKS: readonly DoctorCheck[] = Object.freeze([layoutVersionCheck]);

// The cap of §G.7 is checked here, at load, so a template that grew past 200
// bytes fails in a test run and never in a consumer's terminal.
for (const check of LAYOUT_VERSION_CHECKS) {
  const bytes = Buffer.byteLength(check.messageTemplate, "utf8");
  if (bytes > MESSAGE_TEMPLATE_CAP_BYTES) {
    throw new Error(
      `the message template of the doctor check \`${check.id}\` is ${bytes} bytes and the cap ` +
        `of annex G §G.7 is ${MESSAGE_TEMPLATE_CAP_BYTES}`,
    );
  }
}

/**
 * F122-FR-043 — register the doctor check of the layout version file. It is
 * `lb`, so it is also a launch check of this feature (`launchChecks` of the
 * EP-14 contract selects exactly the `lb` subset).
 */
export function registerLayoutChecks(registry: DoctorRegistry): readonly DoctorCheck[] {
  for (const check of LAYOUT_VERSION_CHECKS) registry.register(check);
  return LAYOUT_VERSION_CHECKS;
}
