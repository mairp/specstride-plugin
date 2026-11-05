/**
 * T006 — the precise type of `src/model/view.ts` and the type the generator of
 * `@specstride/contracts` derives from `schemas/run-view.schema.json` describe
 * the same record. The generator writes `unknown` where a schema uses `const`
 * or `oneOf`, so the check is that every field of the generated type is a field
 * of the precise one, and that the precise one is assignable where the
 * generated type is concrete.
 */
import type { RunView as GeneratedRunView } from "@specstride/contracts/records/run-view";
import type { RunView } from "./view.ts";

/** Every key of the generated type is a key of the precise type. */
export type GeneratedKeysArePreciseKeys = keyof GeneratedRunView extends keyof RunView
  ? true
  : never;

/** Every key of the precise type is a key of the generated type. */
export type PreciseKeysAreGeneratedKeys = keyof RunView extends keyof GeneratedRunView
  ? true
  : never;

export const generatedKeysArePreciseKeys: GeneratedKeysArePreciseKeys = true;
export const preciseKeysAreGeneratedKeys: PreciseKeysAreGeneratedKeys = true;
