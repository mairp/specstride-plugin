/**
 * Phase 2 of feature 103 — the four modules of the pass loop that the
 * characterization tests of `tests/characterization/103/` do not drive
 * end to end, each against the requirement its task names:
 *
 * | Task | Module | Requirements |
 * |---|---|---|
 * | T015 | `src/pass-loop/request.ts` | F103-FR-001, F103-FR-002 |
 * | T017 | `src/pass-loop/progress.ts` | F103-FR-016 |
 * | T018 | `src/pass-loop/invocation-id.ts` | F103-FR-009 |
 * | T019 | `src/pass-loop/announce.ts` | F103-FR-004 |
 *
 * T016 (`src/pass-loop/empty-prompt.ts`) is driven by CT-103-108, the source
 * check by CT-103-121, `betweenPasses` by CT-103-110 and the accounting by
 * CT-103-118 and CT-103-120, so none of those is repeated here.
 *
 * The request record is checked against its SCHEMA and not only against the
 * requirement: `src/pass-loop/pass-loop-request.schema.json` is the shape T003
 * pinned, so a field this module fills that the schema forbids, or a default
 * that disagrees with the schema's `default`, is a failing test here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyRequestDefaults,
  cannotEnterMessage,
  evidenceRequiredMessage,
  FAILURE_CARRIES_THE_USAGE_TEXT,
  FLAG_OF_FIELD,
  IS_A_PUBLIC_COMMAND,
  isKnownField,
  IMPORTS_NODE_FS as REQUEST_IMPORTS_NODE_FS,
  missingValueMessage,
  normalizeRequest,
  promptFileRequiredMessage,
  REQUEST_DEFAULTS,
  REQUIRED_FIELDS,
  stateDirectoryOf,
  unknownArgMessage,
  usageText,
  USAGE_CODES,
  USAGE_OMITS_CODE_3,
  workdirRequiredMessage,
  type RequestIo,
} from "../src/pass-loop/request.ts";
import {
  EMITS_PROGRESS_SWEPT,
  IGNORED_DIRECTORY_NAMES,
  IMPORTS_NODE_FS as PROGRESS_IMPORTS_NODE_FS,
  LEGACY_STATE_DIRECTORY_NAME_IS_CARRIED,
  measureProgress,
  PROGRESS_SWEPT_IS_OWNED_BY,
  STAMP_SLACK_MS,
  THE_CONTROL_PLANE_IS_INSIDE_THE_WORKING_TREE,
  thresholdOf,
  type ProgressEntry,
  type ProgressIo,
} from "../src/pass-loop/progress.ts";
import {
  CLASSES_THAT_RETAIN_UNDER_DEBUG,
  formOf,
  invocationBaseOf,
  invocationIdOfPass,
  MINTED_HEX_CHARACTERS,
  MINTED_PASS_NUMBER_WIDTH,
  MINTED_PATTERN,
  promptLogicalName,
  responseLogicalName,
  retainsUnderDebug,
  retentionOf,
} from "../src/pass-loop/invocation-id.ts";
import {
  ANNOUNCEMENTS,
  evidenceAlreadyExists,
  evidenceAppeared,
  evidencePresentEvent,
  evidenceWrittenEvent,
  hasAnAsIsEquivalent,
  iterDoneEvent,
  iterStartEvent,
  PRINTS_A_NEW_LINE_UNDER_PARITY,
  proposerAttemptBanner,
  proposerPassBanner,
  proposerStartEvent,
  WRITER_OF,
} from "../src/pass-loop/announce.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

/**
 * The two PORTS of the modules under test, implemented here over `node:fs`.
 *
 * They are implemented in this test and not in the modules on purpose:
 * `@specstride/core` may not import `node:fs` (F100-FR-012, F100-FR-234, the
 * rule of `tools/import-boundary`), so `request.ts` and `progress.ts` name the
 * operations and the composition root provides them. A test file is not a
 * source file of the package, so it may hold the implementation — and the
 * assertions below that touch a real directory then measure the real thing
 * rather than a fake of it.
 */
const nodeRequestIo: RequestIo = {
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  isRegularFile: (path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  canonical: (path) => {
    try {
      return realpathSync(path);
    } catch {
      return undefined;
    }
  },
  makeDirectory: (path) => {
    mkdirSync(path, { recursive: true });
  },
  readText: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  },
};

const nodeProgressIo: ProgressIo = {
  entriesOf: (directory) => {
    let names: readonly string[];
    try {
      names = readdirSync(directory);
    } catch {
      return [];
    }
    const out: ProgressEntry[] = [];
    for (const name of names) {
      const path = join(directory, name);
      try {
        const stat = statSync(path);
        out.push({ path, name, isDirectory: stat.isDirectory(), modifiedAtMs: stat.mtimeMs });
      } catch {
        // A file that vanished between the listing and the stat is no progress.
      }
    }
    return out;
  },
};

/** A file system that satisfies every check, for the happy paths. */
const permissive: RequestIo = {
  isDirectory: () => true,
  isRegularFile: () => true,
  canonical: (path) => path,
  makeDirectory: () => undefined,
  readText: () => "a prompt",
};

const base = {
  workdir: "/w",
  evidence: "/w/evidence.md",
  standingPrompt: "a standing prompt",
  harness: "stub",
  role: "proposer",
} as const;

/* ================================================================== *
 * T015 — the request record, its defaults and its failures.
 * ================================================================== */

test("T015 (F103-FR-001): the pass loop is a call and not a public command", () => {
  assert.equal(IS_A_PUBLIC_COMMAND, false);
});

test("T015 (F103-FR-001): the record carries every field the requirement names", () => {
  const normalized = normalizeRequest(
    {
      ...base,
      passLimit: 12,
      pauseSec: 5,
      feature: "103-proposer-pass",
      phase: 2,
      phaseAttempt: 3,
      invocationBase: "run-1-proposer-phase-2-attempt-3",
      passTimeLimitSec: 900,
      yieldPlace: "feature:<slug>:outbox",
      debug: true,
    },
    permissive,
  );
  assert.equal(normalized.ok, true);
  if (!normalized.ok) throw new Error("unreachable");
  assert.deepEqual(normalized.request, {
    workdir: "/w",
    evidence: "/w/evidence.md",
    standingPrompt: "a standing prompt",
    harness: "stub",
    role: "proposer",
    passLimit: 12,
    pauseSec: 5,
    feature: "103-proposer-pass",
    phase: 2,
    phaseAttempt: 3,
    invocationBase: "run-1-proposer-phase-2-attempt-3",
    passTimeLimitSec: 900,
    yieldPlace: "feature:<slug>:outbox",
    debug: true,
    help: false,
  });
});

test("T015 (F103-FR-001): an absent field takes the as-is value", () => {
  const normalized = normalizeRequest(base, permissive);
  assert.equal(normalized.ok, true);
  if (!normalized.ok) throw new Error("unreachable");
  // The three the requirement names by value.
  assert.equal(normalized.request.feature, "default");
  assert.equal(normalized.request.phase, 0);
  assert.equal(normalized.request.phaseAttempt, 1);
  // And the rest.
  assert.equal(normalized.request.passLimit, 30);
  assert.equal(normalized.request.pauseSec, 2);
  assert.equal(normalized.request.debug, false);
});

test("T015 (F103-FR-001): the defaults agree with the schema T003 pinned", () => {
  const schema = JSON.parse(
    readFileSync(join(HERE, "..", "src", "pass-loop", "pass-loop-request.schema.json"), "utf8"),
  ) as {
    required: string[];
    additionalProperties: boolean;
    properties: Record<string, { default?: unknown }>;
  };
  assert.deepEqual(schema.required, [...REQUIRED_FIELDS]);
  assert.equal(schema.additionalProperties, false);
  for (const [field, value] of Object.entries(REQUEST_DEFAULTS)) {
    assert.equal(
      schema.properties[field]?.default,
      value,
      `the default of \`${field}\` is the same in the module and in the schema`,
    );
  }
  // Every field of the record is a field the loop knows, and the other way
  // round for everything but the flag `--prompt-file`'s own name.
  for (const field of Object.keys(schema.properties)) {
    assert.equal(isKnownField(field), true, `the loop knows the schema's field \`${field}\``);
  }
  const normalized = normalizeRequest(base, permissive);
  if (!normalized.ok) throw new Error("unreachable");
  for (const field of Object.keys(normalized.request)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(schema.properties, field),
      `the record's field \`${field}\` is a property of the schema`,
    );
  }
});

test("T015 (F103-FR-001): `applyRequestDefaults` fills only what is absent", () => {
  const filled = applyRequestDefaults({ ...base, passLimit: 7 });
  assert.equal(filled.passLimit, 7, "a field that is present is left alone");
  assert.equal(filled.feature, "default", "a field that is absent is filled");
});

test("T015 (F103-FR-002): an empty or non-directory working directory ends with 1", () => {
  for (const workdir of ["", "/not/a/directory"]) {
    const normalized = normalizeRequest(
      { ...base, workdir },
      { ...permissive, isDirectory: () => false },
    );
    assert.equal(normalized.ok, false);
    if (normalized.ok) throw new Error("unreachable");
    assert.equal(normalized.result.exit_code, 1);
    assert.equal(normalized.result.message, workdirRequiredMessage(workdir));
    assert.equal(normalized.result.message, `--workdir DIR required (got '${workdir}')`);
    assert.equal(normalized.result.usage, undefined, "a parameter error carries no usage text");
  }
});

test("T015 (F103-FR-002): a working directory the loop cannot enter ends with 1", () => {
  const normalized = normalizeRequest(base, { ...permissive, canonical: () => undefined });
  assert.equal(normalized.ok, false);
  if (normalized.ok) throw new Error("unreachable");
  assert.equal(normalized.result.exit_code, 1);
  assert.equal(normalized.result.failure, "cannot-enter");
  assert.equal(normalized.result.message, cannotEnterMessage("/w"));
});

test("T015 (F103-FR-002): an empty evidence path ends with 1 and the as-is message", () => {
  const normalized = normalizeRequest({ ...base, evidence: "" }, permissive);
  assert.equal(normalized.ok, false);
  if (normalized.ok) throw new Error("unreachable");
  assert.equal(normalized.result.exit_code, 1);
  assert.equal(normalized.result.message, evidenceRequiredMessage());
  assert.equal(normalized.result.message, "--evidence FILE required");
});

test("T015 (F103-FR-002): a prompt that is missing or is not a regular file ends with 1", () => {
  // Missing: neither the text nor a file named.
  const missing = normalizeRequest(
    { workdir: "/w", evidence: "/w/e.md", harness: "stub", role: "proposer" },
    permissive,
  );
  assert.equal(missing.ok, false);
  if (missing.ok) throw new Error("unreachable");
  assert.equal(missing.result.message, promptFileRequiredMessage(""));
  assert.equal(missing.result.message, "--prompt-file FILE required (got '')");

  // Named, but not a REGULAR file (a directory, say).
  const notRegular = normalizeRequest(
    {
      workdir: "/w",
      evidence: "/w/e.md",
      promptFile: "/w/a-directory",
      harness: "stub",
      role: "proposer",
    },
    { ...permissive, isRegularFile: () => false },
  );
  assert.equal(notRegular.ok, false);
  if (notRegular.ok) throw new Error("unreachable");
  assert.equal(notRegular.result.message, "--prompt-file FILE required (got '/w/a-directory')");
});

test("T015 (F103-FR-002): a field the loop does not know ends with the usage text", () => {
  const normalized = normalizeRequest({ ...base, resumeFrom: "yesterday" }, permissive);
  assert.equal(normalized.ok, false);
  if (normalized.ok) throw new Error("unreachable");
  assert.equal(normalized.result.exit_code, 1);
  assert.equal(normalized.result.message, unknownArgMessage("resumeFrom"));
  assert.equal(normalized.result.message, "unknown arg: resumeFrom");
  assert.equal(normalized.result.usage, usageText(), "and it DOES carry the usage text");
});

test("T015 (F103-FR-002): a field present without a value is a parameter error, never the usage text", () => {
  const normalized = normalizeRequest({ ...base, passLimit: undefined }, permissive);
  assert.equal(normalized.ok, false);
  if (normalized.ok) throw new Error("unreachable");
  assert.equal(normalized.result.exit_code, 1);
  assert.equal(normalized.result.failure, "missing-value");
  assert.equal(normalized.result.message, missingValueMessage("passLimit"));
  assert.equal(
    normalized.result.usage,
    undefined,
    "F103-FR-002 is explicit: never the usage text for this one",
  );
  // The rule as a table, so no caller has to remember it.
  assert.equal(FAILURE_CARRIES_THE_USAGE_TEXT["missing-value"], false);
  assert.equal(FAILURE_CARRIES_THE_USAGE_TEXT["unknown-arg"], true);
  for (const kind of ["workdir", "evidence", "prompt-file", "cannot-enter"] as const) {
    assert.equal(FAILURE_CARRIES_THE_USAGE_TEXT[kind], false);
  }
});

test("T015 (F103-FR-002): an unknown field is reported before anything is read from disk", () => {
  let touched = 0;
  const counting: RequestIo = {
    isDirectory: () => {
      touched += 1;
      return true;
    },
    isRegularFile: () => {
      touched += 1;
      return true;
    },
    canonical: (path) => {
      touched += 1;
      return path;
    },
    makeDirectory: () => {
      touched += 1;
    },
    readText: () => {
      touched += 1;
      return "a prompt";
    },
  };
  const normalized = normalizeRequest({ ...base, nonsense: 1 }, counting);
  assert.equal(normalized.ok, false);
  assert.equal(touched, 0, "the file system was not touched");
});

test("T015 (F103-FR-002): `help` returns 0 and the usage text", () => {
  const normalized = normalizeRequest({ help: true }, permissive);
  assert.equal(normalized.ok, false, "a request with `help` is not a request that runs passes");
  if (normalized.ok) throw new Error("unreachable");
  assert.equal(normalized.result.exit_code, 0);
  assert.equal(normalized.result.usage, usageText());
  assert.equal(normalized.result.message, undefined);
});

test("T015 (F103-FR-002): the usage text lists 0, 1, 4, 6, 7, 8, 9 and 10 and NOT 3", () => {
  assert.deepEqual([...USAGE_CODES], [0, 1, 4, 6, 7, 8, 9, 10]);
  const text = usageText();
  const codes = [...text.matchAll(/^\s{2}(\s*\d+)\s{2}/gm)].map((m) => Number(m[1]));
  assert.deepEqual(codes, [0, 1, 4, 6, 7, 8, 9, 10]);
  assert.equal(codes.includes(3), false, "the baseline does not list 3, and nor does this");
  assert.equal(USAGE_OMITS_CODE_3, true);
});

test("T015 (F103-FR-002): the working directory is canonical and a relative evidence path resolves", () => {
  const normalized = normalizeRequest(
    { ...base, workdir: "/w/../w/./link", evidence: "gates/GATE2-EVIDENCE.md" },
    { ...permissive, canonical: () => "/canonical/w" },
  );
  assert.equal(normalized.ok, true);
  if (!normalized.ok) throw new Error("unreachable");
  assert.equal(normalized.request.workdir, "/canonical/w", "the canonical form is used");
  assert.equal(
    normalized.request.evidence,
    "/canonical/w/gates/GATE2-EVIDENCE.md",
    "and the relative evidence path resolves against it",
  );
});

test("T015 (F103-FR-002): the parent of the evidence path and the state directory are created", () => {
  const dir = mkdtempSync(join(tmpdir(), "t015-"));
  try {
    const normalized = normalizeRequest(
      {
        workdir: dir,
        evidence: "gates/deep/GATE2-EVIDENCE.md",
        standingPrompt: "a standing prompt",
        harness: "stub",
        role: "proposer",
        feature: "103-proposer-pass",
      },
      nodeRequestIo,
    );
    assert.equal(normalized.ok, true);
    if (!normalized.ok) throw new Error("unreachable");
    // Both really exist on disk now; neither did before.
    assert.equal(nodeRequestIo.isDirectory(join(dir, "gates", "deep")), true);
    assert.equal(
      nodeRequestIo.isDirectory(stateDirectoryOf(normalized.request.workdir, "103-proposer-pass")),
      true,
    );
    assert.equal(
      stateDirectoryOf("/w", "103-proposer-pass"),
      "/w/.specstride/features/103-proposer-pass",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("T015 (F103-FR-002): the prompt is read once, from the file the flag names", () => {
  const dir = mkdtempSync(join(tmpdir(), "t015-prompt-"));
  try {
    const promptFile = join(dir, "prompt.txt");
    writeFileSync(promptFile, "the standing prompt of the attempt");
    const normalized = normalizeRequest(
      {
        workdir: dir,
        evidence: join(dir, "evidence.md"),
        promptFile,
        harness: "stub",
        role: "proposer",
      },
      nodeRequestIo,
    );
    assert.equal(normalized.ok, true);
    if (!normalized.ok) throw new Error("unreachable");
    assert.equal(normalized.request.standingPrompt, "the standing prompt of the attempt");
    // F103-FR-007 — a change of the file afterwards reaches no later pass,
    // because the record holds the TEXT and not the path.
    writeFileSync(promptFile, "rewritten during the attempt");
    assert.equal(normalized.request.standingPrompt, "the standing prompt of the attempt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("T015 (DV-066): every field of the record carries the as-is flag of `proposer.sh`", () => {
  for (const field of REQUIRED_FIELDS) {
    assert.ok(FLAG_OF_FIELD[field]?.startsWith("--"), `\`${field}\` carries a flag`);
  }
  assert.equal(FLAG_OF_FIELD.passLimit, "--max-iter");
  assert.equal(FLAG_OF_FIELD.standingPrompt, "--prompt-file");
  assert.equal(FLAG_OF_FIELD.promptFile, "--prompt-file");
});

/* ================================================================== *
 * T017 — the progress measurement.
 * ================================================================== */

/** A tree in memory, so the measurement can be driven without a clock. */
function treeOf(files: Readonly<Record<string, number>>): ProgressIo {
  const children = new Map<string, ProgressEntry[]>();
  const add = (parent: string, entry: ProgressEntry): void => {
    const held = children.get(parent) ?? [];
    if (!held.some((e) => e.path === entry.path)) held.push(entry);
    children.set(parent, held);
  };
  for (const [path, modifiedAtMs] of Object.entries(files)) {
    const parts = path.split("/").filter((p) => p.length > 0);
    let at = "";
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index] as string;
      const child = `${at}/${name}`;
      const isDirectory = index < parts.length - 1;
      add(at === "" ? "/" : at, {
        path: child,
        name,
        isDirectory,
        modifiedAtMs: isDirectory ? 0 : modifiedAtMs,
      });
      at = child;
    }
  }
  return { entriesOf: (directory) => children.get(directory) ?? [] };
}

const START = 1_000_000;

test("T017 (F103-FR-016): the start stamp is taken one second earlier, strictly greater", () => {
  assert.equal(STAMP_SLACK_MS, 1_000);
  assert.equal(thresholdOf(START), START - 1_000);
  // A file written in the SAME second as the start of the pass counts, which
  // is what the slack is for.
  const io = treeOf({ "/w/src/a.ts": START - 500 });
  assert.equal(measureProgress({ roots: ["/w"], passStartedAtMs: START }, io).madeProgress, true);
  // A file written a second and a half before does not.
  const older = treeOf({ "/w/src/a.ts": START - 1_500 });
  assert.equal(
    measureProgress({ roots: ["/w"], passStartedAtMs: START }, older).madeProgress,
    false,
  );
  // And a file written exactly AT the threshold does not, because the
  // comparison is strictly greater.
  const exact = treeOf({ "/w/src/a.ts": START - 1_000 });
  assert.equal(
    measureProgress({ roots: ["/w"], passStartedAtMs: START }, exact).madeProgress,
    false,
  );
});

test("T017 (F103-FR-016): a write to the workspace, the repository or node_modules is not progress", () => {
  const io = treeOf({
    "/w/.git/index": START + 10,
    "/w/.specstride/features/103/PROGRESS.md": START + 10,
    "/w/.specstride/features/103/outbox/a.json": START + 10,
    "/w/node_modules/left-pad/index.js": START + 10,
    "/w/.venv/lib/python3.13/site.py": START + 10,
  });
  const measured = measureProgress({ roots: ["/w"], passStartedAtMs: START }, io);
  assert.equal(measured.madeProgress, false, "every one of them is ignored");
  assert.equal(measured.filesExamined, 0, "the walk did not even look inside them");
  assert.deepEqual([...IGNORED_DIRECTORY_NAMES], [".git", ".specstride", "node_modules", ".venv"]);
  assert.equal(LEGACY_STATE_DIRECTORY_NAME_IS_CARRIED, false);
  assert.equal(THE_CONTROL_PLANE_IS_INSIDE_THE_WORKING_TREE, false);
});

test("T017 (F103-FR-016): a file a background job wrote under the working directory counts", () => {
  // The measurement asks nothing about WHO wrote a file, so a detached job's
  // output is progress just as the proposer's own edit is.
  const io = treeOf({
    "/w/.specstride/features/103/PROGRESS.md": START + 10,
    "/w/build/from-a-detached-job.log": START + 10,
  });
  const measured = measureProgress({ roots: ["/w"], passStartedAtMs: START }, io);
  assert.equal(measured.madeProgress, true);
  assert.equal(measured.firstNewerFile, "/w/build/from-a-detached-job.log");
});

test("T017 (F103-FR-016): the measurement stops at the first file that proves progress", () => {
  const io = treeOf({ "/w/a.ts": START + 10, "/w/b.ts": START + 10, "/w/c.ts": START + 10 });
  const measured = measureProgress({ roots: ["/w"], passStartedAtMs: START }, io);
  assert.equal(measured.madeProgress, true);
  assert.equal(measured.filesExamined, 1, "one file was enough; the rest of the tree was not read");
});

test("T015, T017 (F100-FR-012): neither module imports a file-system module of Node", () => {
  assert.equal(REQUEST_IMPORTS_NODE_FS, false);
  assert.equal(PROGRESS_IMPORTS_NODE_FS, false);
  for (const file of ["request.ts", "progress.ts"]) {
    const source = readFileSync(join(HERE, "..", "src", "pass-loop", file), "utf8");
    assert.equal(
      /from "node:fs(\/promises)?"/.test(source),
      false,
      `\`${file}\` imports no file-system module of Node: the port is implemented outside the core`,
    );
  }
});

test("T017 (F103-FR-016): the measurement emits no `progress.swept`", () => {
  assert.equal(EMITS_PROGRESS_SWEPT, false);
  assert.equal(PROGRESS_SWEPT_IS_OWNED_BY.event, "progress.swept");
  assert.equal(PROGRESS_SWEPT_IS_OWNED_BY.feature, "100");
  assert.deepEqual([...PROGRESS_SWEPT_IS_OWNED_BY.requirements], ["F100-FR-057", "F100-FR-058"]);
  // And the module's source holds no emitter of it: the constant names the
  // event, and nothing writes it.
  const source = readFileSync(join(HERE, "..", "src", "pass-loop", "progress.ts"), "utf8");
  assert.equal(
    /emit\s*\(/.test(source),
    false,
    "`progress.ts` emits nothing at all, let alone `progress.swept`",
  );
});

test("T017 (F103-FR-016): the measurement reads real modification times on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "t017-"));
  try {
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, ".specstride"), { recursive: true });
    const old = join(dir, "src", "old.ts");
    writeFileSync(old, "// written long ago\n");
    const longAgo = Date.now() / 1000 - 3_600;
    utimesSync(old, longAgo, longAgo);
    const startedAt = Date.now();

    // Nothing but the old file: no progress.
    assert.equal(
      measureProgress({ roots: [dir], passStartedAtMs: startedAt }, nodeProgressIo).madeProgress,
      false,
      "a tree whose only file is an hour old made no progress",
    );
    // A write to the workspace alone: still no progress.
    writeFileSync(join(dir, ".specstride", "notebook.md"), "the proposer's own notes\n");
    assert.equal(
      measureProgress({ roots: [dir], passStartedAtMs: startedAt }, nodeProgressIo).madeProgress,
      false,
      "a write to the workspace is not progress",
    );
    // A write to the working tree: progress.
    writeFileSync(join(dir, "src", "new.ts"), "export const a = 1;\n");
    const measured = measureProgress({ roots: [dir], passStartedAtMs: startedAt }, nodeProgressIo);
    assert.equal(measured.madeProgress, true);
    assert.equal(measured.firstNewerFile, join(dir, "src", "new.ts"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ================================================================== *
 * T018 — the invocation ids and the debug retention switch.
 * ================================================================== */

test("T018 (F103-FR-009): the base is `<run-id>-<role>-phase-<N>-attempt-<M>`", () => {
  assert.equal(
    invocationBaseOf("run-20260103-110825", "proposer", 2, 1),
    "run-20260103-110825-proposer-phase-2-attempt-1",
  );
  assert.equal(
    invocationBaseOf("run-20260103-110825", "accelerator", 7, 3),
    "run-20260103-110825-accelerator-phase-7-attempt-3",
  );
});

test("T018 (F103-FR-009): with a base the id of a pass is `<base>-iter-<n>`", () => {
  const base_ = "run-1-proposer-phase-2-attempt-1";
  assert.equal(invocationIdOfPass(1, base_), `${base_}-iter-1`);
  assert.equal(invocationIdOfPass(30, base_), `${base_}-iter-30`);
  assert.equal(formOf(invocationIdOfPass(1, base_)), "derived");
  // The derived form is stable: the same base and pass give the same id, which
  // is what lets a retained prompt be found again after a resume.
  assert.equal(invocationIdOfPass(4, base_), invocationIdOfPass(4, base_));
});

test("T018 (F103-FR-009): without a base the id is `inv-<six digits>-<eight hex>`", () => {
  const id = invocationIdOfPass(7, undefined, () => "deadbeef");
  assert.equal(id, "inv-000007-deadbeef");
  assert.match(id, MINTED_PATTERN);
  assert.equal(formOf(id), "minted");
  assert.equal(MINTED_PASS_NUMBER_WIDTH, 6);
  assert.equal(MINTED_HEX_CHARACTERS, 8);
  // The zero padding keeps a listing in pass order.
  const ids = [1, 2, 10, 100].map((n) => invocationIdOfPass(n, undefined, () => "00000000"));
  assert.deepEqual([...ids].sort(), ids);
  // An empty base is no base.
  assert.match(
    invocationIdOfPass(1, "", () => "abcdef01"),
    MINTED_PATTERN,
  );
  // And two minted ids of the same pass do not collide.
  assert.notEqual(invocationIdOfPass(1), invocationIdOfPass(1));
  assert.match(invocationIdOfPass(1), MINTED_PATTERN);
});

test("T018 (F103-FR-009): the two logical names of a retained invocation", () => {
  assert.equal(promptLogicalName("p-1"), "pass:p-1:prompt");
  assert.equal(responseLogicalName("p-1"), "pass:p-1:response");
});

test("T018 (F103-FR-009): with the debug switch set, every invocation retains", () => {
  const off = retentionOf("p-1", false);
  assert.equal(off.retained, false);
  assert.equal(off.promptName, undefined);
  assert.equal(off.responseName, undefined);

  const on = retentionOf("p-1", true);
  assert.deepEqual(on, {
    retained: true,
    promptName: "pass:p-1:prompt",
    responseName: "pass:p-1:response",
  });

  // The part a reader gets wrong: the CRITIC-CLASS calls retain too, not only
  // the proposer's passes.
  assert.deepEqual([...CLASSES_THAT_RETAIN_UNDER_DEBUG], ["proposer", "critic-class"]);
  assert.equal(retainsUnderDebug("proposer"), true);
  assert.equal(retainsUnderDebug("critic-class"), true);
  assert.equal(retainsUnderDebug("something-else"), false);
});

/* ================================================================== *
 * T019 — the announcements as compatibility output.
 * ================================================================== */

test("T019 (F103-FR-004): the attempt banner, byte for byte", () => {
  assert.equal(
    proposerAttemptBanner(2, 1, 3, "claude"),
    "----- proposer: phase 2 attempt 1/3 (claude) -----",
  );
});

test("T019 (F103-FR-004): the pass banner, with two blanks before the time", () => {
  const line = proposerPassBanner(3, 30, "2026-10-03T11:08:25Z");
  assert.equal(line, "----- proposer pass 3/30  2026-10-03T11:08:25Z -----");
  assert.match(line, /30 {2}2026/, "two blanks between the limit and the time, as at the baseline");
});

test("T019 (F103-FR-004): `proposer_start` carries `phase`, `attempt` and `backend`", () => {
  const announced = proposerStartEvent(2, 1, "claude");
  assert.equal(announced.asIsName, "proposer_start");
  assert.equal(announced.catalogueType, "attempt.started");
  assert.deepEqual(announced.asIsFields, { phase: 2, attempt: 1, backend: "claude" });
});

test("T019 (F103-FR-004): `iter_start` carries `iter` and `max_iter`", () => {
  const announced = iterStartEvent(3, 30);
  assert.equal(announced.asIsName, "iter_start");
  assert.equal(announced.catalogueType, "pass.started");
  assert.deepEqual(announced.asIsFields, { iter: 3, max_iter: 30 });
});

test("T019 (F103-FR-004): `iter_done` carries `iter` and `evidence=missing`", () => {
  const announced = iterDoneEvent(3);
  assert.equal(announced.asIsName, "iter_done");
  assert.equal(announced.catalogueType, "pass.ended");
  assert.deepEqual(announced.asIsFields, { iter: 3, evidence: "missing" });
});

test("T019 (F103-FR-005, F103-FR-006): the two evidence announcements", () => {
  assert.equal(
    evidenceAlreadyExists("/w/gates/GATE2-EVIDENCE.md"),
    "proposer.sh: evidence already exists (/w/gates/GATE2-EVIDENCE.md); nothing to do.",
  );
  assert.deepEqual(evidencePresentEvent("GATE2-EVIDENCE.md").asIsFields, {
    file: "GATE2-EVIDENCE.md",
    iters: 0,
  });
  assert.equal(
    evidenceAppeared(4, "/w/gates/GATE2-EVIDENCE.md"),
    "proposer.sh: evidence appeared after pass 4 (/w/gates/GATE2-EVIDENCE.md).",
  );
  assert.deepEqual(evidenceWrittenEvent("GATE2-EVIDENCE.md", 4).asIsFields, {
    file: "GATE2-EVIDENCE.md",
    iters: 4,
  });
});

test("T019 (F103-FR-004): every announcement names a type of the event catalogue", () => {
  const catalogue = readFileSync(
    join(ROOT, "packages/observability/data/event-catalogue.tsv"),
    "utf8",
  )
    .split("\n")
    .slice(1)
    .map((line) => line.split("\t")[0])
    .filter((type): type is string => typeof type === "string" && type.length > 0);
  for (const row of ANNOUNCEMENTS) {
    assert.ok(
      catalogue.includes(row.catalogueType),
      `\`${row.catalogueType}\` (for ${row.asIsName}) is a type of the catalogue of feature 111`,
    );
  }
});

test("T019 (F103-FR-004): the projection renders each type under the as-is name", () => {
  const rows = readFileSync(
    join(ROOT, "packages/observability/data/projection/projection-table.tsv"),
    "utf8",
  )
    .split("\n")
    .slice(1)
    .map((line) => line.split("\t"));
  for (const row of ANNOUNCEMENTS) {
    const matching = rows.filter((r) => r[0] === row.catalogueType && r[2] === row.asIsName);
    assert.ok(
      matching.length > 0,
      `the projection table maps \`${row.catalogueType}\` to \`${row.asIsName}\``,
    );
    if (row.condition !== undefined) {
      assert.ok(
        matching.some((r) => r[1] === row.condition),
        `and under the condition \`${row.condition}\``,
      );
    }
  }
});

test("T019 (F103-FR-004): the engine writes the attempt banner, the loop the rest", () => {
  assert.equal(WRITER_OF.proposer_start, "engine");
  assert.equal(WRITER_OF.iter_start, "pass-loop");
  assert.equal(WRITER_OF.iter_done, "pass-loop");
  assert.equal(WRITER_OF.evidence_present, "pass-loop");
  assert.equal(WRITER_OF.evidence_written, "pass-loop");
});

test("T019 (F103-FR-004): no NEW line is printed under the `parity` profile", () => {
  assert.equal(PRINTS_A_NEW_LINE_UNDER_PARITY, false);
  // `AS_IS_LINE_IDS` is the whole of what may be printed.
  for (const id of [
    "proposer-attempt-banner",
    "proposer-pass-banner",
    "evidence-already-exists",
    "evidence-appeared",
  ]) {
    assert.equal(hasAnAsIsEquivalent(id), true, `\`${id}\` has an as-is equivalent`);
  }
  assert.equal(hasAnAsIsEquivalent("a-line-this-feature-invented"), false);
});
