// T064 (F116-FR-015) — the basic protection, for a toolchain without a
// profile.
//
// Class A holds the executables and the files the check manifest names and
// the files its derivation reads; class B is empty; no cache is handled and no
// marker is counted. The fact that the basic protection applied is recorded
// with the protected set, so that the `[LOOP]` line can say so (annex C,
// §C.14, guarantees of the core).
export interface BasicProtection {
  /** True: no profile applied, the basic protection did. */
  readonly basic: true;
  /** Class A as a list of files: what the manifest names and its derivation reads. */
  readonly classA: readonly string[];
  /** Class B is empty without a profile (F116-FR-015). */
  readonly classB: readonly string[];
  /** No cache is handled (F116-FR-015). */
  readonly cachesHandled: false;
  /** No marker is counted (F116-FR-015). */
  readonly markersCounted: false;
}

/** The basic protection over the files the check manifest names and reads. */
export function basicProtection(input: {
  manifestFiles: readonly string[];
  derivationFiles: readonly string[];
}): BasicProtection {
  const seen = new Set<string>();
  for (const file of [...input.manifestFiles, ...input.derivationFiles]) seen.add(file);
  return {
    basic: true,
    classA: Object.freeze([...seen].sort()),
    classB: Object.freeze([]),
    cachesHandled: false,
    markersCounted: false,
  };
}
