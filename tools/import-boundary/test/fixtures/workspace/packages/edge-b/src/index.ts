// T016 fixture: a FORBIDDEN import. @specstride/view (L6) lists
// @specstride/contracts only in its mayImport (annex A, §A.1), so this
// import of @specstride/kernel fails the check with the file, the import
// and the rule id LR-1.
import { evaluateTable } from "@specstride/kernel";

export const c = evaluateTable;
