/**
 * T051 of feature 107 — the modes, the mode map and the argument handling of
 * `launch`, as unit tests over the module the verb wiring consumes
 * (specs/107-launch-contract/tasks.md, T051; F107-FR-032, F107-FR-035,
 * F107-FR-034).
 *
 * The characterization test of the modes (CT-107-10,
 * `tests/characterization/107/modes.test.ts`) proves the five scenarios of
 * the task end to end; this file holds the remaining unit behavior of the
 * argument handling: the usage refusals, the comment hash comparison, and
 * the `--json` and `--new-run` flags.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  commentChanged,
  isKnownModeName,
  parseLaunchArgs,
  resolveModeName,
  MODE_MAP,
  REFUSAL_OF_AN_UNKNOWN_MODE,
  LAUNCH_REFUSED_EXIT,
  LAUNCH_USAGE_EXIT,
} from "../src/contract/launch/modes.ts";

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

test("T051: a flag without its value is a usage refusal (exit 2)", () => {
  for (const flag of ["--mode", "--comment", "--comment-selects", "--launcher"]) {
    const parsed = parseLaunchArgs([flag]);
    assert.equal(parsed.refusal?.reason, "usage", flag);
    assert.equal(parsed.refusal?.exit, LAUNCH_USAGE_EXIT, flag);
    assert.equal(parsed.mode, undefined, flag);
  }
});

test("T051: `--launcher` names the launcher of the call, as given", () => {
  const parsed = parseLaunchArgs(["--launcher", "/state/pipeline/p/launcher/launch.sh"]);
  assert.equal(parsed.mode, "run", "the default mode stands");
  assert.equal(parsed.launcher, "/state/pipeline/p/launcher/launch.sh");
  // The path is taken as it is given: no resolution happens here.
  assert.equal(parseLaunchArgs(["--launcher", "launch.sh"]).launcher, "launch.sh");
  assert.equal(parseLaunchArgs([]).launcher, undefined, "absent where not given");
});

test("T051: an unknown argument is a usage refusal, and `--json` and `--new-run` parse", () => {
  assert.equal(parseLaunchArgs(["--frobnicate"]).refusal?.reason, "usage");
  const parsed = parseLaunchArgs([
    "--dry-run",
    "--json",
    "--new-run",
    "--comment",
    "token=sk-secret-1 go",
  ]);
  assert.equal(parsed.mode, "dry-run");
  assert.equal(parsed.json, true);
  assert.equal(parsed.newRun, true);
  // The comment as it may be printed is the redacted one, never the text.
  assert.notEqual(parsed.commentShown, "token=sk-secret-1 go");
  assert.ok(!parsed.commentShown!.includes("sk-secret-1"));
  assert.equal(parsed.comment, "token=sk-secret-1 go");
});

test("T051: --comment-selects takes only the option `mode` of row 283", () => {
  const other = parseLaunchArgs(["--comment", "x", "--comment-selects", "features"]);
  assert.equal(other.refusal?.reason, "usage");
  assert.match(other.refusal!.message, /launch accepts only mode/);
  const mode = parseLaunchArgs(["--comment", "x", "--comment-selects", "mode=dry-run"]);
  assert.equal(mode.refusal, undefined);
  assert.equal(mode.mode, "dry-run");
  assert.deepEqual(mode.commentSelects, ["mode=dry-run"]);
});

test("T051: an unknown mode refuses with unknown-mode and the code of a refusal", () => {
  assert.equal(isKnownModeName("launch"), false);
  assert.equal(isKnownModeName("dry-run"), true);
  const refused = resolveModeName("launch");
  assert.ok("refusal" in refused);
  assert.equal(refused.refusal.reason, REFUSAL_OF_AN_UNKNOWN_MODE);
  assert.equal(refused.refusal.exit, LAUNCH_REFUSED_EXIT);
  // And through the whole argument handling, no mode is resolved.
  const parsed = parseLaunchArgs(["--mode", "launch"]);
  assert.equal(parsed.mode, undefined);
  assert.equal(parsed.refusal?.reason, "unknown-mode");
  assert.equal(parsed.refusal?.exit, 4);
});

test("T051: the mode map is data, closed and frozen", () => {
  assert.deepEqual(Object.keys(MODE_MAP).sort(), ["auto", "dry-run", "generate", "run"]);
  assert.equal(Object.isFrozen(MODE_MAP), true);
});

test("T051: the comment hash comparison refuses a changed comment (F107-FR-034)", () => {
  const recorded = sha256("same words");
  assert.deepEqual(
    commentChanged({ comment: "same words", recordedHash: recorded, hashOf: sha256 }),
    {
      changed: false,
    },
  );
  const changed = commentChanged({
    comment: "other words",
    recordedHash: recorded,
    hashOf: sha256,
  });
  assert.equal(changed.changed, true);
  if (changed.changed) {
    assert.equal(changed.refusal.reason, "comment-changed");
    assert.equal(changed.refusal.exit, LAUNCH_REFUSED_EXIT);
  }
  // One side with a comment and the other without is a difference too.
  assert.equal(commentChanged({ comment: "words", hashOf: sha256 }).changed, true);
  assert.equal(commentChanged({ recordedHash: sha256("words"), hashOf: sha256 }).changed, true);
  // Neither side has a comment: no difference.
  assert.deepEqual(commentChanged({ hashOf: sha256 }), { changed: false });
});
