/**
 * T006 of `specs/113-host-claude-code/tasks.md` — `renderSkill`,
 * `renderEntry`, `renderStatusHooks` and the budget check (F113-FR-029,
 * F113-FR-036).
 *
 * The budgets are not restated here as prose: the byte limits are held against
 * the token budgets of F113-FR-036 at 2.8 bytes per token, and against the
 * byte numbers the requirement itself prints.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCTOR_SKILL_ID } from "@specstride/contracts/ep/host";
import type { SkillSource } from "@specstride/contracts/ep/host";
import { CONTEXT_COST_CHECKS } from "@specstride/contracts/ep/context-cost";
import { STATUS_LINE_NAME } from "@specstride/contracts/ids/logical-names-amendments";
import {
  BUDGETED,
  BYTES_PER_TOKEN,
  BYTE_BUDGETS,
  BudgetExceededError,
  LOGICAL_IDS,
  MAX_BODY_LINES,
  PRINTED_BYTE_BUDGETS,
  SHIM_PATH,
  STATIC_SIZE_CHECK,
  TOKEN_BUDGETS,
  UnknownLogicalIdError,
  byteBudgetOf,
  bytesForTokens,
  checkSkillBudget,
  descriptionFor,
  renderEntry,
  renderShim,
  renderSkill,
  renderSkillDirectory,
  renderStatusHooks,
  skillPath,
} from "../src/render/index.ts";
import {
  HOOKS_DIRECTORY,
  STATE_UNKNOWN_LINE,
  STATUS_LINE_LOGICAL_NAME,
  STATUS_LINE_UNDER_CONTROL_ROOT,
  invokesTheCli,
  startsTheRuntimePlatform,
} from "../src/hooks.ts";
import { shimScript } from "../src/shim/index.ts";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A skill source, as `renderSkill` is handed one (annex H §H.1, Inputs). */
function source(logicalId: string, body: string, budget = 22_400): SkillSource {
  return {
    logicalId,
    body,
    references: [{ path: "references/modes.md", readWhen: "the consumer names a mode" }],
    budget,
  };
}

/* ---------------------------------------------------------------- budgets */

test("T006: the five token budgets of F113-FR-036, measured in bytes at 2.8", () => {
  assert.equal(BYTES_PER_TOKEN, 2.8);
  assert.deepEqual(
    { ...TOKEN_BUDGETS },
    {
      "specstride-run": 8_000,
      "specstride-reverse": 7_000,
      doctor: 1_500,
      "supervision-cycle": 150,
      "run-supervision": 3_000,
    },
  );
  // The byte numbers F113-FR-036 prints: 22,400; 19,600; 4,200; 420; 8,400.
  assert.deepEqual({ ...BYTE_BUDGETS }, { ...PRINTED_BYTE_BUDGETS });
  for (const id of BUDGETED) {
    assert.equal(BYTE_BUDGETS[id], bytesForTokens(TOKEN_BUDGETS[id]));
  }
  assert.equal(MAX_BODY_LINES, 500, "the body of a skill must not exceed 500 lines");
  // The check is the first of the seven of row 145 of annex X §X.6.
  assert.equal(STATIC_SIZE_CHECK, "static size");
  assert.equal(CONTEXT_COST_CHECKS.includes(STATIC_SIZE_CHECK), true);
});

test("T006: the budget check reports check, measured bytes, limit and verdict", () => {
  const skill = source("specstride-run", "# Run\n\nDo the thing.");
  const [bytes, lines] = checkSkillBudget(skill, 1_000);
  assert.equal(bytes.check, STATIC_SIZE_CHECK);
  assert.equal(bytes.measured, 1_000);
  assert.equal(bytes.limit, BYTE_BUDGETS["specstride-run"]);
  assert.equal(bytes.verdict, "pass");
  assert.equal(lines.unit, "lines");
  assert.equal(lines.limit, MAX_BODY_LINES);
  // A source may ask for LESS than the requirement allows, never for more.
  const tight = checkSkillBudget(source("specstride-run", "x", 100), 150);
  assert.equal(tight[0].limit, 100);
  assert.equal(tight[0].verdict, "fail");
  const greedy = checkSkillBudget(source("doctor", "x", 1_000_000), 5_000);
  assert.equal(greedy[0].limit, BYTE_BUDGETS.doctor);
  assert.equal(greedy[0].verdict, "fail", "4,200 bytes is the limit of the doctor skill");
  assert.equal(byteBudgetOf("specstride-reverse"), 19_600);
  assert.equal(byteBudgetOf("doctor"), 4_200);
  assert.equal(byteBudgetOf(DOCTOR_SKILL_ID), 4_200);
  assert.equal(byteBudgetOf("nonsense"), undefined);
});

test("T006: a skill over its byte limit fails with `budget-exceeded`", () => {
  // spec.md, "Acceptance scenarios": a skill over its byte limit fails the
  // build with `budget-exceeded` (F113-FR-036, F113-FR-037).
  const tooBig = source("doctor", `# Doctor\n\n${"x".repeat(5_000)}`);
  assert.throws(
    () => renderSkill(tooBig),
    (error: unknown) => {
      assert.ok(error instanceof BudgetExceededError);
      assert.equal(error.code, "budget-exceeded");
      assert.equal(error.limit, BYTE_BUDGETS.doctor);
      assert.ok(error.measured > BYTE_BUDGETS.doctor);
      assert.equal(error.unit, "bytes");
      return true;
    },
  );
  // And over 500 lines of body, with the same error.
  const tooLong = source("specstride-run", Array.from({ length: 501 }, () => "x").join("\n"));
  assert.throws(
    () => renderSkill(tooLong),
    (error: unknown) => {
      assert.ok(error instanceof BudgetExceededError);
      assert.equal(error.unit, "lines");
      assert.equal(error.limit, MAX_BODY_LINES);
      return true;
    },
  );
  // A description over the cap of 1,536 characters fails rather than being cut.
  assert.throws(
    () => descriptionFor(source("specstride-run", "x"), "y".repeat(1_537)),
    (error: unknown) => {
      assert.ok(error instanceof BudgetExceededError);
      assert.equal(error.unit, "characters");
      assert.equal(error.limit, 1_536);
      return true;
    },
  );
  // Exactly at the cap passes: the limit is inclusive.
  assert.equal(descriptionFor(source("specstride-run", "x"), "y".repeat(1_536)).length, 1_536);
});

/* ------------------------------------------------------------ renderEntry */

test("T006: `renderEntry` is the host's spelling, and an unknown id fails the build", () => {
  assert.deepEqual([...LOGICAL_IDS], ["specstride-run", "specstride-reverse", "doctor"]);
  assert.equal(renderEntry("specstride-run"), "specstride-run");
  assert.equal(renderEntry("specstride-reverse"), "specstride-reverse");
  // `contracts/host-package.md`: "The host's spelling of a command, for
  // example `doctor`" — this host prefixes it, as its naming rule asks.
  assert.equal(renderEntry("doctor"), DOCTOR_SKILL_ID);
  assert.equal(renderEntry("doctor"), "specstride-doctor");
  // F113-FR-029 — an unknown logical id of a skill or command FAILS THE BUILD.
  assert.throws(
    () => renderEntry("specstride-teleport"),
    (error: unknown) => {
      assert.ok(error instanceof UnknownLogicalIdError);
      assert.equal(error.code, "unknown-logical-id");
      assert.match(error.message, /the build of the host package fails/);
      assert.match(error.message, /specstride-teleport/);
      return true;
    },
  );
  assert.throws(() => renderEntry(""), UnknownLogicalIdError);
  assert.throws(() => renderEntry("DOCTOR"), UnknownLogicalIdError);
});

/* ------------------------------------------------------------ renderSkill */

test("T006: `renderSkill` renders a skill directory with body and references", () => {
  const rendered = renderSkill(source("doctor", "# The doctor\n\nRun the doctor command."));
  assert.equal(rendered.path, "skills/specstride-doctor/SKILL.md");
  assert.equal(skillPath("doctor"), rendered.path);
  assert.equal(rendered.bytes, Buffer.byteLength(rendered.content, "utf8"));
  // The host's front matter, then the body, then the references with the
  // condition of each.
  assert.match(rendered.content, /^---\nname: specstride-doctor\n/);
  assert.match(rendered.content, /description: "The doctor"/);
  assert.match(rendered.content, /Run the doctor command\./);
  assert.match(rendered.content, /## References/);
  assert.match(rendered.content, /- `references\/modes\.md` — read when the consumer names a mode/);
  assert.deepEqual(
    renderSkillDirectory(source("doctor", "# The doctor\n\nx")).map((a) => a.path),
    ["skills/specstride-doctor/SKILL.md"],
  );
  // An unknown logical id fails here too (F113-FR-029).
  assert.throws(() => renderSkill(source("nope", "x")), UnknownLogicalIdError);
  // A source with no reference renders no References section.
  const bare = renderSkill({
    logicalId: "specstride-run",
    body: "# Run\n\nx",
    references: [],
    budget: 22_400,
  });
  assert.equal(bare.content.includes("## References"), false);
});

/* ----------------------------------------------------- renderStatusHooks */

test("T006: `renderStatusHooks` renders shims that print the precomputed line", () => {
  // The one input is the LOGICAL NAME of annex B §B.5, and it comes from the
  // table, not from a string written here.
  assert.equal(STATUS_LINE_LOGICAL_NAME, STATUS_LINE_NAME);
  assert.equal(STATUS_LINE_LOGICAL_NAME, "workspace:current:status-line");
  assert.equal(STATUS_LINE_UNDER_CONTROL_ROOT, "status.line");

  const hooks = renderStatusHooks(STATUS_LINE_LOGICAL_NAME);
  assert.deepEqual(
    hooks.map((h) => h.path),
    [`${HOOKS_DIRECTORY}/session-start.sh`, `${HOOKS_DIRECTORY}/prompt-submit.sh`],
  );
  for (const hook of hooks) {
    assert.equal(hook.bytes, Buffer.byteLength(hook.content, "utf8"));
    assert.match(hook.content, /^#!\/bin\/sh\n/, "a shell shim");
    // It finds the line through the logical name, and prints it.
    assert.match(hook.content, /workspace:current:status-line/);
    assert.match(hook.content, /status\.line/);
    assert.match(hook.content, /SPECSTRIDE_STATE_DIR/);
    // F113-FR-021 — a line past `validUntil` says the state is unknown.
    assert.ok(hook.content.includes(STATE_UNKNOWN_LINE));
    assert.match(hook.content, /validUntil/);
    // F113-FR-020 — it is THIN: it starts no runtime platform and runs no
    // command of the product at all. Only the lines that EXECUTE are read:
    // the comments of the shim name what it must not do.
    const code = hook.content
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    assert.equal(
      /\b(launch|run|resume|supervise|doctor)\b/.test(code),
      false,
      "no command of the product is executed",
    );
    // F113-FR-020 — the status shim starts no interpreter and does not depend on a
    // start of the runtime platform; it invokes the CLI nowhere. The two helpers of
    // T016 read the EXECUTING lines only, so a mention in a comment is not an
    // invocation and an invocation cannot hide in a comment.
    assert.equal(startsTheRuntimePlatform(hook.content), false, "no interpreter is started");
    assert.equal(invokesTheCli(hook.content), false, "the CLI is never invoked");
  }
  // An unknown logical name fails the build (F113-FR-029).
  assert.throws(() => renderStatusHooks("workspace:current:nonsense"), UnknownLogicalIdError);
});

/* ------------------------------------------------------------- the shim */

test("T006: `renderShim` is the artifact of the shim, from `src/shim/`", () => {
  const rendered = renderShim();
  assert.equal(rendered.path, SHIM_PATH);
  assert.equal(rendered.path, "bin/specstride.mjs");
  assert.equal(rendered.content, shimScript());
  assert.equal(rendered.bytes, Buffer.byteLength(rendered.content, "utf8"));
  // plan.md: "one package with a BUILD STEP THAT WRITES THE PLUGIN
  // DIRECTORY". The shim is therefore rendered, never committed: the
  // directory of the layout holds no shim in the repository, and
  // `test/shim.test.ts` writes this artifact into a temporary tree and RUNS
  // it. A committed copy could drift from `src/shim/`; a rendered one cannot.
  assert.equal(
    existsSync(resolve(PKG, "plugin", rendered.path)),
    false,
    "the plugin directory is a build output: the shim is not committed",
  );
});
