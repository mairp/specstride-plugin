/**
 * T003 — the fake file writer of the test frame of feature 127 (`plan.md`,
 * *Ledger write*: "The kernel's atomic write"; **Testing**: "a fake file
 * writer").
 *
 * The ledger, the pause record and the previous generation are written through
 * `AtomicWrite` of annex A §A.3, which this fake stands in for: an in-memory
 * store of logical paths to content, plus the two things the tests of this
 * feature need that a real file system gives only awkwardly —
 *
 *  - `makeUnreadable(path)`: a later `read` throws, which is the unreadable
 *    ledger of F127-FR-032 and the `ledger-unreadable` alert of §Q.4;
 *  - `failNextWrite(reason)`: a write that fails, so that a test can show the
 *    previous generation is still the last good copy.
 *
 * Every write is recorded in order in `writes`, so a test asserts both the
 * content and that the previous generation was written before the ledger
 * (`plan.md`, *Ledger write*).
 */
import type { PauseStore } from "../../src/quota/ports.ts";

/** One recorded write. */
export type WriteCall = {
  readonly path: string;
  readonly content: string;
  /** True where the path already held content: the write replaced it. */
  readonly replaced: boolean;
};

/** A fake atomic write over an in-memory store. */
export type FakeFileWriter = PauseStore & {
  /** Every write, in order. */
  readonly writes: readonly WriteCall[];
  /** Every path removed, in order (F127-FR-013 removes the pause record). */
  readonly removals: readonly string[];
  /** The paths the store holds, sorted. */
  paths(): readonly string[];
  /** Put content in place without recording a write: the state a test starts from. */
  seed(path: string, content: string): void;
  /** Make a later `read` of the path throw, as an unreadable file does. */
  makeUnreadable(path: string): void;
  /** Make the path readable again. */
  makeReadable(path: string): void;
  /** Make the next `write` throw with this reason, once. */
  failNextWrite(reason: string): void;
};

/** The error an unreadable path throws, so a test can recognize it. */
export class UnreadableFile extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`unreadable file: ${path}`);
    this.name = "UnreadableFile";
    this.path = path;
  }
}

function asText(content: string | Uint8Array): string {
  return typeof content === "string" ? content : new TextDecoder().decode(content);
}

/** A fake file writer. A test may seed it with the files a run already wrote. */
export function fakeFileWriter(seeded: Readonly<Record<string, string>> = {}): FakeFileWriter {
  const store = new Map<string, string>(Object.entries(seeded));
  const unreadable = new Set<string>();
  const writes: WriteCall[] = [];
  const removals: string[] = [];
  let failNext: string | undefined;

  return {
    write(path: string, content: string | Uint8Array): void {
      if (failNext !== undefined) {
        const reason = failNext;
        failNext = undefined;
        throw new Error(reason);
      }
      const text = asText(content);
      writes.push({ path, content: text, replaced: store.has(path) });
      store.set(path, text);
      unreadable.delete(path);
    },

    read(path: string): string {
      if (unreadable.has(path)) throw new UnreadableFile(path);
      const content = store.get(path);
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return content;
    },

    exists(path: string): boolean {
      return store.has(path);
    },

    /**
     * Remove the file, as `PauseStore` of `../../src/quota/ports.ts` asks: the
     * pause record is removed at the resume (F127-FR-013). A path that holds
     * nothing is not an error, and the removal is recorded in `removals` so a
     * test can assert the order of a write and a removal.
     */
    remove(path: string): void {
      removals.push(path);
      store.delete(path);
      unreadable.delete(path);
    },

    writes,
    removals,
    paths: () => [...store.keys()].sort(),
    seed(path: string, content: string): void {
      store.set(path, content);
    },
    makeUnreadable(path: string): void {
      unreadable.add(path);
    },
    makeReadable(path: string): void {
      unreadable.delete(path);
    },
    failNextWrite(reason: string): void {
      failNext = reason;
    },
  };
}
