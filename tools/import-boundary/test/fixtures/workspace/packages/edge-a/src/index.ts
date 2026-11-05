// T016 fixture: a PERMITTED import. @specstride/spec-formats (L1) lists
// @specstride/contracts and @specstride/kernel in its mayImport (annex A,
// §A.1), so both imports pass the check.
import type { Lease } from "@specstride/contracts";
import { loadTable } from "@specstride/kernel";

export const a: Lease | undefined = undefined;
export const b = loadTable;
