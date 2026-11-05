/**
 * CT-101-32 (T108 of feature 101) — the discovery hook of the own property test.
 *
 * T108 mandates the path `packages/core/test/101/ct-101-32-verdict-parser.property.test.ts`
 * for the property test itself, and that path is where it lives. The own runner
 * `tests/own.ts` discovers a package test of feature 101 by the name
 * `*-101.test.ts`, which that mandated path does not match, so this file carries
 * the matching name and nothing else: it imports the property test, whose four
 * tests then register and run under `npm run test:own -- --feature 101`.
 *
 * The shared runner is deliberately NOT edited: its discovery rule belongs to
 * every feature, not to this one.
 */
import "./101/ct-101-32-verdict-parser.property.test.ts";
