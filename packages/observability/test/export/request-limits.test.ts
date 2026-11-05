/**
 * T011 — tests PT-128-C-174 and PT-128-C-182: the request limits, the
 * env aliases and the delivery (F128-FR-010, F128-FR-008, F128-FR-035).
 *
 * PT-128-C-174 pins the limits: a timeout of 2500 ms by default, a body bound
 * of 3145728 bytes for a signal that splits, a flush interval of 2000 ms
 * (0 = flush per event), a queue bound of 10000 events that drops the newest
 * with a record, and the six RALPH_* aliases read in decimal seconds.
 * PT-128-C-182 pins the delivery: a collector that is slow, throwing or dead
 * never changes the run (best-effort, F128-FR-035), and a full queue never
 * grows past its bound.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_FLUSH_INTERVAL_MS,
  DEFAULT_MAX_BATCH_BYTES,
  DEFAULT_TIMEOUT_MS,
  RALPH_ALIASES,
  RALPH_SECOND_ALIASES,
  UNSPLIT_SIGNALS,
  postJson,
  resolveMaxBatchBytes,
  resolveTimeoutMs,
  secondsToMs,
  signalIsSplit,
  splitBatch,
  type BatchPart,
  type SplitSignal,
} from "../../src/export/delivery/request.ts";
import {
  DEFAULT_QUEUE_MAX_EVENTS,
  QUEUE_OVERFLOW,
  FlushInterval,
  SinkBuffer,
} from "../../src/export/delivery/buffer.ts";

/* ------------------------------------------------------------------ *
 * PT-128-C-174 — the limits and their defaults.
 * ------------------------------------------------------------------ */

test("PT-128-C-174: the defaults are the requirement's numbers", () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 2500);
  assert.equal(DEFAULT_MAX_BATCH_BYTES, 3145728);
  assert.equal(DEFAULT_FLUSH_INTERVAL_MS, 2000);
  assert.equal(DEFAULT_QUEUE_MAX_EVENTS, 10000);
  assert.equal(resolveTimeoutMs(undefined), 2500);
  assert.equal(resolveMaxBatchBytes(undefined), 3145728);
});

test("PT-128-C-174: the six RALPH_* aliases are the names the env carries", () => {
  assert.deepEqual(Object.values(RALPH_ALIASES), [
    "RALPH_LOKI_URL",
    "RALPH_OTEL_URL",
    "RALPH_LOKI_TIMEOUT",
    "RALPH_OTEL_TIMEOUT",
    "RALPH_LOKI_MAX_BATCH_BYTES",
    "RALPH_OTEL_MAX_BATCH_BYTES",
  ]);
  assert.equal(Object.keys(RALPH_ALIASES).length, 6);
  // The two aliases the environment carried in decimal SECONDS.
  assert.deepEqual([...RALPH_SECOND_ALIASES], ["RALPH_LOKI_TIMEOUT", "RALPH_OTEL_TIMEOUT"]);
});

test("PT-128-C-174: RALPH_*_TIMEOUT is decimal SECONDS, resolved to milliseconds", () => {
  assert.equal(secondsToMs(2.5), 2500);
  assert.equal(secondsToMs(3), 3000);
  const env = { RALPH_LOKI_TIMEOUT: "2.5", RALPH_OTEL_TIMEOUT: "0.75" };
  assert.equal(resolveTimeoutMs(undefined, env, "RALPH_LOKI_TIMEOUT"), 2500);
  assert.equal(resolveTimeoutMs(undefined, env, "RALPH_OTEL_TIMEOUT"), 750);
  assert.equal(
    resolveTimeoutMs(undefined, {}, "RALPH_LOKI_TIMEOUT"),
    2500,
    "falls back to the default",
  );
  // A direct option wins over the env.
  assert.equal(resolveTimeoutMs(4000, env, "RALPH_LOKI_TIMEOUT"), 4000);
  // A value that is not a finite positive number falls back to the default.
  assert.equal(
    resolveTimeoutMs(undefined, { RALPH_LOKI_TIMEOUT: "junk" }, "RALPH_LOKI_TIMEOUT"),
    2500,
  );
  assert.equal(
    resolveTimeoutMs(undefined, { RALPH_LOKI_TIMEOUT: "-1" }, "RALPH_LOKI_TIMEOUT"),
    2500,
  );
  assert.equal(resolveTimeoutMs(undefined, { RALPH_LOKI_TIMEOUT: "" }, "RALPH_LOKI_TIMEOUT"), 2500);
});

test("PT-128-C-174: RALPH_*_MAX_BATCH_BYTES resolves through the alias", () => {
  const env = { RALPH_OTEL_MAX_BATCH_BYTES: "1024" };
  assert.equal(resolveMaxBatchBytes(undefined, env, "RALPH_OTEL_MAX_BATCH_BYTES"), 1024);
  assert.equal(resolveMaxBatchBytes(undefined, {}, "RALPH_OTEL_MAX_BATCH_BYTES"), 3145728);
  assert.equal(resolveMaxBatchBytes(2048, env, "RALPH_OTEL_MAX_BATCH_BYTES"), 2048);
  assert.equal(
    resolveMaxBatchBytes(
      undefined,
      { RALPH_OTEL_MAX_BATCH_BYTES: "junk" },
      "RALPH_OTEL_MAX_BATCH_BYTES",
    ),
    3145728,
  );
});

test("PT-128-C-174: metrics and traces requests are unsplit; logs and loki split", () => {
  assert.deepEqual([...UNSPLIT_SIGNALS], ["metrics", "traces"]);
  assert.equal(signalIsSplit("metrics" as SplitSignal), false);
  assert.equal(signalIsSplit("traces" as SplitSignal), false);
  assert.equal(signalIsSplit("logs"), true);
  assert.equal(signalIsSplit("loki"), true);
});

test("PT-128-C-174: splitBatch keeps the order and never exceeds the bound", () => {
  const items = ["a".repeat(600), "b".repeat(600), "c".repeat(100), "d".repeat(700)];
  const parts: readonly BatchPart<string>[] = splitBatch(items, 1024, (s) => s.length);
  assert.deepEqual(
    parts.map((p) => [...p.items]),
    [["a".repeat(600)], ["b".repeat(600), "c".repeat(100)], ["d".repeat(700)]],
  );
  for (const part of parts) {
    const bytes = part.items.reduce((n, s) => n + s.length, 0);
    assert.ok(bytes <= 1024, `part holds ${String(bytes)} bytes over the bound`);
  }
  // Order preserved across the parts.
  const flat = parts.flatMap((p) => p.items);
  assert.deepEqual(flat, items);
  // A single item larger than the bound still ships, alone in its part.
  const huge = splitBatch(["x".repeat(5000)], 1024, (s) => s.length);
  assert.equal(huge.length, 1);
  assert.equal(huge[0]!.items.length, 1);
});

test("PT-128-C-174: the flush interval — due at 2000 ms, or per event at 0", () => {
  let now = 0;
  const interval = new FlushInterval(2000);
  assert.equal(interval.due(now++, 1), false, "nothing due right after a flush");
  now = 1999;
  assert.equal(interval.due(now, 1), false);
  assert.equal(interval.due(2000, 1), true, "due at 2000 ms");
  interval.flushed(2000);
  assert.equal(interval.due(2100, 1), false);
  assert.equal(interval.due(4000, 1), false, "the interval restarts at the flush");
  assert.equal(interval.due(4100, 1), true, "2100 + 2000");
  // 0 means flush per event: due as soon as anything is buffered.
  const perEvent = new FlushInterval(0);
  assert.equal(perEvent.due(0, 0), false, "nothing buffered, nothing due");
  assert.equal(perEvent.due(0, 1), true);
  assert.equal(perEvent.due(5, 1), true);
});

test("PT-128-C-174: a full queue drops the NEWEST with a DropRecord", () => {
  const buffer = new SinkBuffer<string>(3);
  for (const [i, item] of ["e1", "e2", "e3"].entries())
    assert.equal(buffer.push(item, i + 1).buffered, true);
  assert.equal(buffer.push("e4", 4).buffered, false);
  assert.equal(buffer.push("e5", 5).buffered, false);
  assert.deepEqual([...buffer.take()], ["e1", "e2", "e3"], "the oldest three are kept");
  const drops = buffer.takeDrops();
  assert.deepEqual(
    drops.map((d) => d.seq),
    [4, 5],
    "the NEWEST are the ones dropped",
  );
  assert.deepEqual(
    drops.map((d) => d.reason),
    [QUEUE_OVERFLOW, QUEUE_OVERFLOW],
  );
  assert.equal(buffer.takeDrops().length, 0, "the drop records are taken once");
});

/* ------------------------------------------------------------------ *
 * PT-128-C-182 — the delivery: best-effort, never changes the run.
 * ------------------------------------------------------------------ */

test("PT-128-C-182: postJson is best-effort — a slow, throwing or dead collector never throws", async () => {
  const warn = () => {};
  // A collector that answers accepted.
  const ok = await postJson(
    "http://127.0.0.1:1/x",
    "{}",
    100,
    (async () => ({
      status: 202,
    })) as unknown as typeof fetch,
    warn,
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.status, 202);
  // A collector that refuses.
  const refused = await postJson(
    "http://127.0.0.1:1/x",
    "{}",
    100,
    (async () => ({
      status: 500,
    })) as unknown as typeof fetch,
    warn,
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 500);
  // A fetch that throws.
  const thrown = await postJson(
    "http://127.0.0.1:1/x",
    "{}",
    100,
    (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch,
    warn,
  );
  assert.equal(thrown.ok, false);
  assert.match(String(thrown.error), /ECONNREFUSED/);
  // A collector that never answers: the timeout resolves, never hangs.
  const started = Date.now();
  const timedOut = await postJson(
    "http://127.0.0.1:1/x",
    "{}",
    80,
    ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch,
    warn,
  );
  assert.equal(timedOut.ok, false);
  assert.ok(Date.now() - started < 2500, "the timeout bounded the wait");
  // Only 200, 202 and 204 are accepted.
  for (const status of [200, 202, 204]) {
    assert.equal(
      (
        await postJson(
          "http://x",
          "{}",
          10,
          (async () => ({ status })) as unknown as typeof fetch,
          warn,
        )
      ).ok,
      true,
    );
  }
  assert.equal(
    (
      await postJson(
        "http://x",
        "{}",
        10,
        (async () => ({ status: 201 })) as unknown as typeof fetch,
        warn,
      )
    ).ok,
    false,
  );
});

test("PT-128-C-182: the queue bound holds under flood — the run is never stopped", () => {
  const buffer = new SinkBuffer<number>(DEFAULT_QUEUE_MAX_EVENTS);
  let overflows = 0;
  for (let i = 0; i < DEFAULT_QUEUE_MAX_EVENTS + 500; i += 1) {
    if (buffer.push(i).buffered === false) overflows += 1;
  }
  assert.equal(overflows, 500);
  assert.equal(buffer.size, DEFAULT_QUEUE_MAX_EVENTS);
});
