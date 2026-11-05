/**
 * T020 — contract tests CT-100-133 and CT-100-134 for Locations of state
 * (annex B, §B.1; F100-FR-033, F100-FR-034).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  STATE_ROOTS,
  NON_STATE_PLACES,
  ROOT_NAMES,
  controlRoot,
  isInside,
  isStateRoot,
  locations,
  normaliseRoot,
  rootPlaceholders,
  rootsAreDisjoint,
  userCacheRoot,
  userConfigRoot,
  userStateRoot,
  workerRoot,
  workspacePart,
  type RootEnvironment,
} from "../src/ids/roots.ts";

const env = (over: Partial<RootEnvironment> = {}): RootEnvironment => ({
  home: "/home/someone",
  workspaceRealPath: "/repo",
  workspaceId: "ws-1",
  ...over,
});

test("CT-100-133: the worker root lies outside the workspace and outside the control plane (F100-FR-033)", () => {
  const e = env();
  const worker = workerRoot(e);
  const control = controlRoot(e).path;
  assert.ok(
    !isInside(worker, e.workspaceRealPath),
    `${worker} must lie outside ${e.workspaceRealPath}`,
  );
  assert.ok(!isInside(worker, control), `${worker} must lie outside ${control}`);
  assert.ok(rootsAreDisjoint(worker, control));
  // It lies in the user's cache directory (annex B, §B.1).
  assert.ok(isInside(worker, userCacheRoot(e)));
});

test("CT-100-133: the four roots of state and the three places that are not roots (annex B, §B.1, §B.5)", () => {
  assert.deepEqual([...STATE_ROOTS], ["user", "control", "workspace", "worker-root"]);
  assert.deepEqual([...NON_STATE_PLACES], ["temp", "package", "harness-home"]);
  assert.equal(ROOT_NAMES.length, 7);
  for (const root of STATE_ROOTS) assert.ok(isStateRoot(root));
  for (const place of NON_STATE_PLACES) assert.ok(!isStateRoot(place));
  // The four rows of the table of §B.1 name the four roots, in order.
  assert.deepEqual(
    locations.map((l) => l.root),
    ["user", "control", "workspace", "worker-root"],
  );
  // The prose forms of the `Root` column normalise to one of the seven.
  assert.equal(normaliseRoot("user (cache)"), "user");
  assert.equal(
    normaliseRoot("workspace (the working tree, outside the workspace part)"),
    "workspace",
  );
  assert.equal(
    normaliseRoot("control or a location the sandbox lets the harness write; the run never writes"),
    "control",
  );
  assert.throws(() => normaliseRoot("nowhere"), /is not one of/);
});

test("CT-100-133: the physical placeholders of the roots come from data/layout.json", () => {
  for (const key of [
    "<user-config>",
    "<user-state>",
    "<user-cache>",
    "<control>",
    "<workspace>",
    "<workspace-part>",
    "<worker-root>",
  ]) {
    assert.ok(key in rootPlaceholders, `${key} must have a row in the roots table`);
  }
  const e = env({ xdgConfigHome: "/x/config", xdgStateHome: "/x/state", xdgCacheHome: "/x/cache" });
  assert.equal(userConfigRoot(e), "/x/config/specstride");
  assert.equal(userStateRoot(e), "/x/state/specstride/user");
  assert.equal(userCacheRoot(e), "/x/cache/specstride");
  assert.equal(workspacePart(e), "/repo/.specstride");
  // The defaults of the annex when no XDG variable is set.
  const d = env();
  assert.equal(userConfigRoot(d), "/home/someone/.config/specstride");
  assert.equal(userStateRoot(d), "/home/someone/.local/state/specstride/user");
  assert.equal(userCacheRoot(d), "/home/someone/.cache/specstride");
});

test("CT-100-133: the control plane lies outside the working tree and is keyed by the workspace id (F100-FR-032)", () => {
  const a = controlRoot(env({ workspaceId: "ws-a" }));
  const b = controlRoot(env({ workspaceId: "ws-b" }));
  assert.equal(a.source, "default");
  assert.ok(!a.insideWorkingTree);
  assert.ok(a.path.endsWith("/ws-a"));
  // A mutable file is never shared between two workspaces (F100-FR-032).
  assert.notEqual(a.path, b.path);
  assert.ok(rootsAreDisjoint(a.path, b.path));
});

test("CT-100-134: the consumer may set another control root; one inside the working tree records protection=detect (F100-FR-034)", () => {
  const outside = controlRoot(env({ controlRootOverride: "/elsewhere/control" }));
  assert.equal(outside.source, "override");
  assert.equal(outside.path, "/elsewhere/control");
  assert.ok(!outside.insideWorkingTree);
  assert.ok(!outside.requiresDenyRule);
  assert.equal(outside.protection, "prevent");

  const inside = controlRoot(env({ controlRootOverride: "/repo/.control" }));
  assert.ok(inside.insideWorkingTree);
  // Accepted only together with a deny rule for the proposer's harness.
  assert.ok(inside.requiresDenyRule);
  // The run records `protection=detect` unless the harness adapter confirms.
  assert.equal(inside.protection, "detect");

  const confirmed = controlRoot(
    env({ controlRootOverride: "/repo/.control", sandboxDeniesControlPlane: true }),
  );
  assert.equal(confirmed.protection, "prevent");
});
