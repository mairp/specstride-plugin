# contract/

The part of `@specstride/pipeline` that turns existing Spec Kit features into a
promoted launch contract, a launcher and a content-addressed launch bundle
(feature 107; plan.md, "Source Code"). The other directories of `src/` are of
feature 123.

One directory per subject, as plan.md names them:

- `schemas/` the item schemas of this feature (internal `$id`), joined to the generated record schema
- `ports.ts` the two ports the command wiring hands over (written by the task that owns the ports)
- `inventory/` sources, candidates, verification-plan source (EP-07)
- `draft/` draft builder, obligation ids, finding, verification mode; completion; the verification-commands document
- `judgment/` items, batching, answers in `inventory.judgment`, delegation through a port
- `validate/` the composed validator; post-schema rules; error classes
- `promote/` stamp, canonical bytes, rewrite
- `render/` launcher, bundle with manifest, edited-launcher check
- `launch/` modes, dry-run report, comment, what the comment selected, integrity check at start
- `commands/` derive, validate, render as functions: lines and exit codes

The package imports `@specstride/contracts`, `@specstride/kernel`,
`@specstride/spec-formats` and `@specstride/config` only (plan.md, "Technical
Context"); the import-boundary check (`npm run check:imports`) holds it.
