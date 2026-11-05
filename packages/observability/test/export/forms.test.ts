/**
 * T009 — test CT-128-14: the two forms of a payload (F128-FR-009).
 *
 * The form follows `compat.legacyEvents`. The exporter holds three as-is names
 * of its own — `api_request` from `stream.result`, `tool_use` from `tool.call`,
 * `gate` as the name under which `verdict.recorded` feeds the old metric — and
 * no run ships an event named `gate`. In the as-is form an event that projects
 * to nothing is not shipped, opens no span and feeds no old metric. The names
 * come from the table of the compatibility projection.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { asIsNameOf } from "@specstride/observability/projection";
import {
  PAYLOAD_FORM_SWITCH,
  PAYLOAD_FORMS,
  THE_EXPORTERS_OWN_NAMES,
  THE_EXPORTERS_OWN_TYPES,
  THE_NAME_NO_RUN_SHIPS,
  exporterOwnAsIsNameOf,
  feedsAnOldMetric,
  payloadFormOf,
  payloadFormRows,
  shipsInAsIsForm,
  shippedAsIsNameOf,
  shippedNameOf,
} from "../../src/export/forms/forms.ts";

/** The real table of the compatibility projection, as the context of `open` gives it. */
const TABLE = { asIsNameOf };

test("CT-128-14: the form follows compat.legacyEvents", () => {
  assert.deepEqual([...PAYLOAD_FORMS], ["as-is", "new"]);
  assert.equal(payloadFormOf({ [PAYLOAD_FORM_SWITCH]: true }), "as-is");
  assert.equal(payloadFormOf({ [PAYLOAD_FORM_SWITCH]: false }), "new");
  assert.equal(payloadFormOf({}), "new");
  // Under the `parity` profile the projection is on, so as-is.
  assert.equal(payloadFormOf({}, "parity"), "as-is");
  assert.equal(payloadFormOf({ [PAYLOAD_FORM_SWITCH]: true }, "default"), "as-is");
  assert.equal(PAYLOAD_FORM_SWITCH, "compat.legacyEvents");
});

test("CT-128-14: the three names the exporter holds itself", () => {
  assert.equal(THE_EXPORTERS_OWN_NAMES.api_request, "stream.result");
  assert.equal(THE_EXPORTERS_OWN_NAMES.tool_use, "tool.call");
  assert.equal(THE_EXPORTERS_OWN_NAMES.gate, "verdict.recorded");
  assert.deepEqual(
    [...THE_EXPORTERS_OWN_TYPES],
    ["stream.result", "tool.call", "verdict.recorded"],
  );
  assert.equal(exporterOwnAsIsNameOf("stream.result"), "api_request");
  assert.equal(exporterOwnAsIsNameOf("tool.call"), "tool_use");
  assert.equal(exporterOwnAsIsNameOf("verdict.recorded"), "gate");
  assert.equal(exporterOwnAsIsNameOf("run.launched"), null);
  // The three names have NO row in the table: the exporter holds them itself.
  for (const name of ["api_request", "tool_use", "gate"]) {
    assert.ok(
      !Object.values(THE_EXPORTERS_OWN_NAMES).includes(name as never) ||
        asIsNameOf(THE_EXPORTERS_OWN_NAMES[name as keyof typeof THE_EXPORTERS_OWN_NAMES]!) !== name,
      `${name} is not a name the table gives`,
    );
  }
});

test("CT-128-14: gate is the metric name only — no run ships an event named gate", () => {
  // The verdict ships under the name the table gives (`verdict`), never `gate`.
  assert.equal(shippedAsIsNameOf("verdict.recorded", TABLE), "verdict");
  assert.equal(shippedNameOf("verdict.recorded", "as-is", TABLE), "verdict");
  // Over the whole catalogue and the three own types, nothing ships as `gate`.
  const types = [
    "run.launched",
    "run.started",
    "pass.started",
    "pass.ended",
    "tool.call",
    "stream.result",
    "verdict.recorded",
    "phase.started",
    "run.ended",
  ];
  for (const type of types) {
    assert.notEqual(shippedNameOf(type, "as-is", TABLE), THE_NAME_NO_RUN_SHIPS);
    assert.notEqual(shippedNameOf(type, "new", TABLE), THE_NAME_NO_RUN_SHIPS);
  }
  assert.equal(THE_NAME_NO_RUN_SHIPS, "gate");
});

test("CT-128-14: the names come from the table of the compatibility projection", () => {
  assert.equal(shippedAsIsNameOf("tool.call", TABLE), "agent_tool");
  assert.equal(shippedAsIsNameOf("stream.result", TABLE), "agent_result");
  // A type with no row projects to nothing, in the as-is form.
  assert.equal(shippedAsIsNameOf("x.third-party", TABLE), null);
});

test("CT-128-14: in the as-is form an event that projects to nothing ships nothing, opens no span, feeds no old metric", () => {
  const nothing = { asIsNameOf: () => null };
  assert.equal(shipsInAsIsForm("tripwire.raised", nothing), false);
  assert.equal(shippedNameOf("tripwire.raised", "as-is", nothing), null);
  assert.equal(feedsAnOldMetric("tripwire.raised", nothing), false);
  // The new form ships it under its own type: the rule is the as-is form's.
  assert.equal(shippedNameOf("tripwire.raised", "new", nothing), "tripwire.raised");
  // With the real table, a projecting type ships and its own name feeds the metric.
  assert.equal(shipsInAsIsForm("verdict.recorded", TABLE), true);
  assert.equal(feedsAnOldMetric("verdict.recorded", TABLE), true);
  assert.equal(feedsAnOldMetric("run.launched", TABLE), false);
});

test("CT-128-14: the differences of the two forms are the rows of payload-forms.tsv", () => {
  const rows = payloadFormRows();
  assert.ok(rows.length >= 9, `the table holds ${String(rows.length)} rows`);
  const subjects = rows.map((row) => row.subject);
  assert.ok(subjects.includes("loki label job"), "the job differs: ralph vs specstride");
  assert.ok(subjects.includes("span names"), "the span names differ: eight vs sixteen scopes");
  assert.ok(
    subjects.includes("events that project to nothing"),
    "not shipped as-is, shipped in the new form",
  );
  const job = rows.find((row) => row.subject === "loki label job")!;
  assert.equal(job.asIsForm, "ralph");
  assert.equal(job.newForm, "specstride");
});
