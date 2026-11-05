/**
 * T037 — the tests of the task-list reading and its comparison (F104-FR-026;
 * annex B §B.5; `contracts/verdict.md`).
 *
 * The obligation of T037 asks for an EFFECT WITNESS: the resulting state
 * observed through an independent read path, and a durable content hash that
 * could not exist before the action. This feature does not write the record
 * `run:<runId>:task-list` — the ENGINE does, at launch (F104-FR-026, CQ-044) —
 * so the witness is built the way the engine would build it and then read back
 * the long way round:
 *
 *   the model  →  `contentOfTheRecord`  →  the canonical record text
 *              →  a file on disk  →  a SECOND process reads it with `node:fs`
 *              →  `JSON.parse`  →  the readings rebuilt from the bytes
 *              →  `hashOfReadings` over the REBUILT readings
 *
 * The hash at the end is compared with the hash the model gave at the start.
 * The bytes on disk, and that hash over them, are the durable witness: neither
 * existed before the reading was taken. The read is done in a CHILD process
 * (`node -e`), so the value is observed through a path that shares no object,
 * no module instance and no cache with the one that produced it — the return
 * value of the function under test is not the proof.
 *
 * `WRITES_THE_TASK_LIST_RECORD` is `false`, and the write in this file is the
 * TEST's, standing in for the engine. That the module itself holds no write is
 * measured on the module at the end of the file.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalRecordHash, canonicalRecordText } from "@specstride/kernel/hasher";
import { TASK_LIST_LOGICAL_NAME, TASK_LIST_SCHEMA_ID } from "../src/model.ts";
import { parse } from "../src/validate.ts";
import { tickText } from "../src/tick.ts";
import {
  FIELDS_LEFT_OUT_OF_A_READING,
  FIELDS_OF_A_READING,
  KEYWORD_OF_AN_ABSENT_SCHEMA,
  RECORD_ANNEX_SECTION,
  WRITER_OF_THE_RECORD,
  WRITES_THE_TASK_LIST_RECORD,
  absentSchemaReason,
  compareReadings,
  compareReadingsOfPhase,
  contentOfTheRecord,
  hashOfReadings,
  hashedRecordOf,
  idsOf,
  isReordered,
  isUnchanged,
  markersChanged,
  readingOfPhase,
  readingOfPhaseNumber,
  readingsOfModel,
  textOfReadings,
  validateRecordContent,
} from "../src/task-reading.ts";

const FILE = "specs/104-spec-input/tasks.md";

const TASKS = [
  "# Tasks",
  "",
  "## Phase 1: Setup",
  "",
  "- [ ] T001 [P] create the package",
  "- [ ] T002 write the characterization test",
  "- [x] T003 confirm the fixtures",
  "",
  "## Phase 2: Foundational",
  "",
  "- [ ] T010 [P] [US2] the hasher",
  "- [ ] T011 the registry",
  "",
].join("\n");

function model(text: string) {
  return parse({ file: FILE, text, format: "speckit-tasks", feature: "104-spec-input" });
}

/* ------------------------------------------------------------------ *
 * The reading itself (F104-FR-026).
 * ------------------------------------------------------------------ */

test("T037: the reading of a phase holds the ordered ids, markers and text — and nothing of the file's state", () => {
  const phase = model(TASKS).phases[0];
  assert.ok(phase !== undefined);
  const reading = readingOfPhase(phase);

  assert.equal(reading.phase, 1);
  assert.deepEqual(
    reading.tasks.map((t) => t.id),
    ["T001", "T002", "T003"],
    "the ids, in document order",
  );
  assert.deepEqual([...(reading.tasks[0]?.markers ?? [])], ["[P]"]);
  assert.equal(reading.tasks[0]?.text, "create the package");
  assert.match(reading.hash, /^[0-9a-f]{64}$/, "the canonical record hash");

  // The three fields a reading holds, and the three it leaves out, measured on
  // the object and not only declared.
  for (const task of reading.tasks) {
    assert.deepEqual(Object.keys(task).sort(), [...FIELDS_OF_A_READING].sort());
    for (const left of FIELDS_LEFT_OUT_OF_A_READING) {
      assert.ok(!(left in task), `a reading holds no \`${left}\``);
    }
  }
  // `T003` is ticked in the file; the reading says nothing about it.
  assert.equal(phase.tasks[2]?.ticked, true, "the MODEL knows the box is ticked");
  assert.ok(!("ticked" in (reading.tasks[2] as object)), "the READING does not");

  // The hash is taken over exactly the record `hashedRecordOf` returns.
  assert.equal(reading.hash, canonicalRecordHash(hashedRecordOf(reading.tasks)));
  assert.equal(textOfReadings(reading.tasks), canonicalRecordText(hashedRecordOf(reading.tasks)));
  assert.equal(hashOfReadings(reading.tasks), reading.hash);
});

test("T037: the model gives a reading for EVERY phase, and `readingOfPhaseNumber` picks one out", () => {
  const readings = readingsOfModel(model(TASKS));
  assert.deepEqual(
    readings.map((r) => r.phase),
    [1, 2],
  );
  assert.deepEqual(idsOf(readings[1]?.tasks ?? []), ["T010", "T011"]);
  assert.deepEqual([...(readings[1]?.tasks[0]?.markers ?? [])], ["[P]", "[US2]"]);
  assert.equal(readingOfPhaseNumber(model(TASKS), 2)?.hash, readings[1]?.hash);
  assert.equal(readingOfPhaseNumber(model(TASKS), 99), undefined, "a missing phase is no error");
  // Two phases with different tasks have different hashes.
  assert.notEqual(readings[0]?.hash, readings[1]?.hash);
});

test("T037: a TICK does not change the reading's hash; neither does a line shift (F104-FR-026)", () => {
  const before = readingsOfModel(model(TASKS));

  // A real tick of phase 1, through the tick of this feature.
  const ticked = tickText({
    text: TASKS,
    format: "speckit-tasks",
    request: { phase: 1 },
    file: FILE,
  });
  assert.equal(ticked.changed, 2);
  assert.notEqual(ticked.text, TASKS);
  assert.deepEqual(
    readingsOfModel(model(ticked.text)).map((r) => r.hash),
    before.map((r) => r.hash),
    "every phase's hash survived the tick",
  );

  // A line shift: prose inserted above the tasks moves every `line`, and the
  // reading does not notice.
  const shifted = TASKS.replace(
    "## Phase 1: Setup\n",
    "## Phase 1: Setup\n\nA paragraph the author added.\n",
  );
  const shiftedModel = model(shifted);
  assert.notEqual(
    shiftedModel.phases[0]?.tasks[0]?.line,
    model(TASKS).phases[0]?.tasks[0]?.line,
    "the line really moved",
  );
  assert.deepEqual(
    readingsOfModel(shiftedModel).map((r) => r.hash),
    before.map((r) => r.hash),
  );
});

/* ------------------------------------------------------------------ *
 * The comparison (F104-FR-026; `contracts/verdict.md`).
 * ------------------------------------------------------------------ */

test("T037: the comparison reports added, removed, reordered and textChanged", () => {
  const first = readingOfPhase(model(TASKS).phases[0] as never);

  // Unchanged.
  assert.deepEqual(compareReadingsOfPhase(first, first), {
    added: [],
    removed: [],
    reordered: false,
    textChanged: [],
  });
  assert.equal(isUnchanged(compareReadingsOfPhase(first, first)), true);

  // Added and removed.
  const withT004 = model(TASKS.replace("- [x] T003 confirm the fixtures", "- [ ] T004 a new task"))
    .phases[0];
  const second = readingOfPhase(withT004 as never);
  const comparison = compareReadingsOfPhase(first, second);
  assert.deepEqual([...comparison.added], ["T004"]);
  assert.deepEqual([...comparison.removed], ["T003"]);
  assert.equal(comparison.reordered, false, "a swap of one id for another is not a reorder");
  assert.deepEqual([...comparison.textChanged], []);
  assert.equal(isUnchanged(comparison), false);

  // The text of one task changed.
  const edited = readingOfPhase(
    model(TASKS.replace("T002 write the characterization test", "T002 write the SECOND test"))
      .phases[0] as never,
  );
  const textOnly = compareReadingsOfPhase(first, edited);
  assert.deepEqual([...textOnly.textChanged], ["T002"]);
  assert.deepEqual([...textOnly.added], []);
  assert.deepEqual([...textOnly.removed], []);
  assert.equal(textOnly.reordered, false);
  assert.notEqual(edited.hash, first.hash, "and the hash moved with it");

  // Reordered: the same ids in another order.
  const swapped = readingOfPhase(
    model(
      TASKS.replace(
        "- [ ] T001 [P] create the package\n- [ ] T002 write the characterization test",
        "- [ ] T002 write the characterization test\n- [ ] T001 [P] create the package",
      ),
    ).phases[0] as never,
  );
  const reorder = compareReadingsOfPhase(first, swapped);
  assert.equal(reorder.reordered, true);
  assert.deepEqual([...reorder.added], []);
  assert.deepEqual([...reorder.removed], []);
  assert.deepEqual([...reorder.textChanged], []);
  assert.notEqual(swapped.hash, first.hash, "order is part of the hash");
  assert.equal(isReordered(first.tasks, swapped.tasks), true);
  assert.equal(isReordered(first.tasks, first.tasks), false);
});

test("T037: a markers change is reported by `markersChanged`, which the four contract fields do not cover", () => {
  const first = readingOfPhase(model(TASKS).phases[0] as never);
  const noParallel = readingOfPhase(
    model(TASKS.replace("- [ ] T001 [P] create", "- [ ] T001 create")).phases[0] as never,
  );
  const comparison = compareReadingsOfPhase(first, noParallel);
  // The four fields of `contracts/verdict.md` say nothing about it...
  assert.deepEqual(comparison, { added: [], removed: [], reordered: false, textChanged: [] });
  // ...but the information is not lost: the hash moved, and `markersChanged`
  // names the id.
  assert.deepEqual([...markersChanged(first.tasks, noParallel.tasks)], ["T001"]);
  assert.notEqual(noParallel.hash, first.hash);
  assert.deepEqual([...markersChanged(first.tasks, first.tasks)], []);
});

test("T037: the comparison of a tick is empty — a tick changes nothing a reading can see", () => {
  const before = readingOfPhase(model(TASKS).phases[0] as never);
  const ticked = tickText({
    text: TASKS,
    format: "speckit-tasks",
    request: { phase: 1 },
    file: FILE,
  });
  const after = readingOfPhase(model(ticked.text).phases[0] as never);
  assert.deepEqual(compareReadings(before.tasks, after.tasks), {
    added: [],
    removed: [],
    reordered: false,
    textChanged: [],
  });
  assert.equal(after.hash, before.hash);
});

/* ------------------------------------------------------------------ *
 * The EFFECT WITNESS: the record's content, observed through an
 * independent read path in a CHILD process (annex B §B.5).
 * ------------------------------------------------------------------ */

test("T037: the content of `run:<runId>:task-list` survives a round trip through bytes on disk, read back by a child process", () => {
  const directory = mkdtempSync(join(tmpdir(), "ss104-task-list-"));
  try {
    const content = contentOfTheRecord(model(TASKS));
    // The hashes the model gave, before anything durable exists.
    const expected = content.phases.map((p) => [p.phase, p.hash] as const);
    assert.deepEqual(expected, [
      [1, content.phases[0]?.hash as string],
      [2, content.phases[1]?.hash as string],
    ]);

    // THE ACTION, as the engine would take it at launch: the content, as the
    // canonical record text, written to the record's file. The write is the
    // TEST's; this feature never writes it (F104-FR-026).
    const record = join(directory, "task-list.json");
    const bytes = `${canonicalRecordText(content)}\n`;
    writeFileSync(record, bytes);

    // THE WITNESS, through a path that shares nothing with the producer: a
    // CHILD process reads the file, rebuilds the readings from the bytes, and
    // hashes them again with the canonical hasher. Nothing of the parent's
    // objects, modules or caches reaches it.
    const script = [
      "const { readFileSync } = require('node:fs');",
      "const { createHash } = require('node:crypto');",
      "const content = JSON.parse(readFileSync(process.argv[1], 'utf8'));",
      // The canonical record text, rebuilt here from scratch: sorted keys,
      // compact separators, non-ASCII kept, no final line end (annex X §X.5).
      "const canon = (v) => JSON.stringify(v, (k, x) =>",
      "  x && typeof x === 'object' && !Array.isArray(x)",
      "    ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]]))",
      "    : x);",
      "const hash = (v) => createHash('sha256').update(canon(v) + '\\n', 'utf8').digest('hex');",
      "const out = content.phases.map((p) => [p.phase, p.hash, hash(p.tasks),",
      "  p.tasks.map((t) => Object.keys(t).sort().join('+'))]);",
      "process.stdout.write(JSON.stringify(out));",
    ].join("\n");
    const observed = JSON.parse(
      execFileSync(process.execPath, ["-e", script, record], { encoding: "utf8" }),
    ) as [number, string, string, string[]][];

    // The durable identity: the hash the child computed over the BYTES equals
    // the hash the model gave. Neither the bytes nor this value existed before
    // the reading was taken.
    assert.deepEqual(
      observed.map(([phase, recorded]) => [phase, recorded] as const),
      expected,
      "the recorded hashes came back out of the file",
    );
    for (const [phase, recorded, recomputed, keys] of observed) {
      assert.equal(
        recomputed,
        recorded,
        `phase ${phase}: the hash recomputed from the bytes by an independent reader`,
      );
      for (const taskKeys of keys) {
        assert.equal(taskKeys, "id+markers+text", `phase ${phase}: the fields on disk`);
      }
    }
    // The bytes themselves are durable and are the record's content.
    const onDisk = readFileSync(record, "utf8");
    assert.equal(onDisk, bytes);
    assert.ok(onDisk.includes('"T001"') && onDisk.includes('"[P]"'));
    assert.ok(!onDisk.includes('"ticked"'), "no tick state reached the record");
    assert.ok(!onDisk.includes('"line"'), "no line number reached the record");

    // And the round trip is stable: the reading rebuilt from the bytes, handed
    // back to this package's own hash, gives the same value again.
    const reread = JSON.parse(readFileSync(record, "utf8")) as {
      phases: { phase: number; tasks: { id: string; markers: string[]; text: string }[] }[];
    };
    assert.deepEqual(
      reread.phases.map((p) => [p.phase, hashOfReadings(p.tasks)] as const),
      expected,
    );

    // A TICK of the file, the record untouched: the engine's record still
    // matches, which is the point of the whole construction.
    const ticked = tickText({
      text: TASKS,
      format: "speckit-tasks",
      request: { phase: 1 },
      file: FILE,
    });
    assert.deepEqual(
      contentOfTheRecord(model(ticked.text)).phases.map((p) => [p.phase, p.hash] as const),
      expected,
    );

    // A real EDIT of a task's text, by contrast, breaks the match and the
    // comparison names the id.
    const edited = contentOfTheRecord(
      model(TASKS.replace("T011 the registry", "T011 the registry and its order")),
    );
    assert.notEqual(edited.phases[1]?.hash, expected[1]?.[1]);
    assert.deepEqual(
      [
        ...compareReadings(reread.phases[1]?.tasks ?? [], edited.phases[1]?.tasks ?? [])
          .textChanged,
      ],
      ["T011"],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * What this feature does NOT do (F104-FR-026).
 * ------------------------------------------------------------------ */

test("T037: this feature gives the reading and does not write the record; the module holds no write", () => {
  assert.equal(WRITES_THE_TASK_LIST_RECORD, false);
  assert.equal(WRITER_OF_THE_RECORD, "the engine, at launch");
  assert.equal(TASK_LIST_LOGICAL_NAME, "run:<runId>:task-list");
  assert.equal(RECORD_ANNEX_SECTION, "annex B, §B.5");

  // Measured on the module: `task-reading.ts` imports nothing that writes, and
  // its code names no write. Comments are stripped first, so the prose above
  // cannot decide the result.
  const source = readFileSync(new URL("../src/task-reading.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const forbidden of [
    "node:fs",
    "writeFileSync",
    "atomic-write",
    "mkdirSync",
    "appendFileSync",
  ]) {
    assert.ok(!code.includes(forbidden), `the code of the reading holds no ${forbidden}`);
  }
  // Falsifiable: the module DOES name the writer in its prose, and the stripped
  // code does not hold a write.
  assert.ok(source.includes("the engine writes the record"));
});

test("T037: the record crosses a file boundary, and the schema it is validated against is reported honestly", () => {
  assert.equal(TASK_LIST_SCHEMA_ID, "specstride.task-list/1");
  const result = validateRecordContent(contentOfTheRecord(model(TASKS)));
  if (result.schema === "applied") {
    // The day feature 100 delivers the schema file, the content must validate.
    assert.equal(result.ok, true, `the content is no ${TASK_LIST_SCHEMA_ID}`);
    return;
  }
  // Until then the absence is REPORTED, with the reason and the owner, and
  // never reported as a validation that passed (Principle VI, research D-13).
  assert.equal(result.schema, "absent");
  assert.match(result.reason, /holds no schema `specstride\.task-list\/1`/);
  assert.match(result.reason, /annex B §B\.20/);
  assert.match(result.reason, /unknown schema id/);
  assert.match(result.reason, /Reported, not validated/);
});

/* ------------------------------------------------------------------ *
 * T050 — CT-104-7, the four claims of the task-list reading as the task
 * states them (F104-FR-026). They run beside T037's tests above and name the
 * case id, so a reader sees which obligation each one carries.
 * ------------------------------------------------------------------ */

/** A task list whose two phases differ in every field a reading holds. */
const CT7_TASKS = [
  "# Tasks",
  "",
  "## Phase 1: Setup",
  "",
  "- [ ] T001 [P] [US1] create the package",
  "- [x] T002 write the characterization test",
  "  - [ ] T003a an indented letter id",
  "",
  "## Phase 2: Foundational",
  "",
  "- [ ] T010 [P] the hasher",
  "- [ ] T011 the registry",
  "",
].join("\n");

test("CT-104-7: the task-list reading PER PHASE, in order, with id, markers and text", () => {
  const built = model(CT7_TASKS);
  const readings = readingsOfModel(built);
  // One reading per phase, in document order, each named by its phase number.
  assert.deepEqual(
    readings.map((reading) => reading.phase),
    [1, 2],
  );
  assert.deepEqual(readings[0]?.tasks, [
    { id: "T001", markers: ["[P]", "[US1]"], text: "create the package" },
    { id: "T002", markers: [], text: "write the characterization test" },
    { id: "T003a", markers: [], text: "an indented letter id" },
  ]);
  assert.deepEqual(readings[1]?.tasks, [
    { id: "T010", markers: ["[P]"], text: "the hasher" },
    { id: "T011", markers: [], text: "the registry" },
  ]);
  // The three fields of a reading and the three the MODEL has that a reading
  // leaves out — the file's state is not part of a reading.
  assert.deepEqual([...FIELDS_OF_A_READING], ["id", "markers", "text"]);
  assert.deepEqual([...FIELDS_LEFT_OUT_OF_A_READING], ["ticked", "line", "file"]);
  for (const reading of readings) {
    for (const task of reading.tasks) {
      assert.deepEqual(Object.keys(task).sort(), [...FIELDS_OF_A_READING].sort());
    }
  }
  // Each phase carries its own hash, and the hashes of two different phases
  // are different values.
  assert.match(readings[0]?.hash ?? "", /^[0-9a-f]{64}$/);
  assert.notEqual(readings[0]?.hash, readings[1]?.hash);
  // The reading of ONE phase is the same record either way round.
  assert.deepEqual(readingOfPhaseNumber(built, 1), readings[0]);
  assert.deepEqual(readingOfPhaseNumber(built, 2), readings[1]);
  assert.equal(readingOfPhaseNumber(built, 9), undefined);
  assert.deepEqual(readingOfPhase(built.phases[0]!), readings[0]);
  // The hash is the canonical record hash of the readings, which is the
  // kernel's operation over the record text and no hash of this module's own.
  assert.equal(readings[0]?.hash, canonicalRecordHash(hashedRecordOf(readings[0]!.tasks)));
  assert.equal(
    textOfReadings(readings[0]!.tasks),
    canonicalRecordText(hashedRecordOf(readings[0]!.tasks)),
  );
});

test("CT-104-7: the hash does not change with TICKS or with LINE NUMBERS", () => {
  const before = readingsOfModel(model(CT7_TASKS));

  // (a) a TICK: every box of phase 1 ticked, and of phase 2 as well.
  const ticked = [1, 2].reduce(
    (text, phase) => tickText({ text, format: "speckit-tasks", request: { phase } }).text,
    CT7_TASKS,
  );
  assert.notEqual(ticked, CT7_TASKS, "there IS something to tick");
  const afterTick = readingsOfModel(model(ticked));
  assert.deepEqual(
    afterTick.map((reading) => reading.hash),
    before.map((reading) => reading.hash),
  );
  // ...and the whole reading is the same record, not only its hash.
  assert.deepEqual(afterTick, before);
  // Clearing every box is the same.
  const cleared = CT7_TASKS.replace(/- \[x\]/g, "- [ ]");
  assert.deepEqual(
    readingsOfModel(model(cleared)).map((reading) => reading.hash),
    before.map((reading) => reading.hash),
  );

  // (b) a LINE SHIFT: the same tasks further down the file, with blank lines
  // and prose added above them. Every task's `line` moves; no hash does.
  const shifted = `# Tasks\n\nSome prose.\n\nAnd more prose.\n\n${CT7_TASKS.slice("# Tasks\n\n".length)}`;
  const shiftedModel = model(shifted);
  const afterShift = readingsOfModel(shiftedModel);
  assert.notDeepEqual(
    shiftedModel.phases[0]?.tasks.map((task) => task.line),
    model(CT7_TASKS).phases[0]?.tasks.map((task) => task.line),
    "the lines really did move",
  );
  assert.deepEqual(
    afterShift.map((reading) => reading.hash),
    before.map((reading) => reading.hash),
  );

  // (c) a changed TEXT, a changed MARKER and a changed ORDER each DO move it,
  // so the hash is not merely constant.
  for (const changed of [
    CT7_TASKS.replace("create the package", "create the thing"),
    CT7_TASKS.replace("- [ ] T001 [P] [US1]", "- [ ] T001 [US1]"),
    CT7_TASKS.replace(
      "- [ ] T010 [P] the hasher\n- [ ] T011 the registry",
      "- [ ] T011 the registry\n- [ ] T010 [P] the hasher",
    ),
  ]) {
    assert.notDeepEqual(
      readingsOfModel(model(changed)).map((reading) => reading.hash),
      before.map((reading) => reading.hash),
      changed.slice(0, 40),
    );
  }
});

test("CT-104-7: the comparison reports added, removed, reordered and changed ids", () => {
  const base = readingOfPhaseNumber(model(CT7_TASKS), 1)!;

  // ADDED: one id the earlier reading did not hold.
  const added = readingOfPhaseNumber(
    model(CT7_TASKS.replace("- [x] T002", "- [ ] T004 a new task\n- [x] T002")),
    1,
  )!;
  assert.deepEqual(compareReadings(base.tasks, added.tasks), {
    added: ["T004"],
    removed: [],
    reordered: false,
    textChanged: [],
  });

  // REMOVED: an id the later reading has lost.
  const removed = readingOfPhaseNumber(
    model(CT7_TASKS.replace("- [x] T002 write the characterization test\n", "")),
    1,
  )!;
  assert.deepEqual(compareReadings(base.tasks, removed.tasks), {
    added: [],
    removed: ["T002"],
    reordered: false,
    textChanged: [],
  });

  // REORDERED: the same ids in a different order.
  const reordered = readingOfPhaseNumber(
    model(
      CT7_TASKS.replace(
        "- [ ] T001 [P] [US1] create the package\n- [x] T002 write the characterization test",
        "- [x] T002 write the characterization test\n- [ ] T001 [P] [US1] create the package",
      ),
    ),
    1,
  )!;
  assert.deepEqual(compareReadings(base.tasks, reordered.tasks), {
    added: [],
    removed: [],
    reordered: true,
    textChanged: [],
  });

  // CHANGED IDS: the ids whose TEXT is different, named one by one.
  const textChanged = readingOfPhaseNumber(
    model(CT7_TASKS.replace("create the package", "create the thing")),
    1,
  )!;
  assert.deepEqual(compareReadings(base.tasks, textChanged.tasks), {
    added: [],
    removed: [],
    reordered: false,
    textChanged: ["T001"],
  });

  // All four at once, each field reporting only its own ids.
  const all = readingOfPhaseNumber(
    model(
      [
        "## Phase 1: Setup",
        "",
        "- [ ] T003a an indented letter id",
        "- [ ] T001 [P] [US1] create the thing",
        "- [ ] T004 a new task",
        "",
      ].join("\n"),
    ),
    1,
  )!;
  assert.deepEqual(compareReadings(base.tasks, all.tasks), {
    added: ["T004"],
    removed: ["T002"],
    reordered: true,
    textChanged: ["T001"],
  });
  // `reordered` is scoped to the ids the two readings SHARE: an addition at
  // the end alone is not a reorder, which the `added` case above measured.
  const reading = (...ids: readonly string[]) =>
    ids.map((id) => ({ id, markers: [] as readonly string[], text: id }));
  assert.equal(isReordered(reading("T001", "T002"), reading("T001", "T002", "T004")), false);
  assert.equal(isReordered(reading("T001", "T002"), reading("T002", "T001")), true);
  // An id REMOVED from the middle is not a reorder of the ids that are left.
  assert.equal(isReordered(reading("T001", "T002", "T003"), reading("T001", "T003")), false);
  // The comparison of a reading with ITSELF is empty, and `isUnchanged` says so.
  assert.deepEqual(compareReadings(base.tasks, base.tasks), {
    added: [],
    removed: [],
    reordered: false,
    textChanged: [],
  });
  assert.equal(isUnchanged(compareReadings(base.tasks, base.tasks)), true);
  assert.equal(isUnchanged(compareReadings(base.tasks, all.tasks)), false);
  // A markers change is reported beside the four fields, never folded in.
  const markers = readingOfPhaseNumber(
    model(CT7_TASKS.replace("- [ ] T001 [P] [US1]", "- [ ] T001 [US1]")),
    1,
  )!;
  assert.deepEqual(compareReadings(base.tasks, markers.tasks).textChanged, []);
  assert.deepEqual(markersChanged(base.tasks, markers.tasks), ["T001"]);
  // The comparison of two readings of ONE phase, taken from two whole models.
  assert.deepEqual(
    compareReadingsOfPhase(
      readingOfPhaseNumber(model(CT7_TASKS), 1)!,
      readingOfPhaseNumber(model(CT7_TASKS.replace("create the package", "create the thing")), 1)!,
    ),
    { added: [], removed: [], reordered: false, textChanged: ["T001"] },
  );
  assert.deepEqual(idsOf(base.tasks), ["T001", "T002", "T003a"]);
});

test("CT-104-7: the reading validates as `run:<runId>:task-list` against `specstride.task-list/1`", () => {
  // The id and the logical name are feature 100's (annex B §B.5, §B.20), and
  // this feature delivers the schema FILE through its own
  // `specs/104-spec-input/contracts/deliver.json` (research D-13, T043).
  assert.equal(TASK_LIST_SCHEMA_ID, "specstride.task-list/1");
  assert.equal(TASK_LIST_LOGICAL_NAME, "run:<runId>:task-list");
  assert.equal(RECORD_ANNEX_SECTION, "annex B, §B.5");
  assert.equal(WRITER_OF_THE_RECORD, "the engine, at launch");
  assert.equal(WRITES_THE_TASK_LIST_RECORD, false);

  // The schema is APPLIED — not reported absent — and the content of the
  // record validates. `validateRecordContent` goes through the validator of
  // `@specstride/contracts`; this feature holds none of its own (D-10).
  const content = contentOfTheRecord(model(CT7_TASKS));
  const validated = validateRecordContent(content);
  assert.equal(validated.schema, "applied", "the schema file is delivered");
  assert.equal(validated.schema === "applied" && validated.ok, true);
  // The record carries its own schema id, which is the identity of a record
  // of this product (F100-FR-048).
  assert.equal(content.schema, TASK_LIST_SCHEMA_ID);

  // The validation BITES: four malformed contents, each refused with an error
  // that names the field. A validation that accepted anything would be worth
  // nothing.
  const refused: readonly unknown[] = [
    // no `schema` field at all;
    { phases: content.phases },
    // no `phases`;
    { schema: TASK_LIST_SCHEMA_ID },
    // a phase with no hash;
    { schema: TASK_LIST_SCHEMA_ID, phases: [{ phase: 1, tasks: [] }] },
    // a task with no markers, and a phase number that is not a whole number.
    {
      schema: TASK_LIST_SCHEMA_ID,
      phases: [{ phase: 1.5, tasks: [{ id: "T001", text: "a" }], hash: "x" }],
    },
  ];
  for (const bad of refused) {
    const result = validateRecordContent(bad);
    assert.equal(result.schema, "applied", JSON.stringify(bad));
    assert.equal(result.schema === "applied" && result.ok, false, JSON.stringify(bad));
    assert.ok(
      result.schema === "applied" && !result.ok && result.errors.length > 0,
      JSON.stringify(bad),
    );
  }
  // A record that names a DIFFERENT schema id is refused too, which is what
  // makes the `schema` field the record's identity.
  const wrongId = validateRecordContent({ ...content, schema: "specstride.lease/1" });
  assert.equal(wrongId.schema === "applied" && wrongId.ok, false);

  // The content of EVERY format reads and validates, so the claim is not about
  // one task list.
  for (const [format, text] of [
    ["speckit-tasks", CT7_TASKS],
    ["openspec-change", "## 1. Setup\n\n- [ ] 1.1 do it\n- [x] 1.2 and the other\n"],
  ] as const) {
    const built = parse({ file: FILE, text, format, feature: "104-spec-input" });
    const one = validateRecordContent(contentOfTheRecord(built));
    assert.equal(one.schema === "applied" && one.ok, true, format);
  }
  // And the absent-schema branch is still honest code, not dead prose: its
  // reason names the owner and the delivery, for the day an id has no file.
  assert.equal(KEYWORD_OF_AN_ABSENT_SCHEMA, "unknown-schema");
  assert.match(absentSchemaReason("because"), /annex B §B\.20/);
  assert.match(absentSchemaReason("because"), /Reported, not validated \(because\)/);
});
