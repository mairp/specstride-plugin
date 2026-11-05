# `@specstride/contracts`

The single source of every interface that two or more features of Specstride share (feature 100,
`specs/100-specstride`). It builds no behaviour of a run. It holds what makes the interfaces
checkable, and the annexes of `specs/100-specstride/annexes/` stay the authority: **where a file
here and an annex differ, the annex stands** (T208, F100-FR-017).

This README is for two readers: an **author of a descriptor** (a harness descriptor, an overlay, a
rule table, a configuration file — data the product validates against a schema of this package)
and an **author of a later implementation** (a package of a Wave 1 feature that must speak one of
these interfaces).

## What the package holds

| Group                      | Where                                                                                                                 | What                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Record schemas             | `schemas/*.schema.json` (30 files)                                                                                    | One JSON Schema 2020-12 per record of the control plane and of the edges. Each property carries the meaning, the type in words and the "Required" cell of its annex row as `description`, `x-type-in-words` and `x-required`; `x-unknown-field` and `x-different-major` state the two common rules of annex B §B.4                         |
| Data                       | `data/*.json` (22 files)                                                                                              | The closed sets, the layout and the logical names, the exit codes, the stop reasons, the run-state machine, the identifiers, the CLI protocol and the line grammar, the configuration ranks and trust classes, the `parity` profile, the normalization tables, the threat model, the package graph, the layers and the extension-point map |
| Generated types            | `src/records/generated/`                                                                                              | One TypeScript type per schema file, generated from `properties`, `required`, `x-type-in-words` and `description` (`npm run build`, committed)                                                                                                                                                                                             |
| Readers and validators     | `src/records/`, `src/ids/`, `src/codes/`, `src/state/`, `src/enums/`, `src/envelope/`, `src/grammar/`, `src/profile/` | The lazy validator, the resolver of logical names, the exit-code and stop-reason tables, the run-state machine, the closed sets, the event and config envelopes, the line grammar, the profile                                                                                                                                             |
| Extension-point interfaces | `src/ep/`                                                                                                             | The interface types of EP-01 to EP-19 and of the tree-store service. The behaviour behind each one belongs to the content owner named in its annex section                                                                                                                                                                                 |

Every file of `data/` and `schemas/` is a clean copy of
`specs/100-specstride/contracts/`, made by `npm run sync`; the generator of the specification
(`npm run contracts:check` at the root) proves in the build that those files equal the annexes.
**Do not edit a file of `data/` or `schemas/`**: change the annex and generate again.

The package has one runtime dependency, the JSON Schema validator (`DEPENDENCIES.md`), imports no
`node:` module, runs no install script and compiles nothing at install (F100-FR-027).

## How to validate a record against a schema id

Every record of the control plane carries its schema id, with its major, in the field `schema`
(`specstride.lease/1`, F100-FR-048). A reader refuses a record whose major differs from the one it
supports, with a message that names the logical name and both majors (F100-FR-049).

Two entries, for the two cases:

- `validate` of `@specstride/contracts/records/compile` — when you have a schema id. It compiles
  the schema at first use and caches it.
- `readRecord` of `@specstride/contracts` — when you have a **logical name**. It looks the schema
  id up from the layout table and throws `RecordRefusedError` on a refusal.

```ts
import { validate } from "@specstride/contracts/records/compile";
import { readRecord, RecordRefusedError } from "@specstride/contracts";

const lease = {
  schema: "specstride.lease/1",
  runId: "run-1",
  launchId: "launch-1",
  launchNonce: "n",
  owner: {},
  lockProvider: "flock",
  heartbeatAt: "2026-10-01T00:00:00.000Z",
  heartbeatEverySeconds: 5,
  validUntil: "2026-10-01T00:01:00.000Z",
  leaseTokenHash: "h",
};

// Against a schema id you name:
const checked = validate("specstride.lease/1", lease);
checked.ok; // true; `checked.value` is the typed record, `checked.errors` the list otherwise

// Against the id the record carries — and a different major is refused:
const wrong = validate({ ...lease, schema: "specstride.lease/2" });
// wrong.ok === false
// wrong.errors[0].message ===
//   'refused: the major found is 2, the major supported is 1 (schema id "specstride.lease/2", F100-FR-049)'

// By logical name, which throws on a refusal:
try {
  readRecord("run:<runId>:lease", { ...lease, schema: "specstride.lease/2" });
} catch (error) {
  error instanceof RecordRefusedError; // true
  // 'refused the record of the logical name "run:<runId>:lease": the major found is 2,
  //  the major supported is 1 (F100-FR-049)'
}
```

An **unknown field** is ignored by a reader and kept by a writer that copies the record
(`copyRecord` of `src/records/rules.ts`) — except in the four **closed** schemas (the harness
descriptor, the launch contract, the configuration envelope and the overlay), where an unknown
top-level key refuses the record and a key under `x-` is ignored. Each schema states which it is in
`x-unknown-field`.

## How to read a closed set

A closed set is a list the product will not silently extend. All 285 of them are listed in annex X
§X.6 with an owner, who closed it, and **what a reader does with a value outside the set**. The
package exports them as one map, keyed by the number of the row.

```ts
import { closedSet, closedSets, CLOSED_SET_COUNT } from "@specstride/contracts";

CLOSED_SET_COUNT; // 285
closedSets.size; // 285

const reasons = closedSet(3);
reasons?.name; // "Stop reasons"
reasons?.owner; // the feature that owns the set
reasons?.members.length; // 15
reasons?.has("stop_flag"); // true — and it narrows the type of the value

// A value outside the set: the rule of the row, as a value you can branch on.
reasons?.onUnknown("nope");
// { kind: "refuse", value: "nope", set: "Stop reasons",
//   message: 'refused: "nope" is not a member of the closed set "Stop reasons" (…)',
//   cell: "Treated as not retryable; reported" }
```

The `kind` is one of `refuse`, `show-as-unknown`, `ignore` and `default`. Where the section of an
extension point states nothing more specific, the rule of F100-FR-021 holds: an unknown member of a
closed set **refuses the record** with a message that names the set and the value. Do not write a
reader without a branch for an unknown value — the static test of the test kit fails the build for
one (`readMember` throws `NoUnknownBranchError`).

## How to read a logical name

No package names a path of state. It names a **logical name** (`run:<runId>:record`), and the
resolver of `data/layout.json` gives the path, the root, the one writer and the readers. 127 names,
layout version 1.2 (annex B §B.5).

```ts
import { resolve, rowOf, writerOf, readersOf } from "@specstride/contracts/ids/logical-names";

resolve("run:<runId>:record", { "<slug>": "100-specstride", "<runId>": "run-1" });
// "<control>/features/100-specstride/runs/run-1/run.json"

rowOf("run:<runId>:record").root; // "control"
writerOf("run:<runId>:record"); // "Runtime root (engine in start mode `standalone`)"
readersOf("run:<runId>:record"); // the readers of the row
```

Pass the paths of the roots as the third argument to get an absolute path; leave them out and the
root placeholder stays, which is what a test wants. A name the table does not hold is refused. A
name the annex gives a parameter is refused without it, so ask `parametersOfName` first if you do
not know.

## How to read an exit code

Exit codes are data too: per process (annex E §E.4), for the runtime root and the pipeline entry
(annex F §F.8) and per command (annex G §G.4), in `data/exit-codes.json`.

```ts
import { codesOf, commandCodeRow } from "@specstride/contracts/codes/commands";
import { engineExitRows } from "@specstride/contracts/codes/engine";

codesOf("`resume`"); // [1, 5, 3] — the code numbers the table gives the command
commandCodeRow("`resume`")?.codes; // the cell of the annex, in words: which code on which refusal

engineExitRows.length; // 8 rows for the codes 0 to 6 of the engine
engineExitRows[0].code; // 0
engineExitRows[0].meaning; // "Every phase approved, in this run or before it, …"
engineExitRows[0].stopReasons; // the stop reasons that end in this code
```

The general rules hold beside the table: a usage error keeps the as-is code of its command, an
uncaught error exits 70, an unknown verb exits 1, and an unknown sub-command exits as the table
states. One value can mean different things in different commands: `data/exit-codes.json` holds the
table of those collisions, exported by `src/codes/doctor-and-collisions.ts`.

## How to read the profile

The `parity` profile is the named configuration under which the parity oracle of feature 141
compares the port with the baselines (annex X §X.7). It is ordinary product configuration: there is
no oracle mode (F100-FR-010).

```ts
import {
  loadProfile,
  applyProfile,
  applySecondSuite,
  rowOfKey,
} from "@specstride/contracts/profile/parity";

const rows = loadProfile();
rows.length; // 133
rows[0].switch; // "Loop strategy"
rows[0].parity; // "classic" — the value the switch takes under `parity`
rows[0].keys; // the configuration keys of the row

applyProfile({}).config; // every key of every row set to its value under `parity`, and nothing else
applySecondSuite({}).config; // the same, with row 1 set to `micro`: the second suite

rowOfKey("loop.strategy")?.number; // the row a configuration key belongs to
```

A package that owns a switch **registers it at load** through `registerSwitch` of
`src/profile/switches.ts`. A switch without a row of the profile fails the build (F100-FR-211), and
a registration whose owner differs from the owner of its row is refused: a feature does not change
a row of another feature.

## Where the details are

| Subject                                          | File                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| The fields of a record                           | `schemas/`, and the annex section named in `specs/100-specstride/contracts/README.md`                         |
| The `$id` of a schema file                       | `urn:specstride:schema:<schema id>`; `specs/100-specstride/contracts/README.md`, "The `$id` of a schema file" |
| Entities, writers, transitions                   | `specs/100-specstride/data-model.md`                                                                          |
| Which annex section owns which interface         | `specs/100-specstride/spec.md` and the annexes                                                                |
| Running a conformance suite on an implementation | `packages/testkit/README.md`                                                                                  |
