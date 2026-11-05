/**
 * T064 — CT-109-38, the proof of the first form (`tool-less`) of a
 * critic-class call (F109-FR-038).
 *
 * The proof is the empty tool list and the minted session id of the initial
 * record; a tool or another session refuses the call; the proof by pinned
 * configuration is recorded as the weaker proof for every call that rests on
 * it and is refused for a harness that is not tested; and the reply of a
 * refused call is not read.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fixFormBeforeCall } from "../../src/proof/forms.ts";
import {
  INITIAL_RECORD_PROOF,
  PINNED_CONFIGURATION_PROOF,
  mintSessionId,
  proveFirstForm,
  readAcceptedReply,
} from "../../src/proof/first-form.ts";

const FIRST = fixFormBeforeCall("tool-less") as Exclude<
  ReturnType<typeof fixFormBeforeCall>,
  { accepted: false }
>;

test("CT-109-38: proven by an empty tool list and the minted session id", () => {
  const sessionId = mintSessionId();
  assert.match(sessionId, /^sess-[0-9a-f]{32}$/);
  // Every call mints its own session id.
  assert.notEqual(sessionId, mintSessionId());
  const proof = proveFirstForm({
    fixed: FIRST,
    mintedSessionId: sessionId,
    initialRecord: { tools: [], sessionId },
    tested: false,
  });
  assert.equal(proof.accepted, true);
  if (proof.accepted) {
    assert.equal(proof.proofKind, INITIAL_RECORD_PROOF);
    assert.equal(proof.weakerProof, false);
    assert.equal(proof.sessionProofCase, "caller-minted-id");
    assert.equal(proof.sessionId, sessionId);
  }
});

test("CT-109-38: refused when the initial record shows a tool", () => {
  const proof = proveFirstForm({
    fixed: FIRST,
    mintedSessionId: "sess-a",
    initialRecord: { tools: ["shell"], sessionId: "sess-a" },
    tested: true,
  });
  assert.equal(proof.accepted, false);
  if (!proof.accepted) {
    assert.equal(proof.failure, "critic_not_toolless");
    assert.match(proof.reason, /tool/);
    assert.equal(proof.replyRead, false);
  }
});

test("CT-109-38: refused when the initial record shows another session", () => {
  const proof = proveFirstForm({
    fixed: FIRST,
    mintedSessionId: "sess-minted",
    initialRecord: { tools: [], sessionId: "sess-other" },
    tested: true,
  });
  assert.equal(proof.accepted, false);
  if (!proof.accepted) {
    assert.equal(proof.failure, "critic_not_toolless");
    assert.match(proof.reason, /another session id/);
  }
});

test("CT-109-38: the proof by pinned configuration is the weaker proof, recorded per call", () => {
  const pinned = {
    pin: "1.2.3",
    installedVersion: "1.2.3",
    preflightPassed: true,
    flagSet: ["--no-tools", "--no-session"],
  };
  const proof = proveFirstForm({
    fixed: FIRST,
    mintedSessionId: "sess-minted",
    initialRecord: null,
    tested: true,
    pinned,
  });
  assert.equal(proof.accepted, true);
  if (proof.accepted) {
    assert.equal(proof.proofKind, PINNED_CONFIGURATION_PROOF);
    assert.equal(proof.weakerProof, true);
    assert.equal(proof.sessionProofCase, "no-session-in-the-initial-record");
  }
  // Each of the three facts refuses the weaker proof when it fails.
  const facts = [
    { ...pinned, installedVersion: "9.9.9" },
    { ...pinned, preflightPassed: false },
    { ...pinned, flagSet: [] },
  ];
  for (const broken of facts) {
    const refused = proveFirstForm({
      fixed: FIRST,
      mintedSessionId: "sess-minted",
      initialRecord: null,
      tested: true,
      pinned: broken,
    });
    assert.equal(refused.accepted, false);
    if (!refused.accepted) assert.equal(refused.failure, "critic_not_toolless");
  }
  // Nothing at all to rest on is refused too.
  const nothing = proveFirstForm({
    fixed: FIRST,
    mintedSessionId: "sess-minted",
    initialRecord: null,
    tested: true,
  });
  assert.equal(nothing.accepted, false);
});

test("CT-109-38: the pinned proof is refused for a harness that is not tested", () => {
  const proof = proveFirstForm({
    fixed: FIRST,
    mintedSessionId: "sess-minted",
    initialRecord: null,
    tested: false,
    pinned: {
      pin: "1.2.3",
      installedVersion: "1.2.3",
      preflightPassed: true,
      flagSet: ["--no-tools"],
    },
  });
  assert.equal(proof.accepted, false);
  if (!proof.accepted) {
    assert.equal(proof.failure, "critic_not_toolless");
    assert.match(proof.reason, /tested harness adapter only/);
  }
});

test("CT-109-38: the reply of a refused call is not read", () => {
  const proof = proveFirstForm({
    fixed: FIRST,
    mintedSessionId: "sess-a",
    initialRecord: { tools: ["shell"], sessionId: "sess-a" },
    tested: true,
  });
  assert.equal(proof.accepted, false);
  let reads = 0;
  assert.throws(
    () =>
      readAcceptedReply(proof, () => {
        reads += 1;
        return "the verdict the seam must never see";
      }),
    /reply of a refused call is not read/,
  );
  assert.equal(reads, 0);
  // An accepted call does read its reply.
  const accepted = proveFirstForm({
    fixed: FIRST,
    mintedSessionId: "sess-a",
    initialRecord: { tools: [], sessionId: "sess-a" },
    tested: true,
  });
  assert.equal(
    readAcceptedReply(accepted, () => "verdict"),
    "verdict",
  );
});
