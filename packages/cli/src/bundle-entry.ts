/**
 * The entry of the packed bundle (F119-FR-056; F107-FR-030).
 *
 * One module, three exports: the front door of the router, the runtime root
 * of a launched pipeline — the process the launcher becomes — and the
 * integrity check a launcher runs at every start. The bundler builds from
 * HERE, so the one file the published package carries answers all three:
 * `specstride <verb>` through `route`, the detached root through `main`
 * (the signature the launcher's `SPECSTRIDE_PIPELINE_ENTRY` names:
 * `{ bundleLogicalName, bundleHash, mode, args }`), and the launcher's own
 * start refusal through `launcherStartRefusal` — the launcher's default
 * integrity module resolves only inside a source checkout, so a packed
 * launch points `SPECSTRIDE_LAUNCH_INTEGRITY_MODULE` at this bundle too.
 *
 * The source executable (`bin/specstride`) keeps importing the router
 * directly; only the bundle is built from this entry.
 */
export { route } from "./router/route.ts";
export { main } from "./runtime-root/pipeline-main.ts";
export { launcherStartRefusal } from "../../pipeline/src/contract/launch/integrity.ts";
