/**
 * CT-115-101 (T026, IR-01, F115-FR-002) — no writer of the phase gate in
 * the layer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  registerLayerMicro,
  FORBIDDEN_PHASE_GATE_WRITES,
  phaseGateWritesAllowed,
} from "../../src/register.ts";

const SRC = join(fileURLToPath(import.meta.url), "..", "..", "..", "src");

test("CT-115-101: the registration allows no write to the records of the phase gate", () => {
  const registration = registerLayerMicro();
  assert.deepEqual(registration.phaseGateWrites, []);
  assert.deepEqual(phaseGateWritesAllowed(), []);
  const registrationText = JSON.stringify(registration);
  for (const writer of FORBIDDEN_PHASE_GATE_WRITES) {
    assert.ok(!registrationText.includes(`"${writer}"`), writer);
  }
});

test("CT-115-101: no file of the layer imports a file-system module or a process starter", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts")) {
        const text = readFileSync(path, "utf8");
        if (/from "(node:fs|node:fs\/promises|node:child_process)"/.test(text)) {
          offenders.push(path);
        }
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, []);
});
