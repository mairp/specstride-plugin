/**
 * T015 — the doctor check of the permissions of the control root
 * (F122-FR-022, F122-FR-039; EP-14, annex G §G.7).
 *
 * F122-FR-022 ends *…and the doctor MUST report it*. This is that check, and
 * `../root/control-root.ts` is the one thing it asks: the doctor and a launch
 * must not be able to disagree about whether a control root may be used, so
 * they run THE SAME code and the doctor adds no opinion of its own.
 *
 * Both checks are **launch-blocking** (`lb`). That is not a choice of taste:
 * EP-14 guarantees that *the launch checks are exactly the `lb` subset, so the
 * doctor and a launch cannot disagree* (`CORE_GUARANTEES` of the contract).
 * F122-FR-022 and F122-FR-039 both refuse a launch, so if these checks were
 * not `lb` the doctor would pass a control root that the next launch refuses.
 *
 * The severity is `fail` for either refusal and `ok` otherwise. There is no
 * `warn` reading: a control root another user can write is not a smell, it is
 * the condition under which a stranger can plant an approval record.
 */
import {
  MESSAGE_TEMPLATE_CAP_BYTES,
  type DoctorCheck,
  type DoctorRegistry,
  type Severity,
} from "@specstride/contracts/ep/doctor";
import {
  CONTROL_ROOT_KEY,
  CONTROL_ROOT_NOT_WRITABLE,
  CONTROL_ROOT_UNSAFE,
  checkControlRoot,
  modeOctalOf,
  type Asker,
  type ControlRootCheck,
} from "../root/control-root.ts";

/** The requirements these checks carry. */
export const CONTROL_ROOT_CHECK_REQUIREMENTS = ["F122-FR-022", "F122-FR-039"] as const;

/**
 * The ids of the two checks. *Ids are never renamed* (EP-14,
 * `CORE_GUARANTEES`), so these two strings are now fixed.
 */
export const CONTROL_ROOT_PERMISSIONS_CHECK_ID = "runtime.control-root.permissions" as const;
export const CONTROL_ROOT_WRITABLE_CHECK_ID = "runtime.control-root.writable" as const;

/** Both ids, in the order they are registered. */
export const CONTROL_ROOT_CHECK_IDS = [
  CONTROL_ROOT_PERMISSIONS_CHECK_ID,
  CONTROL_ROOT_WRITABLE_CHECK_ID,
] as const;

/**
 * Both checks are launch-blocking, so the doctor and a launch cannot disagree
 * (EP-14, `CORE_GUARANTEES`; F122-FR-022, F122-FR-039).
 */
export const CONTROL_ROOT_CHECKS_ARE_LAUNCH_BLOCKING = true as const;

/** Where in the doctor's order these two run. */
export const CONTROL_ROOT_PERMISSIONS_ORDER = 220 as const;
export const CONTROL_ROOT_WRITABLE_ORDER = 221 as const;

/**
 * The key the probe reads the control root out of the doctor's injected
 * probes. The doctor hands a check a record of injected probes (§G.7, Inputs);
 * this is the name under which the control root arrives.
 */
export const CONTROL_ROOT_PROBE_KEY = "controlRoot" as const;

/** The key the asker arrives under, where the caller names one. */
export const ASKER_PROBE_KEY = "controlRootAsker" as const;

/** What a probe of either check observed. */
export type ControlRootProbe = {
  /** The control root that was checked, or `null` where none was given. */
  readonly path: string | null;
  /** The result of the shared check, or `null` where there was no path. */
  readonly check: ControlRootCheck | null;
};

/** Read the control root out of the injected probes. */
export function controlRootFrom(injected: Readonly<Record<string, unknown>>): string | null {
  const value = injected[CONTROL_ROOT_PROBE_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Read the asker out of the injected probes; the CLI where none is named. */
export function askerFrom(injected: Readonly<Record<string, unknown>>): Asker {
  return injected[ASKER_PROBE_KEY] === "runtime-root" ? "runtime-root" : "cli";
}

/** Run the shared check of `../root/control-root.ts` for a probe. */
export function probeControlRoot(injected: Readonly<Record<string, unknown>>): ControlRootProbe {
  const path = controlRootFrom(injected);
  if (path === null) return Object.freeze({ path: null, check: null });
  return Object.freeze({ path, check: checkControlRoot(path, askerFrom(injected)) });
}

/**
 * The severity of the permissions check. `fail` where another user can write
 * the control root, `ok` where none can, and `warn` where there was nothing to
 * check — which is the default of §G.7 for a reading a check cannot take, and
 * never `ok`, because "we did not look" is not "it is fine".
 */
export function permissionsSeverity(observed: unknown): Severity {
  const probe = observed as ControlRootProbe | undefined;
  if (probe?.check == null) return "warn";
  return probe.check.refusal === CONTROL_ROOT_UNSAFE ? "fail" : "ok";
}

/**
 * The severity of the writability check. `fail` where the control root cannot
 * be written, `ok` where it can. An unsafe control root is NOT this check's
 * failure — the other check owns it — so this one reports `ok` for a directory
 * it could have written; the launch is still refused, by the other check,
 * which is `lb` too.
 */
export function writableSeverity(observed: unknown): Severity {
  const probe = observed as ControlRootProbe | undefined;
  if (probe?.check == null) return "warn";
  return probe.check.refusal === CONTROL_ROOT_NOT_WRITABLE ? "fail" : "ok";
}

/**
 * The message templates. At most 200 bytes each
 * (`MESSAGE_TEMPLATE_CAP_BYTES`), which `CONTROL_ROOT_CHECKS` asserts below,
 * so a template that grew past the cap fails at module load and not in a
 * consumer's terminal.
 */
export const PERMISSIONS_MESSAGE_TEMPLATE =
  `the control root named by \`${CONTROL_ROOT_KEY}\` must be writable by its owner only; ` +
  `another user who can write it can plant an approval or an owner record (F122-FR-022)`;

export const WRITABLE_MESSAGE_TEMPLATE =
  `the control root named by \`${CONTROL_ROOT_KEY}\` must be writable by this user; the CLI ` +
  `tests it before a launch record and the runtime root before the lock (F122-FR-039)`;

/** The fix hints. Both name the key, because setting it is the remedy. */
export const PERMISSIONS_FIX_HINT =
  `set \`${CONTROL_ROOT_KEY}\` to a directory only you can write, or remove group and other ` +
  `write permission from the one it names (chmod 0700)`;

export const WRITABLE_FIX_HINT =
  `set \`${CONTROL_ROOT_KEY}\` to a directory you can write; it is a widening key, and ` +
  `nothing falls back to another location by itself`;

/**
 * The evidence line of a finding. It holds a path and a permission mode and no
 * secret, so there is nothing to redact — which is worth saying, because §G.7
 * calls the field "redacted evidence" and a reader should know why this one
 * passes through unchanged.
 */
export function evidenceOf(observed: unknown): string {
  const probe = observed as ControlRootProbe | undefined;
  if (probe?.check == null) {
    return `no control root was given to the check (the key is \`${CONTROL_ROOT_KEY}\`)`;
  }
  const e = probe.check.evidence;
  const mode = e.mode === null ? "unknown" : modeOctalOf(e.mode);
  return (
    `${CONTROL_ROOT_KEY}=${probe.check.path} exists=${e.exists} mode=${mode} ` +
    `owner=${e.owner ?? "unknown"} asker=${e.asker ?? "unknown"} ` +
    `anotherUserCanWrite=${e.anotherUserCanWrite} probeWritten=${e.probeWritten}` +
    `${e.probeError === null ? "" : ` probeError=${e.probeError}`}`
  );
}

/** The permissions check of F122-FR-022. */
export const controlRootPermissionsCheck: DoctorCheck = Object.freeze({
  id: CONTROL_ROOT_PERMISSIONS_CHECK_ID,
  severityRule: permissionsSeverity,
  lb: CONTROL_ROOT_CHECKS_ARE_LAUNCH_BLOCKING,
  order: CONTROL_ROOT_PERMISSIONS_ORDER,
  probe: (injected: Readonly<Record<string, unknown>>): Promise<unknown> =>
    Promise.resolve(probeControlRoot(injected)),
  messageTemplate: PERMISSIONS_MESSAGE_TEMPLATE,
  fixHint: PERMISSIONS_FIX_HINT,
});

/** The writability check of F122-FR-039. */
export const controlRootWritableCheck: DoctorCheck = Object.freeze({
  id: CONTROL_ROOT_WRITABLE_CHECK_ID,
  severityRule: writableSeverity,
  lb: CONTROL_ROOT_CHECKS_ARE_LAUNCH_BLOCKING,
  order: CONTROL_ROOT_WRITABLE_ORDER,
  probe: (injected: Readonly<Record<string, unknown>>): Promise<unknown> =>
    Promise.resolve(probeControlRoot(injected)),
  messageTemplate: WRITABLE_MESSAGE_TEMPLATE,
  fixHint: WRITABLE_FIX_HINT,
});

/** Both checks, in the order they are registered. */
export const CONTROL_ROOT_CHECKS: readonly DoctorCheck[] = Object.freeze([
  controlRootPermissionsCheck,
  controlRootWritableCheck,
]);

// The cap of §G.7 is checked here, at load, so a template that grew past 200
// bytes fails in a test run and never in a consumer's terminal.
for (const check of CONTROL_ROOT_CHECKS) {
  const bytes = Buffer.byteLength(check.messageTemplate, "utf8");
  if (bytes > MESSAGE_TEMPLATE_CAP_BYTES) {
    throw new Error(
      `the message template of the doctor check \`${check.id}\` is ${bytes} bytes and the cap ` +
        `of annex G §G.7 is ${MESSAGE_TEMPLATE_CAP_BYTES}`,
    );
  }
}

/**
 * F122-FR-022 — register the doctor check of the permissions of the control
 * root, and the writability check beside it. Both are `lb`, so they are also
 * the launch checks of this feature (`launchChecks` of the EP-14 contract
 * selects exactly the `lb` subset).
 */
export function registerControlRootChecks(registry: DoctorRegistry): readonly DoctorCheck[] {
  for (const check of CONTROL_ROOT_CHECKS) registry.register(check);
  return CONTROL_ROOT_CHECKS;
}
