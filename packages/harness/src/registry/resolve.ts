/**
 * The resolution of a harness reference (T033; F109-FR-008).
 *
 * A harness reference (`id` or `id:qualifier`) is resolved through the
 * registry and through nothing else. A reference with a qualifier matches no
 * entry when the entry has the qualifier form `none`; the message names the
 * spellings that the registry offers. There is no fallback from one
 * transport to another when a call fails — the transport is the consumer's
 * choice alone (F109-FR-011), so resolution reports the chosen transport or
 * refuses, and never substitutes another.
 */
import { chooseTransport, type TransportChoice } from "../transports/transports.ts";
import { type HarnessRegistry } from "./registry.ts";
import { display } from "./display.ts";

/** A resolved reference: the entry, its qualifier, the chosen transport. */
export type ResolvedReference = {
  ok: true;
  entryId: string;
  qualifier: string | null;
  transport: TransportChoice;
};

/** Why a reference does not resolve. */
export type ResolutionRefusal = {
  ok: false;
  /** 1: unknown entry or a qualifier on the form `none`. */
  exit_code: 1;
  stderr: string;
};

export type ReferenceResolution = ResolvedReference | ResolutionRefusal;

/**
 * Resolves REFERENCE (`id` or `id:qualifier`) for ROLE through the registry.
 * A bare id matches the entry of that id; an id with a qualifier matches no
 * entry where the entry takes none — which is a refusal whose message names
 * the spellings the registry offers for the role.
 */
export function resolveReference(
  registry: HarnessRegistry,
  reference: string,
  options: { role?: string; transport?: string | null } = {},
): ReferenceResolution {
  const colon = reference.indexOf(":");
  const bare = colon === -1 ? reference : reference.slice(0, colon);
  const qualifier = colon === -1 ? null : reference.slice(colon + 1);
  const role = options.role ?? "proposer";
  const entry = registry.find(bare);
  if (entry === null) {
    return {
      ok: false,
      exit_code: 1,
      stderr: `unknown harness: ${bare} (available: ${display(registry, role as "proposer" | "critic") || "none"})`,
    };
  }
  const served = entry.roles[role];
  if (!served?.served) {
    return {
      ok: false,
      exit_code: 1,
      stderr: `harness ${bare} does not serve the role ${role} (available: ${display(registry, role as "proposer" | "critic") || "none"})`,
    };
  }
  if (qualifier !== null && served.form === "none") {
    return {
      ok: false,
      exit_code: 1,
      stderr: `harness ${bare} takes no qualifier (available: ${display(registry, role as "proposer" | "critic") || "none"})`,
    };
  }
  const transport = chooseTransport(entry.id, entry.transports, options.transport ?? null);
  return { ok: true, entryId: entry.id, qualifier, transport };
}
