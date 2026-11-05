/**
 * The prerequisite of a parity test of feature 110.
 *
 * A parity test compares the port with the reference trees of the oracle of
 * feature 141 on a fixture family. Feature 141 is not built yet; until it is, the
 * reference half of every parity test here reports a SKIP with its reason and
 * never a pass (the constitution, principle XVII; `quickstart.md` of feature 141,
 * "a test whose prerequisite is missing reports a skip with its reason, never a
 * pass").
 *
 * The table-level half of each test — what the port's own tables must say for the
 * comparison to be possible at all — runs now and is not skipped. The rule is the
 * same one feature 100's `tests/parity/100/oracle.ts` applies; it is restated here
 * rather than imported, because `packages/config` is a package of the workspace and
 * its test tree does not reach outside the package.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The root of the repository: five levels up from `packages/config/tests/parity`. */
export const ROOT = resolve(
  dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))),
);

/** Where the oracle of feature 141 lives when it is built. */
export const ORACLE_PACKAGE = "packages/oracle";

/** Where its reference trees live. */
export const REFERENCE_TREES = "tests/parity/reference";

/**
 * True when `packages/oracle` holds the oracle itself and not the skeleton of the
 * campaign scaffolding (`"specstride": { "skeleton": true }` in its manifest).
 */
function oraclePackagePresent(root: string): boolean {
  const manifest = join(root, ORACLE_PACKAGE, "package.json");
  if (!existsSync(manifest)) return existsSync(join(root, ORACLE_PACKAGE));
  const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
    specstride?: { skeleton?: unknown };
  };
  return parsed.specstride?.skeleton !== true;
}

/** True when the oracle of feature 141 and its reference trees are present. */
export function oracleIsAvailable(root: string = ROOT): boolean {
  return oraclePackagePresent(root) && existsSync(join(root, REFERENCE_TREES));
}

/** The reason a parity test skips its reference half, with the families named. */
export function skipReasonFor(families: readonly string[], root: string = ROOT): string {
  const missing: string[] = [];
  if (!oraclePackagePresent(root)) missing.push(`\`${ORACLE_PACKAGE}\``);
  if (!existsSync(join(root, REFERENCE_TREES))) missing.push(`\`${REFERENCE_TREES}\``);
  return (
    `prerequisite missing: the parity oracle of feature 141 (${missing.join(" and ")}) is not ` +
    `built, so the fixture families ${families.join(", ")} cannot be run against the reference. ` +
    `This is a SKIP with its reason and never a pass (the constitution, principle XVII).`
  );
}

/** The option bag a parity test passes to `test()` for its reference half. */
export function referenceHalfFor(
  families: readonly string[],
  root: string = ROOT,
): { skip: string | false } {
  return oracleIsAvailable(root) ? { skip: false } : { skip: skipReasonFor(families, root) };
}
