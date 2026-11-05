/**
 * The test step of CI: every test file of every workspace, apart from those in
 * ci/needs-specs.txt. Each workspace runs in its own process, as under `npm test`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const excluded = new Set(
  readFileSync(join(root, "ci/needs-specs.txt"), "utf8")
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#")),
);
const workspaces = ["packages", "tools"].flatMap((group) =>
  globSync(`${group}/*/package.json`, { cwd: root }).map((file) => dirname(file)),
);

let failed = 0;
for (const workspace of workspaces.sort()) {
  const manifest = JSON.parse(readFileSync(join(root, workspace, "package.json"), "utf8"));
  if (manifest.scripts?.test === undefined) continue;
  const files = globSync("**/*.test.{ts,mjs}", {
    cwd: join(root, workspace),
    exclude: (name) => name === "node_modules" || name === ".build" || name === "fixtures",
  }).filter((file) => !excluded.has(join(workspace, file)));
  if (files.length === 0) continue;
  const isolate = join(root, "tests/isolate.ts");
  const prefix = existsSync(isolate) ? [isolate, process.execPath] : [];
  const run = spawnSync(process.execPath, [...prefix, "--test", ...files], {
    cwd: join(root, workspace),
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  const notOk = run.stdout.split("\n").filter((line) => /^not ok/.test(line));
  console.log(`${workspace}: ${files.length} files, exit ${String(run.status)}`);
  for (const line of notOk) console.log(`  ${line}`);
  if (run.status !== 0) failed += 1;
}
process.exit(failed === 0 ? 0 : 1);
