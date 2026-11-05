/**
 * T003 — the build check that `src/codes.ts` equals `data/finding-codes.json`
 * (F140-FR-003; F140-SC-001).
 *
 * The closed family of finding codes is fixed by the contract
 * `specs/140-reverse-inventory-and-lint/contracts/finding-codes.json`, copied
 * byte for byte into `data/finding-codes.json`. `src/codes.ts` is the
 * TypeScript face of that file. This module is the check that the two agree,
 * and it is wired into the build three ways:
 *
 *   - `npm run check:codes --workspace @specstride/reverse` runs this file as
 *     a program: it prints every difference and exits 1, or prints one line
 *     and exits 0;
 *   - `npm run check:codes` at the root fans the same script over the
 *     workspace, and the root `test` script runs it;
 *   - `packages/reverse/test/140/setup-140.test.ts` asserts it has no
 *     findings, so `npm test --workspaces` fails on a divergence too.
 *
 * It compares three things, so neither half can drift alone:
 *
 *   1. the rows — the set, the ORDER, the severity and the level string of
 *      every code, against the JSON;
 *   2. the `FindingCode` union of the source TEXT — a row added to
 *      `FINDING_CODES` without its member of the union, or the reverse, is a
 *      difference even though both compile;
 *   3. the schema id, the owner and the count the module declares.
 *
 * It reads the JSON from disk at every call and never caches it: the file is
 * the authority, and this module holds no copy of the family.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FINDING_CODES,
  FINDING_CODE_COUNT,
  FINDING_CODES_CONTRACT,
  FINDING_CODES_OWNER,
  FINDING_CODES_SCHEMA,
  type FindingCodeRow,
} from "../codes.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The root of the package: two levels up from `src/lint/`. */
export const PACKAGE_ROOT = join(HERE, "..", "..");

/** The copy of the contract inside the package, the subject of the check. */
export const CONTRACT_FILE = join(PACKAGE_ROOT, FINDING_CODES_CONTRACT);

/** The module the contract is checked against. */
export const CODES_FILE = join(PACKAGE_ROOT, "src/codes.ts");

/** The shape of `data/finding-codes.json`. */
interface Contract {
  readonly schema?: unknown;
  readonly owner?: unknown;
  readonly codes?: readonly { code?: unknown; severity?: unknown; levels?: unknown }[];
}

/** Where the two files are read from, overridable so a test can point elsewhere. */
export interface CodesCheckOptions {
  /** The contract file to read; `data/finding-codes.json` of this package by default. */
  readonly contractFile?: string;
  /** The module file whose text is read for the union; `src/codes.ts` by default. */
  readonly codesFile?: string;
  /** The rows to compare; those of `src/codes.ts` by default. */
  readonly rows?: readonly FindingCodeRow[];
}

/**
 * Every difference between `src/codes.ts` and `finding-codes.json`, each one
 * line. Empty when the two agree, which is the only state the build accepts.
 */
export function differencesFromTheContract(options: CodesCheckOptions = {}): readonly string[] {
  const contractFile = options.contractFile ?? CONTRACT_FILE;
  const codesFile = options.codesFile ?? CODES_FILE;
  const rows = options.rows ?? FINDING_CODES;
  const differences: string[] = [];

  let contract: Contract;
  try {
    contract = JSON.parse(readFileSync(contractFile, "utf8")) as Contract;
  } catch (error) {
    return Object.freeze([`the contract ${contractFile} cannot be read as JSON: ${String(error)}`]);
  }

  // (3) the identity of the contract the module declares it is a face of.
  if (contract.schema !== FINDING_CODES_SCHEMA) {
    differences.push(
      `schema: src/codes.ts declares "${FINDING_CODES_SCHEMA}", the contract carries ` +
        `"${String(contract.schema)}"`,
    );
  }
  if (String(contract.owner) !== FINDING_CODES_OWNER) {
    differences.push(
      `owner: src/codes.ts declares "${FINDING_CODES_OWNER}", the contract carries ` +
        `"${String(contract.owner)}"`,
    );
  }

  const contractRows = contract.codes ?? [];
  if (rows.length !== contractRows.length) {
    differences.push(
      `count: src/codes.ts holds ${rows.length} codes, the contract holds ` +
        `${contractRows.length}`,
    );
  }
  if (FINDING_CODE_COUNT !== contractRows.length) {
    differences.push(
      `FINDING_CODE_COUNT is ${FINDING_CODE_COUNT}, the contract holds ` +
        `${contractRows.length} codes`,
    );
  }

  // (1) the rows, in order: the set, the severity and the level string.
  const inModule = rows.map((row) => row.code);
  const inContract = contractRows.map((row) => String(row.code));
  for (const code of inContract) {
    if (!inModule.includes(code as FindingCodeRow["code"])) {
      differences.push(`missing from src/codes.ts: the contract code "${code}"`);
    }
  }
  for (const code of inModule) {
    if (!inContract.includes(code)) {
      differences.push(`not in the contract: src/codes.ts holds the code "${code}"`);
    }
  }
  const shared = Math.min(rows.length, contractRows.length);
  for (let i = 0; i < shared; i++) {
    const mine = rows[i] as FindingCodeRow;
    const theirs = contractRows[i] as { code?: unknown; severity?: unknown; levels?: unknown };
    if (mine.code !== String(theirs.code)) {
      differences.push(
        `order: row ${i} of src/codes.ts is "${mine.code}", of the contract ` +
          `"${String(theirs.code)}"`,
      );
      continue;
    }
    if (mine.severity !== String(theirs.severity)) {
      differences.push(
        `severity of "${mine.code}": src/codes.ts says "${mine.severity}", the contract ` +
          `"${String(theirs.severity)}"`,
      );
    }
    if (mine.levels !== String(theirs.levels)) {
      differences.push(
        `levels of "${mine.code}": src/codes.ts says "${mine.levels}", the contract ` +
          `"${String(theirs.levels)}"`,
      );
    }
  }

  // (2) the `FindingCode` union of the source text, so the type cannot drift
  // from the data even though both halves compile.
  let source: string;
  try {
    source = readFileSync(codesFile, "utf8");
  } catch (error) {
    differences.push(`the module ${codesFile} cannot be read: ${String(error)}`);
    return Object.freeze(differences);
  }
  const union = unionMembers(source);
  if (union === undefined) {
    differences.push(`src/codes.ts holds no \`export type FindingCode =\` union`);
  } else {
    for (const code of inContract) {
      if (!union.includes(code)) {
        differences.push(`the FindingCode union of src/codes.ts omits "${code}"`);
      }
    }
    for (const member of union) {
      if (!inContract.includes(member)) {
        differences.push(
          `the FindingCode union of src/codes.ts holds "${member}", not a contract code`,
        );
      }
    }
  }

  return Object.freeze(differences);
}

/**
 * The members of the `FindingCode` union of the module's source text, in the
 * order they are written. `undefined` where the union is not there at all.
 */
export function unionMembers(source: string): readonly string[] | undefined {
  const start = source.indexOf("export type FindingCode =");
  if (start < 0) return undefined;
  const end = source.indexOf(";", start);
  if (end < 0) return undefined;
  const body = source.slice(start, end);
  return Object.freeze([...body.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string));
}

/** The error the check throws, carrying every difference it found. */
export class FindingCodesDivergeFromTheContractError extends Error {
  readonly differences: readonly string[];
  constructor(differences: readonly string[]) {
    super(
      `src/codes.ts and ${FINDING_CODES_CONTRACT} differ in ${differences.length} ` +
        `way(s):\n  - ${differences.join("\n  - ")}`,
    );
    this.name = "FindingCodesDivergeFromTheContractError";
    this.differences = Object.freeze([...differences]);
  }
}

/** Throws unless `src/codes.ts` equals `finding-codes.json`. */
export function checkCodesEqualTheContract(options: CodesCheckOptions = {}): void {
  const differences = differencesFromTheContract(options);
  if (differences.length > 0) throw new FindingCodesDivergeFromTheContractError(differences);
}

/** The program: one line and exit 0, or every difference and exit 1. */
export function main(): number {
  const differences = differencesFromTheContract();
  if (differences.length === 0) {
    process.stdout.write(
      `check:codes: src/codes.ts equals ${FINDING_CODES_CONTRACT} ` +
        `(${FINDING_CODES.length} codes of ${FINDING_CODES_SCHEMA})\n`,
    );
    return 0;
  }
  process.stderr.write(
    `check:codes: src/codes.ts and ${FINDING_CODES_CONTRACT} differ in ` +
      `${differences.length} way(s):\n`,
  );
  for (const difference of differences) process.stderr.write(`  - ${difference}\n`);
  return 1;
}

// Run as a program only when this file IS the entry point, so an import of the
// check never exits the importer's process.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
