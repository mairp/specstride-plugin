/**
 * T006/T007 — the descriptor of dsh, as data, read and validated.
 *
 * The JSON lives in `data/descriptor-dsh.json` (copied from
 * `specs/130-adapter-dsh/contracts/descriptor-dsh.json`, task T007). This
 * module reads it, validates it against the harness descriptor schema of
 * `@specstride/contracts` (`specstride.harness/1:descriptor`, annex C §C.2)
 * through `readHarnessDescriptor`, and exports both forms: the validated
 * record and the raw data.
 *
 * The file is read once, at module load; a refused descriptor fails fast,
 * because a descriptor that the schema of the contracts package refuses is a
 * build fault of this adapter, not a runtime condition.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { harnessDescriptor as schema } from "@specstride/contracts";

export { schema };

/** The path of the descriptor data file, next to this module's package root. */
export const DESCRIPTOR_DATA_PATH = fileURLToPath(
  new URL("../../data/descriptor-dsh.json", import.meta.url),
);

/** The raw descriptor as it stands in the data file. */
export function readRawDescriptorData(): unknown {
  return JSON.parse(readFileSync(DESCRIPTOR_DATA_PATH, "utf8"));
}

/** The descriptor, validated against annex C §C.2 by the contracts package. */
export const dshDescriptor: ReturnType<typeof schema.readHarnessDescriptor> =
  schema.readHarnessDescriptor(readRawDescriptorData());

/** The exact version pin of this adapter and the date the facts were verified. */
export const DSH_PIN = "0.1.0-rc.8" as const;
export const DSH_VERIFIED_ON = "2026-09-29" as const;
