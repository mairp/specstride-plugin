/**
 * T028 — CT-110-122 to CT-110-126 (F110-FR-027 to F110-FR-031).
 *
 * These are integration tests of the three resolvers of Wave 1. Nothing is
 * simulated that can be real:
 *
 * - the `file:` cases write real files into a throw-away directory under the
 *   system temporary directory, set real mode bits with `chmod`, build real
 *   symbolic links, and read the resolver's answer back against the bytes on
 *   disk and their sha-256;
 * - the `keychain:` cases run a REAL executable — a fake keychain tool written
 *   into the same directory — through the real `node:child_process` seam, and
 *   read what the resolver did from the invocation log that the fake tool
 *   writes itself. So "the tool was not run" is observed, not assumed;
 * - the `env:` cases hand the resolver an environment of their own and prove
 *   that `process.env` is not consulted.
 *
 * Every case checks its negative half: the value never reaches a message, a
 * record or an argument list, and `exists` never returns it.
 *
 * CT-110-122 (F110-FR-027): an inline secret, by the type of the key and
 *   through the redactor.
 * CT-110-123 (F110-FR-028): the four operations, the three errors, the three
 *   results of `exists`, no network call, a failure gives `missing`.
 * CT-110-124 (F110-FR-029): the scheme `env:`.
 * CT-110-125 (F110-FR-030): the scheme `file:` — the workspace path, the mode
 *   bits, the links.
 * CT-110-126 (F110-FR-031): the scheme `keychain:` with a fake tool.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { after, describe, it } from "node:test";

import {
  KEYCHAIN_EXISTENCE_ON_LINUX,
  unknownValueOutcome,
} from "@specstride/contracts/ep/secret-resolver";

import {
  ENVIRONMENT_NAME,
  ENV_RESOLVER_ID,
  ENV_SCHEME,
  EXISTENCE_RESULTS,
  FALLS_BACK_TO_A_QUERY_THAT_PRINTS_THE_VALUE,
  FILE_RESOLVER_ID,
  FILE_SCHEME,
  FORBIDDEN_MODE_BITS,
  INLINE_DETECTORS,
  KEYCHAIN_RESOLVER_ID,
  KEYCHAIN_SCHEME,
  KEYCHAIN_TOOLS,
  RESOLVER_ERRORS,
  RESOLVER_OPERATIONS,
  SCHEME_FORM,
  SECRET_SCHEMES,
  SecretError,
  VALUE_WITHHELD,
  WAVE_1_REGISTERED_SCHEMES,
  A_RESOLVER_MAKES_A_NETWORK_CALL,
  createEnvResolver,
  createFileResolver,
  createKeychainResolver,
  createSecretRegistry,
  createWave1Registry,
  existenceOnPlatform,
  expandHome,
  inlineSecretFindings,
  isOwnerReadableOnly,
  keychainArgvCarriesNoValue,
  nodeToolRunner,
  parseKeychainTarget,
  parseSecretReference,
  pathIsInside,
  stripOneFinalLineEnd,
  unknownSchemeError,
  type ConfigSecretResolver,
} from "../../src/secrets/index.ts";
import { SECRET_REFERENCE, loadConfigFiles, type FileEnvironment } from "../../src/load/files.ts";
import { ConfigValueError } from "../../src/schema/types.ts";
import { createTestRedactor, SAMPLE_PATTERNS } from "../redactor.ts";

const ROOTS: string[] = [];
after(() => {
  for (const root of ROOTS) rmSync(root, { recursive: true, force: true });
});

/** A throw-away directory of one case, removed when the file is done. */
function freshRoot(name: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `specstride-110-${name}-`)));
  ROOTS.push(root);
  return root;
}

/** A workspace, a control plane and a home, each a real directory on disk. */
interface Places {
  readonly root: string;
  readonly workspaceRoot: string;
  readonly controlRoot: string;
  readonly home: string;
  readonly outside: string;
}

function places(name: string): Places {
  const root = freshRoot(name);
  const workspaceRoot = join(root, "workspace");
  const controlRoot = join(root, "control");
  const home = join(root, "home");
  const outside = join(root, "outside");
  for (const dir of [workspaceRoot, controlRoot, home, outside]) {
    mkdirSync(dir, { recursive: true });
  }
  return Object.freeze({ root, workspaceRoot, controlRoot, home, outside });
}

/** Write a secret file with the mode it should carry, and return its path. */
function secretFile(dir: string, name: string, content: string, mode = 0o600): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  chmodSync(path, mode);
  return path;
}

/** The sha-256 of the bytes on disk: the independent read path of a case. */
function digestOf(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/* ------------------------------------------------------------------ *
 * The fake keychain tool: a real executable, with its own log.
 * ------------------------------------------------------------------ */

/** A fake keychain tool on disk, with the log it writes of every invocation. */
interface FakeTool {
  /** The absolute path of the executable. */
  readonly command: string;
  /** The log file the tool appends one line to per invocation. */
  readonly log: string;
  /** The invocations so far: one entry per line of the log. */
  invocations(): readonly string[];
}

/**
 * Write a fake keychain tool. It behaves like the tools of §T001: with the
 * argument list of a lookup of the known entry it prints the value and exits 0;
 * with any other entry it prints nothing and exits 1. Every invocation is
 * appended to a log with its whole argument list, so a test can see what the
 * resolver ran — and that it ran nothing at all.
 */
function fakeKeychainTool(
  dir: string,
  input: {
    readonly name: string;
    readonly service: string;
    readonly account: string;
    readonly value: string;
  },
): FakeTool {
  const log = join(dir, `${input.name}.log`);
  const command = join(dir, input.name);
  // The script writes its own argument list to the log before it answers, so a
  // test reads the invocation from a path that is not the resolver's answer.
  writeFileSync(
    command,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      `for a in "$@"; do`,
      `  if [ "$a" = ${JSON.stringify(input.service)} ]; then found_service=1; fi`,
      `  if [ "$a" = ${JSON.stringify(input.account)} ]; then found_account=1; fi`,
      "done",
      `if [ "$found_service" = 1 ] && [ "$found_account" = 1 ]; then`,
      `  case " $* " in`,
      `    *" -w "*) printf '%s\\n' ${JSON.stringify(input.value)} ;;`,
      `    *"lookup"*) printf '%s\\n' ${JSON.stringify(input.value)} ;;`,
      `    *) printf 'service: %s\\n' ${JSON.stringify(input.service)} ;;`,
      "  esac",
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(command, 0o700);
  writeFileSync(log, "");
  return Object.freeze({
    command,
    log,
    invocations(): readonly string[] {
      return Object.freeze(
        readFileSync(log, "utf8")
          .split("\n")
          .filter((line) => line !== ""),
      );
    },
  });
}

/* ================================================================== *
 * CT-110-122 — F110-FR-027: an inline secret
 * ================================================================== */

describe("CT-110-122: a secret in configuration is a reference; an inline value is an error (F110-FR-027)", () => {
  const CREDENTIAL_KEY = "roles.critic.credential";
  const LITERAL = "AKIA00000000EXAMPLE";

  it("there is ONE reference grammar in the product: the loader's and the resolvers' agree", () => {
    assert.equal(SCHEME_FORM.source, SECRET_REFERENCE.source);
    assert.deepEqual([...SECRET_SCHEMES], ["env:", "file:", "keychain:"]);
    assert.deepEqual([...WAVE_1_REGISTERED_SCHEMES], [...SECRET_SCHEMES]);
    assert.deepEqual(parseSecretReference("env:A_KEY"), { scheme: "env:", target: "A_KEY" });
    assert.equal(parseSecretReference(LITERAL), undefined);
  });

  it("a key of the type secret ref whose value is not a reference is `inline-secret`, by the type", () => {
    const redactor = createTestRedactor();
    const registry = createWave1Registry({
      redactor,
      environment: {},
      workspaceRoot: "/w",
      controlRoot: "/c",
      home: "/h",
    });
    const findings = inlineSecretFindings({
      values: [
        {
          key: CREDENTIAL_KEY,
          value: LITERAL,
          layer: "user-configuration",
          place: "/u/config.yaml",
        },
      ],
      redactor,
      registry,
    });
    assert.equal(findings.length, 1);
    const finding = findings[0];
    assert.ok(finding !== undefined);
    assert.equal(finding.detectedBy, "type");
    assert.equal(finding.error.reason, "inline-secret");
    assert.equal(finding.error.key, CREDENTIAL_KEY);
    // The error names the key and NEVER the value (F110-FR-027, last sentence).
    assert.match(finding.error.message, /roles\.critic\.credential/);
    assert.equal(finding.error.message.includes(LITERAL), false);
    assert.equal(finding.error.value, VALUE_WITHHELD);
    assert.ok(finding.error instanceof ConfigValueError);
  });

  it("a reference of a scheme that IS registered passes; one of a scheme nothing handles does not", () => {
    const redactor = createTestRedactor();
    const registry = createWave1Registry({
      redactor,
      environment: { A_KEY: "x" },
      workspaceRoot: "/w",
      controlRoot: "/c",
      home: "/h",
    });
    assert.deepEqual(
      inlineSecretFindings({
        values: [{ key: CREDENTIAL_KEY, value: "env:A_KEY", layer: "user-configuration" }],
        redactor,
        registry,
      }),
      [],
    );
    const unhandled = inlineSecretFindings({
      values: [{ key: CREDENTIAL_KEY, value: "vault:team/key", layer: "user-configuration" }],
      redactor,
      registry,
    });
    assert.equal(unhandled.length, 1);
    assert.equal(unhandled[0]?.detectedBy, "type");
  });

  it("a value in ANY string key that the redactor changes when it passes through `redact` is `inline-secret` too", () => {
    const redactor = createTestRedactor({ patterns: SAMPLE_PATTERNS });
    const planted = "sk-ABCD1234EFGH5678";
    const findings = inlineSecretFindings({
      values: [
        { key: "roles.proposer.model", value: planted, layer: "environment" },
        { key: "roles.proposer.effort", value: "high", layer: "environment" },
      ],
      redactor,
    });
    assert.equal(findings.length, 1);
    const finding = findings[0];
    assert.ok(finding !== undefined);
    assert.equal(finding.key, "roles.proposer.model");
    assert.equal(finding.detectedBy, "redactor");
    assert.equal(finding.error.reason, "inline-secret");
    assert.match(finding.error.message, /redactor of annex X §X\.4/);
    assert.equal(finding.error.message.includes(planted), false);
    assert.deepEqual([...INLINE_DETECTORS], ["type", "redactor"]);
  });

  it("a value the redactor registered as a resolved secret is found in a later layer as well", () => {
    const redactor = createTestRedactor();
    const resolved = "a-value-the-runtime-already-resolved";
    redactor.register(resolved);
    const findings = inlineSecretFindings({
      values: [{ key: "harnesses.claude.label", value: resolved, layer: "project-configuration" }],
      redactor,
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.detectedBy, "redactor");
  });

  it("the file loader refuses a literal in a real file on disk and names the key, not the value", () => {
    const where = places("inline-file");
    const configDir = join(where.home, ".config", "specstride");
    mkdirSync(configDir, { recursive: true });
    const userConfig = join(configDir, "config.yaml");
    writeFileSync(userConfig, `schema: 1\nroles:\n  critic:\n    credential: ${LITERAL}\n`);
    const environment: FileEnvironment = {
      home: where.home,
      xdgConfigHome: join(where.home, ".config"),
      workspaceRealPath: where.workspaceRoot,
    };
    const loaded = loadConfigFiles(environment);
    // The independent read path: the file really is on disk and was read.
    assert.ok(loaded.filesRead.includes(userConfig), loaded.filesRead.join(", "));
    assert.equal(
      digestOf(userConfig),
      createHash("sha256")
        .update(`schema: 1\nroles:\n  critic:\n    credential: ${LITERAL}\n`)
        .digest("hex"),
    );
    const inline = loaded.errors.filter(
      (error): error is ConfigValueError =>
        error instanceof ConfigValueError && error.reason === "inline-secret",
    );
    assert.equal(inline.length, 1);
    assert.equal(inline[0]?.key, CREDENTIAL_KEY);
    assert.equal(inline[0]?.message.includes(LITERAL), false);
  });

  it("the unknown-value rule of §C.11 decides the error, and this feature invents no fourth one", () => {
    assert.equal(unknownValueOutcome(LITERAL, [...SECRET_SCHEMES]), "inline-secret");
    assert.equal(unknownValueOutcome("vault:x", [...SECRET_SCHEMES]), "missing");
    assert.equal(unknownValueOutcome("env:A", [...SECRET_SCHEMES]), undefined);
    const noScheme = unknownSchemeError(LITERAL, SECRET_SCHEMES);
    assert.equal(noScheme.reason, "inline-secret");
    assert.equal(noScheme.isConfigurationError, true);
    const unhandled = unknownSchemeError("vault:x", SECRET_SCHEMES);
    assert.equal(unhandled.reason, "missing");
    assert.equal(unhandled.isConfigurationError, true);
    assert.match(unhandled.message, /env:, file:, keychain:/);
    assert.ok(RESOLVER_ERRORS.includes(unhandled.reason));
  });
});

/* ================================================================== *
 * CT-110-123 — F110-FR-028: the four operations
 * ================================================================== */

describe("CT-110-123: four operations, three errors, three results of `exists`, no network call (F110-FR-028)", () => {
  const where = places("operations");
  const redactor = createTestRedactor();
  const SECRET = "the-value-of-the-entry";
  const tool = fakeKeychainTool(where.outside, {
    name: "fake-secret-tool",
    service: "svc",
    account: "acct",
    value: SECRET,
  });
  secretFile(where.outside, "token", `${SECRET}\n`);

  const resolvers: readonly {
    readonly label: string;
    readonly resolver: ConfigSecretResolver;
    readonly present: string;
    readonly absent: string;
  }[] = Object.freeze([
    Object.freeze({
      label: "env:",
      resolver: createEnvResolver({ environment: { PRESENT: SECRET }, redactor }),
      present: "env:PRESENT",
      absent: "env:ABSENT",
    }),
    Object.freeze({
      label: "file:",
      resolver: createFileResolver({
        workspaceRoot: where.workspaceRoot,
        controlRoot: where.controlRoot,
        home: where.home,
        redactor,
      }),
      present: `file:${join(where.outside, "token")}`,
      absent: `file:${join(where.outside, "nothing-here")}`,
    }),
    Object.freeze({
      label: "keychain:",
      resolver: createKeychainResolver({
        redactor,
        platform: "linux",
        command: tool.command,
        run: nodeToolRunner,
      }),
      present: "keychain:svc/acct",
      absent: "keychain:svc/other",
    }),
  ]);

  it("the operations, the errors and the results of `exists` are the contract's, not restated", () => {
    assert.deepEqual([...RESOLVER_OPERATIONS], ["handles", "exists", "resolve", "boundHost"]);
    assert.deepEqual([...RESOLVER_ERRORS], ["missing", "inline-secret", "unsafe-file"]);
    assert.deepEqual([...EXISTENCE_RESULTS], ["yes", "no", "unprobed"]);
  });

  for (const entry of resolvers) {
    it(`${entry.label} offers the four operations, and \`handles\` answers for its scheme only`, () => {
      for (const operation of RESOLVER_OPERATIONS) {
        assert.equal(
          typeof (entry.resolver as unknown as Record<string, unknown>)[operation],
          "function",
          `${entry.label} must offer \`${operation}\``,
        );
      }
      assert.equal(entry.resolver.handles(entry.resolver.scheme), true);
      assert.equal(entry.resolver.handles("vault:"), false);
    });

    it(`${entry.label}: \`exists\` returns a member of the closed set and never the value`, async () => {
      const yes = await entry.resolver.exists(entry.present);
      assert.ok(EXISTENCE_RESULTS.includes(yes), `${entry.label} returned \`${yes}\``);
      assert.notEqual(yes, SECRET);
      assert.equal(String(yes).includes(SECRET), false);
      const no = await entry.resolver.exists(entry.absent);
      assert.ok(EXISTENCE_RESULTS.includes(no));
      // `env:` and `file:` can answer; `keychain:` on Linux cannot (F110-FR-031).
      assert.equal(yes, entry.label === "keychain:" ? "unprobed" : "yes");
      assert.equal(no, entry.label === "keychain:" ? "unprobed" : "no");
    });

    it(`${entry.label}: \`resolve\` returns the value in memory and registers it with the redactor`, async () => {
      const own = createTestRedactor();
      const resolver =
        entry.label === "env:"
          ? createEnvResolver({ environment: { PRESENT: SECRET }, redactor: own })
          : entry.label === "file:"
            ? createFileResolver({
                workspaceRoot: where.workspaceRoot,
                controlRoot: where.controlRoot,
                home: where.home,
                redactor: own,
              })
            : createKeychainResolver({
                redactor: own,
                platform: "linux",
                command: tool.command,
                run: nodeToolRunner,
              });
      assert.deepEqual(own.registered(), []);
      const resolved = await resolver.resolve(entry.present);
      assert.equal(resolved.value, SECRET);
      assert.equal(resolved.registeredWithTheRedactor, true);
      // The independent read path: the redactor now removes the value.
      assert.deepEqual(own.registered(), [SECRET]);
      assert.equal(
        own.redact(`a log line with ${SECRET} in it`, 4096).text.includes(SECRET),
        false,
      );
      assert.equal(own.replacements(), 1);
    });

    it(`${entry.label}: a resolver that fails gives \`missing\``, async () => {
      await assert.rejects(
        () => entry.resolver.resolve(entry.absent),
        (error: unknown) => {
          assert.ok(error instanceof SecretError);
          assert.equal(error.reason, "missing");
          assert.equal(error.message.includes(SECRET), false);
          assert.equal(error.valueIsNeverCarried, true);
          return true;
        },
      );
    });
  }

  it("`exists` never registers anything: a check is not a use (F110-FR-032)", async () => {
    const own = createTestRedactor();
    const resolver = createFileResolver({
      workspaceRoot: where.workspaceRoot,
      controlRoot: where.controlRoot,
      home: where.home,
      redactor: own,
    });
    assert.equal(await resolver.exists(`file:${join(where.outside, "token")}`), "yes");
    assert.deepEqual(own.registered(), []);
  });

  it("each of the three errors is produced by a real path, and no other kind is", async () => {
    const own = createTestRedactor();
    const fileResolver = createFileResolver({
      workspaceRoot: where.workspaceRoot,
      controlRoot: where.controlRoot,
      home: where.home,
      redactor: own,
    });
    const inside = secretFile(where.workspaceRoot, "in-tree", "x\n");
    const loose = secretFile(where.outside, "loose", "x\n", 0o644);
    const seen = new Set<string>();
    for (const reference of [
      `file:${join(where.outside, "absent")}`,
      "file:not-absolute",
      `file:${inside}`,
      `file:${loose}`,
    ]) {
      await assert.rejects(
        () => fileResolver.resolve(reference),
        (error: unknown) => {
          assert.ok(error instanceof SecretError);
          assert.ok(RESOLVER_ERRORS.includes(error.reason));
          seen.add(error.reason);
          return true;
        },
      );
    }
    assert.deepEqual([...seen].sort(), ["inline-secret", "missing", "unsafe-file"]);
  });

  it("no resolver makes a network call, and `src/secrets/` imports nothing that could", () => {
    assert.equal(A_RESOLVER_MAKES_A_NETWORK_CALL, false);
    for (const entry of resolvers) assert.equal(entry.resolver.makesANetworkCall, false);
    const forbidden = ["node:net", "node:http", "node:https", "node:dgram", "node:tls"];
    const sources = [
      "reference.ts",
      "env.ts",
      "file.ts",
      "keychain.ts",
      "binding.ts",
      "registry.ts",
      "index.ts",
    ];
    for (const name of sources) {
      const text = readFileSync(
        join(import.meta.dirname, "..", "..", "src", "secrets", name),
        "utf8",
      );
      for (const module of forbidden) {
        assert.equal(
          text.includes(`"${module}"`),
          false,
          `src/secrets/${name} must not import ${module} (F110-FR-028)`,
        );
      }
      assert.equal(/\bfetch\s*\(/.test(text), false, `src/secrets/${name} must call no \`fetch\``);
      assert.equal(/\bXMLHttpRequest\b/.test(text), false);
    }
  });

  it("the ids of the three resolvers are distinct, so a report can name them apart", () => {
    assert.deepEqual(
      [ENV_RESOLVER_ID, FILE_RESOLVER_ID, KEYCHAIN_RESOLVER_ID].sort(),
      [...new Set([ENV_RESOLVER_ID, FILE_RESOLVER_ID, KEYCHAIN_RESOLVER_ID])].sort(),
    );
  });
});

/* ================================================================== *
 * CT-110-124 — F110-FR-029: the scheme `env:`
 * ================================================================== */

describe("CT-110-124: the scheme `env:` (F110-FR-029)", () => {
  const SECRET = "env-resolver-value";

  it("resolves to the value of the named variable of the environment of the runtime", async () => {
    const redactor = createTestRedactor();
    const resolver = createEnvResolver({ environment: { A_KEY: SECRET }, redactor });
    assert.equal(resolver.scheme, ENV_SCHEME);
    assert.equal((await resolver.resolve("env:A_KEY")).value, SECRET);
    assert.equal(await resolver.exists("env:A_KEY"), "yes");
  });

  it("reads the environment it was handed and never `process.env`", async () => {
    const name = "SPECSTRIDE_110_CT_124_PROCESS_ENV";
    process.env[name] = "a-value-that-must-not-be-read";
    try {
      const resolver = createEnvResolver({ environment: {}, redactor: createTestRedactor() });
      assert.equal(await resolver.exists(`env:${name}`), "no");
      await assert.rejects(() => resolver.resolve(`env:${name}`), /missing/);
    } finally {
      delete process.env[name];
    }
  });

  it("a name that is not a valid variable name is `inline-secret`", async () => {
    const resolver = createEnvResolver({ environment: {}, redactor: createTestRedactor() });
    assert.equal(ENVIRONMENT_NAME.test("A_KEY"), true);
    assert.equal(ENVIRONMENT_NAME.test("_a1"), true);
    for (const bad of ["1BAD", "A-B", "a key", "", "a.b", "sk-ABCD1234EFGH5678"]) {
      await assert.rejects(
        () => resolver.resolve(`env:${bad}`),
        (error: unknown) => {
          assert.ok(error instanceof SecretError);
          assert.equal(error.reason, "inline-secret");
          assert.equal(error.isConfigurationError, true);
          return true;
        },
        `env:${bad} must be inline-secret`,
      );
      await assert.rejects(() => resolver.exists(`env:${bad}`), /inline-secret/);
    }
  });

  it("an unset or an empty variable is `missing`", async () => {
    const resolver = createEnvResolver({
      environment: { EMPTY: "", SET: "x" },
      redactor: createTestRedactor(),
    });
    assert.equal(await resolver.exists("env:EMPTY"), "no");
    assert.equal(await resolver.exists("env:UNSET"), "no");
    assert.equal(await resolver.exists("env:SET"), "yes");
    for (const reference of ["env:EMPTY", "env:UNSET"]) {
      await assert.rejects(
        () => resolver.resolve(reference),
        (error: unknown) => {
          assert.ok(error instanceof SecretError);
          assert.equal(error.reason, "missing");
          return true;
        },
      );
    }
  });

  it("the resolved value is registered with the redactor for exact-match removal", async () => {
    const redactor = createTestRedactor();
    const resolver = createEnvResolver({ environment: { A_KEY: SECRET }, redactor });
    await resolver.resolve("env:A_KEY");
    assert.deepEqual(redactor.registered(), [SECRET]);
    assert.equal(redactor.redact(SECRET, 64).text.includes(SECRET), false);
  });
});

/* ================================================================== *
 * CT-110-125 — F110-FR-030: the scheme `file:`
 * ================================================================== */

describe("CT-110-125: the scheme `file:` — the workspace path, the mode bits, the links (F110-FR-030)", () => {
  const where = places("file-scheme");
  const SECRET = "file-resolver-value";

  function resolver(redactor = createTestRedactor()) {
    return {
      resolver: createFileResolver({
        workspaceRoot: where.workspaceRoot,
        controlRoot: where.controlRoot,
        home: where.home,
        redactor,
      }),
      redactor,
    };
  }

  it("takes an absolute path, and expands a leading `~/` against the home directory", async () => {
    const path = secretFile(where.home, "token-in-home", `${SECRET}\n`);
    assert.equal(expandHome("~/token-in-home", where.home), path);
    const { resolver: r } = resolver();
    assert.equal((await r.resolve("file:~/token-in-home")).value, SECRET);
    assert.equal((await r.resolve(`file:${path}`)).value, SECRET);
    // The independent read path: the bytes on disk are what was resolved.
    assert.equal(readFileSync(path, "utf8"), `${SECRET}\n`);
    assert.equal(digestOf(path), createHash("sha256").update(`${SECRET}\n`).digest("hex"));
  });

  it("a target that is not an absolute path is `inline-secret`, not a path of a file", async () => {
    const { resolver: r } = resolver();
    for (const bad of ["relative/path", "token", "", "sk-ABCD1234EFGH5678"]) {
      await assert.rejects(
        () => r.resolve(`file:${bad}`),
        (error: unknown) => {
          assert.ok(error instanceof SecretError);
          assert.equal(error.reason, "inline-secret");
          return true;
        },
        `file:${bad}`,
      );
    }
  });

  it("a real path inside the workspace is `unsafe-file`, and the message names the root", async () => {
    const path = secretFile(where.workspaceRoot, "token", `${SECRET}\n`);
    const { resolver: r } = resolver();
    await assert.rejects(
      () => r.resolve(`file:${path}`),
      (error: unknown) => {
        assert.ok(error instanceof SecretError);
        assert.equal(error.reason, "unsafe-file");
        assert.match(error.message, /inside the workspace/);
        assert.equal(error.message.includes(SECRET), false);
        return true;
      },
    );
    await assert.rejects(() => r.exists(`file:${path}`), /unsafe-file/);
    assert.equal(pathIsInside(path, where.workspaceRoot), true);
    assert.equal(pathIsInside(path, where.controlRoot), false);
    // The separator guard: a sibling whose name begins with the root's name.
    assert.equal(pathIsInside(`${where.workspaceRoot}-2/token`, where.workspaceRoot), false);
  });

  it("a real path inside the control plane is `unsafe-file` as well", async () => {
    const path = secretFile(where.controlRoot, "token", `${SECRET}\n`);
    const { resolver: r } = resolver();
    await assert.rejects(
      () => r.resolve(`file:${path}`),
      (error: unknown) => {
        assert.ok(error instanceof SecretError);
        assert.equal(error.reason, "unsafe-file");
        assert.match(error.message, /inside the control plane/);
        return true;
      },
    );
  });

  it("the LINK is followed first: a link outside the workspace to a file inside it is `unsafe-file`", async () => {
    const target = secretFile(where.workspaceRoot, "linked-token", `${SECRET}\n`);
    const link = join(where.outside, "link-into-the-workspace");
    symlinkSync(target, link);
    assert.equal(realpathSync(link), target);
    const { resolver: r } = resolver();
    await assert.rejects(
      () => r.resolve(`file:${link}`),
      (error: unknown) => {
        assert.ok(error instanceof SecretError);
        assert.equal(error.reason, "unsafe-file");
        assert.match(error.message, /has the real path/);
        return true;
      },
    );
  });

  it("the LINK is followed first, the other way too: a link inside the workspace to a file outside it resolves", async () => {
    const target = secretFile(where.outside, "linked-out", `${SECRET}\n`);
    const link = join(where.workspaceRoot, "link-out-of-the-workspace");
    symlinkSync(target, link);
    const { resolver: r } = resolver();
    assert.equal((await r.resolve(`file:${link}`)).value, SECRET);
    assert.equal(realpathSync(link), target);
  });

  it("a file readable by a group or by others is `unsafe-file`, and the message names the mode", async () => {
    const { resolver: r } = resolver();
    assert.equal(FORBIDDEN_MODE_BITS, 0o077);
    for (const mode of [0o640, 0o604, 0o660, 0o666, 0o644]) {
      const path = secretFile(where.outside, `mode-${mode.toString(8)}`, `${SECRET}\n`, mode);
      assert.equal(statSync(path).mode & 0o777, mode);
      assert.equal(isOwnerReadableOnly(mode), false);
      await assert.rejects(
        () => r.resolve(`file:${path}`),
        (error: unknown) => {
          assert.ok(error instanceof SecretError);
          assert.equal(error.reason, "unsafe-file");
          assert.match(error.message, new RegExp(`0${mode.toString(8)}`));
          assert.match(error.message, /readable by a group or by others/);
          return true;
        },
        `mode 0${mode.toString(8)}`,
      );
    }
    for (const mode of [0o600, 0o400]) {
      const path = secretFile(where.outside, `ok-${mode.toString(8)}`, `${SECRET}\n`, mode);
      assert.equal(isOwnerReadableOnly(mode), true);
      assert.equal((await r.resolve(`file:${path}`)).value, SECRET);
    }
  });

  it("ONE final line end is removed, and only one", async () => {
    const { resolver: r } = resolver();
    const cases: readonly [string, string][] = [
      [`${SECRET}\n`, SECRET],
      [`${SECRET}\r\n`, SECRET],
      [`${SECRET}\n\n`, `${SECRET}\n`],
      [SECRET, SECRET],
      [`${SECRET}\n `, `${SECRET}\n `],
    ];
    for (const [written, expected] of cases) {
      assert.equal(stripOneFinalLineEnd(written), expected);
      const path = secretFile(
        where.outside,
        `line-end-${cases.indexOf([written, expected])}-${written.length}`,
        written,
      );
      assert.equal((await r.resolve(`file:${path}`)).value, expected);
      assert.equal(readFileSync(path, "utf8"), written);
    }
  });

  it("an absent or an empty file is `missing`", async () => {
    const { resolver: r } = resolver();
    const empty = secretFile(where.outside, "empty", "");
    const onlyLineEnd = secretFile(where.outside, "only-line-end", "\n");
    assert.equal(statSync(empty).size, 0);
    assert.equal(await r.exists(`file:${empty}`), "no");
    assert.equal(await r.exists(`file:${join(where.outside, "absent")}`), "no");
    for (const reference of [
      `file:${empty}`,
      `file:${onlyLineEnd}`,
      `file:${join(where.outside, "absent")}`,
    ]) {
      await assert.rejects(
        () => r.resolve(reference),
        (error: unknown) => {
          assert.ok(error instanceof SecretError);
          assert.equal(error.reason, "missing");
          return true;
        },
        reference,
      );
    }
  });

  it("the resolved value is registered with the redactor", async () => {
    const path = secretFile(where.outside, "registered", `${SECRET}\n`);
    const { resolver: r, redactor } = resolver();
    await r.resolve(`file:${path}`);
    assert.deepEqual(redactor.registered(), [SECRET]);
  });

  it("the scheme is `file:` and nothing else reaches it", async () => {
    const { resolver: r } = resolver();
    assert.equal(r.scheme, FILE_SCHEME);
    assert.equal(r.handles(FILE_SCHEME), true);
    assert.equal(r.handles(ENV_SCHEME), false);
    assert.equal(await r.exists("env:A_KEY"), "no");
  });
});

/* ================================================================== *
 * CT-110-126 — F110-FR-031: the scheme `keychain:` with a fake tool
 * ================================================================== */

describe("CT-110-126: the scheme `keychain:` with a fake tool (F110-FR-031)", () => {
  const where = places("keychain");
  const SECRET = "keychain-entry-value";

  it("names an entry by service and account, and a malformed target is `inline-secret`", async () => {
    assert.deepEqual(parseKeychainTarget("svc/acct"), { service: "svc", account: "acct" });
    assert.equal(parseKeychainTarget("noslash"), undefined);
    assert.equal(parseKeychainTarget("a/b/c"), undefined);
    const resolver = createKeychainResolver({
      redactor: createTestRedactor(),
      platform: "linux",
      command: "/nonexistent",
    });
    for (const bad of ["noslash", "a/b/c", ""]) {
      await assert.rejects(
        () => resolver.resolve(`keychain:${bad}`),
        (error: unknown) => {
          assert.ok(error instanceof SecretError);
          assert.equal(error.reason, "inline-secret");
          return true;
        },
        `keychain:${bad}`,
      );
    }
  });

  it("on Linux `exists` is `unprobed` and the tool is NOT RUN: the log of the fake tool stays empty", async () => {
    const tool = fakeKeychainTool(where.outside, {
      name: "fake-secret-tool-exists",
      service: "svc",
      account: "acct",
      value: SECRET,
    });
    const resolver = createKeychainResolver({
      redactor: createTestRedactor(),
      platform: "linux",
      command: tool.command,
      run: nodeToolRunner,
    });
    assert.equal(await resolver.exists("keychain:svc/acct"), "unprobed");
    assert.equal(await resolver.exists("keychain:svc/absent"), "unprobed");
    // The tool wrote nothing: nothing was run, so no value could be printed.
    assert.deepEqual(tool.invocations(), []);
    assert.equal(existenceOnPlatform("linux"), "unprobed");
    assert.equal(KEYCHAIN_EXISTENCE_ON_LINUX, "unprobed");
    assert.equal(FALLS_BACK_TO_A_QUERY_THAT_PRINTS_THE_VALUE, false);
    assert.equal(KEYCHAIN_TOOLS["linux"]?.silentExistenceArgv, null);
    assert.equal(KEYCHAIN_TOOLS["linux"]?.command, "secret-tool");
  });

  it("`resolve` still works where the tool is present, through the real process seam", async () => {
    const tool = fakeKeychainTool(where.outside, {
      name: "fake-secret-tool-resolve",
      service: "svc",
      account: "acct",
      value: SECRET,
    });
    const redactor = createTestRedactor();
    const resolver = createKeychainResolver({
      redactor,
      platform: "linux",
      command: tool.command,
      run: nodeToolRunner,
    });
    const resolved = await resolver.resolve("keychain:svc/acct");
    assert.equal(resolved.value, SECRET);
    assert.equal(resolved.registeredWithTheRedactor, true);
    assert.deepEqual(redactor.registered(), [SECRET]);
    // The tool really ran, once, with the argument list of a lookup.
    const invocations = tool.invocations();
    assert.equal(invocations.length, 1);
    assert.match(invocations[0] ?? "", /^lookup service svc account acct$/);
    // F110-FR-032 — the service and the account travel in the argument list;
    // the VALUE never does.
    assert.equal(keychainArgvCarriesNoValue((invocations[0] ?? "").split(" "), SECRET), true);
    assert.equal((invocations[0] ?? "").includes(SECRET), false);
    assert.equal(KEYCHAIN_SCHEME, "keychain:");
    assert.equal(resolver.scheme, KEYCHAIN_SCHEME);
  });

  it("an entry the tool does not return is `missing`, and an absent tool is `missing` too", async () => {
    const tool = fakeKeychainTool(where.outside, {
      name: "fake-secret-tool-missing",
      service: "svc",
      account: "acct",
      value: SECRET,
    });
    const resolver = createKeychainResolver({
      redactor: createTestRedactor(),
      platform: "linux",
      command: tool.command,
      run: nodeToolRunner,
    });
    await assert.rejects(
      () => resolver.resolve("keychain:svc/absent"),
      (error: unknown) => {
        assert.ok(error instanceof SecretError);
        assert.equal(error.reason, "missing");
        assert.equal(error.message.includes(SECRET), false);
        return true;
      },
    );
    assert.equal(tool.invocations().length, 1);
    const absent = createKeychainResolver({
      redactor: createTestRedactor(),
      platform: "linux",
      command: join(where.outside, "no-such-tool"),
      run: nodeToolRunner,
    });
    await assert.rejects(() => absent.resolve("keychain:svc/acct"), /missing/);
  });

  it("the value printed with a final line end has exactly one removed", async () => {
    const tool = fakeKeychainTool(where.outside, {
      name: "fake-secret-tool-line-end",
      service: "svc",
      account: "acct",
      value: SECRET,
    });
    const resolver = createKeychainResolver({
      redactor: createTestRedactor(),
      platform: "linux",
      command: tool.command,
      run: nodeToolRunner,
    });
    // The fake tool prints `VALUE\n`, as the real tools do.
    assert.equal((await resolver.resolve("keychain:svc/acct")).value, SECRET);
  });

  it("a platform whose row knows a SILENT query answers by exit status alone, and prints no value", async () => {
    const tool = fakeKeychainTool(where.outside, {
      name: "fake-security",
      service: "svc",
      account: "acct",
      value: SECRET,
    });
    const resolver = createKeychainResolver({
      redactor: createTestRedactor(),
      platform: "darwin",
      command: tool.command,
      run: nodeToolRunner,
    });
    assert.equal(existenceOnPlatform("darwin"), undefined);
    assert.equal(await resolver.exists("keychain:svc/acct"), "yes");
    assert.equal(await resolver.exists("keychain:svc/absent"), "no");
    const invocations = tool.invocations();
    assert.equal(invocations.length, 2);
    for (const invocation of invocations) {
      // The silent query of the row carries no `-w`, so the tool prints the
      // attributes of the entry and not the value.
      assert.equal(invocation.includes("-w"), false);
      assert.match(invocation, /^find-generic-password -s svc -a /);
    }
    // The row of macOS stays `unverified` (F110-FR-031, last sentence): a fake
    // tool exercises the code path and is no probe of the platform.
    assert.equal(KEYCHAIN_TOOLS["darwin"]?.verified, false);
    assert.match(KEYCHAIN_TOOLS["darwin"]?.unverifiedReason ?? "", /`unverified`/);
    assert.equal(KEYCHAIN_TOOLS["linux"]?.verified, true);
  });

  it("an unknown platform is `unprobed` and resolves to `missing`", async () => {
    const resolver = createKeychainResolver({
      redactor: createTestRedactor(),
      platform: "sunos",
      run: nodeToolRunner,
    });
    assert.equal(await resolver.exists("keychain:svc/acct"), "unprobed");
    await assert.rejects(() => resolver.resolve("keychain:svc/acct"), /missing/);
  });

  it("the registry of this feature is open and holds exactly the three schemes of §K.7", () => {
    const empty = createSecretRegistry();
    assert.deepEqual([...empty.schemes], []);
    const redactor = createTestRedactor();
    const registry = createWave1Registry({
      redactor,
      environment: {},
      workspaceRoot: where.workspaceRoot,
      controlRoot: where.controlRoot,
      home: where.home,
    });
    assert.deepEqual([...registry.schemes], ["env:", "file:", "keychain:"]);
    assert.deepEqual(
      [...registry.resolverIds],
      [ENV_RESOLVER_ID, FILE_RESOLVER_ID, KEYCHAIN_RESOLVER_ID],
    );
  });
});
