/**
 * T035 (feature 112) — the checks of the groups `ui`, `telemetry`, `events`
 * and `memory` (F112-FR-020, CT-112-120; catalogue rows 41 to 44).
 *
 * `ui.endpoint` reports "not running" while no viewer exists and fails if a
 * listener that the product opened is bound outside the loopback address, and
 * warns for a recorded dead process. `telemetry.endpoint` shows the collector
 * and whether content capture is on, warns when content capture is on, and is
 * never `fail`. `events.schema` warns when a reader or a record of the control
 * plane meets a major outside its range. `memory.native` warns when
 * harness-native memory is on for the critic and informs for the proposer.
 */
import type { Check, ProbeBag } from "../registry/types.ts";
import { cfg } from "./read.ts";

/** `ui.endpoint` — the viewer endpoint (row 41). */
export const uiEndpointCheck: Check = {
  id: "ui.endpoint",
  group: "ui",
  lb: false,
  order: 41,
  messageTemplate: "ui {state}",
  fixHint: "none",
  severityRule: (o: unknown) => {
    const s = o as { outsideLoopback: boolean; deadProcess: boolean };
    if (s.outsideLoopback) return "fail";
    if (s.deadProcess) return "warn";
    return "info";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const ui = cfg<{ running: boolean; outsideLoopback: boolean; deadProcess: boolean }>(
      b,
      "ui.endpoint",
      { running: false, outsideLoopback: false, deadProcess: false },
    );
    return {
      running: ui.running,
      outsideLoopback: ui.outsideLoopback,
      deadProcess: ui.deadProcess,
      // "not running" while no viewer exists — the state until one is built.
      state: ui.outsideLoopback
        ? "bound outside the loopback address"
        : ui.deadProcess
          ? "a recorded process is dead"
          : ui.running
            ? "running"
            : "not running",
    };
  },
};

/** `telemetry.endpoint` — the collector and content capture (row 42). */
export const telemetryEndpointCheck: Check = {
  id: "telemetry.endpoint",
  group: "telemetry",
  lb: false,
  order: 42,
  messageTemplate: "collector {collector}; content capture {captureText}",
  fixHint: "switch content capture off",
  severityRule: (o: unknown) => ((o as { capture: boolean }).capture ? "warn" : "info"),
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const t = cfg<{ collector: string; capture: boolean }>(b, "telemetry.endpoint", {
      collector: "unreachable",
      capture: false,
    });
    return {
      collector: t.collector,
      capture: t.capture,
      captureText: t.capture ? "on" : "off",
    };
  },
};

/** `events.schema` — a major outside the reader's range (row 43). */
export const eventsSchemaCheck: Check = {
  id: "events.schema",
  group: "events",
  lb: false,
  order: 43,
  messageTemplate: "reader accepts event v{readerMajor}, run wrote v{recordMajor}",
  fixHint: "upgrade",
  severityRule: (o: unknown) => {
    const s = o as { outsideRange: boolean };
    return s.outsideRange ? "warn" : "info";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const e = cfg<{ readerRange: { from: number; to: number }; recordMajor: number }>(
      b,
      "events.schema",
      { readerRange: { from: 1, to: 1 }, recordMajor: 1 },
    );
    const outsideRange = e.recordMajor < e.readerRange.from || e.recordMajor > e.readerRange.to;
    return {
      readerMajor: e.readerRange.to,
      recordMajor: e.recordMajor,
      outsideRange,
    };
  },
};

/** `memory.native` — harness-native memory per role (row 44). */
export const memoryNativeCheck: Check = {
  id: "memory.native",
  group: "memory",
  lb: false,
  order: 44,
  messageTemplate: "{role}: native memory {state}",
  fixHint: "switch it off",
  severityRule: (o: unknown) => {
    const s = o as { on: boolean; role: string };
    if (!s.on) return "info";
    return s.role === "critic" ? "warn" : "info";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const m = cfg<{ role: string; on: boolean }>(b, "memory.native", {
      role: "proposer",
      on: false,
    });
    return { role: m.role, on: m.on, state: m.on ? "on" : "off" };
  },
};

/** The four checks of these groups, in catalogue order. */
export const miscChecks: readonly Check[] = Object.freeze([
  uiEndpointCheck,
  telemetryEndpointCheck,
  eventsSchemaCheck,
  memoryNativeCheck,
]);
