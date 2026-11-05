/**
 * The STORE of Lisa's verification package — the safe-write path of the
 * renderer's output and of the immutable canonical plan — extracted as source
 * (T006, `research.md` D-1; recorded in `../../EXTRACTED.md`).
 *
 * Extracted from `packages/verification/src/store.ts` of Lisa at `363e6a3`
 * (141 lines, the whole file), read with
 * `git -C <lisa> show 363e6a3:packages/verification/src/store.ts`.
 *
 * Two changes of the extraction, both mechanical:
 *
 * 1. the type-only import comes from `../plan/lisa-plan.ts` instead of
 *    `@lisa/core` — the same shapes, and a type import emits nothing;
 * 2. `VerificationPlanV1Schema.parse(…)` becomes `asVerificationPlanV1(…)`,
 *    because VALIDATION moves out of the extraction (see
 *    `../plan/lisa-plan.ts`): this package takes no zod dependency, and the
 *    validation of a plan is written new with the planner on the canonical
 *    spec model (F105-FR-013). Nothing else of either call site changes, so
 *    the guards below — the authorized-output check, the symbolic-link
 *    refusal, the generated-marker check, the semantic-hash check, the
 *    immutability of the canonical file and the temporary-then-rename write —
 *    are byte for byte the baseline's.
 *
 * As extracted, and a LATER phase of this feature changes each on purpose:
 * the canonical plan is stored under `.lisa/verification/` (the Specstride
 * baseline keeps its own place, F105-FR-002), the generated marker is
 * `<!-- lisa-verification-plan content-hash:`, and the refusal reads
 * "a non-generated or changed verification artifact" where the Specstride
 * baseline writes "a non-generated or changed artifact" (F105-FR-023, item
 * B-1064). Each is pinned as it was extracted by
 * `tests/characterization/105/CT-105-2.test.ts`.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import type { VerificationPlanV1 } from "../plan/lisa-plan.ts";
import { contentHash } from "../plan/lisa-hash.ts";
import { renderVerificationPlan } from "./lisa-render.ts";

/**
 * Where the baseline calls `VerificationPlanV1Schema.parse`. The extraction
 * drops the zod validation and keeps the value (change 2 above); the planner
 * of a later phase validates a plan on the canonical spec model.
 */
function asVerificationPlanV1(value: unknown): VerificationPlanV1 {
  return value as VerificationPlanV1;
}

export class VerificationWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationWriteError";
  }
}

export interface PersistedVerificationPlan {
  plan: VerificationPlanV1;
  canonicalPath: string;
  markdownPath: string;
}

function nearestExisting(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

export function assertAuthorizedOutput(workdir: string, outputPath: string): string {
  if (!isAbsolute(workdir) || !isAbsolute(outputPath)) {
    throw new VerificationWriteError(
      `verification paths must be absolute: workdir=${workdir} output=${outputPath}`,
    );
  }
  const root = realpathSync(resolve(workdir));
  const output = resolve(outputPath);
  const parent = nearestExisting(dirname(output));
  const parentReal = realpathSync(parent);
  const fromRoot = relative(root, parentReal);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new VerificationWriteError(
      `verification output escapes the authorized workdir: ${output}`,
    );
  }
  if (existsSync(output) && lstatSync(output).isSymbolicLink()) {
    throw new VerificationWriteError(`verification output cannot be a symbolic link: ${output}`);
  }
  return output;
}

function atomicWrite(path: string, content: string, replaceGenerated: boolean): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const previous = readFileSync(path, "utf8");
    if (previous === content) return;
    if (!replaceGenerated || !previous.startsWith("<!-- lisa-verification-plan content-hash:")) {
      throw new VerificationWriteError(
        `refusing to overwrite a non-generated or changed verification artifact: ${path}`,
      );
    }
  }
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
}

function assertSemanticHash(plan: VerificationPlanV1): void {
  const { contentHash: recorded, ...semantic } = plan;
  const computed = contentHash(semantic);
  if (recorded !== computed) {
    throw new VerificationWriteError(
      `verification plan hash mismatch: recorded ${recorded} computed ${computed}`,
    );
  }
}

export function persistVerificationPlan(
  inputPlan: VerificationPlanV1,
  markdownOutputPath: string,
): PersistedVerificationPlan {
  const plan = asVerificationPlanV1(inputPlan);
  assertSemanticHash(plan);
  const markdownPath = assertAuthorizedOutput(plan.project.workdir, markdownOutputPath);
  const canonicalPath = join(
    plan.project.workdir,
    ".lisa",
    "verification",
    plan.source.bundleId,
    plan.contentHash,
    "verification-plan.json",
  );
  assertAuthorizedOutput(plan.project.workdir, canonicalPath);

  const json = `${JSON.stringify(plan, null, 2)}\n`;
  mkdirSync(dirname(canonicalPath), { recursive: true });
  if (existsSync(canonicalPath)) {
    const stored = readFileSync(canonicalPath, "utf8");
    if (stored !== json) {
      throw new VerificationWriteError(
        `immutable canonical verification plan already exists with different bytes: ${canonicalPath}`,
      );
    }
  } else {
    const temporary = `${canonicalPath}.tmp-${process.pid}`;
    writeFileSync(temporary, json, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, canonicalPath);
  }
  atomicWrite(markdownPath, renderVerificationPlan(plan), true);
  return { plan, canonicalPath, markdownPath };
}

export function readVerificationPlan(path: string): VerificationPlanV1 {
  if (!isAbsolute(path)) {
    throw new VerificationWriteError(`verification plan path must be absolute: ${path}`);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const plan = asVerificationPlanV1(parsed);
  assertSemanticHash(plan);
  return plan;
}
