/**
 * T010 — the two forms of a payload (F128-FR-009).
 *
 * F128-FR-009: *The payloads MUST have two forms. In the **as-is form** the
 * event names, the field names, the labels, the resource names and the times
 * are those of the Specstride baseline. In the **new form** they are the types
 * of the event catalogue, the fields of the event envelope and the names
 * `specstride.*`. The as-is form MUST be used when `compat.legacyEvents` is
 * on, which is the case under the `parity` profile, and the new form
 * otherwise. In the as-is form an event whose row of the compatibility
 * projection projects to nothing MUST NOT be shipped to any sink, MUST NOT
 * open or close a span and MUST NOT feed a metric of the old names. The as-is
 * names of the events MUST be read from the table of the compatibility
 * projection. Three as-is names were used by the shippers of the baseline
 * only ... the exporter MUST hold them itself, each for one type of the
 * catalogue: `api_request` is the as-is name of the usage fact ... made from
 * `stream.result`; `tool_use` is the as-is name of the tool call fact ... made
 * from `tool.call`; `gate` is the as-is name under which a verdict,
 * `verdict.recorded`, feeds the metric of the old name. No caller of the
 * baseline ships an event named `gate`, so a run MUST ship no log record and
 * no Loki line of that name; the verdict is shipped under the name that the
 * table gives (`verdict`).*
 *
 * The differences of the two forms are the rows of
 * `packages/observability/data/export/payload-forms.tsv` (the copy of the
 * contract file `payload-forms.tsv` of `specs/128-telemetry-export/contracts/`),
 * which this module reads; the names are the table of the compatibility
 * projection, which the context of `open` hands the sink
 * (`SinkContext.compatibilityProjection`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The switch the form of a payload follows (F100-FR-105; F128-FR-009). */
export const PAYLOAD_FORM_SWITCH = "compat.legacyEvents" as const;

/** The two forms of a payload. */
export const PAYLOAD_FORMS = ["as-is", "new"] as const;
export type PayloadForm = (typeof PAYLOAD_FORMS)[number];

/**
 * The three as-is names the shippers of the baseline used and the table of
 * the compatibility projection has no row for. The exporter holds them
 * itself, each for one type of the catalogue (F128-FR-009).
 */
export const THE_EXPORTERS_OWN_NAMES = Object.freeze({
  /** The usage fact of F128-FR-006, one per result record of a stream. */
  api_request: "stream.result",
  /** The tool call fact of F128-FR-006, one per tool call. */
  tool_use: "tool.call",
  /** The name under which a verdict feeds the metric of the old name only. */
  gate: "verdict.recorded",
} as const);

/** The catalogue types behind the three exporter-own names. */
export const THE_EXPORTERS_OWN_TYPES: readonly string[] = Object.freeze(
  Object.values(THE_EXPORTERS_OWN_NAMES),
);

/** The name under which a verdict feeds the old metric, and ships never. */
export const THE_NAME_NO_RUN_SHIPS = "gate" as const;

/** The read access to the table of the compatibility projection (annex C §C.10). */
export type CompatibilityProjectionReader = {
  readonly asIsNameOf: (eventType: string) => string | null;
};

/**
 * The form in force: as-is when `compat.legacyEvents` is on (which it is
 * under the `parity` profile), new otherwise.
 */
export function payloadFormOf(
  switches: Readonly<Record<string, unknown>>,
  profile?: string,
): PayloadForm {
  if (switches[PAYLOAD_FORM_SWITCH] === true) return "as-is";
  if (profile === "parity") return "as-is";
  return "new";
}

/**
 * The as-is name an event SHIPS under in the as-is form: the name of the row
 * of the compatibility projection, read from the table the context of `open`
 * gives. `null` where the type projects to nothing — such an event is not
 * shipped at all. The exporter-own names are never the answer: `gate` ships
 * under the name the table gives (`verdict`), and the metric names
 * `api_request`/`tool_use` ride the metric, not the shipped line.
 */
export function shippedAsIsNameOf(
  eventType: string,
  projection: CompatibilityProjectionReader,
): string | null {
  return projection.asIsNameOf(eventType);
}

/**
 * Whether an event is shipped at all in the as-is form: only when its row of
 * the compatibility projection projects to something. A type that projects to
 * nothing is not shipped, opens no span and feeds no old metric.
 */
export function shipsInAsIsForm(
  eventType: string,
  projection: CompatibilityProjectionReader,
): boolean {
  return projection.asIsNameOf(eventType) !== null;
}

/**
 * The exporter-own as-is name of a type, when it has one: the name under
 * which the event feeds a metric of the old vocabulary. `verdict.recorded`
 * answers `gate` — the metric name only; the verdict still ships as
 * `verdict`. Every other type answers `null`.
 */
export function exporterOwnAsIsNameOf(eventType: string): string | null {
  for (const [name, type] of Object.entries(THE_EXPORTERS_OWN_NAMES)) {
    if (type === eventType) return name;
  }
  return null;
}

/**
 * Whether an event feeds a metric of the old names in the as-is form: the
 * three exporter-own types do, and only when their row projects to something
 * (the verdict always does). A type that projects to nothing feeds nothing.
 */
export function feedsAnOldMetric(
  eventType: string,
  projection: CompatibilityProjectionReader,
): boolean {
  return exporterOwnAsIsNameOf(eventType) !== null && shipsInAsIsForm(eventType, projection);
}

/** The shipped name of an event in the form in force. */
export function shippedNameOf(
  eventType: string,
  form: PayloadForm,
  projection: CompatibilityProjectionReader,
): string | null {
  if (form === "new") return eventType;
  return shippedAsIsNameOf(eventType, projection);
}

/* ------------------------------------------------------------------ *
 * The table of the differences: data/payload-forms.tsv.
 * ------------------------------------------------------------------ */

/** One row of `payload-forms.tsv`: what differs between the two forms. */
export type PayloadFormRow = {
  readonly subject: string;
  readonly asIsForm: string;
  readonly newForm: string;
};

/** The file the exporter reads, relative to this module (the package root). */
export const PAYLOAD_FORMS_TSV = join(
  dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))),
  "data/export/payload-forms.tsv",
);

/** Parse the TSV (three columns, tab-separated, `#` comments). */
export function parsePayloadFormsTsv(text: string): readonly PayloadFormRow[] {
  const rows: PayloadFormRow[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trimEnd();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const [subject, asIs, neu] = trimmed.split("\t");
    if (!subject || subject === "subject") continue;
    rows.push(
      Object.freeze({
        subject,
        asIsForm: asIs ?? "",
        newForm: neu ?? "",
      }),
    );
  }
  return Object.freeze(rows);
}

/** The rows of the table the exporter reads (the copy of the contract file). */
export function payloadFormRows(): readonly PayloadFormRow[] {
  return parsePayloadFormsTsv(readFileSync(PAYLOAD_FORMS_TSV, "utf8"));
}

/** The two label sets the table states, as data the sinks read. */
export const LABELS_OF_THE_FORMS = Object.freeze({
  /** As-is: the baseline's base set plus `model` on the two stream events. */
  "as-is": Object.freeze({
    job: "ralph",
    base: Object.freeze(["task", "backend", "event"]),
    model: Object.freeze(["api_request", "tool_use"]),
    streamTapRole: true,
  }),
  /** New: the specstride base set. */
  new: Object.freeze({
    job: "specstride",
    base: Object.freeze(["feature", "harness", "event", "role"]),
    model: Object.freeze(["usage", "tool"]),
    streamTapRole: false,
  }),
} as const);
