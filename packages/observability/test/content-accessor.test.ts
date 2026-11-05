/**
 * T045 — CT-111-132: content follows traces, the switch off, the references in
 * the primary file, and the accessor that returns nothing when the redactor
 * cannot run (F111-FR-032).
 *
 * F111-FR-032: *Prompt and reply content for telemetry MUST be captured whenever
 * traces are on, and the consumer MUST be able to switch it off. The primary
 * event file MUST still hold references and no content. Content MUST reach a sink
 * only through the content accessor that the core gives the sink at `open`, which
 * reads by reference, redacts, and returns nothing when the redactor cannot run;
 * a text that the point cannot treat MUST NOT be delivered and its reference MUST
 * be delivered in its place. The compatibility projection MUST get the sanitised
 * snippets that the old vocabulary shows ... through the same accessor, only for
 * its own files.*
 *
 * "The primary event file holds references and no content" is read back FROM THE
 * BYTES of a real event file written by the primary writer, not from the value
 * the writer returned: the test writes `pass.ended` and `tool.call` with their
 * references, then greps the file for the content behind those references.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretRegistry, createRedactor, type SpecstrideRedactor } from "@specstride/kernel";
import { PrimaryWriter } from "../src/writer/writer.ts";
import { Ingress } from "../src/ingress/ingress.ts";
import {
  CONTENT_FOLLOWS_TRACES,
  PRIMARY_FILE_HOLDS_REFERENCES_AND_NO_CONTENT,
  captureIsOn,
  createContentAccessor,
} from "../src/accessor/accessor.ts";

const PROMPT = Object.freeze({
  logicalName: "pass:p1:prompt",
  hash: "a".repeat(64),
  size: 64,
});
const REPLY = Object.freeze({ logicalName: "pass:p1:reply", hash: "b".repeat(64), size: 48 });

const CONTENT: Readonly<Record<string, string>> = Object.freeze({
  "pass:p1:prompt": "do the work with api_key=sekritvalue please",
  "pass:p1:reply": "done, token: ghp_abcd1234efgh",
});

function store(): (reference: { logicalName: string }) => string | undefined {
  return (reference) => CONTENT[reference.logicalName];
}

function workdir(): string {
  return mkdtempSync(join(tmpdir(), "ct-111-132-"));
}

/** A redactor that cannot run: every call throws. */
const brokenRedactor: SpecstrideRedactor = Object.freeze({
  patternSetVersion: "",
  unavailable: undefined,
  registry: new SecretRegistry(),
  values: Object.freeze([]),
  register(): void {
    throw new Error("the redactor cannot run");
  },
  redact(): never {
    throw new Error("the redactor cannot run");
  },
  redactValue(): never {
    throw new Error("the redactor cannot run");
  },
});

function accessorWith(options: {
  tracesAreOn: boolean;
  contentCapture?: boolean | undefined;
  redactor?: SpecstrideRedactor;
}) {
  return createContentAccessor({
    tracesAreOn: options.tracesAreOn,
    contentCapture: options.contentCapture,
    read: store(),
    ingress: new Ingress({ redactor: options.redactor ?? createRedactor() }),
  });
}

/* ------------------------------------------------------------------ *
 * Content follows traces.
 * ------------------------------------------------------------------ */

test("CT-111-132: content is captured whenever traces are on (ruling 43)", async () => {
  assert.equal(CONTENT_FOLLOWS_TRACES, true);
  assert.equal(captureIsOn({ tracesAreOn: true }), true);
  const accessor = accessorWith({ tracesAreOn: true });
  const text = await accessor.byReference(PROMPT);
  assert.equal(typeof text, "string");
  assert.ok((text as string).includes("do the work"), text);
});

test("CT-111-132: with traces OFF nothing is captured, whatever the switch says", async () => {
  assert.equal(captureIsOn({ tracesAreOn: false }), false);
  assert.equal(captureIsOn({ tracesAreOn: false, contentCapture: true }), false);
  const accessor = accessorWith({ tracesAreOn: false, contentCapture: true });
  assert.equal(await accessor.byReference(PROMPT), undefined);
  assert.equal(accessor.captureIsOn, false);
});

test("CT-111-132: THE CONSUMER CAN SWITCH IT OFF while traces stay on", async () => {
  assert.equal(captureIsOn({ tracesAreOn: true, contentCapture: false }), false);
  const accessor = accessorWith({ tracesAreOn: true, contentCapture: false });
  assert.equal(accessor.captureIsOn, false);
  assert.equal(await accessor.byReference(PROMPT), undefined);
  // The reference is delivered in its place.
  assert.deepEqual(accessor.referenceInstead(PROMPT), PROMPT);
});

test("CT-111-132: what the accessor returns is REDACTED, never the raw content", async () => {
  const accessor = accessorWith({ tracesAreOn: true });
  const prompt = (await accessor.byReference(PROMPT)) as string;
  const reply = (await accessor.byReference(REPLY)) as string;
  assert.ok(!prompt.includes("sekritvalue"), prompt);
  assert.ok(prompt.includes("[REDACTED]"), prompt);
  assert.ok(!reply.includes("ghp_abcd1234efgh"), reply);
  assert.ok(reply.includes("[REDACTED]"), reply);
});

test("CT-111-132: a reference the store does not know gives nothing", async () => {
  const accessor = accessorWith({ tracesAreOn: true });
  assert.equal(
    await accessor.byReference({ logicalName: "pass:p9:prompt", hash: "c".repeat(64), size: 1 }),
    undefined,
  );
});

/* ------------------------------------------------------------------ *
 * The accessor returns NOTHING when the redactor cannot run.
 * ------------------------------------------------------------------ */

test("CT-111-132: the accessor returns NOTHING when the redactor cannot run", async () => {
  const accessor = accessorWith({ tracesAreOn: true, redactor: brokenRedactor });
  assert.equal(accessor.captureIsOn, true, "capture is on: the failure is the redactor's");
  assert.equal(await accessor.byReference(PROMPT), undefined);
  assert.equal(await accessor.byReference(REPLY), undefined);
  // The reference is delivered in its place, and the drop is on record.
  assert.deepEqual(accessor.referenceInstead(PROMPT), PROMPT);
  const dropped = accessor.drops();
  assert.equal(dropped.length, 2);
  assert.equal(dropped[0]?.mark, "redactor-unavailable");
  assert.ok(!JSON.stringify(dropped).includes("sekritvalue"), JSON.stringify(dropped));
});

test("CT-111-132: an invalid pattern set is the same case, with its own mark", async () => {
  const accessor = createContentAccessor({
    tracesAreOn: true,
    read: store(),
    ingress: new Ingress({
      redactor: createRedactor({ patternSet: { schema: "specstride.redaction/1" } }),
    }),
  });
  assert.equal(await accessor.byReference(PROMPT), undefined);
  assert.equal(accessor.drops()[0]?.mark, "pattern-set-invalid");
});

/* ------------------------------------------------------------------ *
 * The compatibility projection's own snippets.
 * ------------------------------------------------------------------ */

test("CT-111-132: the projection gets sanitised snippets through the SAME accessor", async () => {
  const accessor = accessorWith({ tracesAreOn: true, contentCapture: false });
  // Capture is off, so a sink gets nothing; the projection still gets its
  // snippet, sanitised, for its own files (CQ-032, closed by the owner).
  assert.equal(await accessor.byReference(PROMPT), undefined);
  const snippet = await accessor.asIsSnippetForTheCompatibilityProjection(PROMPT);
  assert.equal(typeof snippet, "string");
  assert.ok(!(snippet as string).includes("sekritvalue"), snippet);
  assert.ok((snippet as string).includes("[REDACTED]"), snippet);
});

test("CT-111-132: the projection's snippet is nothing when the redactor cannot run", async () => {
  const accessor = accessorWith({ tracesAreOn: true, redactor: brokenRedactor });
  assert.equal(await accessor.asIsSnippetForTheCompatibilityProjection(PROMPT), undefined);
});

/* ------------------------------------------------------------------ *
 * The primary event file holds references and NO content.
 * ------------------------------------------------------------------ */

test("CT-111-132: the primary event file holds references and no content", () => {
  assert.equal(PRIMARY_FILE_HOLDS_REFERENCES_AND_NO_CONTENT, true);
  const dir = workdir();
  try {
    const file = join(dir, "events.jsonl");
    const writer = PrimaryWriter.open({ file, runId: "r1", launchId: "l1", holder: "t" });
    try {
      writer.append({
        type: "pass.ended",
        data: { endCause: "completed", transcriptRef: { ...PROMPT } },
      });
      writer.append({
        type: "tool.call",
        data: {
          category: "read",
          argsRef: { ...PROMPT },
          resultRef: { ...REPLY },
          redacted: true,
          truncated: false,
          originalBytes: 42,
          retainedBytes: 10,
        },
      });
    } finally {
      writer.close();
    }
    // Read back the BYTES, and look for the content behind the references.
    const bytes = readFileSync(file, "utf8");
    for (const content of Object.values(CONTENT)) {
      assert.ok(!bytes.includes(content), `the file holds the content: ${content}`);
    }
    assert.ok(!bytes.includes("sekritvalue"), bytes);
    assert.ok(!bytes.includes("ghp_abcd1234efgh"), bytes);
    // The references ARE there: the logical name, the hash and the size.
    assert.ok(bytes.includes(PROMPT.logicalName), bytes);
    assert.ok(bytes.includes(PROMPT.hash), bytes);
    assert.ok(bytes.includes(String(PROMPT.size)), bytes);
    assert.ok(bytes.includes(REPLY.logicalName), bytes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-111-132: content reaches a sink ONLY through the accessor", async () => {
  // A sink that is handed the event and the accessor can reach content only by
  // asking the accessor: the event itself carries none.
  const dir = workdir();
  try {
    const file = join(dir, "events.jsonl");
    const writer = PrimaryWriter.open({ file, runId: "r1", launchId: "l1", holder: "t" });
    const seen: string[] = [];
    writer.addSink({
      id: "spy",
      receive(_event, line) {
        seen.push(line);
      },
    });
    try {
      writer.append({
        type: "prompt.built",
        data: { promptRef: { ...PROMPT }, blocks: [], totalTokensEst: 42 },
      });
    } finally {
      writer.close();
    }
    assert.equal(seen.length, 1);
    assert.ok(!(seen[0] as string).includes("sekritvalue"), seen[0]);
    // The accessor is the one way, and with capture off there is no way at all.
    const off = accessorWith({ tracesAreOn: true, contentCapture: false });
    assert.equal(await off.byReference(PROMPT), undefined);
    const on = accessorWith({ tracesAreOn: true });
    assert.ok(((await on.byReference(PROMPT)) as string).includes("[REDACTED]"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
