/**
 * `@specstride/config` — the configuration package of the product, layer L1
 * of the package graph (owner 110; it imports `@specstride/contracts` and
 * `@specstride/kernel` only).
 *
 * The tree follows `specs/110-config-and-terms/plan.md`:
 *
 * - `src/schema/`  the catalogue data, its types and the validators (T009)
 * - `src/load/`    the layers, the trust filter, the merge and provenance
 *                  (T016, T017, T019, T020, T026, T027)
 * - `src/secrets/` the `env:`, `file:` and `keychain:` resolvers and the
 *                  registry (T031, T032)
 * - `src/cli/`     `config show` and `config schema` (T018, T020)
 * - `data/`        the shipped data of the package: the `parity` profile, the
 *                  alias table, and the baseline defaults the catalogue is
 *                  checked against (T002, T010, T026)
 * - `tools/`       the generators and probes that are run by hand or by a
 *                  check, never by the product at run time (T001, T002, T004)
 *
 * This file is the single entry point named by `exports` of `package.json`;
 * each task of a later phase adds its own exports here.
 */
export * from "./schema/index.ts";
export * from "./load/index.ts";
export * from "./secrets/index.ts";
export * from "./cli/index.ts";
