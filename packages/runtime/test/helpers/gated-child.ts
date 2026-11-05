/**
 * A child that does no work until its registry entry is on disk (T050,
 * F122-FR-023).
 *
 * `spawnStubProcess` of T008 is a process that holds an environment and
 * sleeps; it is what the lock probe and the identity check are pointed at.
 * This is the other half: a child started THROUGH the registry, which blocks
 * on `awaitTheGate` and, the moment the gate opens, reads the registry file
 * ITSELF and records whether its own entry was already there.
 *
 * That record is the witness for *the entry MUST be written before the child
 * can do any work*. The claim is not made by the writer about itself — it is
 * read back from the child's own eyes, through a path the writer does not
 * control.
 *
 * Run directly: `node gated-child.ts --ready <file>`.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { awaitTheGate } from "../../src/procs/registry.ts";
import { RUN_TOKEN_VAR } from "../../src/procs/run-token.ts";

/** This file; the path a test hands to `node` as the child's entry. */
export const GATED_CHILD_ENTRY = fileURLToPath(import.meta.url);

/** The variable the child is told which registry file to read itself out of. */
export const REGISTRY_FILE_VAR = "GATED_CHILD_REGISTRY";

/** The variable the child is told where to write its record. */
export const READY_FILE_VAR = "GATED_CHILD_READY";

/** The cap on the life of a gated child, so a failed test leaves nothing. */
export const DEFAULT_TTL_MS = 30_000;

/** The variable that caps its life. */
export const TTL_VAR = "GATED_CHILD_TTL_MS";

/** What the child writes the instant the gate opens. */
export type GatedChildRecord = {
  readonly kind: "specstride.test.gated-child/1";
  readonly pid: number;
  /** The `procId` the gate carried. */
  readonly procId: string | null;
  /** True where the child found its OWN entry in the registry file. */
  readonly sawItsOwnEntry: boolean;
  /** How many entries of the registry file name this child's process id. */
  readonly entriesForThisPid: number;
  /** True where the child holds a run token in its environment. */
  readonly holdsARunToken: boolean;
  /** The run token it holds. Written only so a test can prove it is NOT in a record. */
  readonly runToken: string | null;
  /** The hash the entry of this child carries, as the child read it. */
  readonly runTokenHashInTheEntry: string | null;
  /** The class and the kind of its own entry, as the child read them. */
  readonly classInTheEntry: string | null;
  readonly kindInTheEntry: string | null;
  readonly workerIdInTheEntry: string | null;
};

function writeAtomically(path: string, text: string): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

async function runAsChild(): Promise<void> {
  const readyPath = process.env[READY_FILE_VAR];
  if (readyPath === undefined) {
    process.stderr.write(`gated-child: ${READY_FILE_VAR} is required\n`);
    process.exit(2);
  }
  // 1. Do nothing at all until the gate opens.
  const procId = await awaitTheGate(process.env);

  // 2. The first work this child does is to read the registry ITSELF.
  const registryFile = process.env[REGISTRY_FILE_VAR];
  let own: Record<string, unknown> | null = null;
  let forThisPid = 0;
  if (registryFile !== undefined) {
    let text = "";
    try {
      text = readFileSync(registryFile, "utf8");
    } catch {
      text = "";
    }
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (entry["pid"] === process.pid) {
        forThisPid += 1;
        own = entry;
      }
    }
  }

  const token = process.env[RUN_TOKEN_VAR] ?? null;
  const record: GatedChildRecord = {
    kind: "specstride.test.gated-child/1",
    pid: process.pid,
    procId,
    sawItsOwnEntry: own !== null && own["procId"] === procId,
    entriesForThisPid: forThisPid,
    holdsARunToken: typeof token === "string" && token.length > 0,
    runToken: token,
    runTokenHashInTheEntry:
      typeof own?.["runTokenHash"] === "string" ? (own["runTokenHash"] as string) : null,
    classInTheEntry: typeof own?.["class"] === "string" ? (own["class"] as string) : null,
    kindInTheEntry: typeof own?.["kind"] === "string" ? (own["kind"] as string) : null,
    workerIdInTheEntry: typeof own?.["workerId"] === "string" ? (own["workerId"] as string) : null,
  };
  writeAtomically(readyPath, `${JSON.stringify(record, null, 2)}\n`);

  const ttl = Number(process.env[TTL_VAR] ?? DEFAULT_TTL_MS);
  setTimeout(() => process.exit(0), Number.isFinite(ttl) ? ttl : DEFAULT_TTL_MS);
}

/** Read the record of a gated child as soon as it is complete on disk. */
export async function waitForGatedChild(
  readyPath: string,
  timeoutMs = 15_000,
): Promise<GatedChildRecord> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    try {
      const record = JSON.parse(readFileSync(readyPath, "utf8")) as GatedChildRecord;
      if (record.kind === "specstride.test.gated-child/1") return record;
      last = `unexpected kind ${String(record.kind)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() > deadline) {
      throw new Error(`the gated child did not report inside ${timeoutMs} ms: ${last}`);
    }
    await new Promise((done) => setTimeout(done, 10));
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === GATED_CHILD_ENTRY) {
  void runAsChild();
}
