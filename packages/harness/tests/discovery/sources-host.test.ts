/**
 * T012 — characterization test CT-146-5 of the source `host`
 * (F146-FR-005): names and types only; an entry of the source `host` is
 * marked informational.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readHostSource } from "../../src/discovery/sources/host.ts";
import type { HostEntryReader } from "../../src/discovery/ports.ts";

test("CT-146-5: names and types only; an entry of the source `host` is informational", async () => {
  // The port answers entries that carry values besides the name and the
  // type: the environment of the entry, a header, an argument. The reader
  // must keep the name and the type, and nothing else.
  const hostEntries: HostEntryReader = () => [
    {
      name: "host-agent",
      type: "agent",
      env: { HOST_AGENT_TOKEN: "value-that-must-not-travel" },
      headers: { authorization: "Bearer value-that-must-not-travel" },
      args: ["--tool-secret=value-that-must-not-travel"],
    },
    { name: "tool-server", type: "tool-server" },
  ];
  const result = await readHostSource({ hostEntries });
  assert.equal(result.candidates.length, 2);
  const agent = result.candidates.find((candidate) => candidate.id === "host:host-agent");
  assert.ok(agent !== undefined);
  // Names and types only.
  assert.equal(agent.kind, "agent");
  assert.deepEqual(agent.sources, ["host"]);
  // Informational: never a candidate for a role (F146-FR-005).
  assert.equal(agent.informational, true);
  // And no value of the environment, of a header or of an argument
  // travelled into the candidate, nor into anything the reader answered.
  const recorded = JSON.stringify(result);
  assert.equal(recorded.includes("value-that-must-not-travel"), false);
  assert.equal(recorded.includes("env"), false);
  assert.equal(recorded.includes("headers"), false);
  assert.equal(recorded.includes("args"), false);
  // An entry that names no type is dropped: the reader reads names and
  // types only, and a name alone is not enough.
  const partial: HostEntryReader = () => [{ name: "half" } as never];
  const dropped = await readHostSource({ hostEntries: partial });
  assert.equal(dropped.candidates.length, 0);
});
