# Contributing

```bash
npm install --ignore-scripts
npm run typecheck
npm test
npm run e2e
```

`npm run e2e` builds the plugin and takes a feature through it with a stub of `claude`, so it needs no account and spends
nothing. Please add a test with each change, keep the import boundaries (`npm run check:imports`), and run
`npm run format` before you push.

The run path starts at `packages/cli/src/engine/run-feature.ts`, which wires the real parts together. `plugin/` is a build
output: change the sources and run `npm run build:plugin`. Good first issues are labelled `good first issue`.

This public suite holds the tests that stand alone. Tests bound to the project's internal spec documents run in the
maintainer's private tree.
