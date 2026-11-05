/**
 * The gate that was missing: the BUILT plugin, in an empty repository, with a
 * stub `claude`. A verb of the usage must answer, a command a shipped skill names
 * must exist, and the plugin's own CLI must carry a feature to an approved commit.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "specstride-e2e-"));
const built = join(scratch, "built");
execFileSync(process.execPath, [join(root, "scripts/build-plugin.ts"), built], { stdio: "ignore" });
const shim = join(built, "plugin", "bin", "specstride.mjs");

const bin = join(scratch, "bin");
const work = join(scratch, "work");
mkdirSync(bin);
mkdirSync(join(work, "specs", "001-one"), { recursive: true });
writeFileSync(
  join(bin, "claude"),
  `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const argv = process.argv.slice(2);
if (argv.includes("--version")) { console.log("stub"); process.exit(0); }
const prompt = fs.readFileSync(0, "utf8");
const critic = argv.includes("--max-turns");
console.log(JSON.stringify({ type: "system", subtype: "init", tools: critic ? [] : ["Read"], session_id: argv[argv.indexOf("--session-id") + 1] }));
if (critic) {
  const nonce = /VERDICT ([0-9a-f]+): APPROVED/.exec(prompt)[1];
  console.log(JSON.stringify({ type: "result", result: "VERDICT " + nonce + ": APPROVED", total_cost_usd: 0.01 }));
} else {
  const evidence = /write (\\.specstride\\S+?):/.exec(prompt)[1];
  fs.mkdirSync(path.dirname(evidence), { recursive: true });
  fs.writeFileSync(evidence, "T001 done\\n");
  fs.writeFileSync("made.txt", "work\\n");
  console.log(JSON.stringify({ type: "result", result: "ok", total_cost_usd: 0.02 }));
}
`,
);
chmodSync(join(bin, "claude"), 0o755);
writeFileSync(
  join(work, "specs", "001-one", "tasks.md"),
  "# Tasks\n\n## Phase 1: One\n\n- [ ] T001 Do it\n",
);
// The feature a launch contract is derived from: a spec, a plan with the one
// declared verification command, and the check the command runs.
writeFileSync(
  join(work, "specs", "001-one", "spec.md"),
  "# Feature Specification: One\n\n**Feature**: 001-one\n\n## User Story 1 (P1)\n\nAs a user I read `made.txt` and it holds `work`.\n\n## Requirements\n\n- **FR-001**: `made.txt` exists in the repository root and holds `work`.\n",
);
writeFileSync(
  join(work, "specs", "001-one", "plan.md"),
  "# Implementation Plan: One\n\n## Summary\n\nCreate `made.txt` and verify it with the declared verification command.\n\n## Verification\n\nThe only declared verification command, run from the repository root:\n\n```bash\nbash checks.sh\n```\n",
);
writeFileSync(
  join(work, "checks.sh"),
  "#!/usr/bin/env bash\nset -euo pipefail\ntest -f made.txt\n",
);
const env = { ...process.env, HOME: scratch, PATH: `${bin}:${process.env.PATH ?? ""}` };
const inWork = (command: string, argv: readonly string[]) =>
  spawnSync(command, [...argv], { cwd: work, env, encoding: "utf8", timeout: 60_000 });
for (const argv of [
  ["init", "-q"],
  ["config", "user.email", "t@t"],
  ["config", "user.name", "t"],
  ["add", "-A"],
  ["commit", "-qm", "init"],
]) {
  inWork("git", argv);
}
const cli = (...argv: string[]) => inWork(process.execPath, [shim, ...argv]);

// A plugin committed to the repository is what a user installs: it must run as committed.
const committed = join(root, "plugin", "bin", "specstride.mjs");
if (existsSync(committed)) {
  const tracked = execFileSync(
    "git",
    ["-C", root, "ls-files", "plugin/cli/dist/cli/specstride.mjs"],
    {
      encoding: "utf8",
    },
  );
  assert.notEqual(tracked.trim(), "", "the committed plugin must hold its CLI bundle");
  assert.equal(inWork(process.execPath, [committed, "--protocol"]).stdout.trim(), "1");
}

try {
  const help = cli("--help").stdout;
  const verbs = [...help.matchAll(/^ {2}([a-z]+) {2}/gm)].map((match) => match[1] as string);
  assert.ok(verbs.length > 5, "the usage lists the verbs");
  for (const verb of verbs.filter((name) => name !== "run" && name !== "start")) {
    const { stderr } = cli(verb, "--verbose");
    assert.doesNotMatch(
      stderr,
      /VerbNotMounted|reason="internal"/,
      `the verb ${verb} crashed: ${stderr}`,
    );
  }

  for (const name of readdirSync(join(built, "plugin", "hooks"))) {
    if (name.endsWith(".sh")) accessSync(join(built, "plugin", "hooks", name), constants.X_OK);
  }

  const skills = readFileSync(
    join(built, "plugin", "skills", "specstride-run", "SKILL.md"),
    "utf8",
  );
  // The SPECIFIED skill ships (F113-FR-002): it names the launch-contract
  // path, not the foreground `run`.
  for (const named of [
    "contract derive",
    "contract validate",
    "contract promote",
    "contract render",
    "launch",
    "wait --until-change",
  ]) {
    assert.match(skills, new RegExp(`\`${named}\``));
  }
  assert.doesNotMatch(skills, /Run `run` as a BACKGROUND command/);
  assert.equal(cli("doctor").status, 0);

  const run = cli("run");
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /DIGEST exit=0 stop=none cost_usd=0\.0300 commits_blocked=0/);
  assert.equal(inWork("git", ["rev-list", "--count", "HEAD"]).stdout.trim(), "2");
  assert.match(readFileSync(join(work, "specs", "001-one", "tasks.md"), "utf8"), /- \[x\] T001/);
  assert.match(inWork("git", ["show", "--name-only", "--format=", "HEAD"]).stdout, /made\.txt/);
  console.log("plugin e2e: passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
