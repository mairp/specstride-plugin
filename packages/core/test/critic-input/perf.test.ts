/**
 * T089 — the performance goals of `plan.md` (heading Scale/Scope), MEASURED
 * and REPORTED. They are STARTING VALUES with low confidence and block
 * nothing: this test records what the modules cost today and always passes;
 * a regression shows up in the numbers it prints, not in a red build.
 *
 * The goals of `plan.md`:
 *  - a snapshot of 80 presence lines with the full byte budget: under 2 s on
 *    a local disk;
 *  - assembly and fitting of one prompt: under 200 ms;
 *  - hiding and return of the three files: under 100 ms each way.
 *
 * covers: F117-FR-011; F117-FR-023
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  globSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  closeSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  groundingSnapshot,
  renderSnapshot,
  type GroundingIo,
} from "../../src/critic-input/grounding/index.ts";
import { assembleCriticPrompt } from "../../src/critic-input/prompt/assemble.ts";
import { fitToWindow } from "../../src/critic-input/prompt/fit.ts";
import { hideFiles, returnFiles, type HiddenFilePlan } from "../../src/critic-input/hide/hide.ts";
import { nodeFileMover, nodeFileReader } from "../../../runtime/src/ports/critic-input-files.ts";

/** The measured wall time of one run, in milliseconds. */
function measure(run: () => void): number {
  const start = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

/** The Node adapter of the read-only port, as the unit tests carry it. */
function nodeIo(_root: string): GroundingIo {
  return {
    realpath: (path) => {
      try {
        return realpathSync(path);
      } catch {
        return undefined;
      }
    },
    stat: (path) => {
      try {
        const st = statSync(path);
        return {
          isDirectory: st.isDirectory(),
          isFile: st.isFile(),
          size: st.size,
          mtimeMs: st.mtimeMs,
        };
      } catch {
        return undefined;
      }
    },
    listDir: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return undefined;
      }
    },
    readHeadTail: (path, headBytes, tailBytes, threshold) => {
      let st;
      try {
        st = statSync(path);
        if (!st.isFile()) return undefined;
      } catch {
        return undefined;
      }
      const fd = openSync(path, "r");
      try {
        const head = Buffer.alloc(Math.min(headBytes, st.size));
        if (head.length > 0) readSync(fd, head, 0, head.length, 0);
        let tail = Buffer.alloc(0);
        if (st.size > threshold) {
          tail = Buffer.alloc(Math.min(tailBytes, st.size - headBytes));
          readSync(fd, tail, 0, tail.length, st.size - tail.length);
        }
        return { head, tail, size: st.size };
      } catch {
        return undefined;
      } finally {
        closeSync(fd);
      }
    },
    glob: (pattern) => {
      try {
        return globSync(pattern);
      } catch {
        return [];
      }
    },
    repositoryFiles: () => [],
  };
}

/** The three files of the proposer (the plans of CT-117-40). */
const PLANS: readonly HiddenFilePlan[] = [
  { logicalName: "feature:<slug>:notebook", from: ".specstride/notebook.md" },
  { logicalName: "feature:<slug>:handoff", from: ".specstride/handoff.md" },
  { logicalName: "feature:<slug>:outbox", from: ".specstride/outbox/events.ndjson" },
];

test("T089: the snapshot of 80 presence lines with the full byte budget (goal: under 2 s)", () => {
  const root = mkdtempSync(join(tmpdir(), "f117-perf-snapshot-"));
  try {
    const files: string[] = [];
    for (let i = 0; i < 80; i++) {
      const rel = `pkg/mod-${Math.floor(i / 10)}/file${i}.ts`;
      mkdirSync(join(root, rel, ".."), { recursive: true });
      // A few KiB per file, so the excerpt budget does real work.
      writeFileSync(join(root, rel), `export const v${i} = "${"x".repeat(4 * 1024)}";\n`);
      files.push(rel);
    }
    const io = nodeIo(root);
    const ms = measure(() => {
      const snapshot = groundingSnapshot(files, root, [], io);
      const rendered = renderSnapshot(snapshot);
      assert.ok(snapshot.lines.length >= 80, "a presence line for each of the 80 cited paths");
      assert.ok(rendered.length > 0);
    });
    console.log(
      `[perf] snapshot, 80 presence lines, full byte budget: ${ms.toFixed(1)} ms (goal: under 2000 ms)`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("T089: assembly and fitting of one prompt (goal: under 200 ms)", () => {
  const evidence = `the phase evidence cites src/a.ts and src/b.ts\n${"detail\n".repeat(400)}`;
  const ms = measure(() => {
    for (let i = 0; i < 100; i++) {
      const assembled = assembleCriticPrompt({
        phase: 8,
        section: "- [ ] T001 do the thing\n".repeat(40),
        evidence,
        grounding: `## Grounding snapshot (verified by the critic, read-only)\n${"- `src/file.ts` — present: 2048 B\n".repeat(80)}`,
        pins: "PREVIOUSLY CONFIRMED (W9 verdict pins)\n- T001",
        context: `# Design context\n${"context line\n".repeat(200)}`,
        nonce: `nonce-${i}`,
        boundaryToken: "b".repeat(16),
        factBlock: "## Facts\n- tasks: 41",
      });
      assert.ok(assembled.text.length > 0);
      fitToWindow({
        build: (blocks) => Object.values(blocks).join("\n\n"),
        blocks: Object.fromEntries(assembled.blocks.map((b) => [b.id, b.text])),
        order: ["context", "grounding", "evidence"],
        windowTokens: 32_000,
      });
    }
  });
  const perCall = ms / 100;
  console.log(
    `[perf] assembly + fitting of one prompt: ${perCall.toFixed(2)} ms (goal: under 200 ms; 100 runs, ${ms.toFixed(0)} ms total)`,
  );
});

test("T089: hiding and return of the three files (goal: under 100 ms each way)", () => {
  const root = mkdtempSync(join(tmpdir(), "f117-perf-hide-"));
  try {
    const workspace = join(root, "workspace");
    const control = join(root, "control");
    const kept = join(control, "hidden-files", "call-1");
    const aside = join(control, "set-aside");
    mkdirSync(join(workspace, ".specstride", "outbox"), { recursive: true });
    mkdirSync(kept, { recursive: true });
    mkdirSync(aside, { recursive: true });
    for (const plan of PLANS) {
      writeFileSync(join(workspace, plan.from), `content of ${plan.logicalName}\n`);
    }
    const base = {
      workspaceRoot: workspace,
      controlRoot: control,
      keptDirectory: kept,
      recordPath: join(control, "hidden-files", "attempt:8:1:1:hidden-files.json"),
      attemptId: "attempt:8:1:1",
      callId: "call-1",
      files: PLANS,
      reader: nodeFileReader(),
      mover: nodeFileMover(join(root, "worker-root")),
    };
    const hideMs = measure(() => {
      hideFiles(base);
    });
    const returnMs = measure(() => {
      returnFiles({ ...base, asideRoot: aside });
    });
    console.log(`[perf] hiding of the three files: ${hideMs.toFixed(1)} ms (goal: under 100 ms)`);
    console.log(`[perf] return of the three files: ${returnMs.toFixed(1)} ms (goal: under 100 ms)`);
    assert.ok(
      existsSync(join(workspace, ".specstride", "notebook.md")),
      "the files are back after the measure",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
