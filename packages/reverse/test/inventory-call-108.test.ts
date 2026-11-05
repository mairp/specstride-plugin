/**
 * Phase 2 of feature 108, T004 — the call into the CLI command
 * `reverse inventory` and the reader of the inventory fields the plan and the
 * guard use (F108-FR-014, F108-FR-027).
 *
 * The tests of the adapter are INTEGRATION tests: they build a real executable
 * that stands in for the verb `inventory` of feature 140, spawn it as a
 * process through the module's own default runner, and then witness the effect
 * through an INDEPENDENT read path — the test reads the bytes off the disk
 * itself and hashes them, and compares that hash with the one the adapter
 * reports. What the stub printed is never the proof.
 *
 * The negative case is the one the obligation names: a stub that exits 0 and
 * prints a convincing absolute path while writing nothing, and one that writes
 * a file that is not an inventory. Both are refused with the messages of
 * F108-FR-027.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import {
  COMMAND,
  DEFAULT_EXECUTABLE,
  FLAGS,
  GUARD_FIELDS,
  INVENTORY_COMMAND,
  INVENTORY_ERROR_PREFIX,
  INVENTORY_LOGICAL_NAME,
  INVENTORY_OWNER,
  INVENTORY_SCHEMA_ID,
  INVENTORY_SCHEMA_MAJOR,
  INVENTORY_SUMMARY_LOGICAL_NAME,
  InventoryCallError,
  InventoryError,
  OWNER_LISTED_FIELDS,
  PLAN_FIELDS,
  READ_FIELDS,
  REFUSALS,
  USAGE_EXIT_CODE,
  VERB,
  callReverseInventory,
  cannotReadInventoryMessage,
  constitutionOf,
  fieldsNotListedByTheOwner,
  fileEntriesByPath,
  frameworksOf,
  inventoryArgv,
  inventoryFieldsOf,
  isAnInventoryDocument,
  languagesOf,
  messageOfStandardError,
  normalisedExcludes,
  notAnInventoryMessage,
  parseInventory,
  printedInventoryPath,
  readInventory,
  recordDisagreesWithTheTable,
  refusalOfSchema,
  reverseErrorLine,
  skippedEntriesByPath,
  unitCountOf,
  wasWalkedInGitMode,
} from "../src/plan/inventory-call.ts";

/* -------------------------------------------------------------------------- *
 * The fixture: one inventory document with every key F140-FR-021 lists
 * -------------------------------------------------------------------------- */

/** A document with all seventeen keys, the shape the owner's schema requires. */
export const INVENTORY_FIXTURE = {
  schema: INVENTORY_SCHEMA_ID,
  schema_version: 1,
  src: "/tmp/source",
  walk: "git",
  excludes: ["specs/reverse-src"],
  limits: { max_file_bytes: 1048576, max_total_bytes: 20971520 },
  totals: { files: 2, skipped: 1, text_bytes: 42, lines: 5 },
  oversize: false,
  files: [
    {
      path: "README.md",
      bytes: 20,
      lines: 2,
      sha256: "a".repeat(64),
      language: "markdown",
      role: "doc",
    },
    {
      path: "src/main.go",
      bytes: 22,
      lines: 3,
      sha256: "b".repeat(64),
      language: "go",
      role: "source",
    },
  ],
  skipped: [{ path: "logo.png", bytes: 900, sha256: "c".repeat(64), reason: "binary" }],
  project: {
    languages: { go: 1, markdown: 1 },
    frameworks: ["pytest"],
    manifests: [{ file: "go.mod", module: "example.com/x" }],
    entry_points: [{ kind: "go-main", target: "src/main.go" }],
    workspaces: [],
  },
  git_head: "0".repeat(40),
  git_status: [" M README.md"],
  testautomation: { "testautomation/run.sh": [11, "d".repeat(64)] },
  specify: { present: true, constitution: false, templates: false, spec_numbers: ["001"] },
  units: [
    { path: ".", files: 1, bytes: 20 },
    { path: "src", files: 1, bytes: 22 },
  ],
  fingerprint: "e".repeat(64),
} as const;

/** The document as the owner serializes it: sorted keys, one space, a final line end. */
function fixtureText(overrides: Readonly<Record<string, unknown>> = {}): string {
  const document: Record<string, unknown> = { ...INVENTORY_FIXTURE, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete document[key];
  }
  const sorted = Object.fromEntries(Object.entries(document).sort(([a], [b]) => (a < b ? -1 : 1)));
  return `${JSON.stringify(sorted, null, 1)}\n`;
}

/**
 * `assert.throws` returns nothing, so this captures the error it accepted and
 * hands it back typed. The assertion is still `assert.throws`'s: a call that
 * does not throw, or throws another class, fails here.
 */
function thrownBy<T extends Error>(action: () => unknown, kind: new (...args: never[]) => T): T {
  let captured: unknown;
  assert.throws(() => {
    try {
      action();
    } catch (error) {
      captured = error;
      throw error;
    }
  }, kind);
  return captured as T;
}

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function workdir(name: string): string {
  return mkdtempSync(join(tmpdir(), `t004-${name}-`));
}

/* -------------------------------------------------------------------------- *
 * The stub executable: a real process that stands in for the verb
 * -------------------------------------------------------------------------- */

/**
 * Writes a Node script that behaves as the verb `inventory` of feature 140 in
 * one of four ways, and records the argument list it was given so that the test
 * can read the argv the adapter really passed, off the disk, and not from the
 * adapter's own report.
 */
function stubExecutable(directory: string): string {
  const script = join(directory, "reverse-inventory-stub.mjs");
  writeFileSync(
    script,
    [
      'import { writeFileSync } from "node:fs";',
      'import { resolve } from "node:path";',
      "const argv = process.argv.slice(2);",
      'const mode = process.env["STUB_MODE"] ?? "write";',
      'const log = process.env["STUB_ARGV_LOG"];',
      "if (log) writeFileSync(log, JSON.stringify(argv) + '\\n');",
      'const out = resolve(argv[argv.indexOf("--out") + 1] ?? "");',
      'const mdIndex = argv.indexOf("--md");',
      'if (mode === "fail") {',
      '  process.stderr.write("reverse-inventory: " + (process.env["STUB_MESSAGE"] ?? "failed") + "\\n");',
      '  process.exit(Number(process.env["STUB_STATUS"] ?? "3"));',
      "}",
      'if (mode === "silent-fail") process.exit(Number(process.env["STUB_STATUS"] ?? "3"));',
      'if (mode !== "lie") {',
      '  writeFileSync(out, process.env["STUB_BODY"] ?? "");',
      '  if (mdIndex >= 0) writeFileSync(resolve(argv[mdIndex + 1]), "# Inventory\\n");',
      "}",
      'process.stdout.write(out + "\\n");',
      "",
    ].join("\n"),
    "utf8",
  );
  return script;
}

/** One call of the adapter against the stub, as a real process. */
function callStub(
  directory: string,
  options: {
    readonly mode?: string;
    readonly body?: string;
    readonly status?: number;
    readonly message?: string;
    readonly md?: string;
    readonly excludes?: readonly string[];
    readonly out?: string;
  } = {},
) {
  const argvLog = join(directory, "argv.json");
  return {
    argvLog,
    result: callReverseInventory({
      src: join(directory, "source"),
      out: options.out ?? join(directory, "state", "inventory.json"),
      md: options.md,
      excludes: options.excludes,
      executable: process.execPath,
      prefixArgs: [stubExecutable(directory)],
      env: {
        STUB_MODE: options.mode ?? "write",
        STUB_BODY: options.body ?? fixtureText(),
        STUB_STATUS: options.status === undefined ? undefined : String(options.status),
        STUB_MESSAGE: options.message,
        STUB_ARGV_LOG: argvLog,
      },
    }),
  };
}

/* -------------------------------------------------------------------------- *
 * The record: schema id, logical name and owner, and the fields it may read
 * -------------------------------------------------------------------------- */

test("T004: the record is the one annex B §B.20 holds, and loading proves it", () => {
  assert.equal(recordDisagreesWithTheTable(), undefined);
  assert.equal(INVENTORY_SCHEMA_ID, "specstride.reverse-inventory/1");
  assert.equal(INVENTORY_SCHEMA_MAJOR, 1);
  assert.equal(INVENTORY_LOGICAL_NAME, "reverse:<slug>:inventory");
  assert.equal(INVENTORY_SUMMARY_LOGICAL_NAME, "reverse:<slug>:inventory-summary");
  assert.equal(INVENTORY_OWNER, "140");
});

test("T004: every field the reader reads is one F140-FR-021 lists (F100-FR-227)", () => {
  assert.deepEqual(fieldsNotListedByTheOwner(), []);
  assert.deepEqual(
    [...READ_FIELDS],
    [
      "fingerprint",
      "files",
      "skipped",
      "excludes",
      "walk",
      "git_head",
      "git_status",
      "testautomation",
      "oversize",
      "units",
      "project",
      "specify",
    ],
  );
  assert.equal(READ_FIELDS.length, 12);
  for (const field of [...PLAN_FIELDS, ...GUARD_FIELDS]) {
    assert.ok(READ_FIELDS.includes(field), `${field} is one of the twelve`);
    assert.ok(OWNER_LISTED_FIELDS.includes(field as never), `${field} is listed by the owner`);
  }
  // The two subsets together are the twelve: nothing is read that no caller wants.
  assert.deepEqual([...new Set([...PLAN_FIELDS, ...GUARD_FIELDS])].sort(), [...READ_FIELDS].sort());
});

/* -------------------------------------------------------------------------- *
 * The reader: the twelve fields, and the refusals of F108-FR-027
 * -------------------------------------------------------------------------- */

test("T004: the reader gives the twelve fields of a document on disk", () => {
  const directory = workdir("read");
  const path = join(directory, "inventory.json");
  const text = fixtureText();
  writeFileSync(path, text, "utf8");

  const read = readInventory(path);
  // The content hash is the test's own, computed off the disk.
  assert.equal(read.documentHash, sha256OfFile(path));
  assert.equal(read.bytes, Buffer.byteLength(text));
  assert.equal(read.fingerprint, "e".repeat(64));

  const fields = read.fields;
  assert.deepEqual(Object.keys(fields).sort(), [...READ_FIELDS].sort());
  assert.equal(fields.fingerprint, "e".repeat(64));
  assert.equal(fields.files.length, 2);
  assert.equal(fields.files[0]?.path, "README.md");
  assert.equal(fields.skipped.length, 1);
  assert.equal(fields.skipped[0]?.reason, "binary");
  assert.deepEqual([...fields.excludes], ["specs/reverse-src"]);
  assert.equal(fields.walk, "git");
  assert.equal(fields.git_head, "0".repeat(40));
  assert.deepEqual([...(fields.git_status ?? [])], [" M README.md"]);
  assert.deepEqual(fields.testautomation, { "testautomation/run.sh": [11, "d".repeat(64)] });
  assert.equal(fields.oversize, false);
  assert.equal(fields.units.length, 2);
  assert.deepEqual(fields.project.languages, { go: 1, markdown: 1 });
  assert.equal(fields.specify.constitution, false);

  // The readers the plan and the guard call.
  assert.equal(wasWalkedInGitMode(fields), true);
  assert.deepEqual([...fileEntriesByPath(fields).keys()], ["README.md", "src/main.go"]);
  assert.deepEqual([...skippedEntriesByPath(fields).keys()], ["logo.png"]);
  assert.deepEqual(languagesOf(fields), { go: 1, markdown: 1 });
  assert.deepEqual([...frameworksOf(fields)], ["pytest"]);
  assert.equal(unitCountOf(fields), 2);
  assert.equal(constitutionOf(fields), "to be written");
  assert.equal(constitutionOf(inventoryFieldsOf({ specify: { constitution: true } })), "existing");
});

test("T004: an absent optional field becomes its empty form, and walk is git only when it says git", () => {
  const fields = inventoryFieldsOf({ fingerprint: "f".repeat(64), files: [] });
  assert.equal(fields.walk, "walk");
  assert.equal(wasWalkedInGitMode(fields), false);
  assert.equal(fields.git_head, null);
  assert.equal(fields.git_status, null);
  assert.equal(fields.testautomation, null);
  assert.equal(fields.oversize, false);
  assert.deepEqual([...fields.excludes], []);
  assert.deepEqual([...fields.units], []);
  assert.deepEqual(fields.project, {});
  assert.deepEqual(fields.specify, {});
});

test("T004: a baseline that cannot be read fails with cannot read inventory <path>: <error>", () => {
  const directory = workdir("unreadable");
  const missing = join(directory, "nope.json");
  const thrown = thrownBy(() => readInventory(missing), InventoryError);
  assert.match(thrown.message, /^cannot read inventory /);
  assert.ok(thrown.message.startsWith(`cannot read inventory ${missing}: `));
  assert.equal(thrown.exitCode, 3);
  assert.equal(thrown.refusal, "unreadable");
  assert.equal(reverseErrorLine(thrown.message), `reverse: ${thrown.message}`);

  const broken = join(directory, "broken.json");
  writeFileSync(broken, "{ not json", "utf8");
  const parseFailure = thrownBy(() => readInventory(broken), InventoryError);
  assert.ok(parseFailure.message.startsWith(`cannot read inventory ${broken}: `));
  assert.equal(parseFailure.exitCode, 3);
});

test("T004: a document that is not an object with fingerprint and files is not an inventory", () => {
  assert.equal(isAnInventoryDocument(INVENTORY_FIXTURE), true);
  assert.equal(isAnInventoryDocument({ fingerprint: "x" }), false);
  assert.equal(isAnInventoryDocument({ files: [] }), false);
  assert.equal(isAnInventoryDocument([INVENTORY_FIXTURE]), false);
  assert.equal(isAnInventoryDocument("an inventory"), false);
  assert.equal(isAnInventoryDocument(null), false);

  const directory = workdir("not-an-inventory");
  for (const [name, body] of [
    ["list.json", "[]\n"],
    ["string.json", '"hello"\n'],
    ["no-files.json", '{"fingerprint": "x"}\n'],
    ["no-fingerprint.json", '{"files": []}\n'],
  ] as const) {
    const path = join(directory, name);
    writeFileSync(path, body, "utf8");
    const thrown = thrownBy(() => readInventory(path), InventoryError);
    assert.equal(thrown.message, notAnInventoryMessage(path));
    assert.equal(thrown.message, `not an inventory: ${path}`);
    assert.equal(thrown.exitCode, 3);
    assert.equal(thrown.refusal, "not-an-object");
  }
});

test("T004: a baseline without schema, or with an unknown id or major, is refused (F100-FR-049)", () => {
  assert.equal(refusalOfSchema(INVENTORY_SCHEMA_ID), undefined);
  assert.equal(refusalOfSchema(undefined), "missing-schema");
  assert.equal(refusalOfSchema(""), "missing-schema");
  assert.equal(refusalOfSchema(null), "missing-schema");
  assert.equal(refusalOfSchema("specstride.reverse-inventory/2"), "unknown-schema");
  assert.equal(refusalOfSchema("specstride.reverse-inventory"), "unknown-schema");
  assert.equal(refusalOfSchema("specstride.span-state/1"), "unknown-schema");
  assert.equal(refusalOfSchema(1), "unknown-schema");
  assert.deepEqual(
    [...REFUSALS],
    ["unreadable", "not-an-object", "missing-schema", "unknown-schema"],
  );

  const directory = workdir("schema");
  const cases = [
    ["absent.json", fixtureText({ schema: undefined }), "missing-schema"],
    [
      "other-major.json",
      fixtureText({ schema: "specstride.reverse-inventory/2" }),
      "unknown-schema",
    ],
    ["other-id.json", fixtureText({ schema: "specstride.checkpoint/1" }), "unknown-schema"],
  ] as const;
  for (const [name, body, refusal] of cases) {
    const path = join(directory, name);
    writeFileSync(path, body, "utf8");
    const thrown = thrownBy(() => readInventory(path), InventoryError);
    // In compatibility output the line is the as-is `not an inventory: <path>`.
    assert.equal(thrown.message, `not an inventory: ${path}`);
    assert.equal(thrown.exitCode, 3);
    assert.equal(thrown.refusal, refusal);
  }
  // The schema is read from the document, not from the file name: the same
  // bytes with the right schema pass.
  const good = join(directory, "good.json");
  writeFileSync(good, fixtureText(), "utf8");
  assert.equal(readInventory(good).fields.fingerprint, "e".repeat(64));
});

test("T004: parseInventory names the path in its messages without reading the disk", () => {
  const read = parseInventory(fixtureText(), "/state/inventory.json");
  assert.equal(read.path, "/state/inventory.json");
  assert.equal(read.fingerprint, "e".repeat(64));
  const thrown = thrownBy(() => parseInventory("[]", "/state/x.json"), InventoryError);
  assert.equal(thrown.message, "not an inventory: /state/x.json");
});

/* -------------------------------------------------------------------------- *
 * The argument list of the call
 * -------------------------------------------------------------------------- */

test("T004: the argument list is the fixed one of reverse inventory (F140-FR-015)", () => {
  assert.equal(COMMAND, "reverse");
  assert.equal(VERB, "inventory");
  assert.equal(INVENTORY_COMMAND, "reverse inventory");
  assert.equal(DEFAULT_EXECUTABLE, "specstride");
  assert.deepEqual(FLAGS, { out: "--out", md: "--md", exclude: "--exclude" });

  assert.deepEqual(
    [...inventoryArgv({ src: "/src", out: "/state/inventory.json" })],
    ["reverse", "inventory", "/src", "--out", "/state/inventory.json"],
  );
  // F108-FR-014: at `plan` the output directory, relative to the source, is the
  // only exclusion, and the summary goes to `--md`.
  assert.deepEqual(
    [
      ...inventoryArgv({
        src: "/src",
        out: "/state/inventory.json",
        md: "/state/inventory.md",
        excludes: ["specs/reverse-src/"],
      }),
    ],
    [
      "reverse",
      "inventory",
      "/src",
      "--out",
      "/state/inventory.json",
      "--md",
      "/state/inventory.md",
      "--exclude",
      "specs/reverse-src",
    ],
  );
  // Repeatable, normalised, de-duplicated and sorted by code point.
  assert.deepEqual([...normalisedExcludes(["/b/", "a", "b", "", "/"])], ["a", "b"]);
  const many = inventoryArgv({ src: "/src", out: "/o.json", excludes: ["z", "a", "a/"] });
  assert.deepEqual([...many].slice(5), ["--exclude", "a", "--exclude", "z"]);
  // A prefix argument puts the command behind an executable that needs one.
  assert.deepEqual(
    [...inventoryArgv({ src: "/s", out: "/o", prefixArgs: ["cli.mjs"] })].slice(0, 3),
    ["cli.mjs", "reverse", "inventory"],
  );
});

test("T004: the printed path and the message of standard error are read as F140-FR-015 and F140-FR-001 write them", () => {
  assert.equal(printedInventoryPath("/state/inventory.json\n"), "/state/inventory.json");
  assert.equal(printedInventoryPath("noise\n/state/a.json\n"), "/state/a.json");
  assert.equal(printedInventoryPath("relative/path\n"), undefined);
  assert.equal(printedInventoryPath("\n\n"), undefined);
  assert.equal(INVENTORY_ERROR_PREFIX, "reverse-inventory: ");
  assert.equal(
    messageOfStandardError("reverse-inventory: source is not a directory: /x\n"),
    "source is not a directory: /x",
  );
  assert.equal(messageOfStandardError("a warning\nreverse-inventory: boom\n"), "boom");
  assert.equal(messageOfStandardError("plain trouble\n"), "plain trouble");
  assert.equal(messageOfStandardError("   \n"), undefined);
});

/* -------------------------------------------------------------------------- *
 * The adapter, as an integration test over a real process
 * -------------------------------------------------------------------------- */

test("T004 integration: the call runs the CLI command as a process and the effect is witnessed off the disk", () => {
  const directory = workdir("call");
  mkdirSync(join(directory, "source"), { recursive: true });
  mkdirSync(join(directory, "state"), { recursive: true });
  const body = fixtureText();
  const { argvLog, result } = callStub(directory, {
    body,
    md: join(directory, "state", "inventory.md"),
    excludes: ["specs/reverse-src"],
  });

  // The exit status is the one the adapter OBSERVED.
  assert.equal(result.exitCode, 0);
  assert.equal(result.executable, process.execPath);

  // The argument list, read back from the file the stub itself wrote: this is
  // what the process really received, not what the adapter says it sent.
  const received = JSON.parse(readFileSync(argvLog, "utf8")) as string[];
  assert.deepEqual(received.slice(0, 2), ["reverse", "inventory"]);
  assert.equal(received[2], join(directory, "source"));
  assert.deepEqual(received.slice(3, 5), ["--out", join(directory, "state", "inventory.json")]);
  assert.deepEqual(received.slice(5, 7), ["--md", join(directory, "state", "inventory.md")]);
  assert.deepEqual(received.slice(7), ["--exclude", "specs/reverse-src"]);
  assert.deepEqual(received, [...result.argv].slice(1));

  // The durable effect: two files that could not exist before the call.
  const inventoryPath = join(directory, "state", "inventory.json");
  assert.equal(existsSync(inventoryPath), true);
  assert.equal(existsSync(join(directory, "state", "inventory.md")), true);
  assert.equal(result.printedPath, inventoryPath);

  // The content hash the adapter reports equals the test's own hash of the
  // bytes on disk — the independent read path.
  assert.equal(result.read.documentHash, sha256OfFile(inventoryPath));
  assert.equal(result.read.documentHash, createHash("sha256").update(body).digest("hex"));
  assert.equal(result.read.path, inventoryPath);
  assert.equal(result.read.fingerprint, "e".repeat(64));
  assert.equal(result.read.fields.walk, "git");
  assert.equal(result.read.fields.files.length, 2);
  assert.deepEqual(Object.keys(result.read.fields).sort(), [...READ_FIELDS].sort());
});

test("T004 integration negative: a success that wrote nothing is refused, not believed", () => {
  const directory = workdir("lie");
  mkdirSync(join(directory, "state"), { recursive: true });
  const inventoryPath = join(directory, "state", "inventory.json");
  // The stub exits 0 and prints exactly the path the adapter asked for, but
  // writes no file at all. A successful-looking response with no independently
  // readable durable effect must not pass.
  const thrown = thrownBy(() => callStub(directory, { mode: "lie" }), InventoryError);
  assert.equal(existsSync(inventoryPath), false);
  assert.ok(thrown.message.startsWith(`cannot read inventory ${inventoryPath}: `));
  assert.equal(thrown.exitCode, 3);
  assert.equal(thrown.refusal, "unreadable");
});

test("T004 integration negative: a success that wrote a document that is not an inventory is refused", () => {
  const directory = workdir("junk");
  mkdirSync(join(directory, "state"), { recursive: true });
  const inventoryPath = join(directory, "state", "inventory.json");
  const thrown = thrownBy(() => callStub(directory, { body: '{"files": []}\n' }), InventoryError);
  // The file EXISTS and the command exited 0: only the read refuses it.
  assert.equal(existsSync(inventoryPath), true);
  assert.equal(readFileSync(inventoryPath, "utf8"), '{"files": []}\n');
  assert.equal(thrown.message, `not an inventory: ${inventoryPath}`);
  assert.equal(thrown.refusal, "not-an-object");

  // The same, for a document written with no `schema` field.
  const other = workdir("junk-schema");
  mkdirSync(join(other, "state"), { recursive: true });
  const schemaless = thrownBy(
    () => callStub(other, { body: fixtureText({ schema: undefined }) }),
    InventoryError,
  );
  assert.equal(schemaless.message, `not an inventory: ${join(other, "state", "inventory.json")}`);
  assert.equal(schemaless.refusal, "missing-schema");
});

test("T004 integration negative: a success that wrote somewhere else is refused", () => {
  const directory = workdir("elsewhere");
  mkdirSync(join(directory, "state"), { recursive: true });
  const script = join(directory, "wrong-path.mjs");
  writeFileSync(script, 'process.stdout.write("/somewhere/else/inventory.json\\n");\n', "utf8");
  const thrown = thrownBy(
    () =>
      callReverseInventory({
        src: join(directory, "source"),
        out: join(directory, "state", "inventory.json"),
        executable: process.execPath,
        prefixArgs: [script],
      }),
    InventoryCallError,
  );
  assert.ok(thrown.message.includes("/somewhere/else/inventory.json"));
  assert.equal(thrown.status, 0);
  assert.equal(thrown.exitCode, 3);
});

test("T004 integration negative: a success that printed no path is refused", () => {
  const directory = workdir("silent");
  mkdirSync(join(directory, "state"), { recursive: true });
  const script = join(directory, "silent.mjs");
  writeFileSync(script, "process.exit(0);\n", "utf8");
  const thrown = thrownBy(
    () =>
      callReverseInventory({
        src: join(directory, "source"),
        out: join(directory, "state", "inventory.json"),
        executable: process.execPath,
        prefixArgs: [script],
      }),
    InventoryCallError,
  );
  assert.ok(thrown.message.includes("printed no inventory path"));
});

test("T004 integration: a failing call carries the command's own message and its code", () => {
  const directory = workdir("fail");
  mkdirSync(join(directory, "state"), { recursive: true });
  const refused = thrownBy(
    () =>
      callStub(directory, {
        mode: "fail",
        status: 3,
        message: "source is not a directory: /x",
      }),
    InventoryCallError,
  );
  // F140-FR-001 gives the prefix; F108-FR-031 writes it as `reverse: <message>`.
  assert.equal(refused.message, "source is not a directory: /x");
  assert.equal(reverseErrorLine(refused.message), "reverse: source is not a directory: /x");
  assert.equal(refused.status, 3);
  assert.equal(refused.exitCode, 3);
  assert.ok(refused.stderr.includes("reverse-inventory: source is not a directory: /x"));
  assert.deepEqual([...refused.argv].slice(1, 3), ["reverse", "inventory"]);

  // A usage error of the verb keeps its own code (F140-FR-001).
  const usage = thrownBy(
    () => callStub(directory, { mode: "fail", status: 2, message: "usage" }),
    InventoryCallError,
  );
  assert.equal(usage.status, 2);
  assert.equal(usage.exitCode, USAGE_EXIT_CODE);

  // A failure that said nothing still gives a message.
  const quiet = thrownBy(
    () => callStub(directory, { mode: "silent-fail", status: 3 }),
    InventoryCallError,
  );
  assert.equal(quiet.message, "reverse inventory exited 3");
});

test("T004 integration: the call does not start where the executable does not exist", () => {
  const directory = workdir("missing-exe");
  const thrown = thrownBy(
    () =>
      callReverseInventory({
        src: join(directory, "source"),
        out: join(directory, "inventory.json"),
        executable: join(directory, "no-such-executable"),
      }),
    InventoryCallError,
  );
  assert.ok(thrown.message.startsWith("reverse inventory did not run: "));
  assert.equal(thrown.status, null);
});

test("T004: a relative --out is resolved against the working directory of the call", () => {
  const directory = workdir("relative-out");
  mkdirSync(join(directory, "state"), { recursive: true });
  const inventoryPath = join(directory, "state", "inventory.json");
  writeFileSync(inventoryPath, fixtureText(), "utf8");
  // The command runs in `directory` and prints the absolute path it wrote; the
  // adapter was given the path relative to that same directory, and the two
  // must still meet. Resolving against this process's own working directory
  // would not find it.
  const result = callReverseInventory({
    src: join(directory, "source"),
    out: join("state", "inventory.json"),
    cwd: directory,
    run: (_executable, _argv, options) => {
      assert.equal(options.cwd, directory);
      return { status: 0, stdout: `${inventoryPath}\n`, stderr: "" };
    },
  });
  assert.equal(result.read.path, inventoryPath);
  assert.equal(result.read.documentHash, sha256OfFile(inventoryPath));
  assert.notEqual(resolve(join("state", "inventory.json")), inventoryPath);
});

test("T004: a runner may be injected, and the adapter still reads the disk", () => {
  const directory = workdir("runner");
  const inventoryPath = join(directory, "inventory.json");
  writeFileSync(inventoryPath, fixtureText(), "utf8");
  const seen: string[][] = [];
  const result = callReverseInventory({
    src: join(directory, "source"),
    out: inventoryPath,
    run: (_executable, argv) => {
      seen.push([...argv]);
      return { status: 0, stdout: `${resolve(inventoryPath)}\n`, stderr: "" };
    },
  });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0]?.slice(0, 2), ["reverse", "inventory"]);
  assert.equal(result.read.documentHash, sha256OfFile(inventoryPath));
  assert.equal(result.read.fields.fingerprint, "e".repeat(64));
  // The runner's word alone is not enough: the same response with no file fails.
  writeFileSync(join(directory, "other.json"), "", "utf8");
  assert.throws(
    () =>
      callReverseInventory({
        src: join(directory, "source"),
        out: join(directory, "absent.json"),
        run: () => ({
          status: 0,
          stdout: `${resolve(join(directory, "absent.json"))}\n`,
          stderr: "",
        }),
      }),
    InventoryError,
  );
  assert.equal(cannotReadInventoryMessage("/p", "boom"), "cannot read inventory /p: boom");
});
