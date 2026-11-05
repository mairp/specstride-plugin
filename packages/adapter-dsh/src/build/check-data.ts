/**
 * T007 — the build check of the data of the dsh adapter.
 *
 * Run with `npm run check:data --workspace @specstride/adapter-dsh`. It reads
 * every file of `packages/adapter-dsh/data/` and validates it against the
 * schemas and closed sets of `@specstride/contracts`:
 *
 *   descriptor-dsh.json      the harness descriptor schema
 *                            `specstride.harness/1:descriptor` (annex C §C.2),
 *                            through `readHarnessDescriptor`
 *   classifier-entries.json  every class against `EP-12` `CLASSES`, every
 *                            confidence against `CONFIDENCES`, the no-match
 *                            class against `CLASS_WHEN_UNKNOWN` (§C.13)
 *   critic-patch.json        the deny list: 18 entries, each an `id` and a
 *                            `group`, the pin stated
 *   argument-table.json      the uses of the harness: one argument list per
 *                            use, the bounds whole numbers, the permission
 *                            modes from the argument table of plan.md
 *
 * A refusal prints the file and the reason and exits 1, so `npm run build`
 * and the gate fail on data that drifted from the contracts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { harnessDescriptor as schema, epQuotaClassifier } from "@specstride/contracts";

export const DATA = fileURLToPath(new URL("../../data/", import.meta.url));
const PIN = "0.1.0-rc.8";

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(`${DATA}${name}`, "utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type CheckDataResult = {
  readonly failures: readonly string[];
  readonly checked: readonly string[];
};

export function checkData(): CheckDataResult {
  const failures: string[] = [];
  const checked: string[] = [];
  // --- descriptor-dsh.json — the schema of the contracts package -------------
  const rawDescriptor = readJson("descriptor-dsh.json");
  const descriptor = schema.readHarnessDescriptor(rawDescriptor); // throws on refusal
  if (descriptor.id !== "dsh")
    failures.push(`descriptor-dsh.json: id is ${descriptor.id}, expected dsh`);
  if (descriptor.kind !== schema.CLI_KIND)
    failures.push(`descriptor-dsh.json: kind is ${descriptor.kind}, expected ${schema.CLI_KIND}`);
  const containment = (rawDescriptor as { containment?: Record<string, unknown> }).containment;
  if (!isRecord(containment) || containment["ceiling"] !== "C1")
    failures.push("descriptor-dsh.json: the containment ceiling is not C1");
  if (!isRecord(containment) || containment["provenance"] !== "adapter")
    failures.push("descriptor-dsh.json: the ceiling carries no provenance adapter");
  if (schema.parseCeiling(`C1(${String(containment?.["provenance"])})`)?.level !== "C1")
    failures.push("descriptor-dsh.json: the ceiling is not a containment level of the contracts");
  checked.push("descriptor-dsh.json: specstride.harness/1:descriptor (annex C §C.2) accepted");

  // --- classifier-entries.json — the EP-12 closed sets -----------------------
  const classifier = readJson("classifier-entries.json");
  if (!isRecord(classifier) || !Array.isArray(classifier.entries)) {
    failures.push("classifier-entries.json: no entries array");
  } else {
    const classes = new Set<string>(epQuotaClassifier.CLASSES);
    const confidences = new Set<string>(epQuotaClassifier.CONFIDENCES);
    for (const [index, entry] of (classifier.entries as unknown[]).entries()) {
      if (!isRecord(entry)) {
        failures.push(`classifier-entries.json: entry ${index} is no record`);
        continue;
      }
      if (!classes.has(String(entry["class"])))
        failures.push(
          `classifier-entries.json: entry ${index} class ${String(entry["class"])} is no class of EP-12`,
        );
      if (typeof entry["code"] !== "string" || entry["code"] === "")
        failures.push(`classifier-entries.json: entry ${index} has no code of the harness`);
      if (!confidences.has(String(entry["confidence"])))
        failures.push(
          `classifier-entries.json: entry ${index} confidence ${String(entry["confidence"])} is no confidence of EP-12`,
        );
    }
    const noMatch = classifier["noMatch"];
    if (!isRecord(noMatch) || noMatch["class"] !== epQuotaClassifier.CLASS_WHEN_UNKNOWN) {
      failures.push(
        `classifier-entries.json: noMatch.class is not ${epQuotaClassifier.CLASS_WHEN_UNKNOWN}`,
      );
    }
    if (classifier["pin"] !== PIN) failures.push("classifier-entries.json: the pin is not stated");
    checked.push(
      `classifier-entries.json: ${(classifier.entries as unknown[]).length} entries against EP-12 CLASSES/CONFIDENCES`,
    );
  }

  // --- critic-patch.json — the deny list -------------------------------------
  const patch = readJson("critic-patch.json");
  if (!isRecord(patch) || !Array.isArray(patch["disabled"])) {
    failures.push("critic-patch.json: no disabled array");
  } else {
    const ids = new Set<string>();
    for (const [index, entry] of (patch["disabled"] as unknown[]).entries()) {
      if (!isRecord(entry) || typeof entry["id"] !== "string" || entry["id"] === "") {
        failures.push(`critic-patch.json: entry ${index} has no id`);
        continue;
      }
      if (typeof entry["group"] !== "string" || entry["group"] === "")
        failures.push(`critic-patch.json: entry ${entry["id"]} has no group`);
      if (ids.has(entry["id"]))
        failures.push(`critic-patch.json: the id ${entry["id"]} appears twice`);
      ids.add(entry["id"]);
    }
    if (ids.size !== 18)
      failures.push(`critic-patch.json: ${ids.size} entries, the deny list of the baseline has 18`);
    if (patch["pin"] !== PIN) failures.push("critic-patch.json: the pin is not stated");
    checked.push(`critic-patch.json: ${ids.size} tool ids, each with id and group`);
  }

  // --- argument-table.json — the uses of the harness --------------------------
  const table = readJson("argument-table.json");
  if (!isRecord(table)) {
    failures.push("argument-table.json: no record");
  } else {
    const roles = table["roles"];
    if (!isRecord(roles) || !isRecord(roles["proposer"]) || !isRecord(roles["critic"]))
      failures.push("argument-table.json: no proposer and critic uses");
    else {
      for (const role of ["proposer", "critic"] as const) {
        const use = roles[role] as Record<string, unknown>;
        if (!Array.isArray(use["argv"]) || (use["argv"] as unknown[]).length === 0)
          failures.push(`argument-table.json: the ${role} use has no argument list`);
      }
      const proposer = roles["proposer"] as Record<string, unknown>;
      if (proposer["promptLimitBytes"] !== 122880)
        failures.push("argument-table.json: the proposer prompt bound is not 122880");
      const permission = isRecord(proposer["permissionMode"])
        ? proposer["permissionMode"]
        : undefined;
      if (!permission || permission["default"] !== "workspace-write")
        failures.push("argument-table.json: the default permission mode is not workspace-write");
    }
    if (table["pin"] !== PIN) failures.push("argument-table.json: the pin is not stated");
    checked.push(
      "argument-table.json: proposer and critic uses, the 120 KiB bound, the permission mode",
    );
  }

  return { failures, checked };
}

function main(): void {
  const { failures, checked } = checkData();
  if (failures.length > 0) {
    console.error("check:data refused the data of @specstride/adapter-dsh:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  for (const line of checked) console.log(`ok ${line}`);
  console.log("check:data: the four data files match the schemas of @specstride/contracts");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main();
}
