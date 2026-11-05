/**
 * T029 — CT-110-127, the canary test of this feature (F110-FR-032; annex X
 * §X.9 and §X.10; quickstart.md, scenario 6).
 *
 * F110-FR-032 has four sentences and this case covers all four:
 *
 * 1. "A secret MUST be resolved at the moment of use and not earlier" — the
 *    whole configuration is resolved, the run snapshot is built, `config show`
 *    is run, and `registry.resolved()` is asserted EMPTY at each of those
 *    points. Only the call of `resolveAtUse` fetches a value.
 * 2. "Every resolved value MUST be registered with the redactor for exact-match
 *    removal" — the redactor is asked what it holds, and the redacted form of
 *    each artefact is what reaches each sink.
 * 3. "A secret MUST be passed to a harness by environment or by standard input,
 *    and never in an argument list" — the call of the harness is built and its
 *    argument list is scanned; the negative half plants a canary in an argument
 *    list and asserts that the scan finds it.
 * 4. "A secret MUST NOT be written to the run snapshot, the launch record, the
 *    launch contract, an event, a log, the digest, the status output, the read
 *    model or the output of `config show`" — one artefact is built per entry of
 *    `SINKS_A_SECRET_IS_NEVER_WRITTEN_TO` and every one of them is scanned for
 *    every canary.
 *
 * Three canaries, one per scheme of §K.7, each planted where that scheme reads
 * from: a variable of the environment, a real file of mode 0600 outside the
 * workspace, and a real fake keychain tool run through `node:child_process`.
 * Each canary appears nowhere else in the fixture, so a hit names its own
 * scheme.
 */
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { formatDigest } from "@specstride/contracts/grammar/digest";

import {
  SECRET_IN_AN_ARGUMENT_LIST,
  SECRET_IS_PASSED_BY,
  SECRET_IS_RESOLVED_AT,
  SINKS_A_SECRET_IS_NEVER_WRITTEN_TO,
  createSecretBindings,
  createWave1Registry,
  harnessCallWithSecrets,
  nodeToolRunner,
  resolveAtUse,
  secretsInArgumentList,
  type SecretRegistry,
} from "../../src/secrets/index.ts";
import { buildRunSnapshot, isPinnable, snapshotKeys } from "../../src/load/snapshot.ts";
import { provenanceTable, runRecordSources } from "../../src/load/provenance.ts";
import { resolveConfiguration } from "../../src/load/merge.ts";
import { runConfigShow } from "../../src/cli/show.ts";
import { createTestRedactor, type TestRedactor } from "../redactor.ts";

/* ------------------------------------------------------------------ *
 * The three canaries.
 * ------------------------------------------------------------------ */

/** The schemes a canary is planted behind, in the order of §K.7. */
const SCHEMES = ["env:", "file:", "keychain:"] as const;
type Scheme = (typeof SCHEMES)[number];

/** The salt is fixed, so a failing run is reproducible: no clock, no randomness. */
const SALT = "7b3c1a9e5d2f8046" as const;

/** The canary planted behind each scheme. Each value appears nowhere else. */
const CANARY: Readonly<Record<Scheme, string>> = Object.freeze({
  "env:": `CANARY-ENV-${SALT}`,
  "file:": `CANARY-FILE-${SALT}`,
  "keychain:": `CANARY-KEYCHAIN-${SALT}`,
});

/** The configuration key each canary is referred to by. */
const KEY: Readonly<Record<Scheme, string>> = Object.freeze({
  "env:": "roles.proposer.credential",
  "file:": "roles.critic.credential",
  "keychain:": "harnesses.codex.auth.credential",
});

/** The host each reference is bound to (F110-FR-033). */
const HOST = "api.example.invalid" as const;
const ENDPOINT = `https://${HOST}/v1` as const;

let root = "";
let workspaceRoot = "";
let controlRoot = "";
let home = "";
let outside = "";
let secretFilePath = "";
let keychainTool = "";
let keychainLog = "";
let reference: Readonly<Record<Scheme, string>>;

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "specstride-110-canary-")));
  workspaceRoot = join(root, "workspace");
  controlRoot = join(root, "control");
  home = join(root, "home");
  outside = join(root, "outside");
  for (const dir of [workspaceRoot, controlRoot, home, outside])
    mkdirSync(dir, { recursive: true });

  // `file:` — a real file, mode 0600, outside the workspace and the control plane.
  secretFilePath = join(outside, "critic-credential");
  writeFileSync(secretFilePath, `${CANARY["file:"]}\n`);
  chmodSync(secretFilePath, 0o600);

  // `keychain:` — a real executable that prints the canary on a lookup.
  keychainLog = join(outside, "keychain.log");
  keychainTool = join(outside, "fake-secret-tool");
  writeFileSync(
    keychainTool,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> ${JSON.stringify(keychainLog)}`,
      'case " $* " in',
      '  *" canary-service "*) ;;',
      "  *) exit 1 ;;",
      "esac",
      `printf '%s\\n' ${JSON.stringify(CANARY["keychain:"])}`,
      "",
    ].join("\n"),
  );
  chmodSync(keychainTool, 0o700);
  writeFileSync(keychainLog, "");

  reference = Object.freeze({
    "env:": "env:SPECSTRIDE_CANARY_PROPOSER_CREDENTIAL",
    "file:": `file:${secretFilePath}`,
    "keychain:": "keychain:canary-service/canary-account",
  });
});

after(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

/** The environment of the runtime: the `env:` canary and nothing else of note. */
function environment(): Readonly<Record<string, string>> {
  return Object.freeze({ SPECSTRIDE_CANARY_PROPOSER_CREDENTIAL: CANARY["env:"] });
}

/** The command line of the launch: the three references, as `--set` flags. */
function argv(): readonly string[] {
  return Object.freeze([
    "--set",
    `${KEY["env:"]}=${reference["env:"]}`,
    "--set",
    `${KEY["file:"]}=${reference["file:"]}`,
    "--set",
    `${KEY["keychain:"]}=${reference["keychain:"]}`,
  ]);
}

/** The registry of Wave 1, with the bindings of the three declarations. */
function wave1(redactor: TestRedactor): SecretRegistry {
  const bindings = createSecretBindings(
    SCHEMES.map((scheme) => ({
      key: KEY[scheme],
      reference: reference[scheme],
      harnessId: "codex",
      kind: "openai-chat",
      endpoint: ENDPOINT,
      endpointLayer: "U" as const,
    })),
  );
  return createWave1Registry({
    redactor,
    environment: environment(),
    workspaceRoot,
    controlRoot,
    home,
    bindings,
    platform: "linux",
    keychainCommand: keychainTool,
    keychainRun: nodeToolRunner,
  });
}

/** Every artefact and sink of F110-FR-032, as text the scan reads. */
interface Artefacts {
  readonly texts: Readonly<Record<string, readonly string[]>>;
  readonly argv: readonly string[];
  readonly childEnvironment: Readonly<Record<string, string>>;
  readonly stdin: string;
  readonly resolved: Readonly<Record<Scheme, string>>;
  readonly registered: readonly string[];
}

/**
 * Run the launch: resolve the configuration, build every artefact of
 * F110-FR-032's fourth sentence, resolve the three secrets at the moment of use
 * and hand them to a harness. Nothing is redacted by hand: the artefacts that
 * carry run content pass the ONE point of redaction, and the records of this
 * feature carry the reference and never the value by construction.
 */
async function runTheLaunch(redactor: TestRedactor): Promise<Artefacts> {
  const registry = wave1(redactor);
  const sources = { argv: argv(), environment: environment() };
  const resolved = resolveConfiguration(sources);
  assert.deepEqual(
    resolved.errors.map((error) => error.message),
    [],
  );

  // F110-FR-032, first sentence — nothing is resolved yet.
  assert.deepEqual(registry.resolved(), []);

  // 1. the run snapshot
  const snapshot = buildRunSnapshot({
    runId: "canary-run",
    createdAt: "2026-10-01T00:00:00.000Z",
    profile: resolved.profile,
    values: resolved.values,
  });

  // 2. the launch record — the provenance of every key that was set.
  const records = provenanceTable(resolved.values);
  const launchRecord = {
    schema: "canary.launch-record/1",
    launchId: "canary-launch",
    runId: "canary-run",
    sources: runRecordSources(records),
    keys: Object.fromEntries(
      records
        .filter((record) => record.source !== "default")
        .map((record) => [record.key, { value: record.value, source: record.source }]),
    ),
  };

  // 3. the launch contract — the pins it may carry. A key of the type secret
  //    ref is not pinnable, which is why the contract holds no reference either.
  for (const scheme of SCHEMES) assert.equal(isPinnable(KEY[scheme]), false);
  const launchContract = {
    schema: "canary.launch-contract/1",
    pins: {},
    argv: [...argv()],
  };

  // 4. an event, 5. a log, 7. the status output, 8. the read model — run
  //    content, through the one point of redaction.
  const cap = 65536;
  const passOutput =
    `the proposer authenticated with the credential of ` +
    `${KEY["env:"]} and the check printed its own copy\n`;
  const event = {
    schema: "specstride.event",
    v: 1,
    seq: 1,
    type: "pass.completed",
    runId: "canary-run",
    data: { text: redactor.redact(passOutput, cap).text },
  };
  const logLine = redactor.redact(`[pass 1] ${passOutput}`, cap).text;
  const statusOutput = redactor.redact("run=canary-run st=running validUntil=none", cap).text;
  const readModel = {
    schema: "canary.view/1",
    state: "running",
    lastPass: { output: redactor.redact(passOutput, cap).text },
  };

  // 6. the digest
  const digestLine = formatDigest({
    state: "completed",
    exit: 0,
    lastStage: "specstride",
    evidence: "phase:5:evidence",
  });

  // 9. the output of `config show` — the real command, all three forms.
  const show = runConfigShow({ sources });
  const showAll = runConfigShow({ sources, argv: ["--all"] });
  const showJson = runConfigShow({ sources, argv: ["--json", "--all"] });
  assert.equal(show.code, 0);
  assert.equal(showAll.code, 0);
  assert.equal(showJson.code, 0);

  // Still nothing resolved: building every artefact did not fetch a value.
  assert.deepEqual(registry.resolved(), []);

  // THE MOMENT OF USE. Each secret is resolved now, and only now.
  const values: Record<Scheme, string> = {} as Record<Scheme, string>;
  for (const scheme of SCHEMES) {
    const result = await resolveAtUse({
      registry,
      use: { key: KEY[scheme], reference: reference[scheme], host: HOST },
    });
    assert.equal(result.registeredWithTheRedactor, true);
    values[scheme] = result.value;
  }
  assert.deepEqual(
    [...registry.resolved()],
    SCHEMES.map((scheme) => reference[scheme]),
  );

  // The harness call: by environment and by standard input, never in the argv.
  const call = harnessCallWithSecrets({
    argv: ["/usr/bin/codex", "exec", "--model", "gpt-5", "--prompt-file", "/tmp/prompt"],
    byEnvironment: {
      OPENAI_API_KEY: values["env:"],
      CRITIC_CREDENTIAL: values["file:"],
    },
    byStandardInput: values["keychain:"],
    environment: { PATH: "/usr/bin" },
  });

  return Object.freeze({
    texts: Object.freeze({
      "the run snapshot": Object.freeze([
        JSON.stringify(snapshot),
        JSON.stringify(snapshotKeys(resolved.values)),
      ]),
      "the launch record": Object.freeze([JSON.stringify(launchRecord)]),
      "the launch contract": Object.freeze([JSON.stringify(launchContract)]),
      "an event": Object.freeze([JSON.stringify(event)]),
      "a log": Object.freeze([logLine]),
      "the digest": Object.freeze([digestLine]),
      "the status output": Object.freeze([statusOutput]),
      "the read model": Object.freeze([JSON.stringify(readModel)]),
      "the output of `config show`": Object.freeze([
        show.stdout,
        show.stderr,
        showAll.stdout,
        showAll.stderr,
        showJson.stdout,
        showJson.stderr,
      ]),
    }),
    argv: call.argv,
    childEnvironment: call.environment,
    stdin: call.stdin,
    resolved: Object.freeze(values),
    registered: redactor.registered(),
  });
}

/** One hit of the scan: the sink, the scheme and the line. */
interface Hit {
  readonly sink: string;
  readonly scheme: Scheme;
  readonly line: number;
}

/** Scan every sink for every canary. Zero hits is the pass. */
function scan(artefacts: Artefacts): readonly Hit[] {
  const hits: Hit[] = [];
  for (const [sink, lines] of Object.entries(artefacts.texts)) {
    for (const [index, text] of lines.entries()) {
      for (const scheme of SCHEMES) {
        if (text.includes(CANARY[scheme])) hits.push({ sink, scheme, line: index + 1 });
      }
    }
  }
  for (const [index, argument] of artefacts.argv.entries()) {
    for (const scheme of SCHEMES) {
      if (argument.includes(CANARY[scheme])) {
        hits.push({ sink: "an argument list", scheme, line: index + 1 });
      }
    }
  }
  return Object.freeze(hits);
}

function formatHits(hits: readonly Hit[]): string {
  return hits
    .map((hit) => `the canary behind \`${hit.scheme}\` reached ${hit.sink}, line ${hit.line}`)
    .join("; ");
}

/* ================================================================== *
 * CT-110-127
 * ================================================================== */

describe("CT-110-127: no canary behind `env:`, `file:` or `keychain:` reaches any artifact, sink or argument list (F110-FR-032)", () => {
  it("the fixture is sound: three distinct canaries, each planted only where its scheme reads", () => {
    const values = SCHEMES.map((scheme) => CANARY[scheme]);
    assert.equal(new Set(values).size, SCHEMES.length);
    // `env:` is in the environment only.
    assert.equal(environment()["SPECSTRIDE_CANARY_PROPOSER_CREDENTIAL"], CANARY["env:"]);
    // `file:` is in the file on disk only, read back through an independent path.
    assert.equal(readFileSync(secretFilePath, "utf8"), `${CANARY["file:"]}\n`);
    // `keychain:` is in the fake tool's script only.
    const script = readFileSync(keychainTool, "utf8");
    assert.ok(script.includes(CANARY["keychain:"]));
    for (const scheme of SCHEMES) {
      const elsewhere = [
        environment()["SPECSTRIDE_CANARY_PROPOSER_CREDENTIAL"] ?? "",
        readFileSync(secretFilePath, "utf8"),
        script,
      ].filter((text) => text.includes(CANARY[scheme]));
      assert.equal(elsewhere.length, 1, `the canary behind \`${scheme}\` is planted twice`);
    }
    // No canary is in the command line of the launch: only the references are.
    for (const scheme of SCHEMES) {
      assert.equal(argv().join(" ").includes(CANARY[scheme]), false);
    }
  });

  it("all three canaries are really resolved, so the scan is not vacuous", async () => {
    const redactor = createTestRedactor();
    const artefacts = await runTheLaunch(redactor);
    for (const scheme of SCHEMES) {
      assert.equal(
        artefacts.resolved[scheme],
        CANARY[scheme],
        `the canary behind \`${scheme}\` was not resolved`,
      );
    }
    // F110-FR-032, second sentence — every resolved value is registered.
    assert.deepEqual(
      [...artefacts.registered].sort(),
      SCHEMES.map((scheme) => CANARY[scheme]).sort(),
    );
  });

  it("every artifact and sink of F110-FR-032 is covered, and none holds a canary", async () => {
    const redactor = createTestRedactor();
    const artefacts = await runTheLaunch(redactor);
    // The list of sinks is the requirement's own, read from the port.
    assert.deepEqual(
      Object.keys(artefacts.texts).sort(),
      [...SINKS_A_SECRET_IS_NEVER_WRITTEN_TO].sort(),
    );
    assert.equal(Object.keys(artefacts.texts).length, 9);
    for (const lines of Object.values(artefacts.texts)) assert.ok(lines.length > 0);
    const hits = scan(artefacts);
    assert.deepEqual(hits, [], formatHits(hits));
  });

  it("the reference, and not the value, is what the records carry", async () => {
    const redactor = createTestRedactor();
    const artefacts = await runTheLaunch(redactor);
    for (const scheme of SCHEMES) {
      assert.ok(
        artefacts.texts["the run snapshot"]?.[0]?.includes(reference[scheme]),
        `the snapshot must carry the reference \`${reference[scheme]}\``,
      );
      assert.ok(artefacts.texts["the launch record"]?.[0]?.includes(reference[scheme]));
    }
  });

  it("a secret is passed by environment or standard input, and the argument list holds none", async () => {
    const redactor = createTestRedactor();
    const artefacts = await runTheLaunch(redactor);
    assert.deepEqual([...SECRET_IS_PASSED_BY], ["environment", "standard input"]);
    assert.equal(SECRET_IN_AN_ARGUMENT_LIST, false);
    assert.equal(SECRET_IS_RESOLVED_AT, "the moment of use");
    // The two paths that MAY carry a secret really do, so the empty argument
    // list is not the result of nothing being passed at all.
    assert.equal(artefacts.childEnvironment["OPENAI_API_KEY"], CANARY["env:"]);
    assert.equal(artefacts.childEnvironment["CRITIC_CREDENTIAL"], CANARY["file:"]);
    assert.equal(artefacts.stdin, CANARY["keychain:"]);
    assert.deepEqual(
      secretsInArgumentList(
        artefacts.argv,
        SCHEMES.map((scheme) => CANARY[scheme]),
      ),
      [],
    );
  });

  it("the negative half: a canary planted in an argument list IS found, and the build refuses it", () => {
    const planted = ["/usr/bin/codex", `--api-key=${CANARY["env:"]}`, "exec"];
    const hits = secretsInArgumentList(planted, [CANARY["env:"]]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.index, 1);
    // The report itself prints no value.
    assert.equal(hits[0]?.redacted.includes(CANARY["env:"]), false);
    assert.match(hits[0]?.redacted ?? "", /\[redacted\]/);
    assert.throws(
      () =>
        harnessCallWithSecrets({
          argv: planted,
          byEnvironment: { OPENAI_API_KEY: CANARY["env:"] },
        }),
      /never in an argument list \(F110-FR-032\)/,
    );
  });

  it("the negative half of the scan: a canary written into a sink would be found", async () => {
    const redactor = createTestRedactor();
    const artefacts = await runTheLaunch(redactor);
    const poisoned: Artefacts = Object.freeze({
      ...artefacts,
      texts: Object.freeze({
        ...artefacts.texts,
        "a log": Object.freeze([`[pass 1] the key was ${CANARY["keychain:"]}\n`]),
      }),
    });
    const hits = scan(poisoned);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.sink, "a log");
    assert.equal(hits[0]?.scheme, "keychain:");
    assert.match(formatHits(hits), /keychain:.*reached a log/);
  });

  it("the keychain tool was really run, and its argument list carried no canary", async () => {
    writeFileSync(keychainLog, "");
    const redactor = createTestRedactor();
    await runTheLaunch(redactor);
    const invocations = readFileSync(keychainLog, "utf8")
      .split("\n")
      .filter((line) => line !== "");
    assert.ok(invocations.length >= 1, "the keychain tool was never run");
    for (const invocation of invocations) {
      assert.equal(invocation.includes(CANARY["keychain:"]), false);
      assert.match(invocation, /^lookup service canary-service account canary-account$/);
    }
  });
});
