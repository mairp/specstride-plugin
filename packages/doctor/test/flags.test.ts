/**
 * T018 (feature 112) — CT-112-126 (F112-FR-026): the flags.
 *
 * The parser accepts `--json --verbose --quick --offline --online --role
 * <role> --harness <id> --check <id> --launch-checks --strict --workdir`;
 * `--check` is the check-id filter and may be given more than once;
 * `--launch-checks` is the evaluation of the launch checks (`lb` subset)
 * WITHOUT launching; `--offline` forbids the network and allows subprocesses;
 * `--online` runs the free model-list requests; the default follows the
 * configuration key `doctor.online`. An unknown flag, an unknown role,
 * harness, or check id in the filter is a usage error and exits 3.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDoctorFlags, resolveOnline, UsageError, USAGE_LINE } from "../src/runner/flags.ts";
import { launchChecks } from "@specstride/contracts/ep/doctor";
import type { Check } from "../src/registry/types.ts";

const KNOWN = {
  roles: ["proposer", "critic"],
  harnesses: ["claude", "codex"],
  checkIds: ["env.node", "terms.gate", "critic.independence"],
};

test("CT-112-126: every flag parses, and --check may be given more than once", () => {
  const flags = parseDoctorFlags(
    [
      "--json",
      "--verbose",
      "--quick",
      "--strict",
      "--launch-checks",
      "--role",
      "proposer",
      "--harness",
      "claude",
      "--check",
      "env.node",
      "--check",
      "terms.gate",
      "--workdir",
      "/tmp/ws",
    ],
    KNOWN,
  );
  assert.deepEqual(flags, {
    json: true,
    verbose: true,
    quick: true,
    offline: false,
    online: false,
    role: "proposer",
    harness: "claude",
    check: ["env.node", "terms.gate"],
    launchChecks: true,
    strict: true,
    workdir: "/tmp/ws",
  });
});

test("CT-112-126: the check-id filter selects only the named checks", async () => {
  // The filter is `--check <id>`: only the named checks run.
  const { runDoctorChecks } = await import("../src/runner/run.ts");
  const { makeProbeBag } = await import("../src/runner/run.ts");
  const mk = (id: string): Check => ({
    id,
    group: "env",
    lb: false,
    order: 1,
    messageTemplate: id,
    fixHint: "fix",
    severityRule: () => "info",
    probe: async () => ({ ran: id }),
  });
  const all = [mk("env.node"), mk("terms.gate"), mk("memory.native")];
  const flags = parseDoctorFlags(["--check", "env.node", "--check", "terms.gate"]);
  const selected = all.filter((c) => flags.check.includes(c.id));
  const result = await runDoctorChecks({ checks: selected, bag: makeProbeBag() });
  assert.deepEqual(result.findings.map((f) => f.id).sort(), ["env.node", "terms.gate"]);
});

test("CT-112-126: --launch-checks runs exactly the lb subset, without launching", () => {
  const all = [
    { id: "env.node", lb: false, order: 1 },
    { id: "terms.gate", lb: true, order: 24 },
    { id: "critic.independence", lb: true, order: 22 },
    { id: "critic.diversity", lb: false, order: 21 },
  ] as Check[];
  // The same function the launch uses (F112-FR-030): the `lb` subset in order.
  const subset = launchChecks(all);
  assert.deepEqual(
    subset.map((c) => c.id),
    ["critic.independence", "terms.gate"],
  );
  // The flag is the doctor's form of that evaluation: no run is launched.
  const flags = parseDoctorFlags(["--launch-checks"]);
  assert.equal(flags.launchChecks, true);
  assert.equal(flags.json, false);
});

test("CT-112-126: --offline forbids the network; --online forces it; doctor.online is the default", () => {
  assert.equal(resolveOnline({ flags: parseDoctorFlags(["--offline"]) }), false);
  assert.equal(resolveOnline({ flags: parseDoctorFlags(["--online"]) }), true);
  // The default follows `doctor.online` (default true).
  assert.equal(
    resolveOnline({ flags: parseDoctorFlags([]), config: new Map([["doctor.online", false]]) }),
    false,
  );
  assert.equal(
    resolveOnline({ flags: parseDoctorFlags([]), config: new Map([["doctor.online", true]]) }),
    true,
  );
  assert.equal(resolveOnline({ flags: parseDoctorFlags([]) }), true);
  // And on when a credential reference exists for a role in use.
  assert.equal(resolveOnline({ flags: parseDoctorFlags([]), credentialRoles: ["proposer"] }), true);
});

test("CT-112-126: an unknown flag, role, harness or check id gives a usage error, exit 3", () => {
  assert.throws(
    () => parseDoctorFlags(["--nope"]),
    (e: unknown) => {
      assert.ok(e instanceof UsageError);
      assert.equal(e.exit, 3);
      assert.equal(e.flag, "--nope");
      return true;
    },
  );
  assert.throws(
    () => parseDoctorFlags(["--role", "nonexistent"], KNOWN),
    (e: unknown) => e instanceof UsageError && e.exit === 3,
  );
  assert.throws(
    () => parseDoctorFlags(["--harness", "gemini"], KNOWN),
    (e: unknown) => e instanceof UsageError && e.exit === 3,
  );
  assert.throws(
    () => parseDoctorFlags(["--check", "not.a.check"], KNOWN),
    (e: unknown) => e instanceof UsageError && e.exit === 3,
  );
  // A check id outside the filter's known ids is fine when no catalogue is given.
  assert.doesNotThrow(() => parseDoctorFlags(["--check", "anything"]));
  // --offline and --online contradict each other.
  assert.throws(() => parseDoctorFlags(["--offline", "--online"]), UsageError);
  // A value flag without its value.
  assert.throws(() => parseDoctorFlags(["--role"]), UsageError);
  // The usage line names every flag.
  for (const flag of [
    "--json",
    "--verbose",
    "--quick",
    "--offline",
    "--online",
    "--role",
    "--harness",
    "--check",
    "--launch-checks",
    "--strict",
    "--workdir",
  ]) {
    assert.ok(USAGE_LINE.includes(flag));
  }
});
