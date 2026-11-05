/**
 * T025 (feature 112) — the checks of the groups `env` and `cli`
 * (F112-FR-011, CT-112-111; catalogue rows 1 to 6).
 *
 * What they report (F112-FR-011): the runtime version against the floor; the
 * platform (Linux and macOS supported, Windows and WSL unvalidated — a
 * warning, never a failure); the platform tools outside the package registry
 * (git, the process listing tools, the keychain tool) as the evidence of
 * `env.os`; the permissions of state directories and files (owner only);
 * whether the control root is writable and has free space; the protocol
 * integer of the CLI against the range the calling host package supports; and
 * `cli.version` warns when the engine starts of a run carry different product
 * versions. Every statement about macOS is marked unverified (D-7).
 *
 * Every probe reads only its injected probe bag: no real machine in a test.
 */
import type { Check, ProbeBag } from "../registry/types.ts";
import { cfg, runsOf, MACOS_UNVERIFIED } from "./read.ts";
import process from "node:process";

/** The runtime floor: Node 22 or later (plan, Technical Context). */
export const NODE_FLOOR_MAJOR = 22 as const;
/** The free-space warn threshold of `env.tmpWritable`: 1 GiB (R16 F2). */
export const FREE_SPACE_WARN_BYTES: number = 1024 * 1024 * 1024;

/** Parse the major of a version string, or null. */
export function majorOf(version: string | undefined): number | null {
  const match = /^v?(\d+)\./.exec(version ?? "");
  return match === null ? null : Number(match[1]);
}

/** `env.node` — the runtime version against the floor (row 1). */
export const envNodeCheck: Check = {
  id: "env.node",
  group: "env",
  lb: false,
  order: 1,
  messageTemplate: "node {version} ok (needs >=22)",
  fixHint: "install Node 22 or later",
  severityRule: (o: unknown) => {
    const s = o as { major: number | null; lts: boolean; present: boolean };
    if (!s.present || s.major === null) return "fail";
    if (s.major < NODE_FLOOR_MAJOR) return "fail";
    // A long-term-support line of Node is an even major.
    if (!s.lts) return "warn";
    return "ok";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const version = cfg<string>(b, "env.node.version", process.version);
    const major = majorOf(version);
    return {
      version,
      major,
      present: major !== null,
      // LTS lines of Node are the even majors from 22 on.
      lts: major !== null && major % 2 === 0,
    };
  },
};

/** `env.os` — the platform and the platform tools as its evidence (row 2). */
export const envOsCheck: Check = {
  id: "env.os",
  group: "env",
  lb: false,
  order: 2,
  messageTemplate: "{platform} {state}; {tools}",
  fixHint: "run on Linux or macOS for supported behaviour",
  severityRule: (o: unknown) => {
    const s = o as { platform: string; missingTools: string[] };
    if (s.platform === "win32" || s.platform === "wsl") return "warn";
    if (s.missingTools.length > 0) return "info";
    return "ok";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const platform = cfg<string>(b, "env.os.platform", "linux");
    const tools = cfg<Record<string, boolean>>(b, "env.os.tools", {
      git: true,
      ps: true,
      pgrep: true,
      keychain: true,
    });
    const present = Object.entries(tools)
      .filter(([, ok]) => ok)
      .map(([name]) => name);
    const missingTools = Object.entries(tools)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);
    return {
      platform,
      // The platform tools are the evidence of `env.os` (D-7).
      toolsPresent: present.join(", "),
      tools: present.length > 0 ? `${present.join(", ")} present` : "no platform tool probed",
      missingTools,
      state: platform === "win32" || platform === "wsl" ? "unvalidated" : "ok",
      // Every statement about macOS is marked unverified (F112-FR-011).
      ...(platform === "darwin" ? { statement: MACOS_UNVERIFIED } : {}),
    };
  },
};

/** `env.git` — git missing means checkpoints disabled (row 3). */
export const envGitCheck: Check = {
  id: "env.git",
  group: "env",
  lb: false,
  order: 3,
  messageTemplate: "git missing: checkpoints disabled",
  fixHint: "install git",
  severityRule: (o: unknown) => ((o as { present: boolean }).present ? "ok" : "warn"),
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const configured = cfg<boolean | undefined>(b, "env.git.present", undefined);
    if (configured !== undefined) return { present: configured };
    // The real probe: the process listing tool of the bag, not the machine.
    const probe = await b.subprocess.run("git", ["--version"]);
    return { present: probe.code === 0 };
  },
};

/** The mode bits that make a state path readable by others (F112-FR-011). */
export function readableByOthers(mode: number | undefined): {
  group: boolean;
  world: boolean;
} {
  if (mode === undefined) return { group: false, world: false };
  return { group: (mode & 0o040) !== 0, world: (mode & 0o004) !== 0 };
}

/** `env.stateDirPerms` — state readable only by the owner (row 4). */
export const envStateDirPermsCheck: Check = {
  id: "env.stateDirPerms",
  group: "env",
  lb: false,
  order: 4,
  messageTemplate: "state directory is group or world readable",
  fixHint: "remove group and world access to the directory",
  severityRule: (o: unknown) => {
    const s = o as { group: boolean; world: boolean; present: boolean };
    if (!s.present) return "ok";
    return s.group || s.world ? "warn" : "ok";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const path = cfg<string>(b, "env.stateDir.path", "");
    if (path === "") return { present: false, group: false, world: false, path };
    // A metadata read only: size and mode, never content (F112-FR-006).
    const meta = b.files.stat(path);
    const bits = readableByOthers(meta?.mode);
    return { present: meta !== undefined, path, ...bits };
  },
};

/** `env.tmpWritable` — the control root writable, with free space (row 5). */
export const envTmpWritableCheck: Check = {
  id: "env.tmpWritable",
  group: "env",
  lb: false,
  order: 5,
  messageTemplate: "state directory not writable",
  fixHint: "fix the permissions or set another control root in user configuration",
  severityRule: (o: unknown) => {
    const s = o as { writable: boolean; freeBytes: number };
    if (!s.writable) return "fail";
    if (s.freeBytes < FREE_SPACE_WARN_BYTES) return "warn";
    return "ok";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const root = cfg<{ writable: boolean; freeBytes: number }>(b, "env.controlRoot", {
      writable: true,
      freeBytes: Number.MAX_SAFE_INTEGER,
    });
    return { writable: root.writable, freeBytes: root.freeBytes };
  },
};

/** `cli.version` — the protocol integer against the host range (row 6). */
export const cliVersionCheck: Check = {
  id: "cli.version",
  group: "cli",
  lb: false,
  order: 6,
  messageTemplate: "plugin expects protocol {expected}, cli has {protocol}",
  fixHint: "install the version the host package names (printed, never run)",
  severityRule: (o: unknown) => {
    const s = o as {
      protocol: number;
      range: { from: number; to: number };
      differingVersions: string[];
    };
    if (s.protocol < s.range.from || s.protocol > s.range.to) return "fail";
    if (s.differingVersions.length > 1) return "warn";
    return "ok";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const protocol = cfg<number>(b, "cli.protocol", 1);
    const range = cfg<{ from: number; to: number }>(b, "host.protocolRange", { from: 1, to: 1 });
    // The engine starts of a run carry the product version that started them.
    const versions = [
      ...new Set(
        runsOf(b)
          .filter((r) => r["kind"] === "engine-start")
          .map((r) => String(r["productVersion"] ?? "")),
      ),
    ].filter((v) => v !== "");
    return {
      protocol,
      expected: range.from,
      range,
      differingVersions: versions,
    };
  },
};

/** The six checks of the groups `env` and `cli`, in catalogue order. */
export const envChecks: readonly Check[] = Object.freeze([
  envNodeCheck,
  envOsCheck,
  envGitCheck,
  envStateDirPermsCheck,
  envTmpWritableCheck,
  cliVersionCheck,
]);
