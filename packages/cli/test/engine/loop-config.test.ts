/**
 * The loop configuration of a run (F115-FR-001): `micro` is the default of
 * the catalogue, a project file `specstride.yaml` with `loop.strategy:
 * classic` selects the classic loop, and the caps come from the
 * `loop.micro.caps.*` keys with the catalogue defaults where the
 * configuration is silent.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loopConfigurationOf } from "../../src/engine/loop-config.ts";

function fixture(projectFile?: string): { readonly home: string; readonly dir: string } {
  const root = mkdtempSync(join(tmpdir(), "specstride-loopcfg-"));
  const home = join(root, "home");
  const dir = join(root, "work");
  mkdirSync(home);
  mkdirSync(dir);
  if (projectFile !== undefined) writeFileSync(join(dir, "specstride.yaml"), projectFile);
  return { home, dir: root && dir };
}

const ENV: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "" };

test("with no configuration file the strategy is micro, the default of the catalogue", () => {
  const { home, dir } = fixture();
  try {
    const loop = loopConfigurationOf({ home, workdir: dir, environment: ENV });
    assert.equal(loop.strategy, "micro");
    assert.equal(loop.source, "default");
    assert.equal(loop.configuredValue, undefined);
    assert.equal(loop.closingCheck, true);
    assert.deepEqual(loop.caps, {
      repairs: 2,
      proposalMinutes: 20,
      unitMinutes: 30,
      cyclesExtra: 6,
      cyclesMin: 12,
      unresolvedUnits: 2,
    });
  } finally {
    rmSync(join(dir, ".."), { recursive: true, force: true });
  }
});

test("a project file with loop.strategy: classic selects the classic loop", () => {
  const { home, dir } = fixture("schema: 1\nloop:\n  strategy: classic\n");
  try {
    const loop = loopConfigurationOf({ home, workdir: dir, environment: ENV });
    assert.equal(loop.strategy, "classic");
    assert.equal(loop.source, "configured");
    assert.equal(loop.configuredValue, "classic");
  } finally {
    rmSync(join(dir, ".."), { recursive: true, force: true });
  }
});

test("the caps of the project file replace the defaults they name, and only them", () => {
  const { home, dir } = fixture(
    "schema: 1\nloop:\n  strategy: micro\n  micro:\n    caps:\n      repairs: 0\n      unresolvedUnits: 1\n",
  );
  try {
    const loop = loopConfigurationOf({ home, workdir: dir, environment: ENV });
    assert.equal(loop.strategy, "micro");
    assert.equal(loop.source, "configured");
    assert.equal(loop.caps.repairs, 0);
    assert.equal(loop.caps.unresolvedUnits, 1);
    assert.equal(loop.caps.cyclesMin, 12, "an unnamed cap keeps its default");
  } finally {
    rmSync(join(dir, ".."), { recursive: true, force: true });
  }
});

test("the closing-check switch reads loop.micro.closing_check", () => {
  const { home, dir } = fixture("schema: 1\nloop:\n  micro:\n    closing_check: false\n");
  try {
    const loop = loopConfigurationOf({ home, workdir: dir, environment: ENV });
    assert.equal(loop.closingCheck, false);
    assert.equal(loop.strategy, "micro");
  } finally {
    rmSync(join(dir, ".."), { recursive: true, force: true });
  }
});
