/**
 * T019 — the source `declared` (F146-FR-002, F146-FR-010): entries the
 * consumer declared.
 *
 * An entry the consumer declared is accepted from user configuration, the
 * environment, flags and the bundled data of the product ONLY. A harness
 * declaration, an endpoint or a secret reference in PROJECT configuration
 * is IGNORED, with a launch message that names the key and with a doctor
 * warning. The message is one line of at most 200 bytes, on the grammar of
 * `contracts/output-lines.json`, and it is NOT printed under the `parity`
 * profile (the caller decides that; the line is data either way).
 */
import { makeCandidate } from "../candidate.ts";
import type { Candidate, CandidateFinding } from "../types.ts";

/** The source this reader reads. */
export const DECLARED_SOURCE = "declared" as const;

/** The prefix of the one product line of this feature (output-lines.json). */
export const LINE_LABEL = "SPECSTRIDE-DISCOVERY" as const;

/** The longest the line may be (F146-FR-010). */
export const LINE_BYTE_LIMIT = 200;

/** An entry the consumer declared, from a scope that is accepted. */
export type ConsumerDeclaration = {
  readonly id: string;
  readonly kind: string;
  /** The state the declaration gives; `declared` unless it names an adapter. */
  readonly state?: "declared" | "tested";
  readonly baseUrl?: string;
  readonly modelsPath?: string;
  readonly credentialReference?: string | null;
  readonly termsRef?: string | null;
};

/** A project configuration this reader was handed, to be ignored. */
export type ProjectConfiguration = {
  readonly scope: "project";
  readonly values: Readonly<Record<string, unknown>>;
};

/**
 * The one line for an ignored entry (F146-FR-010): one line, it names the
 * key, and it is at most 200 bytes.
 */
export function ignoredEntryLine(key: string): string {
  const line = `${LINE_LABEL} ignored=${key} reason=project-configuration-is-not-accepted (F146-FR-010)`;
  let cut = line;
  while (Buffer.byteLength(cut, "utf8") > LINE_BYTE_LIMIT - 4) {
    cut = cut.slice(0, -8);
  }
  return cut === line ? line : `${cut}…`;
}

/** True where a key of a project configuration is a declaration to ignore. */
export function isDeclarationKey(key: string): boolean {
  return /(^|\.)(harnesses|harness|endpoint|endpoints|secrets|secret|credentials|credential)(\.|$)/i.test(
    key,
  );
}

/** The keys of a project configuration that hold a declaration to ignore. */
export function declarationKeysOf(values: Readonly<Record<string, unknown>>): readonly string[] {
  const keys: string[] = [];
  const walk = (prefix: string, node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    for (const [name, child] of Object.entries(node as Record<string, unknown>)) {
      const key = prefix === "" ? name : `${prefix}.${name}`;
      if (isDeclarationKey(key) && prefix !== "") {
        // One line per entry the configuration declares: the entry is the
        // key that matched, and nothing inside it is walked. A top-level
        // section name only leads to its entries.
        keys.push(key);
        continue;
      }
      walk(key, child);
    }
  };
  walk("", values);
  return keys;
}

/** The reader of the source `declared`. */
export function readDeclaredSource(deps: {
  readonly declarations: readonly ConsumerDeclaration[];
  /** Project configuration, where the run was handed one; it is ignored. */
  readonly projectConfig?: ProjectConfiguration;
}): {
  readonly candidates: readonly Candidate[];
  /** The launch messages, one per ignored entry, each at most 200 bytes. */
  readonly lines: readonly string[];
  /** The doctor warnings, one per ignored entry. */
  readonly findings: readonly CandidateFinding[];
} {
  const lines: string[] = [];
  const findings: CandidateFinding[] = [];
  if (deps.projectConfig !== undefined) {
    for (const key of declarationKeysOf(deps.projectConfig.values)) {
      const line = ignoredEntryLine(key);
      lines.push(line);
      findings.push({ code: "declared-entry-ignored", message: line });
    }
  }
  const candidates = deps.declarations.map((declaration) =>
    makeCandidate({
      id: declaration.id,
      sources: [DECLARED_SOURCE],
      state: declaration.state ?? "declared",
      origin: "user",
      kind: declaration.kind,
      endpoint:
        declaration.baseUrl === undefined
          ? null
          : endpointOfDeclaration(declaration.baseUrl, declaration.modelsPath),
      provider: declaration.baseUrl === undefined ? null : hostOf(declaration.baseUrl),
      credential: "unprobed",
      termsRef: declaration.termsRef ?? null,
    }),
  );
  return { candidates, lines, findings };
}

function endpointOfDeclaration(baseUrl: string, modelsPath?: string) {
  try {
    const parsed = new URL(baseUrl);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    const path = parsed.pathname === "/" ? (modelsPath ?? "") : parsed.pathname;
    return {
      scheme: parsed.protocol.replace(/:$/, ""),
      host: parsed.hostname,
      path: path === "" ? null : path.replace(/\/+$/, "") || null,
    };
  } catch {
    return null;
  }
}

function hostOf(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return null;
  }
}
