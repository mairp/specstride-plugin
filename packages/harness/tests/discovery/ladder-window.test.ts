/**
 * T022 — characterization tests CT-146-13, CT-146-15 and CT-146-16 of the
 * probe ladder, the flag check and the context window (F146-FR-013,
 * F146-FR-015, F146-FR-016; quickstart scenario 4).
 *
 * CT-146-13  provenance per ladder step, and nothing guessed: every value
 *            the ladder reads carries the source and the step that
 *            produced it, and a value no step read stays null.
 * CT-146-15  a flag missing from the help text makes the role unsupported,
 *            with the missing flag as the reason.
 * CT-146-16  the precedence of the window, the smaller of two, the margin
 *            on a catalogue value, and NO default window.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  capabilityOf,
  checkFlagsAgainstHelp,
  flagsOfDescriptor,
  probeVersionAndHelp,
  PROBE_LADDER_STEPS,
  roleSupportOf,
} from "../../src/discovery/probes/ladder.ts";
import type { ProbeProcess, ProbeRequest } from "../../src/discovery/probes/runner.ts";
import {
  BUNDLED_CATALOGUE_LOGICAL_NAME,
  CATALOGUE_SCHEMA_PATH,
  CATALOGUE_SNAPSHOT_SCHEMA,
  catalogueEntryOf,
  readBundledCatalogue,
  readUserCatalogue,
  selectCatalogue,
  USER_CATALOGUE_LOGICAL_NAME,
  validateAgainstSchema,
} from "../../src/discovery/catalogue.ts";
import {
  applyMargin,
  CATALOGUE_MARGIN_CONFIG_KEY,
  CATALOGUE_WINDOW_MARGIN_PERCENT,
  resolveWindow,
} from "../../src/discovery/window.ts";

/** A spawn that answers each probe with scripted text, and traces. */
function scriptedSpawn(outputs: Readonly<Record<string, string>>): {
  readonly spawn: (request: ProbeRequest) => ProbeProcess;
  readonly started: ProbeRequest[];
} {
  const started: ProbeRequest[] = [];
  const spawn = (request: ProbeRequest): ProbeProcess => {
    started.push(request);
    const emitter = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const text = outputs[request.id] ?? "";
    queueMicrotask(() => {
      stdout.end(text);
      stderr.end();
      emitter.emit("exit", 0, null);
    });
    return {
      stdout,
      stderr,
      endInput: () => {},
      kill: () => {},
      onExit: (callback) => emitter.on("exit", (code, signal) => callback(code, signal)),
      onStartError: (callback) => emitter.on("error", (error: Error) => callback(error)),
    };
  };
  return { spawn, started };
}

test("CT-146-13: the version-help probe reads the version from the output and records its step", async () => {
  // A REAL child process: the version is what the executable printed,
  // never a value the code held.
  const { spawn, started } = scriptedSpawn({
    "version-help:version": "example-cli 2.7.1\n",
    "version-help:help": "Usage: example-cli\nOptions:\n  --model <name>\n  --workdir <dir>\n",
  });
  const outcome = await probeVersionAndHelp({
    file: process.execPath,
    spawn,
    versionArgs: ["--version"],
    helpArgs: ["--help"],
  });
  assert.equal(outcome.version, "example-cli 2.7.1");
  assert.ok(outcome.helpText?.includes("--model"));
  assert.deepEqual(outcome.findings, []);
  // The provenance of the value is the step that produced it, and the
  // step is a member of the closed set row 179.
  assert.deepEqual(
    [...PROBE_LADDER_STEPS],
    ["presence", "version-help", "credential-presence", "metadata", "catalogue"],
  );
  assert.deepEqual(outcome.steps, ["version-help", "version-help"]);
  const capability = capabilityOf(outcome.version!, "binary", "version-help");
  assert.deepEqual(capability, {
    value: "example-cli 2.7.1",
    source: "binary",
    ladderStep: "version-help",
  });
  // Only the argument lists the caller copied from the descriptor ran.
  assert.deepEqual(
    started.map((probe) => probe.args),
    [["--version"], ["--help"]],
  );
  assert.ok(started.every((probe) => probe.file === process.execPath));
});

test("CT-146-13: nothing is guessed — a failed probe leaves the value null and never invents one", async () => {
  const emitter = new EventEmitter();
  const never = (_request: ProbeRequest): ProbeProcess => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    queueMicrotask(() => emitter.emit("exit", 1, null));
    return {
      stdout,
      stderr,
      endInput: () => {},
      kill: () => {},
      onExit: (callback) => emitter.on("exit", (code, signal) => callback(code, signal)),
      onStartError: (callback) => emitter.on("error", (error: Error) => callback(error)),
    };
  };
  const outcome = await probeVersionAndHelp({ file: process.execPath, spawn: never });
  assert.equal(outcome.version, null);
  assert.equal(outcome.helpText, null);
  assert.equal(outcome.steps.length, 0);
  assert.equal(outcome.findings.length, 2);
  assert.ok(outcome.findings.every((finding) => finding.code === "probe-failed"));
});

test("CT-146-15: a flag missing from the help text makes the role unsupported, with the flag as the reason", () => {
  const descriptor = {
    invoke: {
      proposer: {
        args: ["--model", "{model}", "--workdir", "{workdir}", "--prompt-file", "{promptFile}"],
      },
      critic: { args: ["--model", "{model}", "--prompt-stdin"] },
    },
  };
  // The flags of the argument lists, and nothing else: a placeholder is
  // not a flag.
  const flags = flagsOfDescriptor(descriptor);
  assert.deepEqual(flags.proposer, ["--model", "--workdir", "--prompt-file"]);
  assert.deepEqual(flags.critic, ["--model", "--prompt-stdin"]);
  // The help text names --model and --workdir but not --prompt-file nor
  // --prompt-stdin.
  const help =
    "Usage: example-cli\n  --model <name>      the model\n  --workdir <dir>     the workdir\n";
  const support = roleSupportOf(descriptor, help);
  assert.deepEqual(
    support.map((entry) => [entry.role, entry.supported, entry.missingFlags]),
    [
      ["proposer", false, ["--prompt-file"]],
      ["critic", false, ["--prompt-stdin"]],
    ],
  );
  assert.match(support[0]!.reason!, /missing flag --prompt-file in the help text/);
  // A help text that names every flag supports the roles.
  const full = "Usage: example-cli\n --model --workdir --prompt-file --prompt-stdin\n more words\n";
  assert.deepEqual(checkFlagsAgainstHelp(full, ["--model", "--prompt-stdin"]).missing, []);
  assert.deepEqual(
    roleSupportOf(descriptor, full).map((entry) => entry.supported),
    [true, true],
  );
  // Word-boundary: --model-file must not vouch for --model.
  assert.deepEqual(checkFlagsAgainstHelp("--model-file only", ["--model"]).missing, ["--model"]);
  // No help text: nothing is guessed — no role becomes supported.
  assert.deepEqual(
    roleSupportOf(descriptor, null).map((entry) => [entry.supported, entry.reason !== null]),
    [
      [false, true],
      [false, true],
    ],
  );
});

test("CT-146-16: the window follows the precedence, the smaller of two, the margin, and no default", async (t) => {
  await t.test("the model list gives the step `metadata` (source gateway)", () => {
    assert.deepEqual(resolveWindow({ metadata: 128000 }), {
      tokens: 128000,
      source: "gateway",
      marginApplied: false,
    });
  });
  await t.test("the adapter table before the catalogue", () => {
    assert.deepEqual(resolveWindow({ adapter: 100000, catalogue: 200000 }), {
      tokens: 100000,
      source: "harness-adapter",
      marginApplied: false,
    });
  });
  await t.test("the declared window and the effective one differ: the smaller is used", () => {
    assert.deepEqual(resolveWindow({ declared: 64000, metadata: 128000 }), {
      tokens: 64000,
      source: "declared",
      marginApplied: false,
    });
    // The declared window is the larger one: the effective window stays.
    assert.deepEqual(resolveWindow({ declared: 256000, metadata: 128000 }), {
      tokens: 128000,
      source: "gateway",
      marginApplied: false,
    });
  });
  await t.test("a catalogue value is reduced by the margin of row 89", () => {
    assert.equal(CATALOGUE_MARGIN_CONFIG_KEY, "critic.catalogueWindowMargin");
    assert.equal(CATALOGUE_WINDOW_MARGIN_PERCENT, 20);
    assert.equal(applyMargin(200000), 160000);
    assert.deepEqual(resolveWindow({ catalogue: 200000 }), {
      tokens: 160000,
      source: "catalogue",
      marginApplied: true,
    });
    // The declared window, smaller than the reduced catalogue value, wins.
    assert.deepEqual(resolveWindow({ declared: 100000, catalogue: 200000 }), {
      tokens: 100000,
      source: "declared",
      marginApplied: false,
    });
  });
  await t.test("no source gives a window: null, and NO default", () => {
    assert.equal(resolveWindow({}), null);
    assert.equal(
      resolveWindow({ declared: null, metadata: null, adapter: null, catalogue: null }),
      null,
    );
  });

  await t.test("the bundled snapshot validates and is read only as `package:catalogue`", () => {
    const read = readBundledCatalogue();
    assert.deepEqual(read.findings, []);
    assert.equal(read.catalogue?.logicalName, BUNDLED_CATALOGUE_LOGICAL_NAME);
    assert.equal(read.catalogue?.date, "2026-09-30");
    const window = catalogueEntryOf(read.catalogue, "example-model");
    assert.equal(window.entry?.contextWindowTokens, 200000);
    assert.equal(window.date, "2026-09-30");
    // A model the catalogue does not name: null, no default.
    assert.deepEqual(catalogueEntryOf(read.catalogue, "no-such-model"), {
      entry: null,
      date: null,
    });
  });

  await t.test(
    "a file at `user:catalogue` is validated on read, and replaces the bundled snapshot where it holds",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "catalogue-146-"));
      await mkdir(home, { recursive: true });
      const good = join(home, "good.json");
      await writeFile(
        good,
        JSON.stringify({
          schema: CATALOGUE_SNAPSHOT_SCHEMA,
          date: "2026-10-01",
          models: [{ model: "example-model", contextWindowTokens: 250000 }],
        }),
      );
      const user = readUserCatalogue(good);
      assert.deepEqual(user.findings, []);
      assert.equal(user.catalogue?.logicalName, USER_CATALOGUE_LOGICAL_NAME);
      assert.equal(user.catalogue?.date, "2026-10-01");
      const selected = selectCatalogue({ userPath: good });
      assert.equal(selected.catalogue?.date, "2026-10-01");
      assert.equal(selected.catalogue?.logicalName, USER_CATALOGUE_LOGICAL_NAME);

      // An invalid user catalogue is refused against the schema, the
      // finding stays, and the bundled snapshot answers instead.
      const bad = join(home, "bad.json");
      await writeFile(
        bad,
        JSON.stringify({
          schema: "specstride.catalogue-snapshot/1",
          date: "2026-10-01",
          models: [{ model: "x" }],
        }),
      );
      const refused = readUserCatalogue(bad);
      assert.equal(refused.catalogue, null);
      assert.equal(refused.findings.length, 1);
      assert.match(refused.findings[0]!.code, /^catalogue-(invalid|unreadable)$/);
      assert.match(refused.findings[0]!.message, /contextWindowTokens/);
      const fallback = selectCatalogue({ userPath: bad });
      assert.equal(fallback.catalogue?.logicalName, BUNDLED_CATALOGUE_LOGICAL_NAME);
      assert.equal(fallback.findings.length, 1);
      // And the window through the rule: the bundled row, reduced.
      const entry = catalogueEntryOf(fallback.catalogue, "example-model").entry;
      assert.deepEqual(resolveWindow({ catalogue: entry!.contextWindowTokens }), {
        tokens: 160000,
        source: "catalogue",
        marginApplied: true,
      });
    },
  );

  await t.test(
    "the schema itself refuses what it states, and the code only applies it",
    async () => {
      const schema = JSON.parse(await readFileOf(CATALOGUE_SCHEMA_PATH)) as Record<string, unknown>;
      assert.equal(
        (schema.properties as Record<string, unknown>).schema &&
          ((schema.properties as Record<string, unknown>).schema as Record<string, unknown>).const,
        CATALOGUE_SNAPSHOT_SCHEMA,
      );
      assert.deepEqual(
        validateAgainstSchema({ schema: "other/1", date: "2026-01-01", models: [] }, schema)
          .length > 0,
        true,
      );
      assert.deepEqual(
        validateAgainstSchema(
          {
            schema: CATALOGUE_SNAPSHOT_SCHEMA,
            date: "2026-01-01",
            models: [{ model: "m", contextWindowTokens: 0 }],
          },
          schema,
        ).length > 0,
        true,
      );
      assert.deepEqual(
        validateAgainstSchema(
          { schema: CATALOGUE_SNAPSHOT_SCHEMA, date: "2026-01-01", models: [{ model: "m" }] },
          schema,
        ).length > 0,
        true,
      );
      assert.deepEqual(
        validateAgainstSchema({ schema: CATALOGUE_SNAPSHOT_SCHEMA, models: [] }, schema).length > 0,
        true,
      );
      assert.deepEqual(
        validateAgainstSchema(
          { schema: CATALOGUE_SNAPSHOT_SCHEMA, date: "2026-01-01", models: [] },
          schema,
        ),
        [],
      );
    },
  );
});

/** Read a file by absolute path, for the schema check above. */
async function readFileOf(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}
