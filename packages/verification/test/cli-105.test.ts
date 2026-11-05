/**
 * T135 and T136 — the public command `verify` and its MOUNT in the CLI
 * (F105-FR-039; annex G §G.1 and §G.4).
 *
 * The parity tests of `tests/parity/105/` measure the command against the
 * baseline's own `main()`. This file measures the two things a differential
 * test cannot: that the SHAPE of the command is read from the tables of
 * feature 100 and from this feature's own contract rather than typed in the
 * code, and that the MOUNT refuses when they disagree.
 *
 * Every table is read from THE FILE SYSTEM here — `data/verify-cli.json` of
 * this package, `data/cli-protocol.json`, `data/exit-codes.json` and
 * `data/normalization.json` of `@specstride/contracts` — so an assertion that
 * passes is an assertion about the data on disk and not about a constant in
 * this test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CODES_OF_ANNEX_G,
  CODES_OF_THE_CONTRACT,
  COMMAND,
  COMPONENT,
  CONTRACT_IS_OF_THIS_COMMAND,
  EXIT_CODES,
  GATE_FAILED,
  MOUNT_CONDITIONS,
  MountRefusedError,
  NAMES_ARE_THE_BASELINE_S,
  NAMES_OF_THE_BASELINE,
  OWNER,
  PROTOCOL,
  STAGED_COMMAND_FAILED,
  SUB_COMMANDS,
  SUB_COMMAND_COUNT,
  SUCCESS,
  THE_CODES_ARE_THE_ROW_S,
  THE_COMMAND_HAS_A_CODE_ROW,
  THE_COMMAND_IS_IN_THE_TABLE,
  THE_TABLES_AGREE,
  THIS_FEATURE_OWNS_IT,
  VERIFICATION_ERROR,
  VerifyUsageError,
  brokenConditions,
  errorLine,
  flagKindOf,
  mountIsConsistent,
  mountVerify,
  parseVerifyArguments,
  phaseOfRun,
  runVerify,
  subCommandOf,
  subCommands,
  verifyCommandTable,
  wholeNumberOf,
  GateCannotRunError,
  VERIFICATION_ERROR_CLASSES,
  VerificationError,
  WriteOnceRefusedError,
  codeOfAThrow,
  isAVerificationError,
  isExitCodeOfVerify,
  planContentHash,
  assertCodeIsOfTheRow,
  assertMountable,
  codesAreTheRowS,
  requireCommandsDocument,
  unknownSubCommandMessage,
} from "../src/index.ts";
// `lisa-store.ts` is re-exported as a NAMESPACE by `../src/render/index.ts`,
// because its names are the extracted module's (T006).
import { VerificationWriteError } from "../src/render/lisa-store.ts";

/**
 * A plan the `run` sub-command loads through an INJECTED reader, so the test
 * of the write-once rule needs no file system at all. One phase, one gate, one
 * command, and the two hashes a validation of this plan does not check
 * (`--specs` is not given, so the source binding is not compared).
 */
const PLAN_WITHOUT_ITS_HASH = {
  id: "verification-0000000000000000cli0",
  kind: "verification-plan",
  version: 1,
  source: { specPath: "/a/tasks.md", projection: "tasks-v2", contentHash: "a".repeat(64) },
  project: { workdir: "/a", fingerprint: "b".repeat(64), frameworks: [] },
  obligations: [],
  commands: [
    {
      id: "CMD-one",
      declaredId: null,
      source: "declared",
      phase: 1,
      executable: "/bin/true",
      args: [],
      env: {},
      cwd: "/a",
      timeoutSec: 60,
      stage: "gate",
      reusePolicy: "per-attempt",
      detached: false,
      cumulative: true,
      kind: "test",
      label: "one",
      reportPath: null,
    },
  ],
  suites: [{ id: "SUITE-phase-1", commandRefs: ["CMD-one"], obligationRefs: [] }],
  gates: [
    {
      id: "GATE-phase-1",
      scope: "phase",
      phase: 1,
      suiteRefs: ["SUITE-phase-1"],
      obligationRefs: [],
      required: true,
      cumulative: true,
    },
  ],
} as const;

/** The plan with ITS OWN content hash, so validation accepts it. */
const PLAN_TEXT = JSON.stringify({
  ...PLAN_WITHOUT_ITS_HASH,
  contentHash: planContentHash(PLAN_WITHOUT_ITS_HASH),
});

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = resolve(HERE, "..");
const CONTRACTS = resolve(PACKAGE, "../contracts");

function dataOf(root: string, name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, "data", name), "utf8")) as Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * T135 — the seven sub-commands and the four codes.
 * ------------------------------------------------------------------ */

test("T135: the seven sub-commands are the contract's on disk, in its order", () => {
  const contract = dataOf(PACKAGE, "verify-cli.json") as {
    command: string;
    subCommands: { name: string; required: string[]; optional: string[]; codes: number[] }[];
  };
  assert.equal(contract.command, COMMAND);
  assert.ok(CONTRACT_IS_OF_THIS_COMMAND);
  assert.equal(contract.subCommands.length, SUB_COMMAND_COUNT);
  assert.deepEqual(
    contract.subCommands.map((one) => one.name),
    [...SUB_COMMANDS],
  );
  assert.deepEqual([...SUB_COMMANDS], [...NAMES_OF_THE_BASELINE]);
  assert.ok(NAMES_ARE_THE_BASELINE_S);
  // Every sub-command's flags are the contract's, required and optional.
  for (const row of contract.subCommands) {
    const one = subCommandOf(row.name);
    assert.ok(one !== undefined, row.name);
    assert.deepEqual([...one.required], row.required);
    assert.deepEqual([...one.optional], row.optional);
    assert.deepEqual([...one.codes], row.codes);
    assert.deepEqual([...one.flags], [...row.required, ...row.optional]);
  }
  assert.equal(subCommandOf("nope"), undefined);
});

test("T135: the four codes are read from annex G §G.4 and the contract", () => {
  const exitCodes = dataOf(CONTRACTS, "exit-codes.json") as {
    perCommand: { Command: string; Codes: string }[];
  };
  const row = exitCodes.perCommand.find((one) => one.Command === "`verify`");
  assert.ok(row !== undefined, "annex G §G.4 holds a row for `verify`");
  for (const code of [0, 3, 10, 11]) {
    assert.ok(new RegExp(`\\b${String(code)}\\b`).test(row.Codes), `the row names ${String(code)}`);
  }
  assert.ok(THE_TABLES_AGREE);
  assert.deepEqual(
    [...CODES_OF_THE_CONTRACT],
    [...CODES_OF_ANNEX_G].sort((a, b) => a - b),
  );
  assert.deepEqual(
    [...EXIT_CODES],
    [SUCCESS, VERIFICATION_ERROR, GATE_FAILED, STAGED_COMMAND_FAILED],
  );
  assert.deepEqual(
    [SUCCESS, VERIFICATION_ERROR, GATE_FAILED, STAGED_COMMAND_FAILED],
    [0, 3, 10, 11],
  );
});

test("T135: a code the row of §G.4 does not hold is REFUSED, not taken", () => {
  // The guard `codeOf` calls. With the real tables it never fires, so the rule
  // is held here by driving it with a row that does not hold the number.
  assert.equal(assertCodeIsOfTheRow(3), 3);
  assert.equal(assertCodeIsOfTheRow(11, [0, 3, 10, 11]), 11);
  for (const code of [1, 2, 4, 70, 127]) {
    assert.throws(
      () => assertCodeIsOfTheRow(code),
      /is not in the table of annex G §G\.4/,
      String(code),
    );
  }
  assert.throws(() => assertCodeIsOfTheRow(3, [0, 10]), /is not in the table/);
});

test("T135: the component name of a refusal is read from annex X §X.8", () => {
  const normalization = dataOf(CONTRACTS, "normalization.json") as {
    componentNames: { "As-is implementation file": string; "Logical component name": string }[];
  };
  const row = normalization.componentNames.find(
    (one) => one["As-is implementation file"] === "The verification-plan module",
  );
  assert.ok(row !== undefined, "the component-name table names the verification-plan module");
  assert.equal(row["Logical component name"].replace(/`/g, "").trim(), COMPONENT);
  assert.equal(errorLine("x"), `${COMPONENT}: x\n`);
});

test("T135: the kind of every flag", () => {
  assert.equal(flagKindOf("create", "--required"), "switch");
  assert.equal(flagKindOf("create", "--workdir"), "value");
  assert.equal(flagKindOf("create", "--generate-tests"), "value");
  // `--phase` is a WHOLE NUMBER everywhere but `run`, where the baseline
  // declares it without a type and reads `release` itself.
  assert.equal(flagKindOf("run", "--phase"), "value");
  for (const name of ["slice", "prestage", "prestage-report"]) {
    assert.equal(flagKindOf(name, "--phase"), "whole-number");
  }
  for (const one of subCommands) {
    if (one.flags.includes("--attempt"))
      assert.equal(flagKindOf(one.name, "--attempt"), "whole-number");
  }
});

test("T135: the argument parser takes both forms and refuses the rest", () => {
  const parsed = parseVerifyArguments([
    "validate",
    "--plan",
    "/a/plan.json",
    "--specs=/a/tasks.md",
  ]);
  assert.equal(parsed.subCommand.name, "validate");
  assert.deepEqual({ ...parsed.values }, { "--plan": "/a/plan.json", "--specs": "/a/tasks.md" });
  // A switch has no value and takes none.
  const created = parseVerifyArguments([
    "create",
    "--workdir",
    "/a",
    "--specs",
    "/a/tasks.md",
    "--output",
    "/a/p.md",
    "--json-output",
    "/a/p.json",
    "--required",
  ]);
  assert.equal(created.values["--required"], "true");
  for (const argv of [
    [],
    ["nope"],
    ["validate"],
    ["validate", "--plan"],
    ["validate", "--plan", "/a", "--nope", "x"],
    ["create", "--workdir", "/a"],
    ["slice", "--plan", "/a", "--phase", "release"],
    ["prestage", "--plan", "/a", "--phase", "1", "--attempt", "x"],
  ]) {
    assert.throws(() => parseVerifyArguments(argv), VerifyUsageError, JSON.stringify(argv));
  }
});

test("T135: `run --phase` takes a whole number or `release`", () => {
  assert.equal(phaseOfRun("release"), "release");
  assert.equal(phaseOfRun("1"), 1);
  assert.equal(phaseOfRun(" 2 "), 2);
  assert.equal(phaseOfRun("-3"), -3);
  for (const value of ["nope", "1.5", "", "release ", "1e3"]) {
    assert.throws(() => phaseOfRun(value), /--phase must be an integer or release/, value);
  }
  assert.equal(wholeNumberOf("+4"), 4);
  assert.equal(wholeNumberOf("x"), undefined);
});

test("T135: a usage error carries the as-is code of the command, which is 3", async () => {
  for (const argv of [[], ["nope"], ["validate"], ["validate", "--plan"]]) {
    const outcome = await runVerify({ argv });
    assert.equal(outcome.exitCode, VERIFICATION_ERROR, JSON.stringify(argv));
    assert.equal(outcome.stdout, "");
    assert.ok(outcome.stderr.startsWith(`${COMPONENT}: `), outcome.stderr);
  }
  // AN UNKNOWN SUB-COMMAND IS REFUSED AS ONE, and is never silently taken for
  // the first of the seven: the message names it and names the seven.
  const unknown = await runVerify({ argv: ["nope"] });
  assert.equal(unknown.stderr, errorLine(unknownSubCommandMessage("nope")));
  assert.match(unknown.stderr, /unknown sub-command of verify: nope/);
  for (const name of SUB_COMMANDS) assert.ok(unknown.stderr.includes(name), name);
  assert.equal(unknown.subCommand, undefined, "no sub-command ran");
  // And a sub-command that IS one reports its name back.
  const known = await runVerify({ argv: ["validate", "--plan", "relative.json"] });
  assert.equal(known.subCommand, "validate");
});

test("T135: a verification-commands document must be absolute and must be there", () => {
  // B-1053 as an ARGUMENT check of its own. The document loader of phase 4
  // refuses the same two things, which is defence in depth; this holds the
  // rule at the argument list, where the requirement states it.
  assert.equal(requireCommandsDocument({ path: "/a/doc.json", isFile: () => true }), "/a/doc.json");
  assert.throws(
    () => requireCommandsDocument({ path: "doc.json", isFile: () => true }),
    /verification commands path must be absolute: doc\.json/,
  );
  assert.throws(
    () => requireCommandsDocument({ path: "/a/doc.json", isFile: () => false }),
    /verification commands not found: \/a\/doc\.json/,
  );
});

test("T135: a sub-command without the port it needs refuses with 3", async () => {
  // `create` needs the grammar owner (EP-03) and `run` the check runner
  // (EP-05); neither is in this package and neither is invented here.
  const create = await runVerify({
    argv: ["create", "--workdir", "/", "--specs", "/x", "--output", "/a", "--json-output", "/b"],
  });
  assert.equal(create.exitCode, VERIFICATION_ERROR);
  assert.match(create.stderr, /create needs the port `specModel`/);
  const run = await runVerify({ argv: ["run", "--plan", "/a/plan.json", "--phase", "1"] });
  assert.equal(run.exitCode, VERIFICATION_ERROR);
  assert.match(run.stderr, /run needs the port `run`/);
});

test("T135: a refusal of this feature is 3; anything else is the general rule 70", async () => {
  // A `VerificationError` and every other error class of this feature are
  // refusals of its own work and exit 3 (B-1058).
  assert.equal(codeOfAThrow(new VerificationError("x")), VERIFICATION_ERROR);
  assert.equal(codeOfAThrow(new VerifyUsageError("x")), VERIFICATION_ERROR);
  assert.equal(codeOfAThrow(new GateCannotRunError("x")), VERIFICATION_ERROR);
  assert.equal(codeOfAThrow(new WriteOnceRefusedError("a:name")), VERIFICATION_ERROR);
  assert.equal(codeOfAThrow(new VerificationWriteError("x")), VERIFICATION_ERROR);
  for (const one of VERIFICATION_ERROR_CLASSES) assert.equal(typeof one, "function");
  // ANYTHING ELSE is an uncaught error of the general rules of §G.4 and exits
  // 70 (F100-FR-182). It is NOT reported as a verification error: a
  // programming fault is not a statement about the consumer's project.
  assert.equal(codeOfAThrow(new TypeError("a fault")), 70);
  assert.equal(codeOfAThrow(new RangeError("a fault")), 70);
  assert.equal(codeOfAThrow("not an error at all"), 70);
  assert.equal(isAVerificationError(new TypeError("a fault")), false);
  assert.equal(isAVerificationError(new VerificationError("x")), true);
  // And the entry point gives that code, through a port that throws one.
  // The working directory and the specification are real, so the call gets
  // past the argument checks and reaches the port that throws.
  const outcome = await runVerify({
    argv: [
      "create",
      "--workdir",
      PACKAGE,
      "--specs",
      fileURLToPath(import.meta.url),
      "--output",
      join(PACKAGE, "p.md"),
      "--json-output",
      join(PACKAGE, "p.json"),
    ],
    ports: {
      specModel: () => {
        throw new TypeError("a fault of the grammar port");
      },
    },
  });
  assert.equal(outcome.exitCode, 70);
  assert.equal(outcome.stdout, "");
  assert.match(outcome.stderr, /a fault of the grammar port/);
  assert.equal(isExitCodeOfVerify(70), false, "70 is not a code of this command's row");
});

test("T135: `run` writes the result record ONCE and refuses other content", async () => {
  // F105-FR-009: the result record is written once. The sub-command must pass
  // the refusal on as a verification error and not overwrite the record.
  const written = new Map<string, string>();
  const ports = {
    run: async (command: { readonly id: string }) => ({
      commandId: command.id,
      declaredId: "",
      source: "declared",
      executable: "/bin/true",
      args: [] as readonly string[],
      env: {},
      cwd: "/",
      exitCode: 0,
      signal: null,
      durationMs: 1,
      stdout: "",
      stderr: "",
      passed: true,
    }),
    ingress: (text: string) => ({
      ok: true as const,
      ingressClass: "check-output",
      text,
      truncated: false,
      original_bytes: text.length,
      retained_bytes: text.length,
    }),
    files: {
      read: (path: string) => written.get(path) ?? PLAN_TEXT,
      readIfPresent: (path: string) => written.get(path),
      isFile: () => true,
      realPath: (path: string) => path,
      write: (path: string, text: string) => {
        written.set(path, text);
      },
      recordsIn: () => [],
    },
  };
  const argv = [
    "run",
    "--plan",
    "/a/verification-plan.json",
    "--phase",
    "1",
    "--evidence-output",
    "/a/verification/phase-1-attempt-1.json",
  ];
  const first = await runVerify({ argv, ports: ports as never });
  assert.equal(first.exitCode, SUCCESS, first.stderr);
  assert.ok(written.has("/a/verification/phase-1-attempt-1.json"), "the record was written");
  // The SAME content again is accepted and changes nothing.
  const same = await runVerify({ argv, ports: ports as never });
  assert.equal(same.exitCode, SUCCESS, same.stderr);
  // OTHER content at the same place REFUSES the write, with the code 3.
  written.set("/a/verification/phase-1-attempt-1.json", '{\n  "other": true\n}\n');
  const refused = await runVerify({ argv, ports: ports as never });
  assert.equal(refused.exitCode, VERIFICATION_ERROR, refused.stdout);
  assert.match(refused.stderr, /is written once and already holds other content/);
  assert.equal(
    written.get("/a/verification/phase-1-attempt-1.json"),
    '{\n  "other": true\n}\n',
    "the record that was there is untouched",
  );
});

/* ------------------------------------------------------------------ *
 * T136 — the mount.
 * ------------------------------------------------------------------ */

test("T136: the command table of annex G §G.1 names `verify` and this feature", () => {
  const protocol = dataOf(CONTRACTS, "cli-protocol.json") as {
    protocol: number;
    commands: { Command: string; "What it does": string; Owner: string }[];
  };
  const row = protocol.commands.find((one) => one.Command.replace(/`/g, "").trim() === COMMAND);
  assert.ok(row !== undefined, "§G.1 holds a row for `verify`");
  assert.equal(row.Owner.trim(), OWNER);
  assert.equal(OWNER, "105");
  assert.equal(PROTOCOL, protocol.protocol);
  assert.ok(THE_COMMAND_IS_IN_THE_TABLE);
  assert.ok(THIS_FEATURE_OWNS_IT);
  assert.ok(THE_COMMAND_HAS_A_CODE_ROW);
  assert.ok(THE_CODES_ARE_THE_ROW_S);
});

test("T136: a list of codes that is not the row of §G.4 is not the row", () => {
  assert.equal(codesAreTheRowS([0, 3, 10, 11], [11, 10, 3, 0]), true);
  assert.equal(codesAreTheRowS([0, 3, 10], [0, 3, 10, 11]), false, "one short");
  assert.equal(codesAreTheRowS([0, 3, 10, 2], [0, 3, 10, 11]), false, "one wrong");
  assert.equal(codesAreTheRowS([0, 3, 10, 11, 70], [0, 3, 10, 11]), false, "one too many");
});

test("T136: the guard of the mount refuses a broken set of conditions", () => {
  // With the real tables every condition holds, so the refusal is driven here
  // with a broken set — one condition at a time, and all of them together.
  assert.doesNotThrow(() => assertMountable());
  for (const name of Object.keys(MOUNT_CONDITIONS)) {
    assert.throws(
      () => assertMountable({ ...MOUNT_CONDITIONS, [name]: false }),
      (error: unknown) =>
        error instanceof MountRefusedError && error.broken.length === 1 && error.broken[0] === name,
      name,
    );
  }
  assert.throws(
    () =>
      assertMountable(
        Object.fromEntries(Object.keys(MOUNT_CONDITIONS).map((name) => [name, false])),
      ),
    (error: unknown) =>
      error instanceof MountRefusedError &&
      error.broken.length === Object.keys(MOUNT_CONDITIONS).length,
  );
  assert.equal(mountIsConsistent({ a: true, b: false }), false);
  assert.deepEqual([...brokenConditions({ a: true, b: false })], ["b"]);
});

test("T136: the mount is the row, the codes and the seven sub-commands", () => {
  assert.ok(mountIsConsistent());
  assert.deepEqual([...brokenConditions()], []);
  const mounted = mountVerify();
  assert.equal(mounted.command, "verify");
  assert.equal(mounted.owner, "105");
  assert.equal(mounted.protocol, 1);
  assert.equal(
    mounted.whatItDoes,
    "The verification plan and the verification gate as a public command",
  );
  assert.deepEqual([...mounted.subCommands], [...SUB_COMMANDS]);
  assert.deepEqual(
    [...mounted.codes].sort((a, b) => a - b),
    [0, 3, 10, 11],
  );
  assert.equal(mounted.handler, runVerify);
  // Every condition of the mount holds, each by name.
  for (const [name, holds] of Object.entries(MOUNT_CONDITIONS)) {
    assert.equal(holds, true, name);
  }
});

test("T136: the mount is a command table a composition root can spread", async () => {
  const table = verifyCommandTable();
  assert.deepEqual(Object.keys(table), ["verify"]);
  const mounted = table["verify"];
  assert.ok(mounted !== undefined);
  // The handler IS the command: it is called through the table and gives the
  // code of a usage error of the row.
  const outcome = await mounted.handler({ argv: ["nope"] });
  assert.equal(outcome.exitCode, VERIFICATION_ERROR);
});

test("T136: the mount REFUSES when the tables and the module disagree", () => {
  // The refusal is reachable and names which condition broke; the conditions
  // are what `mountVerify` checks before it builds anything.
  const error = new MountRefusedError(["thisFeatureOwnsIt"]);
  assert.match(error.message, /`verify` cannot be mounted/);
  assert.match(error.message, /annex G, §G\.1/);
  assert.deepEqual([...error.broken], ["thisFeatureOwnsIt"]);
  assert.equal(error.name, "MountRefusedError");
  // And the names of the conditions are exactly the five the mount checks, so
  // a condition cannot be dropped without this test noticing.
  assert.deepEqual(Object.keys(MOUNT_CONDITIONS), [
    "theCommandIsInTheTable",
    "thisFeatureOwnsIt",
    "theCommandHasACodeRow",
    "theCodesAreTheRowS",
    "sevenSubCommands",
  ]);
});
