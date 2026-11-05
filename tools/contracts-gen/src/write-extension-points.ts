/**
 * The writers of the extension points (T291; the extension-point table at the
 * head of `specs/100-specstride/contracts/tools/generate.py` and the part of
 * `build()` that writes `extension-points/`; F100-FR-030).
 *
 * One file per point with its ids, its annex section, its operations, the
 * requirements that cite the point and the thirteen sub-sections word for word,
 * and `extension-points/index.json`.
 */
import { EP_SUBHEADS, type EpBody, type Requirement } from "./markdown.ts";
import { NOTE } from "./paths.ts";

/** One extension point: the number, the schema ids, the annex section, the file stem, the operations. */
export interface EpSpec {
  readonly ep: string;
  readonly ids: readonly string[];
  readonly annex: string;
  readonly section: string;
  readonly stem: string;
  readonly operations: readonly string[];
}

/** The nineteen extension points, in the order the Python script lists them. */
export const EPS: readonly EpSpec[] = (
  [
    [
      "EP-01",
      ["specstride.host/1"],
      "H",
      "§H.1",
      "host",
      ["describe", "renderSkill", "renderEntry", "renderStatusHooks", "evalDriver.run"],
    ],
    [
      "EP-02",
      ["specstride.harness/1"],
      "C",
      "§C.1",
      "harness",
      [
        "detect",
        "capabilities",
        "preflight",
        "startPass",
        "complete",
        "stop",
        "betweenPasses",
        "classify",
      ],
    ],
    [
      "EP-03",
      ["specstride.spec-format/1"],
      "C",
      "§C.7",
      "spec-format",
      ["detect", "parse", "validate", "tick", "inputs"],
    ],
    [
      "EP-04",
      ["specstride.loop-layer/1"],
      "D",
      "§D.1",
      "loop-layer",
      [
        "contributePrompt",
        "afterPass",
        "betweenPasses",
        "nextPassBlock",
        "onEvidence",
        "contributeCriticInput",
        "resume",
        "report",
      ],
    ],
    [
      "EP-05",
      ["specstride.check-runner/1"],
      "C",
      "§C.8",
      "check-runner",
      ["pin", "start", "poll", "result", "cancel", "environment"],
    ],
    ["EP-06", ["specstride.router-rules/1"], "D", "§D.4", "router-rules", ["route.decided"]],
    [
      "EP-07",
      ["specstride.verification-source/1"],
      "C",
      "§C.9",
      "verification-source",
      ["discover", "obligations", "conflicts"],
    ],
    [
      "EP-08",
      ["specstride.event-sink/1"],
      "C",
      "§C.10",
      "event-sink",
      ["open", "write", "flush", "close", "status"],
    ],
    ["EP-09", ["specstride.view/1"], "G", "§G.6", "view", ["project", "reduce"]],
    [
      "EP-10",
      ["specstride.secret-resolver/1"],
      "C",
      "§C.11",
      "secret-resolver",
      ["handles", "exists", "resolve", "boundHost"],
    ],
    ["EP-11", ["specstride.terms/1"], "C", "§C.12", "terms", ["evaluate"]],
    [
      "EP-12",
      ["specstride.quota-classifier/1"],
      "C",
      "§C.13",
      "quota-classifier",
      ["classify", "observe"],
    ],
    [
      "EP-13",
      ["specstride.lock/1"],
      "F",
      "§F.5",
      "lock",
      ["acquire", "heartbeat", "release", "probe", "reclaim", "handDown", "verify"],
    ],
    ["EP-14", ["specstride.doctor/1"], "G", "§G.7", "doctor", ["run"]],
    ["EP-15", ["specstride.prompt-block/1"], "D", "§D.5", "prompt-block", ["blocks"]],
    ["EP-16", ["specstride.toolchain/1"], "C", "§C.14", "toolchain", []],
    ["EP-17", ["specstride.detach/1"], "F", "§F.6", "detach", ["available", "start", "describe"]],
    [
      "EP-18",
      ["specstride.critic-strategy/1", "specstride.attempt-planner/1"],
      "E",
      "§E.1",
      "critic-strategy-and-attempt-planner",
      ["judge", "next"],
    ],
    [
      "EP-19",
      ["specstride.stage-kind/1"],
      "F",
      "§F.7",
      "stage-kind",
      ["validate", "run", "evaluate"],
    ],
  ] as const
).map(([ep, ids, annex, section, stem, operations]) =>
  Object.freeze({ ep, ids, annex, section, stem, operations }),
);

/**
 * One file per point and `extension-points/index.json`.
 *
 * A point whose section lacks one of the thirteen sub-headings, or whose
 * operations are not named in the section, is a fault of the annex: the
 * generator stops and names it.
 */
export function writeExtensionPoints(
  out: Map<string, unknown>,
  eps: Record<string, EpBody>,
  reqs: readonly Requirement[],
): void {
  const index: unknown[] = [];
  for (const spec of EPS) {
    const body = eps[spec.section];
    const absent = EP_SUBHEADS.filter(
      (h) => body === undefined || !Object.prototype.hasOwnProperty.call(body, h),
    );
    if (body === undefined || absent.length > 0) {
      throw new Error(`extension point ${spec.ep} lacks a sub-heading in ${spec.section}`);
    }
    const flat = JSON.stringify(body);
    for (const op of spec.operations) {
      if (!flat.includes("`" + op + "`") && !flat.includes(op)) {
        throw new Error(`${spec.ep}: operation ${op} is not in ${spec.section}`);
      }
    }
    const own = reqs
      .filter((r) => String(r["ep"] ?? "").startsWith(spec.ep + " "))
      .map((r) => String(r["id"]));
    const sections: Record<string, unknown> = {};
    for (const h of EP_SUBHEADS) sections[h] = body[h];
    const file = `extension-points/${spec.ep}.${spec.stem}.json`;
    out.set(file, {
      note: NOTE,
      ep: spec.ep,
      ids: spec.ids,
      annex: `annex ${spec.annex}, ${spec.section}`,
      operations: spec.operations,
      requirements: own,
      sections,
    });
    index.push({
      ep: spec.ep,
      ids: spec.ids,
      annex: spec.annex,
      section: spec.section,
      file,
      operations: spec.operations,
    });
  }
  out.set("extension-points/index.json", { note: NOTE, extensionPoints: index });
}
