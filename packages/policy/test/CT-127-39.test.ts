/**
 * CT-127-39 (T058) — the characterization test of the TEXT OF THE
 * ANNOUNCEMENT WITH AND WITHOUT A CAP (F127-FR-041).
 *
 * It also carries the EFFECT WITNESS of T057: the announcement is written
 * through the atomic-write port and read back through an INDEPENDENT READ PATH
 * (`readAnnouncement`), and the content hash of what was read is compared with
 * the hash of what was written — a durable identity that could not exist
 * before the write.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ANNOUNCED_AT,
  ANNOUNCEMENT_LOGICAL_NAME,
  API_KEY_IN_USE,
  API_KEY_IN_USE_WITH_A_CAP,
  API_KEY_IN_USE_WITH_NO_CAP,
  SPEND_CANNOT_BE_MEASURED,
  announce,
  announcementPath,
  announcementText,
  apiKeyLine,
  billingModeLine,
  ceilingLine,
  ceilingLines,
  fallbackLine,
  formatCap,
  readAnnouncement,
  roleLines,
  writeAnnouncement,
  type RoleAnnouncement,
} from "../src/budget/announce.ts";
import { entryOf, type RolePlan } from "../src/budget/fallback.ts";
import type { Ceiling } from "../src/budget/ceilings.ts";
import { contentHash } from "@specstride/kernel";
import { testPorts } from "./support/index.ts";

const SUBSCRIPTION = entryOf(0, {
  harness: "stub-harness",
  model: "stub-base",
  billingMode: "subscription",
});
const KEY_WITH_A_CAP = entryOf(1, {
  harness: "stub-api",
  model: "stub-metered",
  billingMode: "api",
  capUsd: 25,
});
const KEY_WITHOUT_A_CAP = entryOf(2, {
  harness: "stub-api-nocap",
  billingMode: "api",
  capUsd: null,
});

function planOf(
  primary: ReturnType<typeof entryOf>,
  entries: readonly ReturnType<typeof entryOf>[],
): RolePlan {
  return {
    role: "proposer",
    primary,
    entries,
    resolvedHarnesses: ["stub-harness", "stub-api", "stub-api-nocap"],
  };
}

const CEILINGS: readonly Ceiling[] = [
  { scope: "role", role: "proposer", dimension: "costUsd", limit: 25 },
  { scope: "run", dimension: "tokens", limit: 1_000_000 },
  { scope: "run", dimension: "calls", limit: 0 },
];

test("CT-127-39: the announcement is made at launch and at `resume`", () => {
  assert.deepEqual([...ANNOUNCED_AT], ["launch", "resume"]);
  assert.equal(ANNOUNCEMENT_LOGICAL_NAME, "run:<runId>:announcement");
  assert.equal(announcementPath("/runs/run-1", "launch"), "/runs/run-1/announcement-launch.txt");
  assert.equal(announcementPath("/runs/run-1", "resume"), "/runs/run-1/announcement-resume.txt");
});

test("CT-127-39: WITH a cap it says `API key in use, cap <value>`", () => {
  assert.equal(API_KEY_IN_USE_WITH_A_CAP, "API key in use, cap <value>");
  assert.equal(API_KEY_IN_USE, "API key in use");
  assert.equal(apiKeyLine(25), "API key in use, cap 25 USD");
  assert.equal(apiKeyLine(12.5), "API key in use, cap 12.50 USD");
  assert.equal(formatCap(25), "25 USD");
  assert.equal(formatCap(12.345), "12.35 USD");
  assert.match(apiKeyLine(25), /^API key in use, cap /);
});

test("CT-127-39: WITHOUT a cap it SAYS SO", () => {
  assert.equal(API_KEY_IN_USE_WITH_NO_CAP, "API key in use, no cap set");
  assert.equal(apiKeyLine(null), "API key in use, no cap set");
  assert.match(apiKeyLine(null), /^API key in use/, "it still names the key");
  assert.match(apiKeyLine(null), /no cap set/);
});

test("CT-127-39: a role on an API key is announced with its cap", () => {
  const role: RoleAnnouncement = {
    role: "proposer",
    plan: planOf(KEY_WITH_A_CAP, []),
    ceilings: CEILINGS,
  };
  const lines = roleLines(role);
  assert.equal(lines[0], "proposer: stub-api/stub-metered — API key in use, cap 25 USD");
  assert.equal(
    lines[1],
    "  ceilings in force: budget.role.proposer.costUsd = 25, budget.run.tokens = 1000000",
  );
  assert.equal(lines[2], "  fallback: off");
});

test("CT-127-39: a role on an API key with NO cap says so in the same place", () => {
  const role: RoleAnnouncement = {
    role: "proposer",
    plan: planOf(KEY_WITHOUT_A_CAP, []),
    ceilings: [],
  };
  const lines = roleLines(role);
  assert.equal(lines[0], "proposer: stub-api-nocap — API key in use, no cap set");
  assert.equal(lines[1], "  ceilings in force: none");
});

test("CT-127-39: a configured cap counts as the role's cap", () => {
  const role: RoleAnnouncement = {
    role: "proposer",
    plan: planOf(KEY_WITHOUT_A_CAP, []),
    ceilings: [],
    configuredCapUsd: 40,
  };
  assert.equal(roleLines(role)[0], "proposer: stub-api-nocap — API key in use, cap 40 USD");
});

test("CT-127-39: a subscription and an unknown billing mode have their own lines", () => {
  assert.match(billingModeLine("subscription"), /^subscription in use/);
  assert.match(billingModeLine("subscription"), /observed by Specstride only/);
  assert.match(billingModeLine("unknown"), /^billing mode unknown/);
  const role: RoleAnnouncement = {
    role: "proposer",
    plan: planOf(SUBSCRIPTION, []),
    ceilings: [],
  };
  assert.match(roleLines(role)[0], /^proposer: stub-harness\/stub-base — subscription in use/);
});

test("CT-127-39: the ceilings in force are listed, and an off ceiling is not", () => {
  assert.equal(ceilingLine(CEILINGS[0]), "budget.role.proposer.costUsd = 25");
  assert.equal(ceilingLine(CEILINGS[2]), null, "a ceiling of 0 is off");
  assert.equal(ceilingLine({ scope: "run", dimension: "tokens", limit: null }), null);
  assert.equal(
    ceilingLine({ scope: "run", dimension: "wallClock", limit: 60 }),
    "loop.maxWallMin = 60",
  );
  assert.deepEqual(
    [...ceilingLines(CEILINGS)],
    ["budget.role.proposer.costUsd = 25", "budget.run.tokens = 1000000"],
  );
});

test("CT-127-39: every fallback entry is announced with its billing mode and cap", () => {
  assert.equal(
    fallbackLine(KEY_WITH_A_CAP),
    "  fallback 1: stub-api/stub-metered (api), cap 25 USD",
  );
  assert.equal(
    fallbackLine(KEY_WITHOUT_A_CAP),
    "  fallback 2: stub-api-nocap (api), no cap set (it will be skipped)",
  );
  assert.equal(
    fallbackLine(entryOf(3, { harness: "stub-two", billingMode: "subscription" })),
    "  fallback 3: stub-two (subscription)",
  );
});

test("CT-127-39: a role whose spend cannot be measured is named", () => {
  assert.match(SPEND_CANNOT_BE_MEASURED, /spend cannot be measured/);
  assert.match(SPEND_CANNOT_BE_MEASURED, /wallClock, phaseAttempts and calls ceilings still apply/);
  const announcement = announce({
    at: "launch",
    roles: [
      {
        role: "proposer",
        plan: planOf(SUBSCRIPTION, []),
        ceilings: [],
        spendUnmeasurable: true,
      },
    ],
  });
  assert.deepEqual([...announcement.unmeasurable], ["proposer"]);
  assert.ok(announcement.lines.some((line) => line.includes("spend cannot be measured")));
});

test("CT-127-39: the whole announcement at launch, with a cap and a fallback list", () => {
  const announcement = announce({
    at: "launch",
    roles: [
      {
        role: "proposer",
        plan: planOf(SUBSCRIPTION, [KEY_WITH_A_CAP, KEY_WITHOUT_A_CAP]),
        ceilings: CEILINGS,
      },
    ],
    openLoudAlerts: ["billing-mode-change:proposer:-"],
  });
  assert.deepEqual(
    [...announcement.lines],
    [
      "Budgets and billing at launch:",
      "proposer: stub-harness/stub-base — subscription in use, spend is notional and observed by Specstride only",
      "  ceilings in force: budget.role.proposer.costUsd = 25, budget.run.tokens = 1000000",
      "  fallback 1: stub-api/stub-metered (api), cap 25 USD",
      "  fallback 2: stub-api-nocap (api), no cap set (it will be skipped)",
      "  loud alert still open: billing-mode-change:proposer:-",
    ],
  );
  assert.deepEqual([...announcement.onAnApiKey], []);
});

test("CT-127-39: at `resume` the same facts are announced, and a key is named with its cap", () => {
  const announcement = announce({
    at: "resume",
    roles: [
      {
        role: "proposer",
        plan: planOf(KEY_WITH_A_CAP, [KEY_WITHOUT_A_CAP]),
        ceilings: CEILINGS,
      },
    ],
  });
  assert.equal(announcement.at, "resume");
  assert.equal(announcement.lines[0], "Budgets and billing at resume:");
  assert.match(announcement.lines[1], /API key in use, cap 25 USD/);
  assert.deepEqual([...announcement.onAnApiKey], [{ role: "proposer", capUsd: 25 }]);
});

test("CT-127-39: the announcement is DURABLE, and reads back the same through an independent path", () => {
  const ports = testPorts();
  const announcement = announce({
    at: "launch",
    roles: [
      { role: "proposer", plan: planOf(KEY_WITH_A_CAP, [KEY_WITHOUT_A_CAP]), ceilings: CEILINGS },
      { role: "critic", plan: planOf(SUBSCRIPTION, []), ceilings: [], spendUnmeasurable: true },
    ],
  });
  const path = announcementPath("/runs/run-1", "launch");
  assert.equal(ports.fileWriter.exists(path), false, "nothing is there before the write");

  const written = writeAnnouncement(ports.fileWriter, path, announcement);
  assert.equal(written.path, path);
  assert.equal(written.at, "launch");
  assert.equal(written.lineCount, announcement.lines.length);

  // The independent read path: the file, not the value the writer answered.
  const read = readAnnouncement(ports.fileWriter, path);
  assert.notEqual(read, null);
  assert.equal(read?.contentHash, written.contentHash, "the durable identity of the record");
  assert.equal(read?.contentHash, contentHash(announcementText(announcement)));
  assert.equal(read?.text, announcementText(announcement));
  assert.deepEqual([...(read?.lines ?? [])], [...announcement.lines]);
  // And the content really is on disk, under the path the layout names.
  assert.equal(ports.fileWriter.exists(path), true);
  assert.deepEqual([...ports.fileWriter.paths()], [path]);
  assert.equal(ports.fileWriter.writes.length, 1);
  assert.equal(ports.fileWriter.writes[0].path, path);
  assert.match(ports.fileWriter.writes[0].content, /API key in use, cap 25 USD/);
  assert.match(ports.fileWriter.writes[0].content, /spend cannot be measured/);
});

test("CT-127-39: a path that holds nothing reads as nothing, not as an empty announcement", () => {
  const ports = testPorts();
  assert.equal(readAnnouncement(ports.fileWriter, "/runs/run-1/announcement-resume.txt"), null);
});

test("CT-127-39: the two announcements of one run are separate records", () => {
  const ports = testPorts();
  const roles = [{ role: "proposer", plan: planOf(KEY_WITH_A_CAP, []), ceilings: CEILINGS }];
  const atLaunch = writeAnnouncement(
    ports.fileWriter,
    announcementPath("/runs/run-1", "launch"),
    announce({ at: "launch", roles }),
  );
  const atResume = writeAnnouncement(
    ports.fileWriter,
    announcementPath("/runs/run-1", "resume"),
    announce({ at: "resume", roles }),
  );
  assert.notEqual(atLaunch.contentHash, atResume.contentHash, "the moment is part of the text");
  assert.equal(ports.fileWriter.paths().length, 2);
  assert.match(
    readAnnouncement(ports.fileWriter, atResume.path)?.text ?? "",
    /^Budgets and billing at resume:/,
  );
});

test("CT-127-39: the text ends with one newline, so a CLI prints it as it is", () => {
  const announcement = announce({
    at: "launch",
    roles: [{ role: "proposer", plan: planOf(SUBSCRIPTION, []), ceilings: [] }],
  });
  const text = announcementText(announcement);
  assert.ok(text.endsWith("\n"));
  assert.ok(!text.endsWith("\n\n"));
  assert.equal(
    text.split("\n").filter((line) => line.length > 0).length,
    announcement.lines.length,
  );
});
