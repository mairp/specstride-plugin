/**
 * T035 — the wrapper that makes the property test of F101-SC-002 DISCOVERED by
 * `npm run test:own -- --feature 101`.
 *
 * `tests/own.ts` finds a package test of feature N by the NAME `*-<N>.test.ts`
 * (`namedTests`, and its test `path.endsWith("-" + number + ".test.ts")`). The
 * path T035 mandates for the property test is
 * `packages/core/test/101/sc-002-approval-order.test.ts`, which does not match
 * that name, so the test would never run inside a gate command. This file
 * carries the matching name and imports it; the property test itself stays at
 * the path the task mandates, byte for byte, and `tests/own.ts` is not
 * touched, because its discovery rule is shared by every feature.
 *
 * The same device carries T108's property test (`ct-101-32-101.test.ts`).
 */
import "./101/sc-002-approval-order.test.ts";
