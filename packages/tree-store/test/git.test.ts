/**
 * T007 — THE ONE PLACE THAT STARTS GIT, with the fixed environment
 * (F143-FR-004).
 *
 * The test is written as an EXPERIMENT WITH A CONTROL. For every part of the
 * hardening it first shows, with a plain git process that carries no fixed
 * environment, that the thing being removed WAS THERE TO BE REMOVED — a
 * hostile global configuration really is read, the hook really runs, the
 * clean filter really mangles the bytes, the external difference tool really
 * starts — and only then shows that a process started by `runGit` is free of
 * it. Without the control half, every assertion here could pass on a machine
 * where none of it was ever possible.
 *
 * The control is the only place in this package that starts a process
 * without `src/git.ts`, and it lives in the test tree, never in `src/`. The
 * first case of the file asserts exactly that: no file under
 * `packages/tree-store/src/` but `git.ts` names `node:child_process`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import {
  ARGUMENTS_THE_CALLER_MAY_NOT_PASS,
  AWriteOutsideThePlaces,
  COMMANDS_THAT_WRITE_A_REPOSITORY,
  FIXED_ARGV_PREFIX,
  FIXED_COMMIT,
  FIXED_CONFIG,
  FIXED_ENVIRONMENT_VARIABLES,
  GIT,
  GIT_EXECUTABLE_VARIABLE,
  GitCallFailed,
  NEUTRAL_HOME,
  NO_OPTIONAL_LOCKS,
  PLACES_A_CALL_MAY_WRITE,
  StoreConfigurationChanged,
  THE_ONE_PLACE,
  THE_PROJECTS_REPOSITORY_IS_NEVER_WRITTEN,
  argvOf,
  commandWritesARepository,
  compareTheStoreConfigurationWithItsHash,
  fixedEnvironment,
  gitExecutable,
  gitOutput,
  hashOfBytes,
  inStore,
  initializeAWorkerRepository,
  initializeTheStore,
  placeOfThePath,
  readInDirectory,
  recordTheStoreConfiguration,
  recordedStoreConfigurationHash,
  runGit,
  storeConfigurationHash,
  storeConfigurationPath,
  theCommandOf,
  tryGit,
  tryInStore,
} from "../src/git.ts";
import { probeGit } from "../src/doctor.ts";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(PACKAGE_ROOT, "src");

/** A directory that is none of the three places the runtime owns (T046). */
const ROOT_OF_THE_TESTS = PACKAGE_ROOT;

/* ------------------------------------------------------------------ *
 * 1. One door.
 * ------------------------------------------------------------------ */

test("T007 `git.ts` is the only file of `src/` that starts a process", () => {
  const starters: string[] = [];
  for (const name of readdirSync(SRC)) {
    if (!name.endsWith(".ts")) continue;
    const content = readFileSync(join(SRC, name), "utf8");
    if (/from\s+"node:child_process"|require\("node:child_process"\)/.test(content)) {
      starters.push(name);
    }
  }
  assert.deepEqual(starters, ["git.ts"], `only the one place may start git: ${THE_ONE_PLACE}`);
  assert.equal(THE_ONE_PLACE, "packages/tree-store/src/git.ts");
  // And the doctor check of T005 reads its version THROUGH that door.
  assert.match(readFileSync(join(SRC, "doctor.ts"), "utf8"), /from "\.\/git\.ts"/);
  const observed = probeGit();
  assert.equal(observed.present, true, "git is a platform dependency of the product");
  assert.match(observed.version, /^\d+\.\d+/);
});

/* ------------------------------------------------------------------ *
 * 2. The argv and what a caller may not pass.
 * ------------------------------------------------------------------ */

test("T007 every call carries the fixed settings, and a caller may not pass its own", () => {
  assert.equal(FIXED_ARGV_PREFIX[0], NO_OPTIONAL_LOCKS);
  // The prefix is the flag and then one `-c` pair per setting.
  assert.equal(FIXED_ARGV_PREFIX.length, 1 + 2 * FIXED_CONFIG.length);
  for (const setting of FIXED_CONFIG) {
    const at = FIXED_ARGV_PREFIX.indexOf(setting);
    assert.ok(at > 0, `the prefix carries \`${setting}\``);
    assert.equal(FIXED_ARGV_PREFIX[at - 1], "-c");
  }
  // The hardening of F143-FR-004, setting by setting.
  for (const required of [
    "core.hooksPath=/dev/null",
    "core.fsmonitor=false",
    "core.autocrlf=false",
    "core.safecrlf=false",
    "core.eol=lf",
    "core.attributesFile=/dev/null",
    "diff.external=",
    "merge.default=",
  ]) {
    assert.ok(FIXED_CONFIG.includes(required), `F143-FR-004 requires \`${required}\``);
  }
  assert.deepEqual(argvOf({ argv: ["write-tree"], cwd: "/" }), [
    ...FIXED_ARGV_PREFIX,
    "write-tree",
  ]);
  for (const forbidden of ARGUMENTS_THE_CALLER_MAY_NOT_PASS) {
    assert.throws(
      () => argvOf({ argv: ["status", forbidden, "x"], cwd: "/" }),
      /belongs to the one place that starts git/,
      forbidden,
    );
  }
});

/* ------------------------------------------------------------------ *
 * 3. The environment is built from nothing but PATH.
 * ------------------------------------------------------------------ */

test("T007 the fixed environment inherits nothing but `PATH`", () => {
  const env = fixedEnvironment({
    parentEnv: {
      PATH: "/the/path",
      GIT_DIR: "/the/project/.git",
      GIT_WORK_TREE: "/the/project",
      GIT_INDEX_FILE: "/the/project/.git/index",
      GIT_CONFIG: "/hostile",
      GIT_SSH_COMMAND: "/hostile/ssh",
      HOME: "/the/real/home",
    },
  });
  assert.equal(env["PATH"], "/the/path");
  assert.deepEqual(Object.keys(env).sort(), [...FIXED_ENVIRONMENT_VARIABLES].sort());
  // A variable of the machine cannot reach the child by being inherited.
  for (const leaked of ["GIT_WORK_TREE", "GIT_CONFIG", "GIT_SSH_COMMAND"]) {
    assert.equal(leaked in env, false, `${leaked} must not be inherited`);
  }
  assert.equal(env["GIT_DIR"], undefined, "no repository unless the call names one");
  assert.equal(env["HOME"], NEUTRAL_HOME);
  assert.equal(existsSync(NEUTRAL_HOME), false, "the home of a repository process does not exist");
  assert.equal(env["GIT_CONFIG_NOSYSTEM"], "1");
  assert.equal(env["GIT_AUTHOR_DATE"], FIXED_COMMIT.date);
  assert.equal(env["GIT_COMMITTER_DATE"], FIXED_COMMIT.date);
  assert.equal(env["TZ"], "UTC");
  assert.equal(env["LC_ALL"], "C");

  // The call names the repository and the index, and only then are they set.
  const named = fixedEnvironment({ gitDir: "/store", indexFile: "/control/index" });
  assert.equal(named["GIT_DIR"], "/store");
  assert.equal(named["GIT_INDEX_FILE"], "/control/index");

  assert.equal(gitExecutable({}), GIT);
  assert.equal(
    gitExecutable({ [GIT_EXECUTABLE_VARIABLE]: "/git-floor/bin/git" }),
    "/git-floor/bin/git",
  );
});

/* ------------------------------------------------------------------ *
 * 4. The experiment: a hostile machine, with the control.
 * ------------------------------------------------------------------ */

/** A machine whose git configuration is hostile in four ways. */
function hostileMachine(): {
  readonly root: string;
  readonly home: string;
  readonly repo: string;
  readonly hookMarker: string;
  readonly diffMarker: string;
} {
  const root = mkdtempSync(join(tmpdir(), "specstride-143-t007-"));
  const home = join(root, "home");
  const hooks = join(root, "hooks");
  const repo = join(root, "repo");
  const hookMarker = join(root, "HOOK-RAN");
  const diffMarker = join(root, "DIFF-RAN");
  mkdirSync(home, { recursive: true });
  mkdirSync(hooks, { recursive: true });
  mkdirSync(repo, { recursive: true });

  const external = join(root, "difftool.sh");
  writeFileSync(external, `#!/bin/sh\necho ran > ${diffMarker}\n`);
  chmodSync(external, 0o755);
  const hook = join(hooks, "pre-commit");
  writeFileSync(hook, `#!/bin/sh\necho ran > ${hookMarker}\n`);
  chmodSync(hook, 0o755);

  writeFileSync(
    join(home, ".gitconfig"),
    [
      "[user]",
      "\tname = Hostile",
      "\temail = hostile@example.com",
      "[core]",
      "\tautocrlf = true",
      `\thooksPath = ${hooks}`,
      '[filter "mangle"]',
      "\tclean = sed s/a/Z/g",
      "[diff]",
      `\texternal = ${external}`,
      "",
    ].join("\n"),
  );
  return { root, home, repo, hookMarker, diffMarker };
}

/**
 * THE CONTROL: a git process with no fixed environment at all. It exists to
 * show that the hostile configuration is really read. Nothing of `src/` ever
 * does this.
 */
function control(argv: readonly string[], cwd: string, home: string): string {
  const r = spawnSync(GIT, [...argv], {
    cwd,
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: home, LC_ALL: "C" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return String(r.stdout ?? "");
}

test("T007 the hostile global configuration is read by a plain process and NOT by `runGit`", () => {
  const m = hostileMachine();
  try {
    runGit({ argv: ["init", "--quiet", m.repo], cwd: m.root });

    // The control: six settings of the hostile home are in force.
    const seen = control(["config", "--list", "--show-origin"], m.repo, m.home);
    assert.ok(seen.includes(join(m.home, ".gitconfig")), "the control reads the hostile home");
    assert.match(seen, /user\.name=Hostile/);
    assert.match(seen, /core\.autocrlf=true/);

    // The one door: no system configuration, no global configuration.
    const fixed = runGit({ argv: ["config", "--list", "--show-origin"], cwd: m.repo }).stdout;
    assert.equal(fixed.includes(m.home), false, "no global configuration is read");
    assert.equal(/user\.name=Hostile/.test(fixed), false);
    assert.equal(/core\.autocrlf=true/.test(fixed), false);
    // The settings that ARE in force came from the command line, not a file.
    assert.match(fixed, /command line:\s+core\.hookspath=\/dev\/null/);
    assert.match(fixed, /command line:\s+core\.autocrlf=false/);
    assert.match(fixed, /command line:\s+core\.fsmonitor=false/);
  } finally {
    rmSync(m.root, { recursive: true, force: true });
  }
});

test("T007 the hook runs under the control and never under `runGit`", () => {
  const m = hostileMachine();
  try {
    runGit({ argv: ["init", "--quiet", m.repo], cwd: m.root });
    writeFileSync(join(m.repo, "f.txt"), "aaa\n");

    // The control commits and the pre-commit hook of the hostile home runs.
    control(["add", "f.txt"], m.repo, m.home);
    control(["-c", "user.name=H", "-c", "user.email=h@x", "commit", "-m", "one"], m.repo, m.home);
    assert.equal(existsSync(m.hookMarker), true, "the control shows the hook was there to run");

    rmSync(m.hookMarker, { force: true });
    writeFileSync(join(m.repo, "f.txt"), "bbb\n");
    runGit({ argv: ["commit", "-a", "-q", "-m", FIXED_COMMIT.message], cwd: m.repo });
    assert.equal(existsSync(m.hookMarker), false, "hooks are off (F143-FR-004)");

    // And the commit carries the fixed author, date and message.
    const line = gitOutput({
      argv: ["log", "-1", "--format=%an <%ae>%n%aI%n%at%n%s"],
      cwd: m.repo,
    });
    const [author, iso, unix, subject] = line.split("\n");
    assert.equal(author, FIXED_COMMIT.author);
    assert.ok(
      (FIXED_COMMIT.datesAsGitPrintsThem as readonly string[]).includes(String(iso)),
      `the fixed instant, however this git renders it: ${String(iso)}`,
    );
    assert.equal(unix, FIXED_COMMIT.unixTime);
    assert.equal(subject, FIXED_COMMIT.message);
  } finally {
    rmSync(m.root, { recursive: true, force: true });
  }
});

test("T007 the clean filter mangles the bytes under the control and never under `runGit`", () => {
  const m = hostileMachine();
  try {
    runGit({ argv: ["init", "--quiet", m.repo], cwd: m.root });
    const bytes = Buffer.from("aaa\n");
    writeFileSync(join(m.repo, "f.txt"), bytes);
    writeFileSync(join(m.repo, ".gitattributes"), "* filter=mangle text eol=crlf\n");

    // The object id of the bytes as they are on disk, computed here.
    const raw = createHash("sha1")
      .update(Buffer.concat([Buffer.from(`blob ${String(bytes.length)}\0`), bytes]))
      .digest("hex");

    // The control: the filter of the hostile home runs and the object differs.
    const mangled = control(["hash-object", "--path", "f.txt", "f.txt"], m.repo, m.home).trim();
    assert.notEqual(mangled, raw, "the control shows the filter was there to run");

    // The one door: a snapshot stores THE BYTES ON DISK (F143-FR-004).
    const stored = gitOutput({
      argv: ["hash-object", "--no-filters", "--stdin"],
      cwd: m.repo,
      stdin: bytes,
    });
    assert.equal(stored, raw);
    // And even with the path named, no filter and no conversion takes place.
    const byPath = gitOutput({ argv: ["hash-object", "--path", "f.txt", "f.txt"], cwd: m.repo });
    assert.equal(byPath, raw, "no filter, no text conversion (F143-FR-004)");
  } finally {
    rmSync(m.root, { recursive: true, force: true });
  }
});

test("T007 the external difference tool starts under the control and never under `runGit`", () => {
  const m = hostileMachine();
  try {
    runGit({ argv: ["init", "--quiet", m.repo], cwd: m.repo });
    writeFileSync(join(m.repo, "f.txt"), "aaa\n");
    runGit({ argv: ["add", "f.txt"], cwd: m.repo });
    runGit({ argv: ["commit", "-q", "-m", FIXED_COMMIT.message], cwd: m.repo });
    writeFileSync(join(m.repo, "f.txt"), "bbb\n");

    // The control: the tool of the hostile home starts.
    control(["diff"], m.repo, m.home);
    assert.equal(existsSync(m.diffMarker), true, "the control shows the tool was there to start");

    // The one door, FAIL CLOSED. `diff.external=` is carried as an empty
    // setting, which is stronger than leaving it unset: a patch that would
    // have started an external tool — one named by a repository's OWN
    // configuration, the one source the removal of the system and global
    // configuration cannot reach — is refused with a non-zero exit instead,
    // and no process is started. The store never needs a patch (research.md
    // D-4: it writes the bytes of stored objects and never applies one).
    rmSync(m.diffMarker, { force: true });
    runGit({ argv: ["config", "diff.external", join(m.root, "difftool.sh")], cwd: m.repo });
    const asControl = control(["diff"], m.repo, m.home);
    assert.equal(existsSync(m.diffMarker), true, `the local setting is live: ${asControl}`);

    rmSync(m.diffMarker, { force: true });
    const refused = tryGit({ argv: ["diff"], cwd: m.repo });
    assert.equal(existsSync(m.diffMarker), false, "no external difference tool (F143-FR-004)");
    assert.notEqual(refused.status, 0, "a patch that wanted the tool is refused, not produced");

    // And what the store actually reads — the plumbing that names changed
    // paths, with no patch — is unaffected and starts nothing.
    const names = runGit({
      argv: ["diff-tree", "-r", "--name-status", "HEAD", "HEAD"],
      cwd: m.repo,
    });
    assert.equal(names.status, 0);
    assert.equal(existsSync(m.diffMarker), false);
  } finally {
    rmSync(m.root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * 5. Failures.
 * ------------------------------------------------------------------ */

test("T007 a failure to start and a non-zero exit are reported, and may be asked for", () => {
  const absent = tryGit({
    argv: ["--version"],
    cwd: process.cwd(),
    executable: "/nonexistent/git-that-is-not-installed",
  });
  assert.equal(absent.started, false);
  assert.ok(absent.error.length > 0);
  assert.throws(
    () =>
      runGit({
        argv: ["--version"],
        cwd: process.cwd(),
        executable: "/nonexistent/git-that-is-not-installed",
      }),
    GitCallFailed,
  );

  const root = mkdtempSync(join(tmpdir(), "specstride-143-t007-fail-"));
  try {
    const bad = tryGit({ argv: ["cat-file", "-e", "0".repeat(40)], cwd: root });
    assert.equal(bad.started, true);
    assert.notEqual(bad.status, 0);
    assert.throws(
      () => runGit({ argv: ["cat-file", "-e", "0".repeat(40)], cwd: root }),
      GitCallFailed,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * T046 — the doors, and the one `init` (F143-FR-002).
 * ------------------------------------------------------------------ */

test("T046 no file of `src/` but `git.ts` names `runGit` or `tryGit`: the doors are the only way out", () => {
  const callers: string[] = [];
  for (const name of readdirSync(SRC)) {
    if (!name.endsWith(".ts") || name === "git.ts") continue;
    const content = readFileSync(join(SRC, name), "utf8");
    // The `index.ts` of the package RE-EXPORTS the two names, which is not
    // calling them; a call names them outside an export list.
    const withoutExports = content.replace(/export\s*\{[^}]*\}\s*from\s*"[^"]*";/g, "");
    if (/\b(runGit|tryGit)\s*\(/.test(withoutExports)) callers.push(name);
  }
  assert.deepEqual(
    callers,
    [],
    "every call of this package goes through `inStore`, `tryInStore`, `readInDirectory`, " +
      "`initializeARepositoryOfTheRuntime` or `theVersionOnly` (F143-FR-002, T046)",
  );
});

test("T046 `readInDirectory` refuses every command that can write a repository (F143-FR-002)", () => {
  const places = {
    store: join(ROOT_OF_THE_TESTS, "store"),
    workerRoot: join(ROOT_OF_THE_TESTS, "worker-root"),
    control: ROOT_OF_THE_TESTS,
  };
  for (const command of COMMANDS_THAT_WRITE_A_REPOSITORY) {
    assert.equal(commandWritesARepository([command]), true, `${command} can write`);
    assert.throws(
      () => readInDirectory(places, ROOT_OF_THE_TESTS, [command]),
      AWriteOutsideThePlaces,
      `\`git ${command}\` is refused by \`readInDirectory\``,
    );
    // And it is refused BEFORE the process: no `git` was started at all, so
    // even a command that does not exist in this git is refused the same way.
    assert.throws(
      () => readInDirectory(places, ROOT_OF_THE_TESTS, ["--quiet", command, "--whatever"]),
      AWriteOutsideThePlaces,
    );
  }
  assert.equal(theCommandOf(["-c", "x=y"]), "x=y");
  assert.equal(theCommandOf([]), "");
  assert.equal(commandWritesARepository(["ls-tree", "-r"]), false);
  assert.equal(commandWritesARepository(["rev-list", "--all"]), false);
  assert.equal(commandWritesARepository(["check-ignore", "--stdin"]), false);
});

test("T046 the place of a path is one of the three the runtime owns, or `somewhere else` (F143-FR-002)", () => {
  const places = {
    store: join(ROOT_OF_THE_TESTS, "control", "tree-store"),
    workerRoot: join(ROOT_OF_THE_TESTS, "worker-root"),
    control: join(ROOT_OF_THE_TESTS, "control"),
  };
  assert.deepEqual([...PLACES_A_CALL_MAY_WRITE], ["tree-store", "worker-root", "control"]);
  assert.equal(placeOfThePath(places, places.store), "tree-store");
  assert.equal(placeOfThePath(places, join(places.store, "objects", "ab")), "tree-store");
  assert.equal(placeOfThePath(places, join(places.workerRoot, "x", "tree")), "worker-root");
  assert.equal(placeOfThePath(places, places.control), "control");
  assert.equal(placeOfThePath(places, join(places.control, "ignore-rules", "abc")), "control");
  assert.equal(placeOfThePath(places, "/tmp"), "somewhere else");
  assert.equal(
    placeOfThePath(places, join(ROOT_OF_THE_TESTS, "workspace", ".git")),
    "somewhere else",
  );
  // The store lies INSIDE the control plane, and the narrower place wins, so
  // a call for the store is never mistaken for a call for the control plane.
  assert.equal(THE_PROJECTS_REPOSITORY_IS_NEVER_WRITTEN, true);
});

/* ------------------------------------------------------------------ *
 * T048 — the configuration of the store and its hash (F143-FR-004).
 * ------------------------------------------------------------------ */

test("T048 the hash of the configuration of the store is recorded and compared (F143-FR-004)", () => {
  const root = mkdtempSync(join(tmpdir(), "specstride-143-t048-"));
  try {
    const places = {
      store: join(root, "control", "tree-store"),
      workerRoot: join(root, "worker-root"),
      control: join(root, "control"),
    };
    mkdirSync(places.control, { recursive: true });
    mkdirSync(places.workerRoot, { recursive: true });

    // Before the store exists nothing is recorded and nothing is compared.
    assert.equal(recordedStoreConfigurationHash(places), "");
    assert.equal(storeConfigurationHash(places), "");
    assert.deepEqual(
      { ...compareTheStoreConfigurationWithItsHash(places) },
      {
        recorded: "",
        found: "",
        equal: true,
        compared: false,
      },
    );

    // `initializeTheStore` makes it AND records the hash.
    initializeTheStore(places);
    const recorded = recordedStoreConfigurationHash(places);
    assert.match(recorded, /^[0-9a-f]{64}$/);
    assert.equal(recorded, storeConfigurationHash(places));
    assert.equal(
      recorded,
      createHash("sha256")
        .update(readFileSync(storeConfigurationPath(places)))
        .digest("hex"),
    );
    assert.equal(compareTheStoreConfigurationWithItsHash(places).compared, true);
    assert.equal(inStore(places, ["rev-parse", "--is-bare-repository"]).stdout.trim(), "true");

    // One byte changed and every door refuses.
    writeFileSync(storeConfigurationPath(places), "\n", { flag: "a" });
    assert.throws(() => compareTheStoreConfigurationWithItsHash(places), StoreConfigurationChanged);
    assert.throws(
      () => inStore(places, ["rev-parse", "--is-bare-repository"]),
      StoreConfigurationChanged,
    );
    assert.throws(() => tryInStore(places, ["cat-file", "-e", "HEAD"]), StoreConfigurationChanged);
    assert.throws(() => readInDirectory(places, root, ["ls-files"]), StoreConfigurationChanged);
    assert.throws(
      () => initializeAWorkerRepository(places, join(places.workerRoot, "w")),
      StoreConfigurationChanged,
    );

    // Recorded again, and the doors open again.
    recordTheStoreConfiguration(places);
    assert.equal(inStore(places, ["rev-parse", "--is-bare-repository"]).stdout.trim(), "true");
    assert.equal(hashOfBytes(Buffer.from("")), createHash("sha256").update("").digest("hex"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
