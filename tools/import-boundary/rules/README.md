# Rule files of the import-boundary check

One JSON file per rule, read by [`../src/rule-files.ts`](../src/rule-files.ts) (T300):

```json
{
  "rule": "the id reported with every violation",
  "owner": "the feature that owns the rule",
  "requirement": "the requirement it enforces",
  "from": ["path globs of the source files the rule is about"],
  "forbid": ["path globs of the modules those files may not import"],
  "reason": "why the rule stands"
}
```

A file that lacks a field is refused: `check:imports` fails rather than pass a rule it cannot
read. A rule fires when a source file that `from` matches imports a module that `forbid` matches,
resolved as the caller writes it — a relative path, or a package export.

These rules separate **modules inside one package**, which `mayImport` of
`packages/contracts/data/package-graph.json` cannot express, because it separates packages
(F149-FR-007). The rules of the package graph stay in that file; a feature that needs a
module-level rule places its own file here.

This directory holds no rule of feature 100. The mechanism is proved by
[`../test/rule-files.test.ts`](../test/rule-files.test.ts) over fixture workspaces.
