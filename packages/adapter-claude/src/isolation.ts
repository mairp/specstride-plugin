/**
 * T052 + T053 — the isolation of a pass (F125-FR-015 to F125-FR-018).
 *
 * T052 (F125-FR-015, F125-FR-016, F125-FR-018):
 *   - the CUSTOMISATION-OFF mode: plugins, host hooks, skills, tool servers
 *     of the harness and, unless the proposer's opt-in is set, the harness's
 *     own auto-loaded memory, and the project instruction files, are all off
 *     for every pass and every critic-class call;
 *   - the MEMORY switch: the switch the descriptor names
 *     (`CLAUDE_CODE_DISABLE_AUTO_MEMORY`), off for every critic-class call,
 *     off by default for the proposer with the opt-in
 *     `memory.native.proposer` in user configuration, recorded per run, and
 *     passed NOWHERE under the `parity` profile;
 *   - the ASSERTIONS ON THE INITIAL RECORD: a customisation the record shows
 *     is a warning event for a proposer (the pass goes on) and a refusal
 *     `critic_not_toolless` for a critic; no host hook of Specstride's own
 *     plugin runs inside a proposer child.
 *
 * T053 (F125-FR-017): the THROWAWAY HOME of auth tier 2, built from an
 * overlay of `specstride-overlay/v1` (annex C §C.16), its scope (`attempt`
 * while a session is continued, else `pass`) and its removal, which happens
 * when the scope ends — even when the pass was killed — and never touches a
 * path the adapter did not build, the real configuration home included.
 */
import { mkdirSync, rmSync } from "node:fs";
import { CRITIC_NOT_TOOLLESS, CriticConfigError, type InitialRecord } from "./critic-cli.ts";
import { SessionRefusedError, type ThrowawayHome } from "./session.ts";

export { SessionRefusedError, type ThrowawayHome };

/* ------------------------------------------------------------------ *
 * T052 — the customisation-off mode (F125-FR-015).
 * ------------------------------------------------------------------ */

/** The stated value of the customisation mode on every call. */
export const CUSTOMISATION_OFF = "off" as const;

/** The closed set of the customisations the mode switches off. */
export const CUSTOMISATION_KINDS = [
  "plugins",
  "host-hooks",
  "skills",
  "tool-servers",
  "project-instructions",
  "native-memory",
] as const;
export type CustomisationKind = (typeof CUSTOMISATION_KINDS)[number];

/**
 * The customisation-off mode of a call (F125-FR-015), stated on the call
 * and never relied on as a default of the CLI (F125-FR-004). Native memory
 * is off unless the proposer's opt-in of F125-FR-018 is set; every other
 * kind is off unconditionally. Project instruction files are off under the
 * proposer's default isolation: the standing prompt is self-contained
 * (CQ-147).
 */
export function customisationOffMode(input: {
  readonly role: "proposer" | "critic";
  /** The opt-in `memory.native.proposer` of user configuration. */
  readonly proposerNativeMemory?: boolean;
}): {
  readonly customisation: typeof CUSTOMISATION_OFF;
  readonly role: "proposer" | "critic";
  readonly off: readonly CustomisationKind[];
  readonly nativeMemory: "off" | "on-by-opt-in";
} {
  const nativeMemory =
    input.role === "critic" || input.proposerNativeMemory !== true ? "off" : "on-by-opt-in";
  const off = CUSTOMISATION_KINDS.filter(
    (kind) => !(kind === "native-memory" && nativeMemory === "on-by-opt-in"),
  );
  return Object.freeze({
    customisation: CUSTOMISATION_OFF,
    role: input.role,
    off: Object.freeze(off),
    nativeMemory,
  });
}

/* ------------------------------------------------------------------ *
 * T052 — the memory switch (F125-FR-018).
 * ------------------------------------------------------------------ */

/** The switch the descriptor names for the harness's native memory. */
export const NATIVE_MEMORY_SWITCH = "CLAUDE_CODE_DISABLE_AUTO_MEMORY";

/** The opt-in key of user configuration for the proposer's native memory. */
export const PROPOSER_MEMORY_OPT_IN = "memory.native.proposer";

/** The memory switch as it is decided and recorded for one run. */
export type MemorySwitchSetting = {
  /** The environment name the switch sets. */
  readonly name: typeof NATIVE_MEMORY_SWITCH;
  /** Whether the switch is passed on this call. */
  readonly applied: boolean;
  /** Why: the role's rule, or the parity profile that passes nothing. */
  readonly reason:
    "critic-always-off" | "proposer-default-off" | "proposer-opt-in" | "parity-passes-nothing";
  /** The opt-in value as the run recorded it (F125-FR-018). */
  readonly recordedOptIn: boolean;
};

/**
 * The memory switch of one call (F125-FR-018): off for every critic-class
 * call; off by default for the proposer, on only with the opt-in
 * `memory.native.proposer` of user configuration; and under `parity` the
 * harness adapter passes NO switch about memory at all.
 */
export function memorySwitchSetting(input: {
  readonly role: "proposer" | "critic";
  readonly profile: "parity" | "default";
  /** The opt-in `memory.native.proposer` of user configuration. */
  readonly proposerNativeMemory?: boolean;
}): MemorySwitchSetting {
  if (input.profile === "parity") {
    return Object.freeze({
      name: NATIVE_MEMORY_SWITCH,
      applied: false,
      reason: "parity-passes-nothing",
      recordedOptIn: input.proposerNativeMemory === true,
    });
  }
  if (input.role === "critic") {
    return Object.freeze({
      name: NATIVE_MEMORY_SWITCH,
      applied: true,
      reason: "critic-always-off",
      recordedOptIn: false,
    });
  }
  const optIn = input.proposerNativeMemory === true;
  return Object.freeze({
    name: NATIVE_MEMORY_SWITCH,
    applied: !optIn,
    reason: optIn ? "proposer-opt-in" : "proposer-default-off",
    recordedOptIn: optIn,
  });
}

/* ------------------------------------------------------------------ *
 * T052 — the assertions on the initial record (F125-FR-016).
 * ------------------------------------------------------------------ */

/** One host hook as the initial record of capture D lists it. */
export type HostHook = {
  /** Where the hook comes from: a plugin, managed settings, the user. */
  readonly source: string;
  /** The event the hook is on (for example `PreToolUse`). */
  readonly event: string;
};

/** The plugin id of the host, whose hooks must not run in a child. */
export const HOST_PLUGIN_ID = "specstride";

/** The kinds of customisation an initial record may show. */
export type CustomisationFinding = {
  readonly kind: "plugin" | "host-hook" | "skill" | "tool-server";
  /** What the record showed, verbatim. */
  readonly detail: string;
};

/**
 * Reads the customisations an initial record shows (F125-FR-016). Hooks and
 * skills reach the record of capture D alongside tools, servers and plugins;
 * where the record carries none, the lists are simply empty.
 */
export function customisationFindings(input: {
  readonly initialRecord: InitialRecord;
  readonly hooks?: readonly HostHook[];
  readonly skills?: readonly string[];
}): readonly CustomisationFinding[] {
  const findings: CustomisationFinding[] = [];
  for (const plugin of input.initialRecord.plugins) {
    findings.push({ kind: "plugin", detail: plugin });
  }
  for (const server of input.initialRecord.servers) {
    findings.push({ kind: "tool-server", detail: server });
  }
  for (const hook of input.hooks ?? []) {
    findings.push({ kind: "host-hook", detail: `${hook.source}:${hook.event}` });
  }
  for (const skill of input.skills ?? []) {
    findings.push({ kind: "skill", detail: skill });
  }
  return Object.freeze(findings);
}

/** The warning event recorded for a proposer pass (F125-FR-016, CQ-144). */
export type IsolationWarning = {
  readonly kind: "customisation-present";
  readonly event: "warning";
  readonly findings: readonly CustomisationFinding[];
  /** True: a warning never stops a proposer pass (CQ-144). */
  readonly passContinues: true;
};

/**
 * The proposer's assertion on the initial record (F125-FR-016): every
 * customisation the record shows is recorded as a WARNING event, visible to
 * the doctor, and the pass goes on. Administrator-managed settings still
 * apply in the isolated mode, so the assertions are the backstop, not the
 * mechanism.
 */
export function assertInitialRecordForProposer(input: {
  readonly initialRecord: InitialRecord;
  readonly hooks?: readonly HostHook[];
  readonly skills?: readonly string[];
}): IsolationWarning {
  const findings = customisationFindings(input);
  return Object.freeze({
    kind: "customisation-present",
    event: "warning",
    findings,
    passContinues: true,
  });
}

/**
 * The critic's assertion on the initial record (F125-FR-016): a plugin, a
 * host hook, a skill or a tool server in the record REFUSES the call with
 * `critic_not_toolless`.
 */
export function assertInitialRecordForCritic(input: {
  readonly initialRecord: InitialRecord;
  readonly hooks?: readonly HostHook[];
  readonly skills?: readonly string[];
}): void {
  const findings = customisationFindings(input);
  if (findings.length === 0) return;
  throw new CriticConfigError(
    "critic_not_toolless",
    `refused the critic call (${CRITIC_NOT_TOOLLESS}): the initial record shows ` +
      `the customisation(s) ${findings.map((f) => `${f.kind} "${f.detail}"`).join(", ")} ` +
      `(F125-FR-016)`,
  );
}

/**
 * The host hooks of Specstride's OWN plugin a record shows (F125-FR-016):
 * none of them may run inside a proposer child. Empty where the record
 * shows none — which is the state the customisation-off mode produces.
 */
export function hostPluginHookFindings(
  hooks: readonly HostHook[] | undefined,
): readonly HostHook[] {
  return Object.freeze(
    (hooks ?? []).filter((hook) => hook.source.toLowerCase().includes(HOST_PLUGIN_ID)),
  );
}

/* ------------------------------------------------------------------ *
 * T053 — the throwaway home from the overlay (F125-FR-017).
 * ------------------------------------------------------------------ */

/** The overlay schema the throwaway home is built from (annex C §C.16). */
export const OVERLAY_SCHEMA = "specstride-overlay/v1" as const;

/** The closed set of the scopes of an overlay. */
export const OVERLAY_SCOPES = ["pass", "attempt"] as const;
export type OverlayScope = (typeof OVERLAY_SCOPES)[number];

/** A throwaway configuration home built from an overlay (F125-FR-017). */
export type OverlayHome = ThrowawayHome & {
  readonly schema: typeof OVERLAY_SCHEMA;
  /** The environment name through which the harness is pointed at it. */
  readonly envName: "CLAUDE_CONFIG_DIR";
};

/** Why an overlay was refused. */
export type OverlayRefusalReason = "unknown-schema" | "unknown-scope" | "overlay-root-missing";

/** The error a refused overlay carries. */
export class OverlayRefusedError extends Error {
  readonly reason: OverlayRefusalReason;

  constructor(reason: OverlayRefusalReason, message: string) {
    super(message);
    this.name = "OverlayRefusedError";
    this.reason = reason;
  }
}

/**
 * The scope of the overlay (F125-FR-017): `attempt` while a session of the
 * attempt is continued (the session state of F125-FR-014 lives with it),
 * else `pass`.
 */
export function overlayScope(input: { readonly sessionContinued: boolean }): OverlayScope {
  return input.sessionContinued ? "attempt" : "pass";
}

/**
 * Builds the throwaway configuration home of an auth tier 2 call from an
 * overlay of `specstride-overlay/v1` (F125-FR-017): a fresh directory the
 * ADAPTER built, outside the real configuration home and outside the
 * workspace, named by `CLAUDE_CONFIG_DIR` on the call. An overlay root that
 * is the real home or the workspace is refused. `mkdir` is injectable for
 * tests.
 */
export function buildOverlayHome(input: {
  /** Where overlays are built; never the real home, never the workspace. */
  readonly overlayRoot: string;
  readonly attemptId: string;
  readonly scope?: OverlayScope;
  /** The consumer's real configuration home; a refused overlay root. */
  readonly realConfigHome?: string | null;
  /** The root of the workspace; a refused overlay root. */
  readonly workspaceRoot?: string | null;
  readonly mkdir?: (dir: string) => void;
}): OverlayHome {
  if (input.scope !== undefined && !(OVERLAY_SCOPES as readonly string[]).includes(input.scope)) {
    throw new OverlayRefusedError("unknown-scope", `refused the overlay scope "${input.scope}"`);
  }
  const overlayRoot = input.overlayRoot.trim();
  if (overlayRoot === "" || overlayRoot === "/") {
    throw new OverlayRefusedError(
      "overlay-root-missing",
      `refused the overlay root "${input.overlayRoot}": it is empty or the filesystem root`,
    );
  }
  const resolvedRoot = overlayRoot;
  for (const [name, refused] of [
    ["the real configuration home", input.realConfigHome ?? null],
    ["the workspace", input.workspaceRoot ?? null],
  ] as const) {
    if (refused === null) continue;
    const base =
      resolvedRoot.startsWith(refused + "/") || resolvedRoot === refused ? resolvedRoot : null;
    if (base !== null) {
      throw new OverlayRefusedError(
        "overlay-root-missing",
        `refused the overlay root "${resolvedRoot}": it is inside ${name} (F125-FR-017)`,
      );
    }
  }
  const home = pathJoin(resolvedRoot, `claude-home-${input.attemptId}`);
  (input.mkdir ?? defaultMkdir)(home);
  return Object.freeze({
    path: home,
    adapterOwned: true as const,
    scope: input.scope ?? "pass",
    schema: OVERLAY_SCHEMA,
    envName: "CLAUDE_CONFIG_DIR" as const,
  });
}

function defaultMkdir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function pathJoin(...parts: readonly string[]): string {
  return parts.join("/").replace(/\/{2,}/g, "/");
}

/**
 * Removes a throwaway home when its scope ends (F125-FR-017): at the end of
 * the pass (`pass`) or at the end of the phase attempt (`attempt`), EVEN
 * WHEN THE PASS WAS KILLED — the removal depends only on the overlay record
 * the adapter built, never on the liveness of the pass. A home the adapter
 * did not build, the real configuration home and anything inside it are
 * refused before any removal. `rm` is injectable for tests.
 */
export function removeOverlayHome(input: {
  readonly home: OverlayHome | null;
  readonly realConfigHome?: string | null;
  readonly rm?: (dir: string) => void;
}): { removed: string | null } {
  if (input.home === null) return { removed: null };
  const target = input.home.path;
  if (input.home.adapterOwned !== true || input.home.schema !== OVERLAY_SCHEMA) {
    throw new SessionRefusedError(
      "not-adapter-owned",
      `refused to remove "${target}": the adapter did not build it from ${OVERLAY_SCHEMA}`,
    );
  }
  const real = input.realConfigHome ?? null;
  if (real !== null) {
    const normalised = real.replace(/\/$/, "");
    if (target === normalised || target.startsWith(`${normalised}/`)) {
      throw new SessionRefusedError(
        "real-home",
        `refused to remove "${target}": it is the real configuration home (F125-FR-015)`,
      );
    }
  }
  (input.rm ?? ((dir: string) => rmSync(dir, { recursive: true, force: true })))(target);
  return { removed: target };
}

/* ------------------------------------------------------------------ *
 * T052 — the minimal mode (F125-FR-004, F125-FR-017).
 * ------------------------------------------------------------------ */

/**
 * Whether the minimal mode — the mode that never reads the subscription
 * login — may be used on this call: only at auth tier 2, and never at auth
 * tier 1 (F125-FR-004).
 */
export function minimalModeAllowed(input: { readonly authTier: 1 | 2 }): boolean {
  return input.authTier === 2;
}

/* ------------------------------------------------------------------ *
 * T047 — the home comparison and its exclusion list (F125-SC-003).
 * ------------------------------------------------------------------ */

/**
 * The fixture that carries the list of the files the harness keeps by
 * itself (capture E); the list is the exclusion set of F125-SC-003.
 */
export const CAPTURE_E_FIXTURE = "packages/adapter-claude/test/fixtures/capture-e-home-writes.md";

/** The plan of the before/after comparison of the configuration home. */
export type HomeComparisonPlan =
  | {
      readonly kind: "compare";
      /** The paths the comparison leaves out: the list of capture E. */
      readonly excluded: readonly string[];
    }
  | {
      readonly kind: "skipped";
      /** Why: capture E has no list yet (unverified; no list, no guess). */
      readonly reason: string;
    };

/**
 * The exclusion list of the home comparison (F125-SC-003, CQ-143): the
 * files the HARNESS keeps by itself, named by capture E, are left out; the
 * files the ADAPTER acts on must number zero. Until capture E lands there
 * is no list and none is guessed, so the comparison of the harness's own
 * files is a SKIP with its reason.
 */
export function homeComparisonPlan(input: {
  /** The list of capture E; null while the capture is `unverified`. */
  readonly captureEFileList: readonly string[] | null;
}): HomeComparisonPlan {
  if (input.captureEFileList === null) {
    return Object.freeze({
      kind: "skipped",
      reason:
        "capture E is unverified: it has not listed the files the harness keeps by " +
        "itself in the real configuration home, and no list is guessed (CQ-143, F125-SC-003)",
    });
  }
  return Object.freeze({ kind: "compare", excluded: Object.freeze([...input.captureEFileList]) });
}

/**
 * The byte comparison of the home (F125-SC-003): the adapter's own acts
 * must number zero; the harness's own files, as capture E names them, are
 * the recorded deviation and are left out of the comparison. Both trees are
 * maps path → content digest; the comparison is pure.
 */
export function compareHomeTrees(input: {
  readonly before: Readonly<Record<string, string>>;
  readonly after: Readonly<Record<string, string>>;
  readonly excluded: readonly string[];
}): {
  readonly adapterWrites: readonly string[];
  readonly adapterRemovals: readonly string[];
  readonly harnessKept: readonly string[];
} {
  const excluded = new Set(input.excluded);
  const adapterWrites: string[] = [];
  const harnessKept: string[] = [];
  for (const [p, digest] of Object.entries(input.after)) {
    const before = input.before[p];
    if (before === digest) continue;
    if (excluded.has(p)) harnessKept.push(p);
    else adapterWrites.push(p);
  }
  const adapterRemovals = Object.keys(input.before).filter(
    (p) => !(p in input.after) && !excluded.has(p),
  );
  return Object.freeze({
    adapterWrites: Object.freeze(adapterWrites),
    adapterRemovals: Object.freeze(adapterRemovals),
    harnessKept: Object.freeze(harnessKept),
  });
}
