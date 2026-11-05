/**
 * T008, T009 and T010 of `specs/113-host-claude-code/tasks.md` — the three skill
 * sources exist and the build turns them into files of the plugin directory.
 *
 * The witness is the TREE ON DISK, read back with `node:fs` through a path the
 * build did not hand over, and the SHA-256 of each file's bytes: a durable
 * identity that cannot exist before the build has run. The return value of
 * `writePluginSkills` is never the proof; it is compared with what the disk says.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESCRIPTION_CAP } from "../src/describe/index.ts";
import { BYTE_BUDGETS, MAX_BODY_LINES, renderEntry, skillPath } from "../src/render/index.ts";
import { BODY_BYTE_LIMITS, assertBodyFitsItsLimit, bodyBytes } from "../src/skill-budgets.ts";
import { RUN_SKILL_ID, runSkillBody, runSkillSource } from "../src/skill-run.ts";
import { REVERSE_SKILL_ID, reverseSkillBody, reverseSkillSource } from "../src/skill-reverse.ts";
import {
  DOCTOR_SKILL_LOGICAL_ID,
  doctorSkillBody,
  doctorSkillSource,
} from "../src/skill-doctor.ts";
import {
  SKILL_LOGICAL_IDS,
  renderPluginSkills,
  skillContentHash,
  skillSources,
  writePluginSkills,
} from "../src/skills.ts";

/** A fresh plugin directory for one case. */
function freshPlugin(): string {
  return join(mkdtempSync(join(tmpdir(), "specstride-113-skills-")), "plugin");
}

test("T008-T010: the build writes three skill files, and the DISK is the witness", () => {
  const plugin = freshPlugin();
  // Nothing is there before the build runs.
  for (const id of SKILL_LOGICAL_IDS) {
    assert.equal(existsSync(join(plugin, skillPath(id))), false, `${id} existed before the build`);
  }

  const written = writePluginSkills(plugin);
  assert.equal(written.length, 3);
  assert.deepEqual(
    written.map((w) => w.logicalId),
    [...SKILL_LOGICAL_IDS],
  );

  for (const skill of written) {
    // The independent read path: the file, by the path the host's naming rule
    // gives it, read from disk and not from the return value.
    const file = join(plugin, "skills", renderEntry(skill.logicalId), "SKILL.md");
    assert.equal(existsSync(file), true, `${skill.logicalId}: ${file} is missing`);
    assert.equal(statSync(file).isFile(), true);
    const onDisk = readFileSync(file, "utf8");
    // The durable identity: the hash of the bytes that are now on disk.
    const hash = createHash("sha256").update(onDisk, "utf8").digest("hex");
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(
      hash,
      skill.sha256,
      `${skill.logicalId}: the file on disk is not what was written`,
    );
    assert.equal(Buffer.byteLength(onDisk, "utf8"), skill.bytes);
    // It is not the hash of nothing.
    assert.notEqual(hash, createHash("sha256").update("", "utf8").digest("hex"));
    // The file carries the host's front matter and the body.
    assert.match(onDisk, /^---\nname: /);
    assert.ok(onDisk.includes(`name: ${renderEntry(skill.logicalId)}`));
  }
  // Three distinct skills, three distinct hashes.
  assert.equal(new Set(written.map((w) => w.sha256)).size, 3);
  assert.equal(new Set(written.map((w) => w.path)).size, 3);
});

test("T008-T010: the read path is real — a file that was not written cannot be read", () => {
  const plugin = freshPlugin();
  const written = writePluginSkills(plugin);
  const file = join(plugin, written[0]?.path ?? "");
  assert.equal(existsSync(file), true);
  // Remove it: the independent read then FAILS, so a pass of the case above
  // cannot come from anywhere but the file itself.
  rmSync(file);
  assert.throws(() => readFileSync(file, "utf8"), /ENOENT/);
  // And no skill of this host is ever written outside its own directory.
  for (const skill of written) {
    assert.match(skill.path, /^skills\/[a-z-]+\/SKILL\.md$/);
  }
});

test("T008-T010: the build is deterministic — the same sources, the same hashes", () => {
  const first = writePluginSkills(freshPlugin());
  const second = writePluginSkills(freshPlugin());
  assert.deepEqual(
    first.map((w) => [w.logicalId, w.sha256]),
    second.map((w) => [w.logicalId, w.sha256]),
  );
  // The hash of the artifact and the hash of its content agree.
  for (const artifact of renderPluginSkills()) {
    const match = first.find((w) => w.path === artifact.path);
    assert.equal(match?.sha256, skillContentHash(artifact.content));
  }
});

test("T008-T010: every skill is inside its budgets (F113-FR-036 and plan.md)", () => {
  const artifacts = renderPluginSkills();
  const budgets = [
    BYTE_BUDGETS["specstride-run"],
    BYTE_BUDGETS["specstride-reverse"],
    BYTE_BUDGETS.doctor,
  ];
  artifacts.forEach((artifact, index) => {
    const limit = budgets[index] ?? 0;
    assert.ok(artifact.bytes <= limit, `${artifact.path}: ${artifact.bytes} bytes over ${limit}`);
    assert.ok(artifact.bytes > 0);
  });
  // The body of each skill is inside the tighter limit of the design point, and
  // under the cap of 500 lines.
  const bodies: readonly (readonly [string, string])[] = [
    [RUN_SKILL_ID, runSkillBody()],
    [REVERSE_SKILL_ID, reverseSkillBody()],
    [DOCTOR_SKILL_LOGICAL_ID, doctorSkillBody()],
  ];
  for (const [id, body] of bodies) {
    const limit = BODY_BYTE_LIMITS[id] ?? 0;
    assert.ok(limit > 0, `plan.md fixes no body limit for \`${id}\``);
    assert.ok(bodyBytes(body) <= limit, `${id}: ${bodyBytes(body)} bytes over ${limit}`);
    assert.ok(body.split("\n").length <= MAX_BODY_LINES, `${id}: over ${MAX_BODY_LINES} lines`);
    assert.doesNotThrow(() => assertBodyFitsItsLimit(id, body));
  }
  // A body over the limit FAILS THE BUILD rather than being cut.
  assert.throws(
    () =>
      assertBodyFitsItsLimit(RUN_SKILL_ID, "x".repeat((BODY_BYTE_LIMITS[RUN_SKILL_ID] ?? 0) + 1)),
    /budget-exceeded/,
  );
  assert.throws(() => assertBodyFitsItsLimit("onboard-skill", "x"), /no body limit/);
  // Every description is inside the cap of this host.
  for (const source of skillSources()) {
    const artifact = artifacts.find((a) => a.path === skillPath(source.logicalId));
    const description = /description: "((?:[^"\\]|\\.)*)"/.exec(artifact?.content ?? "")?.[1] ?? "";
    assert.ok(description.length > 0, `${source.logicalId} has no description`);
    assert.ok(description.length <= DESCRIPTION_CAP, `${source.logicalId}: description too long`);
  }
});

test("T008-T010: each source carries the logical id of row 144 and its own budget", () => {
  assert.deepEqual(
    [runSkillSource(), reverseSkillSource(), doctorSkillSource()].map((s) => s.logicalId),
    [...SKILL_LOGICAL_IDS],
  );
  assert.equal(runSkillSource().budget, BYTE_BUDGETS["specstride-run"]);
  assert.equal(reverseSkillSource().budget, BYTE_BUDGETS["specstride-reverse"]);
  assert.equal(doctorSkillSource().budget, BYTE_BUDGETS.doctor);
  // The host's spelling of each, which is the directory the file lies in.
  assert.equal(renderEntry(RUN_SKILL_ID), "specstride-run");
  assert.equal(renderEntry(REVERSE_SKILL_ID), "specstride-reverse");
  assert.equal(renderEntry(DOCTOR_SKILL_LOGICAL_ID), "specstride-doctor");
});
