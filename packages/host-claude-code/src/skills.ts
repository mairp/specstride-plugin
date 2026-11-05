/**
 * T008, T009 and T010 — the three skill sources of this host together, and the
 * artifacts `renderSkill` makes of them (F113-FR-001: the plugin offers three
 * skills with the logical ids `specstride-run`, `specstride-reverse` and a
 * doctor skill).
 *
 * The three logical ids are row 144 of annex X §X.6, read from
 * `@specstride/contracts` and not written here. A source whose logical id is
 * outside the row fails the BUILD (F113-FR-029), which `renderSkill` enforces.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HOST_SKILL_AND_ENTRY_IDS } from "@specstride/contracts/ep/context-cost";
import type { HostArtifact, SkillSource } from "@specstride/contracts/ep/host";
import { renderSkill } from "./render/index.ts";
import { DOCTOR_SKILL_DESCRIPTION, doctorSkillSource } from "./skill-doctor.ts";
import { REVERSE_SKILL_DESCRIPTION, reverseSkillSource } from "./skill-reverse.ts";
import { RUN_SKILL_DESCRIPTION, runSkillSource } from "./skill-run.ts";

/** The logical ids of the three skills, row 144 of annex X §X.6. */
export const SKILL_LOGICAL_IDS = HOST_SKILL_AND_ENTRY_IDS;

/** The one-line description of each skill, by logical id. */
export const SKILL_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  [HOST_SKILL_AND_ENTRY_IDS[0]]: RUN_SKILL_DESCRIPTION,
  [HOST_SKILL_AND_ENTRY_IDS[1]]: REVERSE_SKILL_DESCRIPTION,
  [HOST_SKILL_AND_ENTRY_IDS[2]]: DOCTOR_SKILL_DESCRIPTION,
});

/** The three skill sources, in the order of row 144. */
export function skillSources(): readonly SkillSource[] {
  return Object.freeze([runSkillSource(), reverseSkillSource(), doctorSkillSource()]);
}

/** The source of one logical id, or `undefined`. */
export function skillSourceOf(logicalId: string): SkillSource | undefined {
  return skillSources().find((source) => source.logicalId === logicalId);
}

/**
 * F113-FR-001 — the happy path of every skill needs NO reference file, so no
 * source carries one.
 */
export function everySkillHasAHappyPathWithoutAReference(): boolean {
  return skillSources().every((source) => source.references.length === 0);
}

/**
 * The artifacts of the three skills: one `skills/<the host's spelling>/SKILL.md`
 * each, checked against the byte budget of F113-FR-036 by `renderSkill`.
 */
export function renderPluginSkills(): readonly HostArtifact[] {
  return Object.freeze(
    skillSources().map((source) =>
      renderSkill(source, { description: SKILL_DESCRIPTIONS[source.logicalId] }),
    ),
  );
}

/** The artifact of one logical id. */
export function renderPluginSkill(logicalId: string): HostArtifact {
  const source = skillSourceOf(logicalId);
  if (source === undefined) {
    throw new Error(`row 144 of annex X §X.6 holds no skill \`${logicalId}\``);
  }
  return renderSkill(source, { description: SKILL_DESCRIPTIONS[logicalId] });
}

/* -------------------------------------------------------------------------
 * The build step: the sources become files of the plugin directory
 * ---------------------------------------------------------------------- */

/** The content hash of a rendered skill, which a test reads back from disk. */
export function skillContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** One skill as the build wrote it into the plugin directory. */
export type WrittenSkill = {
  /** The logical id of row 144 the file came from. */
  readonly logicalId: string;
  /** The path inside the plugin directory, with `/` as the separator. */
  readonly path: string;
  /** The bytes the file measures. */
  readonly bytes: number;
  /** The SHA-256 of its content, in lower-case hexadecimal. */
  readonly sha256: string;
};

/**
 * The build step of T008 to T010: it writes the three rendered skills into a
 * plugin directory and returns what it wrote, each with its content hash. The
 * plugin directory is a BUILD OUTPUT and lies inside the published package
 * (plan.md, "Structure Decision"), so the build writes it and the repository
 * does not carry it.
 */
export function writePluginSkills(pluginDirectory: string): readonly WrittenSkill[] {
  const written = renderPluginSkills().map((artifact, index) => {
    const file = join(pluginDirectory, artifact.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, artifact.content, "utf8");
    const source = skillSources()[index];
    return Object.freeze({
      logicalId: source?.logicalId ?? "",
      path: artifact.path,
      bytes: artifact.bytes,
      sha256: skillContentHash(artifact.content),
    });
  });
  return Object.freeze(written);
}
