/**
 * T219 — contract test CT-100-333 for the presenter interface (annex G, §G.10;
 * F100-FR-233).
 *
 * The front door reaches the presenter only through the interface of §G.10; the
 * presenter reads nothing but the stream of events and the settings it is
 * handed; it never changes the exit code of a command, never writes state, and
 * is best-effort: a failure of the presenter never stalls or fails a run.
 *
 * The interface types are read from `data/presenter-interface.json`, the
 * machine-readable form of the table of §G.10, so the test compares the module
 * with that file cell by cell.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANNEX_SECTION,
  A_FAILURE_FAILS_A_RUN,
  A_FAILURE_STALLS_A_RUN,
  BASELINE_LINES_BYTE_FOR_BYTE_IN,
  CALLED_BY,
  CALLED_BY_CELL,
  CLOSED_SET_ROW,
  ERRORS_CELL,
  FREE_TEXT_FROM_OUTSIDE_IN_DEFAULT_OUTPUT,
  INTERFACE,
  IS_AN_EXTENSION_POINT_IN_WAVE_1,
  LINES_PRINTED_ON_A_FAILURE,
  MODES,
  MODES_CELL,
  MODE_OF_VERB,
  ON_A_FAILURE,
  OUTPUT_CELL,
  OUTPUT_MODES,
  OWNS_THE_FOUR_SUMMARY_LINES,
  PRESENTER_CHANGES_THE_EXIT_CODE,
  PRESENTER_IS_BEST_EFFORT,
  PRESENTER_READS,
  PRESENTER_READS_STATE,
  PRESENTER_WRITES_STATE,
  PROVIDED_BY,
  PROVIDED_BY_CELL,
  PresenterInterfaceError,
  REQUIREMENT,
  SCHEMA_ID,
  SETTINGS,
  STREAM_OF_OUTPUT_MODE,
  SUBJECTS,
  SUMMARY_LINES_ARE_OWNED_IN,
  SUMMARY_LINE_COUNT,
  SUMMARY_LINE_OWNER_CELL,
  failureLine,
  isPresenterMode,
  renderBestEffort,
  type Presenter,
  type PresenterInput,
  type PresenterOutput,
} from "../src/ep/presenter.ts";
import { closedSetRows } from "../src/enums/index.ts";

const DATA = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "data", "presenter-interface.json"), "utf8"),
) as { schema: string; annex: string; interface: { Subject: string; Content: string }[] };

/** A presenter that writes one line per event, for the best-effort cases. */
function samplePresenter(onRender?: () => void): Presenter {
  return {
    schema: SCHEMA_ID,
    render(input: PresenterInput, output: PresenterOutput): void {
      onRender?.();
      output.write(`[${input.mode}] rendered`);
    },
  };
}

function collector(): PresenterOutput & { readonly lines: string[] } {
  const lines: string[] = [];
  return { lines, write: (line: string) => void lines.push(line) };
}

function input(over: Partial<PresenterInput> = {}): PresenterInput {
  return {
    events: [],
    outputMode: "default",
    mode: "timeline",
    detail: "normal",
    settings: {
      colour: "auto",
      motion: false,
      banner: true,
      rail: true,
      background: "dark",
      glyphs: "unicode",
    },
    terminalSize: { columns: 100, rows: 40 },
    isATerminal: true,
    ...over,
  };
}

test("CT-100-333: the interface is the table of §G.10, subject for subject (F100-FR-233)", () => {
  assert.equal(ANNEX_SECTION, "annex G, §G.10");
  assert.equal(REQUIREMENT, "F100-FR-233");
  assert.equal(DATA.annex, "annex G, §G.10");
  assert.deepEqual(
    [...SUBJECTS],
    DATA.interface.map((r) => r.Subject),
    "every subject of the table, in the order of the annex",
  );
  for (const row of DATA.interface) {
    assert.equal(INTERFACE[row.Subject], row.Content, row.Subject);
  }
  // The schema id of the presenter is the one §G.10 fixes.
  assert.equal(SCHEMA_ID, "specstride.presenter/1");
  assert.equal(SCHEMA_ID, DATA.schema);
  // A subject the table does not hold is refused, not answered.
  assert.equal(INTERFACE["Something else"], undefined);
  assert.throws(() => {
    // The module refuses an unknown subject at load; prove the error exists and
    // names the table.
    throw new PresenterInterfaceError(`the table of ${ANNEX_SECTION} holds no subject "x"`);
  }, PresenterInterfaceError);
});

test("CT-100-333: the front door calls the presenter and nothing else does; it is no extension point (F100-FR-233)", () => {
  assert.equal(CALLED_BY, "the front door (119)");
  assert.match(CALLED_BY_CELL, /The front door \(119\)/);
  assert.equal(PROVIDED_BY, "145");
  assert.match(PROVIDED_BY_CELL, /presenter \(145\)/);
  assert.equal(IS_AN_EXTENSION_POINT_IN_WAVE_1, false);
  // The verbs of the front door and the mode each asks for (§G.10, "Called by").
  assert.equal(MODE_OF_VERB["run"], "timeline");
  assert.equal(MODE_OF_VERB["resume"], "timeline");
  assert.equal(MODE_OF_VERB["watch"], "card");
  for (const mode of Object.values(MODE_OF_VERB)) assert.ok(MODES.includes(mode));
});

test("CT-100-333: the three modes are those of §G.10 and of row 160 of annex X §X.6", () => {
  assert.equal(CLOSED_SET_ROW, 160);
  assert.deepEqual([...MODES], ["timeline", "card", "plain"]);
  for (const mode of MODES) {
    assert.equal(isPresenterMode(mode), true, mode);
    assert.ok(MODES_CELL.includes(mode), `the cell of §G.10 names ${mode}`);
  }
  assert.equal(isPresenterMode("fancy"), false);
  const row160 = closedSetRows.find((r) => r.number === 160);
  assert.ok(row160 !== undefined, "the table of annex X §X.6 holds row 160");
  for (const mode of MODES) {
    assert.ok(row160.members.includes(mode), `row 160 of annex X §X.6 names the mode ${mode}`);
  }
});

test("CT-100-333: the presenter reads nothing but the stream of events and the settings it is handed (F100-FR-233)", () => {
  assert.deepEqual([...PRESENTER_READS], ["the stream of events", "the settings it is handed"]);
  assert.equal(PRESENTER_READS_STATE, false);
  assert.equal(PRESENTER_WRITES_STATE, false);
  // The settings of §G.10, "Input": colour, motion, banner, rail, background,
  // glyphs — and the input carries every one of them and nothing of state.
  assert.deepEqual([...SETTINGS], ["colour", "motion", "banner", "rail", "background", "glyphs"]);
  const given = input();
  for (const setting of SETTINGS) {
    assert.ok(setting in given.settings, `the input carries the setting ${setting}`);
  }
  // The input carries the size of the terminal and whether the stream is one.
  assert.equal(typeof given.terminalSize.columns, "number");
  assert.equal(typeof given.isATerminal, "boolean");
  // No field of the input is a path, a root or a logical name: the presenter
  // has no way to read state through the interface.
  for (const key of Object.keys(given)) {
    assert.ok(
      !/path|root|file|dir|logicalName/i.test(key),
      `the interface hands the presenter no \`${key}\``,
    );
  }
  // The stream it reads depends on the output mode (§G.10, "Input").
  assert.deepEqual([...OUTPUT_MODES], ["default", "compatibility"]);
  assert.equal(STREAM_OF_OUTPUT_MODE["default"], "the primary event stream");
  assert.equal(STREAM_OF_OUTPUT_MODE["compatibility"], "the compatibility projection");
  assert.match(INTERFACE["Input"] ?? "", /compatibility projection in compatibility output/);
});

test("CT-100-333: the presenter never changes an exit code, never writes state and is best-effort (F100-FR-233)", async () => {
  assert.equal(PRESENTER_CHANGES_THE_EXIT_CODE, false);
  assert.equal(PRESENTER_WRITES_STATE, false);
  assert.equal(PRESENTER_IS_BEST_EFFORT, true);
  assert.equal(A_FAILURE_STALLS_A_RUN, false);
  assert.equal(A_FAILURE_FAILS_A_RUN, false);
  assert.equal(ON_A_FAILURE.reachesTheRun, false);
  assert.match(ERRORS_CELL, /None that reaches the run/);

  // A presenter that works: its lines go to the stream the front door names.
  const good = collector();
  const ok = await renderBestEffort(samplePresenter(), input({ mode: "card" }), good);
  assert.equal(ok.failed, false);
  assert.deepEqual(good.lines, ["[card] rendered"]);

  // A presenter that fails prints one line and leaves the exit code as it is.
  assert.equal(LINES_PRINTED_ON_A_FAILURE, 1);
  assert.equal(ON_A_FAILURE.linesPrinted, 1);
  const bad = collector();
  const failed = await renderBestEffort(
    samplePresenter(() => {
      throw new Error("the theme is broken");
    }),
    input(),
    bad,
  );
  assert.equal(failed.failed, true, "the failure is reported, not thrown at the front door");
  assert.equal(bad.lines.length, 1, "one line, and no more");
  assert.equal(bad.lines[0], failureLine(new Error("the theme is broken")));
  assert.match(bad.lines[0] ?? "", /the presenter failed/);
  // An asynchronous presenter that rejects is caught the same way.
  const rejected = collector();
  const async = await renderBestEffort(
    {
      schema: SCHEMA_ID,
      render: () => Promise.reject(new Error("late")),
    },
    input(),
    rejected,
  );
  assert.equal(async.failed, true);
  assert.equal(rejected.lines.length, 1);
});

test("CT-100-333: the output rules and the four summary lines are those of §G.10", () => {
  // In compatibility output the lines of the baseline byte for byte; in default
  // output no free text from outside the runtime.
  assert.equal(BASELINE_LINES_BYTE_FOR_BYTE_IN, "compatibility");
  assert.equal(FREE_TEXT_FROM_OUTSIDE_IN_DEFAULT_OUTPUT, false);
  assert.match(OUTPUT_CELL, /lines of the baseline byte for byte/);
  assert.match(OUTPUT_CELL, /no free text from outside the runtime/);
  // The presenter owns the four summary lines of the stream, in compatibility
  // output.
  assert.equal(OWNS_THE_FOUR_SUMMARY_LINES, true);
  assert.equal(SUMMARY_LINE_COUNT, 4);
  assert.equal(SUMMARY_LINES_ARE_OWNED_IN, "compatibility");
  assert.match(SUMMARY_LINE_OWNER_CELL, /The presenter, in compatibility output/);
});
