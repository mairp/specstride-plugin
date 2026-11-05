/**
 * CT-126-Foundation — the invocation identity, the path-safe components and
 * the id generator (T006; F126-FR-026).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IdentityComponentError,
  buildIdentity,
  generateInvocationId,
  identityFields,
  invocationIdFor,
  pathSafeComponent,
  absoluteExpectedEvidencePath,
} from "../src/invocation/identity.ts";

test("a generated id is inv-<iteration, 6 digits>-<8 hex characters>", () => {
  const id = generateInvocationId(7);
  assert.match(id, /^inv-000007-[0-9a-f]{8}$/);
  assert.notEqual(generateInvocationId(7), id); // two ids never collide
});

test("an id base gives <base>-iter-<n> for pass n", () => {
  assert.equal(invocationIdFor(3, "run-42"), "run-42-iter-3");
  assert.match(invocationIdFor(3), /^inv-000003-[0-9a-f]{8}$/); // no base: generated
});

test("a path component keeps only A-Za-z0-9_.- and is cut to 128 characters", () => {
  assert.equal(pathSafeComponent("feature/126:stream"), "feature-126-stream");
  assert.equal(pathSafeComponent("a  b///c"), "a-b-c"); // each run: one hyphen
  assert.equal(pathSafeComponent(".leading-and-"), "leading-and"); // edges trimmed
  assert.equal(pathSafeComponent("x".repeat(200)).length, 128);
  assert.throws(
    () => pathSafeComponent("///"),
    (err: unknown): err is IdentityComponentError =>
      err instanceof IdentityComponentError &&
      err.message === "identity component is not path-safe",
  );
});

test("the role is checked under the parity profile with the as-is message", () => {
  const base = {
    runId: "r",
    feature: "f",
    harness: "claude",
    phase: "propose",
    attempt: 1,
    iteration: 2,
  };
  const identity = buildIdentity({ ...base, role: "critic", profile: "parity" });
  assert.equal(identity.invocationId.startsWith("inv-000002-"), true);
  assert.throws(
    () => buildIdentity({ ...base, role: "overseer", profile: "parity" }),
    (err: unknown): err is IdentityComponentError =>
      err instanceof IdentityComponentError &&
      err.message === "role must be proposer, accelerator or critic",
  );
  // Outside the parity profile the label is carried as a value (F126-FR-039).
  assert.equal(buildIdentity({ ...base, role: "overseer" }).role, "overseer");
});

test("the expected evidence path is stored absolute, home expanded, links resolved", () => {
  const root = mkdtempSync(join(tmpdir(), "ct126-identity-"));
  try {
    const real = join(root, "evidence");
    mkdirSync(real);
    const link = join(root, "evidence-link");
    symlinkSync(real, link);
    assert.equal(absoluteExpectedEvidencePath(link), real);
    assert.equal(absoluteExpectedEvidencePath("relative/dir"), join(process.cwd(), "relative/dir"));
    const home = absoluteExpectedEvidencePath("~/notes.md");
    assert.equal(home.endsWith("notes.md"), true);
    assert.equal(home.startsWith("/"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the identity is carried as the eight fields of the artifacts", () => {
  const identity = buildIdentity({
    runId: "run-1",
    feature: "126",
    role: "proposer",
    harness: "claude",
    phase: "propose",
    attempt: 1,
    iteration: 4,
    invocationId: "given-id",
  });
  assert.deepEqual(identityFields(identity), {
    runId: "run-1",
    feature: "126",
    role: "proposer",
    harness: "claude",
    phase: "propose",
    attempt: 1,
    iteration: 4,
    invocationId: "given-id",
  });
});
