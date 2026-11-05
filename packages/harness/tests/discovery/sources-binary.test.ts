/**
 * T011 — characterization test CT-146-3 of the source `binary`
 * (F146-FR-003): only the argument lists of `detect` are run; an
 * executable that no harness descriptor names is never executed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GuardedReader } from "../../src/discovery/guarded-reader.ts";
import { readBinarySource } from "../../src/discovery/sources/binary.ts";
import { loadBundledDescriptors } from "../../src/descriptor/bundled.ts";
import { fakeResolver } from "./helpers.ts";

/** A directory on the search path with the fake CLI and an orphan tool. */
function makeBin(): string {
  const bin = mkdtempSync(join(tmpdir(), "ct-146-3-bin-"));
  writeFileSync(join(bin, "example-cli"), "#!/bin/sh\necho 'example-cli 1.0.0'\n", { mode: 0o755 });
  chmodSync(join(bin, "example-cli"), 0o755);
  // The orphan: no harness descriptor names it. If anything starts it, it
  // leaves this marker behind.
  writeFileSync(
    join(bin, "orphan-tool"),
    '#!/bin/sh\necho started > "$ORPHAN_TOOL_STARTED_FILE"\n',
    { mode: 0o755 },
  );
  chmodSync(join(bin, "orphan-tool"), 0o755);
  return bin;
}

test("CT-146-3: only the argument lists of `detect` are run; the orphan is never executed", async () => {
  const bin = makeBin();
  const startedFile = join(bin, "orphan-started.marker");
  const descriptors = loadBundledDescriptors().entries;
  const reader = new GuardedReader({
    secretResolver: fakeResolver(),
    readSearchPath: () => bin,
  });
  const result = await readBinarySource({
    reader,
    descriptors,
    runVersionProbes: true,
  });
  // The fake CLI is found by the name its bundled descriptor gives.
  const candidate = result.candidates.find((entry) => entry.id === "example-cli");
  assert.ok(candidate !== undefined, "the named executable was not found");
  assert.equal(candidate.resolvedPath, join(bin, "example-cli"));
  assert.deepEqual(candidate.sources, ["binary"]);
  // The only argument list that ran: the one `detect.version` names, for
  // the executable the descriptor names, and nothing else.
  assert.deepEqual(result.started, [{ file: join(bin, "example-cli"), args: ["--version"] }]);
  assert.equal(candidate.version, "example-cli 1.0.0");
  // The executable that no harness descriptor names was never executed.
  const { existsSync, readFileSync } = await import("node:fs");
  assert.equal(existsSync(startedFile), false, "the orphan tool was started");
  assert.equal(readFileSync(join(bin, "orphan-tool"), "utf8").includes("started >"), true);
});

test("CT-146-3: a probe that fails yields null and a finding, and never fails the source", async () => {
  const bin = mkdtempSync(join(tmpdir(), "ct-146-3-fail-"));
  // The named executable ends with a failure: the version probe reports
  // null and one finding, and discovery goes on.
  writeFileSync(join(bin, "example-cli"), "#!/bin/sh\nexit 3\n", { mode: 0o755 });
  const descriptors = loadBundledDescriptors().entries;
  const reader = new GuardedReader({
    secretResolver: fakeResolver(),
    readSearchPath: () => bin,
  });
  const result = await readBinarySource({
    reader,
    descriptors,
    runVersionProbes: true,
  });
  const candidate = result.candidates.find((entry) => entry.id === "example-cli");
  assert.ok(candidate !== undefined);
  assert.equal(candidate.version, null);
  assert.equal(result.findings.length, 1);
  assert.equal(candidate.findings.length, 1);
  // Still only the argument list `detect` names.
  assert.deepEqual(result.started, [{ file: join(bin, "example-cli"), args: ["--version"] }]);
});
