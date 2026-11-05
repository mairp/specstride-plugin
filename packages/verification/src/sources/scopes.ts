/**
 * T148 — the INTAKE of declared reads and writes, from the launch contract and
 * from nowhere else (F105-FR-016, F105-FR-020; CQ-190, `research.md` D-18).
 *
 * Two halves of one rule, and they are in two folders because they act at two
 * places:
 *
 *  - `./commands-document.ts` REFUSES `reads`, `writes` and `sideEffects` from
 *    repository text, with a finding that names the command and the line;
 *  - this module takes them IN from the launch contract (feature 100, annex G,
 *    `configuration.scopes`) — and only where the recorded provenance of the
 *    declaration is user configuration, the environment or a flag. A
 *    declaration from repository text, and one WITHOUT that provenance, does
 *    not enter: the manifest entry then has no `reads` and no `writes` and is
 *    undeclared, which means SERIAL (annex D §D.8; F100-FR-099).
 *
 * The three provenances that count are the contract's
 * (`PROVENANCES_THAT_COUNT_AS_DECLARED` of EP-07) and are never retyped here.
 */
import { PROVENANCES_THAT_COUNT_AS_DECLARED } from "@specstride/contracts/ep/verification-source";

/** The three provenances a declaration must carry to count (CQ-190). */
export const PROVENANCES_THAT_COUNT = PROVENANCES_THAT_COUNT_AS_DECLARED;
export type ProvenanceThatCounts = (typeof PROVENANCES_THAT_COUNT)[number];

/** Where the declarations of a run live: annex G, `configuration.scopes`. */
export const SCOPES_PLACE = "configuration.scopes" as const;
/** The annex that owns the launch contract. */
export const SCOPES_ANNEX = "annex G" as const;

/** An undeclared entry runs SERIAL (annex D §D.8, F100-FR-099). */
export const UNDECLARED_MEANS_SERIAL = true as const;

/**
 * One declaration of the reads and the writes of a verification command, as
 * `configuration.scopes` of the launch contract records it: the lists, and the
 * SOURCE the record keeps beside them.
 */
export type ScopeDeclaration = {
  readonly reads?: readonly string[];
  readonly writes?: readonly string[];
  readonly resource?: string;
  /** The recorded provenance of the declaration (annex G). */
  readonly source: string;
};

/** `configuration.scopes` as this feature reads it: one entry per command. */
export type LaunchContractScopes = {
  /** Declared reads and writes of verification commands, by command id. */
  readonly verificationCommands?: Readonly<Record<string, ScopeDeclaration>>;
};

/** True where a recorded provenance is one of the three that count. */
export function provenanceCounts(source: string): boolean {
  return (PROVENANCES_THAT_COUNT as readonly string[]).includes(source);
}

/** What enters a manifest entry: the two lists, or neither (F105-FR-020). */
export type DeclaredScope = {
  readonly reads?: readonly string[];
  readonly writes?: readonly string[];
  readonly resource?: string;
};

/** Nothing enters: the entry is undeclared, which means serial. */
export const UNDECLARED: DeclaredScope = Object.freeze({});

/**
 * The declared reads and writes of one command, from the launch contract
 * (F105-FR-020). A declaration whose recorded provenance is NOT user
 * configuration, the environment or a flag gives `UNDECLARED`, and so does a
 * command the launch contract names nothing for.
 */
export function declaredScopeOf(input: {
  readonly scopes: LaunchContractScopes | undefined;
  readonly commandId: string;
}): DeclaredScope {
  const declaration = input.scopes?.verificationCommands?.[input.commandId];
  if (declaration === undefined) return UNDECLARED;
  if (!provenanceCounts(declaration.source)) return UNDECLARED;
  const scope: { reads?: readonly string[]; writes?: readonly string[]; resource?: string } = {};
  if (declaration.reads !== undefined) scope.reads = Object.freeze([...declaration.reads]);
  if (declaration.writes !== undefined) scope.writes = Object.freeze([...declaration.writes]);
  if (declaration.resource !== undefined) scope.resource = declaration.resource;
  return Object.freeze(scope);
}

/** True where an entry is undeclared, which means it runs serial. */
export function isUndeclared(scope: DeclaredScope): boolean {
  return scope.reads === undefined && scope.writes === undefined;
}

/**
 * The reason a declaration did not enter, for the record a reader of the
 * manifest needs: it names the provenance that was recorded and the three that
 * would have counted.
 */
export function reasonADeclarationDidNotEnter(source: string): string {
  return (
    `the declared reads and writes are not taken over: the recorded provenance is ` +
    `\`${source}\`, and only ${PROVENANCES_THAT_COUNT.map((one) => `\`${one}\``).join(", ")} ` +
    "count as declared (F105-FR-020, CQ-190); the entry is undeclared, which means serial"
  );
}
