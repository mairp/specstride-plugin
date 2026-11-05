/**
 * T040 — the conditions of F126-FR-039 as data.
 *
 * No code of this feature tests a harness name: every difference between
 * harnesses is read from the resolved registry (the route), from the
 * `trackTerminal` option of the format row, or from the row of the dialect
 * table that the mapping names (annex C §C.5; CQ-227). This module reads
 * those three and nothing else; a condition is a value of the row, never a
 * comparison against an id, a name or a label of a harness.
 */
import { isCorrelated, type TapContext } from "./tap.ts";
import type { ResolvedRow } from "./registry.ts";

/**
 * The row of the dialect table (annex C §C.5) a format of the JSONL family
 * reads, as data. Where the row carries a value, it decides over the format
 * row (CQ-227).
 */
export type DialectRowData = {
  readonly trackTerminal?: boolean | undefined;
  readonly terminalDecides?: boolean | undefined;
  /** The provider format the dialect names, for the JSONL family. */
  readonly providerFormat?: string | undefined;
};

/** The dialect row a format row reads, where its mapping names one. */
export function dialectRowOf(row: ResolvedRow): string | null {
  return row.reader.type === "mapping" ? (row.reader.dialect ?? null) : null;
}

/**
 * Terminal-tracked (F126-FR-039): `trackTerminal` of the format row, or, for
 * a format of the JSONL family, of the row of the dialect table (CQ-227).
 */
export function terminalTracked(
  row: ResolvedRow | null,
  dialectRow?: DialectRowData | undefined,
): boolean {
  if (row === null) return false;
  if (dialectRowOf(row) !== null && dialectRow?.trackTerminal !== undefined) {
    return dialectRow.trackTerminal;
  }
  return row.trackTerminal;
}

/**
 * The terminal decides (F126-FR-010): `terminalDecides` of the format row or
 * of the dialect row, on the same rule as `terminalTracked`.
 */
export function terminalDecidesFor(
  row: ResolvedRow | null,
  dialectRow?: DialectRowData | undefined,
): boolean {
  if (row === null) return false;
  if (dialectRowOf(row) !== null && dialectRow?.terminalDecides !== undefined) {
    return dialectRow.terminalDecides;
  }
  return row.terminalDecides;
}

/** The path of one pass, read from the route, the row and the dialect row. */
export type PassPath = {
  /** The pass has a route: the entry of the registry names a stream format. */
  readonly routed: boolean;
  /** The route resolved the format to a reader that started. */
  readonly registryRouted: boolean;
  /** The terminal of the pass is tracked (F126-FR-039). */
  readonly terminalTracked: boolean;
  /** True on the correlated path, false on the legacy path. */
  readonly correlated: boolean;
  /** True on the legacy path (the as-is events of the compatibility form). */
  readonly legacy: boolean;
  /**
   * The provider-terminal destination the tap is given: set only where the
   * pass is terminal-tracked (F126-FR-012, F126-FR-031), null elsewhere.
   */
  readonly providerTerminalDestination: string | null;
  /** The provider format: the dialect row of the JSONL family, else the row. */
  readonly providerFormat: string | null;
};

/**
 * The path of one pass (F126-FR-039): correlated and given the
 * provider-terminal destination where the resolved row is terminal-tracked
 * and the identity of the correlated path is present; on the legacy path
 * otherwise. Every input is data of the registry, the dialect row or the
 * context — never a name of a harness.
 */
export function passPathFor(options: {
  readonly row: ResolvedRow | null;
  readonly readerStarted: boolean;
  readonly context: TapContext;
  readonly dialectRow?: DialectRowData | undefined;
}): PassPath {
  const routed = options.row !== null;
  const registryRouted = routed && options.readerStarted;
  const tracked = terminalTracked(options.row, options.dialectRow);
  const correlated = registryRouted && tracked && isCorrelated(options.context);
  return {
    routed,
    registryRouted,
    terminalTracked: tracked,
    correlated,
    legacy: registryRouted && !correlated,
    providerTerminalDestination:
      registryRouted && tracked ? options.context.providerTerminalDestination : null,
    providerFormat:
      options.dialectRow?.providerFormat ?? (options.row === null ? null : options.row.name),
  };
}
