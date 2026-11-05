/**
 * CT-130-46 — the capture of `concurrentSessions`: several headless
 * processes of one harness run at once under one configuration home and one
 * login, with separate session stores (F142-FR-020, F142-FR-003; annex C
 * §C.1).
 *
 * This is the REAL capture: three `zai/glm-5.3-flash` headless sessions of
 * the installed dsh, started at once through `startPass` in three separate
 * trees, all under ONE configuration home and ONE login — the fixture home
 * links the credentials, the profiles and the skills of the real home and
 * writes its own settings file, which names the model — with the session
 * stores under that one home, one store per tree. The paid part runs here by
 * the owner's ruling of 2026-11-03 (build parallel units; the release waits
 * for them), which lifts the out-of-band rule of 2026-09-30 for exactly this
 * capture: three small calls of the cheapest named model, nothing else.
 *
 * What is pinned:
 *   - the installed dsh is at the pin `0.1.0-rc.8`;
 *   - all three passes are alive AT ONCE, each in a process group of its own;
 *   - all three finish with exit 0 and answer DONE;
 *   - each tree holds exactly its own claim file, with its own token;
 *   - exactly three new session stores appear under the one home, one per
 *     tree, each named by the tree's path, each holding one fresh session.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dshStartPass } from "../src/start-pass/index.ts";
import { overlaySettingsContent } from "../src/overlay/index.ts";
import { resolveDshSettings } from "../src/proposer/settings.ts";
import { detectDsh, DSH_PIN } from "../src/detect/index.ts";

/** The model the capture names (the owner's rule: glm-5.3-flash or glm-5.3 only). */
export const CONCURRENT_CAPTURE_MODEL = "zai/glm-5.3-flash" as const;

/** The number of sessions the capture runs at once. */
export const CONCURRENT_CAPTURE_SESSIONS = 3 as const;

/** The store directory name dsh derives from a working tree (observed, pinned). */
export function sessionStoreDirectoryNameOf(tree: string): string {
  return `--${tree.replace(/^\//, "").split("/").join("-")}--`;
}

/**
 * The fixture home of the capture: ONE configuration home that links the
 * credentials, the profiles, the skills and every other entry of the real
 * home (one login), writes its own settings file naming the model, and holds
 * its own session stores; three trees stand beside it.
 */
function stageConcurrentCapture() {
  const root = mkdtempSync(join(tmpdir(), "dsh-concurrent."));
  const home = join(root, "home");
  mkdirSync(home);
  const realHome = resolveDshSettings({
    env: process.env as Record<string, string | undefined>,
  }).home;
  const realSettings = existsSync(join(realHome, "settings.yaml"))
    ? readFileSync(join(realHome, "settings.yaml"), "utf8")
    : null;
  if (realSettings === null) {
    throw new Error(
      `CT-130-46 needs the settings of the real home to build one login: ${realHome}`,
    );
  }
  for (const entry of readdirSync(realHome)) {
    if (entry === "settings.yaml" || entry === "sessions") continue;
    symlinkSync(join(realHome, entry), join(home, entry));
  }
  mkdirSync(join(home, "sessions"), { recursive: true });
  writeFileSync(
    join(home, "settings.yaml"),
    overlaySettingsContent({ provider: "zai", model: "glm-5.3-flash" }, realSettings),
    "utf8",
  );
  const trees = Array.from({ length: CONCURRENT_CAPTURE_SESSIONS }, (_, i) =>
    join(root, `tree-${i + 1}`),
  );
  for (const tree of trees) mkdirSync(tree);
  return {
    root,
    home,
    trees,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * The capture spends three paid model calls on the real harness, so it runs
 * only when asked for (W-X-09: a missing prerequisite is a SKIP with its
 * reason, never a pass). Asked for, a missing harness is a failure.
 */
const LIVE_CAPTURE_VARIABLE = "SPECSTRIDE_LIVE_CAPTURE";

test("CT-130-46: three glm-5.3-flash sessions at once, one home, one login, separate stores", async (t) => {
  if (process.env[LIVE_CAPTURE_VARIABLE] !== "1") {
    t.skip(`a live capture on the real harness: set ${LIVE_CAPTURE_VARIABLE}=1 to run it`);
    return;
  }
  const detection = detectDsh({
    exists: (dir, name) => {
      try {
        return statSync(join(dir, name)).isFile();
      } catch {
        return false;
      }
    },
  });
  assert.ok(detection.ok, `the installed dsh was not found: ${JSON.stringify(detection)}`);
  assert.equal(
    detection.ok && detection.version,
    DSH_PIN,
    "the capture is pinned to the tested version of the harness",
  );

  const fixture = stageConcurrentCapture();
  try {
    // No model reference is named, so no overlay is built: every process
    // carries the ONE fixture home as its DSH_HOME, and the settings of that
    // one home select zai/glm-5.3-flash.
    const handles = await Promise.all(
      fixture.trees.map((tree, index) =>
        dshStartPass({
          promptReference:
            `Create a file named claim-${index + 1}.txt in the current working directory ` +
            `containing exactly the single line TOKEN-${index + 1} and nothing else. ` +
            "Then reply with the single word DONE.",
          workingDirectory: tree,
          writeRoot: tree,
          session: { kind: "fresh", sessionId: `worker-${index + 1}` },
          model: "",
          modelTierOrEffort: "base",
          containment: "C1",
          environmentAllowList: ["SPECSTRIDE_RUN_TOKEN"],
          environment: { SPECSTRIDE_RUN_TOKEN: "run-token-of-the-capture" },
          timeLimitMs: 240_000,
          killGraceMs: 5_000,
          transport: "subprocess",
          env: {
            ...(process.env as Record<string, string | undefined>),
            DSH_HOME: fixture.home,
          },
          outputDirectory: join(fixture.root, `out-${index + 1}`),
        }),
      ),
    );
    for (const started of handles) {
      assert.ok(started.ok, JSON.stringify(started));
    }
    const live = handles.map((s) => (s.ok ? s.handle : null));
    assert.ok(live.every((h): h is NonNullable<typeof h> => h !== null));

    // All three run AT ONCE: each answers signal 0 now, in a group of its own.
    const pids = live.map((handle) => handle.pid);
    assert.equal(new Set(pids).size, CONCURRENT_CAPTURE_SESSIONS, "three distinct processes");
    for (const handle of live) {
      process.kill(handle.pid, 0);
      assert.equal(handle.processGroup, handle.pid, "a process group of its own");
      assert.equal(handle.permissionMode, "workspace-write");
      assert.equal(handle.sessionId.startsWith("worker-"), true);
    }

    // All three finish, each with its reply.
    const ends = await Promise.all(live.map((handle) => handle.ended));
    for (const [index, end] of ends.entries()) {
      assert.deepEqual(
        { exitCode: end.exitCode, signal: end.signal },
        { exitCode: 0, signal: null },
        `session ${index + 1} ended cleanly; standard error: ` +
          readFileSync(live[index]!.stderrFile, "utf8").slice(0, 400),
      );
      const reply = await live[index]!.reply();
      assert.ok(
        reply.includes("DONE"),
        `session ${index + 1} replied DONE: ${reply.slice(0, 200)}`,
      );
    }

    // Each tree holds exactly its own claim file, with its own token.
    for (const [index, tree] of fixture.trees.entries()) {
      assert.deepEqual(
        readdirSync(tree).sort(),
        [`claim-${index + 1}.txt`],
        `tree ${index + 1} holds its own claim and nothing else`,
      );
      assert.equal(
        readFileSync(join(tree, `claim-${index + 1}.txt`), "utf8").trim(),
        `TOKEN-${index + 1}`,
      );
    }

    // Exactly three new session stores, one per tree, each a fresh session.
    const stores = readdirSync(join(fixture.home, "sessions")).sort();
    assert.deepEqual(
      stores,
      fixture.trees.map((tree) => sessionStoreDirectoryNameOf(tree)).sort(),
      "one store per tree, named by the tree's path, under the one home",
    );
    for (const [index, store] of stores.entries()) {
      const sessions = readdirSync(join(fixture.home, "sessions", store));
      assert.equal(sessions.length, 1, `store of tree ${index + 1} holds one fresh session`);
      assert.ok(/^session-[0-9a-f-]{36}$/.test(sessions[0] as string));
    }
  } finally {
    fixture.dispose();
  }
});
