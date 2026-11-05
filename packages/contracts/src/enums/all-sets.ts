/**
 * T257 — assemble the closed sets (annex X, §X.6; F100-FR-208, F100-FR-209;
 * F100-SC-007).
 *
 * The seven batch files of T250 to T256 register their sets in the map of
 * T070 at load. This module imports all seven, then asserts at load that the
 * map holds exactly the 285 numbers of `data/closed-sets.json`, each once,
 * with the name of its row, and exports the map as `closedSets`.
 *
 * The count is pinned: `CLOSED_SET_COUNT` is the literal 285 of T257, and the
 * assertion refuses a data file that holds any other number of rows, so
 * neither the map nor the table can drift from it.
 */
import { ALL_SET_NUMBERS, registeredSets, rowOf, type ClosedSet } from "./index.ts";
import * as sets_100_104 from "./sets-100-104.ts";
import * as sets_105_109 from "./sets-105-109.ts";
import * as sets_110_119 from "./sets-110-119.ts";
import * as sets_120_125 from "./sets-120-125.ts";
import * as sets_126_129 from "./sets-126-129.ts";
import * as sets_130_144 from "./sets-130-144.ts";
import * as sets_145_149 from "./sets-145-149.ts";

// The seven batch files are imported for their registration at load.
const BATCHES = [
  sets_100_104,
  sets_105_109,
  sets_110_119,
  sets_120_125,
  sets_126_129,
  sets_130_144,
  sets_145_149,
];
void BATCHES;

/** A set the map holds that the table does not, or the other way round. */
export class ClosedSetAssemblyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClosedSetAssemblyError";
  }
}

/** The 285 numbers of the table of §X.6 that T257 pins. */
const CLOSED_SETS_OF_THE_TABLE = 285;

function assemble(): ReadonlyMap<number, ClosedSet> {
  const map = registeredSets();
  // The pinned count of T257: the table holds exactly 285 rows, each number once.
  if (ALL_SET_NUMBERS.length !== CLOSED_SETS_OF_THE_TABLE) {
    throw new ClosedSetAssemblyError(
      `\`data/closed-sets.json\` holds ${ALL_SET_NUMBERS.length} rows; annex X §X.6 holds ` +
        `the ${CLOSED_SETS_OF_THE_TABLE} closed sets of the product (F100-FR-208)`,
    );
  }
  if (new Set(ALL_SET_NUMBERS).size !== CLOSED_SETS_OF_THE_TABLE) {
    throw new ClosedSetAssemblyError(
      `\`data/closed-sets.json\` holds a number twice; the ${CLOSED_SETS_OF_THE_TABLE} ` +
        `numbers of annex X §X.6 each stand once (F100-FR-208)`,
    );
  }
  if (map.size !== CLOSED_SETS_OF_THE_TABLE) {
    throw new ClosedSetAssemblyError(
      `the \`contracts\` package exports ${map.size} closed sets; the map holds exactly ` +
        `the ${CLOSED_SETS_OF_THE_TABLE} numbers of annex X §X.6, each once ` +
        `(F100-FR-208, F100-FR-209)`,
    );
  }
  const missing = ALL_SET_NUMBERS.filter((n) => !map.has(n));
  if (missing.length > 0) {
    throw new ClosedSetAssemblyError(
      `the closed sets ${missing.join(", ")} of annex X §X.6 have no export in the ` +
        `\`contracts\` package (F100-FR-208, F100-FR-209)`,
    );
  }
  const extra = [...map.keys()].filter((n) => !ALL_SET_NUMBERS.includes(n));
  if (extra.length > 0) {
    throw new ClosedSetAssemblyError(
      `the closed sets ${extra.join(", ")} are exported by the package and have no row ` +
        `in annex X §X.6 (F100-FR-208, F100-FR-209)`,
    );
  }
  for (const number of ALL_SET_NUMBERS) {
    const set = map.get(number);
    const row = rowOf(number);
    if (set === undefined || row === undefined) continue;
    if (set.name !== row.name) {
      throw new ClosedSetAssemblyError(
        `the closed set ${number} is exported as "${set.name}" and its row of annex X ` +
          `§X.6 is "${row.name}" (F100-FR-208)`,
      );
    }
  }
  return map;
}

/** Every closed set of the product, keyed by the number of its row of §X.6. */
export const closedSets: ReadonlyMap<number, ClosedSet> = assemble();

/** The number of sets the package exports: the 285 rows of the table (T257). */
export const CLOSED_SET_COUNT: 285 = CLOSED_SETS_OF_THE_TABLE;

/** The set of a number, or `undefined` where the table holds none. */
export function closedSet(number: number): ClosedSet | undefined {
  return closedSets.get(number);
}

/** The set of a name, or `undefined`. */
export function closedSetByName(name: string): ClosedSet | undefined {
  for (const set of closedSets.values()) if (set.name === name) return set;
  return undefined;
}

export * from "./sets-100-104.ts";
export * from "./sets-105-109.ts";
export * from "./sets-110-119.ts";
export * from "./sets-120-125.ts";
export * from "./sets-126-129.ts";
export * from "./sets-130-144.ts";
export * from "./sets-145-149.ts";
