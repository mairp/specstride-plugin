/**
 * T005 — characterization test CT-146-4 of the guarded reader
 * (F146-FR-004): the reader offers presence and existence only, refuses
 * every path of the deny-list, and asks the secret resolver for `exists`
 * only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DENY_LIST, GuardedReader, deniedRuleOf } from "../../src/discovery/guarded-reader.ts";
import type { SecretResolver } from "@specstride/contracts/ep/secret-resolver";

const MODULE_URL = new URL("../../src/discovery/guarded-reader.ts", import.meta.url);

/** A resolver that records every operation the reader asks of it. */
function tracedResolver(answers: ReadonlyMap<string, "yes" | "no" | "unprobed">): {
  resolver: SecretResolver;
  asked: string[];
  touched: string[];
} {
  const asked: string[] = [];
  const touched: string[] = [];
  const resolver = new Proxy({} as SecretResolver, {
    get(_target, property, receiver) {
      const name = String(property);
      touched.push(name);
      if (name === "exists") {
        return (reference: string): Promise<"yes" | "no" | "unprobed"> => {
          asked.push(reference);
          return Promise.resolve(answers.get(reference) ?? "no");
        };
      }
      return Reflect.get(_target, property, receiver);
    },
  });
  return { resolver, asked, touched };
}

test("CT-146-4: the reader offers presence and existence only", async () => {
  // The surface of the reader: three questions of presence or existence,
  // and the trace. No operation reads, opens or lists anything.
  const operations = Object.getOwnPropertyNames(GuardedReader.prototype)
    .filter((name) => name !== "constructor")
    .sort();
  assert.deepEqual(operations, [
    "directoryExists",
    "executableOnSearchPath",
    "isVariableSet",
    "trace",
  ]);
  // And the module holds no operation that opens or reads a file: the only
  // thing it imports from `node:fs` is the `stat` of one named path.
  const source = await readFile(fileURLToPath(MODULE_URL), "utf8");
  assert.match(source, /statSync/);
  for (const banned of ["readFileSync", "readFile", "openSync", "readdirSync", "writeFile"]) {
    assert.equal(
      new RegExp(`\\b${banned}`).test(source),
      false,
      `the guarded reader must not hold ${banned}`,
    );
  }
});

test("CT-146-4: presence of a variable goes to the resolver `exists` only", async () => {
  const answers = new Map<string, "yes" | "no" | "unprobed">([
    ["env:EXAMPLE_CONFIG_DIR", "yes"],
    ["env:EXAMPLE_NOT_SET", "no"],
  ]);
  const { resolver, asked, touched } = tracedResolver(answers);
  const reader = new GuardedReader({ secretResolver: resolver });
  assert.deepEqual(await reader.isVariableSet("EXAMPLE_CONFIG_DIR"), { outcome: "present" });
  assert.deepEqual(await reader.isVariableSet("EXAMPLE_NOT_SET"), { outcome: "absent" });
  assert.deepEqual(asked, ["env:EXAMPLE_CONFIG_DIR", "env:EXAMPLE_NOT_SET"]);
  // Every property the reader took from the resolver is `exists`.
  assert.deepEqual([...new Set(touched)], ["exists"]);
  assert.equal(reader.trace.length, 2);
  assert.equal(reader.trace[0]?.op, "variable-presence");
});

test("CT-146-4: existence of a directory is answered without opening anything inside", () => {
  const home = mkdtempSync(join(tmpdir(), "ct146-4-"));
  const nested = join(home, "example-config");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "settings"), "a value that must never be read\n");
  try {
    const reader = new GuardedReader({ secretResolver: null as never });
    assert.deepEqual(reader.directoryExists(nested), { outcome: "exists" });
    assert.deepEqual(reader.directoryExists(join(home, "no-such-directory")), {
      outcome: "absent",
    });
    // A file is not a directory: absent, and still not opened.
    assert.deepEqual(reader.directoryExists(join(nested, "settings")), { outcome: "absent" });
    // A symlink is followed by the stat of the named path only.
    symlinkSync(nested, join(home, "a-link"));
    assert.deepEqual(reader.directoryExists(join(home, "a-link")), { outcome: "exists" });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("CT-146-4: every path of the deny-list is refused before it is looked at", () => {
  const home = mkdtempSync(join(tmpdir(), "ct146-4-"));
  try {
    const reader = new GuardedReader({ secretResolver: null as never });
    for (const entry of DENY_LIST) {
      const target = join(home, entry);
      const answer = reader.directoryExists(target);
      assert.equal(answer.outcome, "refused", `the deny-list entry \`${entry}\` is refused`);
      assert.equal(answer.refusedBy, deniedRuleOf(target));
    }
    // A deny-listed name deeper in the path is refused too, in either case.
    for (const target of [
      join(home, ".config", "gcloud", "credentials.json"),
      join(home, "PROJECTS", ".aws", "config"),
      join(home, "vault", ".netrc"),
    ]) {
      assert.equal(reader.directoryExists(target).outcome, "refused", target);
    }
    // And every refusal is in the trace, with its rule.
    const refusals = reader.trace.filter((entry) => entry.outcome === "refused");
    assert.equal(refusals.length, DENY_LIST.length + 3);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("CT-146-4: the reader answers the search path with presence, and starts nothing", () => {
  const home = mkdtempSync(join(tmpdir(), "ct146-4-"));
  const bin = join(home, "example-bin");
  mkdirSync(bin, { recursive: true });
  const tool = join(bin, "example-tool");
  writeFileSync(tool, "#!/bin/sh\n");
  chmodSync(tool, 0o500);
  // On the search path only through the directory the test hands over.
  const reader = new GuardedReader({
    secretResolver: null as never,
    readSearchPath: () => bin,
  });
  try {
    assert.equal(reader.executableOnSearchPath("example-tool").outcome, "on-path");
    assert.deepEqual(reader.executableOnSearchPath("example-tool"), {
      outcome: "on-path",
      directory: bin,
    });
    // A file without an executable bit is not on the path.
    writeFileSync(join(bin, "plain"), "x");
    assert.equal(reader.executableOnSearchPath("plain").outcome, "not-on-path");
    assert.equal(reader.executableOnSearchPath("no-such-tool").outcome, "not-on-path");
    // A deny-listed name is refused and never looked up.
    assert.deepEqual(reader.executableOnSearchPath(".netrc"), {
      outcome: "refused",
      refusedBy: ".netrc",
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
