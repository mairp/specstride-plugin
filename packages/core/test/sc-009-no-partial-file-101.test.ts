/**
 * T101 — the wrapper that makes the own test of F101-SC-009 DISCOVERED by
 * `npm run test:own -- --feature 101`.
 *
 * `tests/own.ts` finds a package test of feature N by the NAME
 * `*-<N>.test.ts`. The path T101 mandates is
 * `packages/core/test/101/sc-009-no-partial-file.test.ts`, which does not match
 * that name, so the test would never run inside a gate command. This file
 * carries the matching name and imports it; the test itself stays at the path
 * the task mandates, and `tests/own.ts` is not touched.
 */
import "./101/sc-009-no-partial-file.test.ts";
