/**
 * Phase 1 of feature 105, T001, T003 and T004: the package of verification,
 * its manifest and TypeScript configuration, the folders of `plan.md`, the
 * data files of discovery read from the Specstride baseline, and the
 * contracts data copied from the specification.
 *
 * Every assertion reads the FILE SYSTEM — the independent read path — and
 * records a content hash, so the state is observed and not declared. A folder
 * that exists but whose index module cannot load does not pass: the test
 * imports every index module.
 *
 * T004 and Principle XVII: the `specs/` tree is local and outside the git
 * index since 2026-09-30. Where it is absent, the comparison against the
 * specification is reported as a SKIP with its reason — never as a pass. The
 * checks that need no `specs/` tree (the copies parse, they carry a schema
 * id, `data/` holds exactly the expected files) still run.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The package root: one level up from `test/`. */
export const PACKAGE_ROOT = join(HERE, "..");
/** The repository root: three levels up from `packages/verification/test`. */
export const ROOT = join(HERE, "..", "..", "..");

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * T001 — the ten folders of `src/` that `plan.md`, "Project Structure",
 * names.
 */
export const SOURCE_FOLDERS = [
  "src/mode",
  "src/plan",
  "src/sources",
  "src/manifest",
  "src/render",
  "src/gate",
  "src/prestage",
  "src/summary",
  "src/staleness",
  "src/cli",
] as const;

/** T003 — the data files read from the Specstride baseline at `9cab15d`. */
export const BASELINE_DATA_FILES = ["discovery.json", "word-lists.json"] as const;

/** T004 — the contracts data of `specs/105-verification/contracts/`. */
export const CONTRACT_DATA_FILES = [
  "closed-sets.json",
  "parity-rows.json",
  "as-is-literals.json",
  "verify-cli.json",
] as const;

/** The contracts folder of the specification; it may be absent (Principle XVII). */
const SPEC_CONTRACTS = join(ROOT, "specs/105-verification/contracts");

// ---------------------------------------------------------------------------
// T001 — the package, its manifest, its TypeScript configuration, its folders
// ---------------------------------------------------------------------------

test("T001: the package of verification holds the folders of plan.md", () => {
  for (const folder of [...SOURCE_FOLDERS, "data", "test"]) {
    const directory = join(PACKAGE_ROOT, folder);
    assert.equal(statSync(directory).isDirectory(), true, `${folder} is a directory`);
    assert.ok(readdirSync(directory).length > 0, `${folder} is not empty`);
  }
  // A folder of `src/` carries its index module, and the module has a hash.
  for (const folder of SOURCE_FOLDERS) {
    const index = join(PACKAGE_ROOT, folder, "index.ts");
    assert.equal(statSync(index).isFile(), true, `${folder}/index.ts is a file`);
    assert.match(sha256(index), /^[0-9a-f]{64}$/, `${folder}/index.ts has a content hash`);
  }
});

test("T001: every index module of src/ loads, and the package index re-exports them", async () => {
  for (const folder of SOURCE_FOLDERS) {
    const module = (await import(join(PACKAGE_ROOT, folder, "index.ts"))) as object;
    assert.equal(typeof module, "object", `${folder}/index.ts loads`);
  }
  const index = readFileSync(join(PACKAGE_ROOT, "src/index.ts"), "utf8");
  for (const folder of SOURCE_FOLDERS) {
    const relative = `./${folder.slice("src/".length)}/index.ts`;
    assert.ok(index.includes(relative), `src/index.ts re-exports ${relative}`);
  }
  const entry = (await import(join(PACKAGE_ROOT, "src/index.ts"))) as object;
  assert.equal(typeof entry, "object", "the package entry point loads");
});

test("T001: the manifest names the package, the layer L1, the owner 105 and the two imports", () => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    name: string;
    license: string;
    type: string;
    exports: Record<string, string>;
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    specstride?: { skeleton?: boolean; layer?: string; owner?: string; extensionPoint?: string };
  };
  assert.equal(manifest.name, "@specstride/verification");
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.exports["."], "./src/index.ts");
  assert.equal(manifest.specstride?.layer, "L1", "the package is of layer L1");
  assert.match(manifest.specstride?.owner ?? "", /105/, "feature 105 owns it");
  assert.equal(manifest.specstride?.extensionPoint, "EP-07", "it owns the content of EP-07");
  // `skeleton` STAYS true while the campaign runs, as it does on every other
  // package of the workspace. It is the owner's cross-feature marker for
  // which packages are inside the acceptance surface of feature 100 — not a
  // claim that this one is empty. Removing it puts this package into
  // `packagesUnderTest` of `packages/testkit/test/acceptance-core.test.ts`,
  // whose expected list feature 100 owns, and fails a test of another
  // feature. The marker is dropped when that owner drops it.
  assert.equal(manifest.specstride?.skeleton, true, "the campaign's skeleton marker stays");
  // The two imports of the product, and nothing else (T002).
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    "@specstride/contracts",
    "@specstride/kernel",
  ]);
  // The package runs its own unit tests, under the isolation wrapper.
  assert.match(manifest.scripts["test"] ?? "", /tests\/isolate\.ts/);
  assert.equal(manifest.scripts["typecheck"], "tsc -p .");
});

test("T001: the TypeScript configuration extends the base and covers src and test", () => {
  const config = JSON.parse(readFileSync(join(PACKAGE_ROOT, "tsconfig.json"), "utf8")) as {
    extends: string;
    include: string[];
  };
  assert.equal(config.extends, "../../tsconfig.base.json");
  assert.deepEqual([...config.include].sort(), ["src", "test"]);
  assert.equal(statSync(join(ROOT, "tsconfig.base.json")).isFile(), true);
});

// ---------------------------------------------------------------------------
// T003 — the data files of discovery and of the word lists
// ---------------------------------------------------------------------------

test("T003: data/discovery.json carries the toolchains of F105-FR-017 with their time limits", () => {
  const path = join(PACKAGE_ROOT, "data/discovery.json");
  assert.match(sha256(path), /^[0-9a-f]{64}$/, "the data file has a content hash");
  const data = JSON.parse(readFileSync(path, "utf8")) as {
    schema: string;
    baseline: { repository: string; commit: string; file: string };
    toolchains: {
      id: string;
      entryPoints: { script?: string; kind: string; timeoutSec: number }[];
    }[];
    fingerprintFiles: string[];
    ambiguities: Record<string, string>;
  };
  assert.equal(data.schema, "specstride.verification-discovery/1");
  // The provenance of the data: the Specstride baseline, read with `git show`.
  assert.equal(data.baseline.commit, "9cab15d");
  assert.equal(data.baseline.file, "lib/verification_plan.py");

  const byId = new Map(data.toolchains.map((chain) => [chain.id, chain]));
  assert.deepEqual([...byId.keys()], ["node", "python", "rust", "go"]);

  // Node: the four scripts and the four time limits of F105-FR-017.
  const node = byId.get("node");
  assert.ok(node !== undefined);
  assert.deepEqual(
    node.entryPoints.map((point) => [point.script, point.kind, point.timeoutSec]),
    [
      ["test", "test", 1800],
      ["build", "build", 1800],
      ["lint", "lint", 900],
      ["format:check", "format", 900],
    ],
  );
  // Python, Rust and Go: one test command each, 1800 seconds.
  for (const id of ["python", "rust", "go"] as const) {
    const chain = byId.get(id);
    assert.ok(chain !== undefined, `the data holds the toolchain ${id}`);
    assert.equal(chain.entryPoints.length, 1, `${id} has one entry point`);
    assert.equal(chain.entryPoints[0]?.kind, "test");
    assert.equal(chain.entryPoints[0]?.timeoutSec, 1800);
  }
  // The twelve files of the project fingerprint, in the baseline's order.
  assert.deepEqual(data.fingerprintFiles, [
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lock",
    "pyproject.toml",
    "pytest.ini",
    "tox.ini",
    "Cargo.toml",
    "Cargo.lock",
    "go.mod",
    "go.sum",
  ]);
  // The two as-is ambiguities of F105-FR-017 (items B-1078 and B-1105).
  assert.equal(
    data.ambiguities["noTestCommand"],
    "No safe automated test command was discovered below %s; required verification cannot start until one is configured",
  );
  assert.equal(
    data.ambiguities["phasesWithoutCommand"],
    "Phase(s) %s have neither a discovered nor a declared verification command; their gates would execute nothing",
  );
});

test("T003: data/word-lists.json carries the verbs of change and the build words", () => {
  const path = join(PACKAGE_ROOT, "data/word-lists.json");
  assert.match(sha256(path), /^[0-9a-f]{64}$/, "the data file has a content hash");
  const data = JSON.parse(readFileSync(path, "utf8")) as {
    schema: string;
    baseline: { commit: string; file: string };
    lists: { id: string; constant: string; pattern: string; words: string[] }[];
  };
  assert.equal(data.schema, "specstride.verification-word-lists/1");
  assert.equal(data.baseline.commit, "9cab15d");

  const byId = new Map(data.lists.map((list) => [list.id, list]));
  assert.deepEqual([...byId.keys()], ["change-verbs", "build-words"]);

  const verbs = byId.get("change-verbs");
  assert.ok(verbs !== undefined);
  assert.equal(verbs.constant, "MUTATION", "the list names the baseline's constant");
  assert.equal(verbs.words.length, 17, "the baseline holds seventeen verbs of change");
  assert.deepEqual(verbs.words.slice(0, 3), ["start", "create", "write"]);
  assert.ok(verbs.words.includes("migrate") && verbs.words.includes("push"));

  const build = byId.get("build-words");
  assert.ok(build !== undefined);
  assert.equal(build.constant, "BUILD_ARTIFACT", "the list names the baseline's constant");
  for (const word of ["build", "dist", "artifact", "tsc", "typecheck", "type-check", ".d.ts"]) {
    assert.ok(build.words.includes(word), `the build words hold ${word}`);
  }

  // Every word spelled out is matched by the pattern of the same row, so the
  // two forms of each list cannot drift apart. `.d.ts` keeps the baseline's
  // word boundary and so matches only after a word character.
  for (const list of data.lists) {
    const expression = new RegExp(list.pattern, "i");
    for (const word of list.words) {
      const probe = word.startsWith(".") ? `x${word}` : word;
      assert.ok(expression.test(probe), `${list.id}: the pattern matches ${word}`);
    }
  }
});

// ---------------------------------------------------------------------------
// T004 — the contracts data copied from the specification
// ---------------------------------------------------------------------------

test("T004: the four copies parse, carry a schema id and name feature 105", () => {
  for (const name of CONTRACT_DATA_FILES) {
    const packageFile = join(PACKAGE_ROOT, "data", name);
    assert.equal(statSync(packageFile).isFile(), true, `data/${name} is a file`);
    assert.match(sha256(packageFile), /^[0-9a-f]{64}$/, `data/${name} has a content hash`);
    const parsed = JSON.parse(readFileSync(packageFile, "utf8")) as { schema?: string };
    assert.equal(typeof parsed, "object", `data/${name} parses as JSON`);
    assert.match(parsed.schema ?? "", /^specstride\./, `data/${name} carries a schema id`);
  }
});

test("T004: data/ holds the four copies, the two baseline data files, and nothing else", () => {
  const inPackage = readdirSync(join(PACKAGE_ROOT, "data"))
    .filter((name) => name.endsWith(".json"))
    .sort();
  assert.deepEqual(inPackage, [...CONTRACT_DATA_FILES, ...BASELINE_DATA_FILES].sort());
});

test("T004: the contracts data of the package equals the specification byte for byte", (t) => {
  if (!existsSync(SPEC_CONTRACTS)) {
    // Principle XVII: a missing prerequisite is a SKIP with its reason, never
    // a pass. The `specs/` tree is local and outside the git index since
    // 2026-09-30, so a checkout without it cannot compare — and must not
    // report that the copies are equal when nothing was compared.
    t.skip(
      `the specification is absent: ${SPEC_CONTRACTS} does not exist. ` +
        "The `specs/` tree is local and outside the git index since 2026-09-30, " +
        "so the byte-for-byte comparison of data/ against the contracts of " +
        "specs/105-verification/contracts/ cannot run here (Principle XVII).",
    );
    return;
  }
  for (const name of CONTRACT_DATA_FILES) {
    const specFile = join(SPEC_CONTRACTS, name);
    assert.equal(existsSync(specFile), true, `the specification holds contracts/${name}`);
    const packageFile = join(PACKAGE_ROOT, "data", name);
    // Byte for byte, not merely "the same JSON": a reformatting would make
    // the package differ from the contract the specification fixes.
    assert.equal(
      sha256(packageFile),
      sha256(specFile),
      `data/${name} has the hash of specs/105-verification/contracts/${name}`,
    );
    assert.equal(
      readFileSync(packageFile).equals(readFileSync(specFile)),
      true,
      `data/${name} is byte for byte the contract`,
    );
  }
});

test("T004: every JSON contract of the specification is copied, none is missed", (t) => {
  if (!existsSync(SPEC_CONTRACTS)) {
    t.skip(
      `the specification is absent: ${SPEC_CONTRACTS} does not exist. ` +
        "Whether every contract of specs/105-verification/contracts/ is copied " +
        "cannot be decided here (Principle XVII).",
    );
    return;
  }
  const inSpec = readdirSync(SPEC_CONTRACTS)
    .filter((name) => name.endsWith(".json"))
    .sort();
  assert.deepEqual(
    inSpec,
    [...CONTRACT_DATA_FILES].sort(),
    "the four JSON contracts of the specification are the four the package copies",
  );
});
