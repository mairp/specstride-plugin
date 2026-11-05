/**
 * T043 — the coverage check, the proof record, the switch
 * `harnesses.dsh.critic.proof` and the refusal `critic_not_toolless`
 * (F130-FR-024, F130-FR-025, F130-FR-037).
 *
 * The patch is a deny list, and a deny list goes stale when the harness gains
 * a tool. At preflight and before every critic call the adapter enumerates the
 * tool ids that the installed harness and its profile expose, by a FREE
 * introspection that makes no model call, and refuses the critic role with
 * `critic_not_toolless` when one of them is not covered by the patch. An
 * enumeration that fails or that cannot be read refuses the role the same
 * way. Under `strict` a version other than the pin refuses the role the same
 * way (F130-FR-025).
 *
 * The proof of a strict call is the WEAKER proof (constitution v3.0.1, CQ-182;
 * DV-081): four facts — the version pin, the coverage check, the hash of the
 * patch file and the exported permission mode `read-only` — and the statement
 * that it is the weaker proof. Under `parity` the switch is `none` and no
 * proof is made (row 117).
 */
import { spawnSync } from "node:child_process";
import { DSH_PIN } from "../descriptor/data.ts";
import { CRITIC_PATCH_IDS } from "../critic/patch.ts";

/** The refusal reason when a tool id is not covered (F130-FR-024). */
export const CRITIC_NOT_TOOLLESS = "critic_not_toolless" as const;

/** The switch this module serves (row 117 of annex X §X.7). */
export const CRITIC_PROOF_SWITCH = "harnesses.dsh.critic.proof" as const;

/** The flag of the free introspection: the composed configuration, no model call. */
export const DSH_TOOL_INTROSPECTION_FLAG = "--dump-config" as const;

/** One enumerated coverage check. */
export type CoverageCheck =
  | { readonly ok: true; readonly covered: readonly string[]; readonly checked: number }
  | {
      readonly ok: false;
      readonly reason: typeof CRITIC_NOT_TOOLLESS;
      /** The ids the patch does not cover; empty where the enumeration failed. */
      readonly uncovered: readonly string[];
      readonly message: string;
    };

/** The input of the enumeration: the resolved executable and its profile. */
export type EnumerateInput = {
  readonly binPath: string;
  readonly profile: string;
  /** The environment of the enumeration (DSH_HOME, permission mode, ...). */
  readonly env?: Readonly<Record<string, string>>;
  /** The time limit of the introspection, in milliseconds. */
  readonly timeoutMs?: number;
};

/**
 * F130-FR-024 — enumerates the tool ids the installed harness and its profile
 * expose, free of charge: `<bin> --profile <profile> --dump-config` with
 * standard input closed, standard output read as one JSON document with a
 * `toolIds` array. No model call is made. `null` where the enumeration fails
 * or cannot be read (which refuses the role the same way).
 */
/**
 * The ids of a profile tree as the installed `dsh --dump-config` prints it, one
 * `- id: <name>` per plugin. A plugin the model can call as a tool is one of the deny
 * list's own shape. Null where the output is not such a tree.
 */
export function toolIdsOfTheProfileTree(text: string): readonly string[] | null {
  const ids = [...text.matchAll(/^- id: (\S+)$/gm)].map((match) => match[1] as string);
  if (ids.length === 0) return null;
  return ids.filter(
    (id) =>
      (/^tool-/.test(id) && !NOT_CALLABLE_BY_THE_MODEL.includes(id)) || id === "user-questions",
  );
}

/** Plugins named `tool-` that shape tool calls and offer no tool of their own. */
export const NOT_CALLABLE_BY_THE_MODEL: readonly string[] = Object.freeze(["tool-result-pruner"]);

export function enumerateDshToolIds(input: EnumerateInput): readonly string[] | null {
  const run = spawnSync(input.binPath, ["--profile", input.profile, DSH_TOOL_INTROSPECTION_FLAG], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: input.timeoutMs ?? 10_000,
    shell: false,
    env: input.env,
  });
  if (run.status !== 0 || typeof run.stdout !== "string" || run.stdout.trim() === "") {
    return null;
  }
  const fromTheTree = toolIdsOfTheProfileTree(run.stdout);
  if (fromTheTree !== null) return fromTheTree;
  try {
    const parsed: unknown = JSON.parse(run.stdout);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { toolIds?: unknown }).toolIds)
    ) {
      return null;
    }
    const ids = (parsed as { toolIds: unknown[] }).toolIds;
    return ids.every((id) => typeof id === "string") ? (ids as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * F130-FR-024 — the coverage check: every id the installed harness exposes
 * MUST be covered by the patch. An enumeration that failed (`toolIds ===
 * null`) refuses the role the same way.
 */
export function checkCriticCoverage(
  toolIds: readonly string[] | null,
  patchIds: readonly string[] = CRITIC_PATCH_IDS,
): CoverageCheck {
  if (toolIds === null) {
    return {
      ok: false,
      reason: CRITIC_NOT_TOOLLESS,
      uncovered: [],
      message:
        `pass-loop: ${CRITIC_NOT_TOOLLESS}: the tool ids of the installed dsh could ` +
        `not be enumerated; the coverage of the patch cannot be proved`,
    };
  }
  const uncovered = toolIds.filter((id) => !patchIds.includes(id));
  if (uncovered.length > 0) {
    return {
      ok: false,
      reason: CRITIC_NOT_TOOLLESS,
      uncovered,
      message:
        `pass-loop: ${CRITIC_NOT_TOOLLESS}: the installed dsh exposes tool ids the ` +
        `patch of ${patchIds.length} ids does not cover: ${uncovered.join(", ")}`,
    };
  }
  return { ok: true, covered: patchIds, checked: toolIds.length };
}

/** The four facts of the weaker proof (F130-FR-025), and the statement. */
export type CriticProofRecord =
  | {
      readonly proof: "strict";
      /** Fact 1: the exact version equals the pin. */
      readonly versionPin: typeof DSH_PIN;
      readonly versionMatchesPin: true;
      /** Fact 2: the coverage check passed. */
      readonly toolCoverage: "passed";
      /** Fact 3: the hash of the patch file. */
      readonly patchHash: string;
      /** Fact 4: the exported permission mode. */
      readonly permissionMode: "read-only";
      /** The statement that this is the weaker proof (CQ-182). */
      readonly weakerProof: true;
      readonly statement: "weaker proof";
    }
  | {
      readonly proof: "none";
      /** No proof was made: under `parity` (rows 28 and 117). */
      readonly statement: "no proof was made";
    };

/**
 * F130-FR-025 — builds the record of the proof of one critic call. Under
 * `strict` it holds the four facts and says that it is the weaker proof;
 * under `none` it says that no proof was made.
 */
export function buildCriticProof(
  proof: "strict" | "none",
  facts: { readonly patchHash: string },
): CriticProofRecord {
  if (proof === "none") return { proof: "none", statement: "no proof was made" };
  return {
    proof: "strict",
    versionPin: DSH_PIN,
    versionMatchesPin: true,
    toolCoverage: "passed",
    patchHash: facts.patchHash,
    permissionMode: "read-only",
    weakerProof: true,
    statement: "weaker proof",
  };
}

/**
 * F130-FR-025 — the preflight of the proof: under `strict` the installed
 * version MUST be exactly the pin; any other version refuses the critic role
 * with `critic_not_toolless`.
 */
export function checkCriticVersionPin(version: string | null): CoverageCheck {
  if (version === DSH_PIN) {
    return { ok: true, covered: CRITIC_PATCH_IDS, checked: CRITIC_PATCH_IDS.length };
  }
  return {
    ok: false,
    reason: CRITIC_NOT_TOOLLESS,
    uncovered: [],
    message:
      `pass-loop: ${CRITIC_NOT_TOOLLESS}: the installed dsh version ` +
      `${version ?? "unknown"} is not the pin ${DSH_PIN}; the critic role is refused`,
  };
}
