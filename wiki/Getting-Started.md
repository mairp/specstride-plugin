# Getting started

1. Install, in Claude Code:

   ```text
   /plugin marketplace add mairp/specstride-plugin
   /plugin install specstride@specstride-marketplace
   ```

2. Have a git repository with one committed feature. `## Phase N: Title` headings and `- [ ] T001 …` tasks are what Spec Kit
   writes, and you can write them by hand:

   ```markdown
   # Tasks

   ## Phase 1: Add

   - [ ] T001 Create add.js exporting add(a, b), throwing TypeError on non-numbers
   - [ ] T002 Create add.test.js covering sums and the TypeError
   ```

   Save it as `specs/001-add/tasks.md`, optionally with `spec.md` and `plan.md` beside it, and add a `test` script to
   `package.json`.

3. Ask Claude: "Run Specstride on the feature in this repo."

The run goes in the background. You get each phase's result and a `DIGEST` line at the end. With several features, set
`SPECSTRIDE_FEATURE` to the directory name.
