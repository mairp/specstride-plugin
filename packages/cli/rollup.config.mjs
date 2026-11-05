/**
 * T064 — the bundler of the published package (F119-FR-056, W-119-01).
 *
 * `rollup` (research.md decision 10) is a DEVELOPMENT dependency of this
 * feature only: it runs when the package is packed, never when it is
 * installed, and it never enters the manifest of the packed package (the
 * staging writer of `scripts/pack.mjs` omits every build tool and every
 * runtime dependency).
 *
 * The bundle is ONE ESM file (`dist/specstride.mjs`): the entry of
 * `src/bundle-entry.ts` — the front door of the router and the runtime root
 * of a launched pipeline — with the whole `@specstride/*` graph inlined, so
 * the plain install of CT-119-19 needs no compiler and no workspace. The
 * lazy `import()` branches of the router (F119-FR-015) stay lazy in the
 * bundle — `inlineDynamicImports` keeps them inside `Promise` branches of
 * the single file instead of separate chunks — and node builtins stay
 * external. No native module anywhere: pure JavaScript (research.md
 * decision 10).
 *
 * TypeScript is stripped per module with the workspace `typescript` (a
 * per-file `transpileModule`, exact because the project compiles under
 * `isolatedModules`), which is what a bundler transform needs; the full
 * type check stays in the `typecheck` script and is not the bundler's job.
 * @type {import("rollup").RollupOptions}
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

const require_ = createRequire(import.meta.url);
const ts = require_("typescript");

// JSON data files (the "@specstride" packages' data/ modules) become parsed-module exports.
function jsonModule() {
  return {
    name: "json-module",
    transform(code, id) {
      if (!/\.json$/i.test(id.replace(/[?#].*$/, "")) || id.includes("commonjs-proxy")) return null;
      const parsed = JSON.parse(code);
      return { code: `export default ${JSON.stringify(parsed)};`, map: null };
    },
  };
}

/** Per-module TS-stripping transform (no type check, no emit on disk). */
function tsStrip() {
  return {
    name: "ts-strip-transpile-only",
    transform(code, id) {
      if (!/\.m?ts$/i.test(id.replace(/[?#].*$/, "")) || /\.d\.mts?$/i.test(id)) return null;
      const out = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: {
          target: ts.ScriptTarget.ES2023,
          module: ts.ModuleKind.ESNext,
          verbatimModuleSyntax: true,
          esModuleInterop: true,
          isolatedModules: true,
          sourceMap: false,
        },
      });
      return { code: out.outputText, map: null };
    },
  };
}

export default {
  input: "src/bundle-entry.ts",
  output: {
    // `.build/cli/` so the data-path algebra of the bundled modules (three
    // dirnames up to the package root) resolves inside the packed package.
    // The build output lives under a dot-directory: it is an artifact of the
    // build, regenerated from scratch, and no static scan of the source
    // trees should read the bundle as if it were source.
    file: ".build/cli/specstride.mjs",
    format: "esm",
    inlineDynamicImports: true,
    sourcemap: false,
    banner:
      "// @specstride/cli — one bundled ESM file (F119-FR-056). Built by rollup, a development dependency only; never at install. Pure JavaScript, no native module.",
  },
  // Node builtins stay external; every `@specstride/*` workspace import is
  // inlined so the packed package carries no runtime dependency and the
  // plain install of CT-119-19 resolves everything from the bundle alone.
  external: (id) => id.startsWith("node:"),
  plugins: [
    resolve({ extensions: [".ts", ".mjs", ".js"], exports: true }),
    jsonModule(),
    commonjs(),
    tsStrip(),
  ],
};

// The workspace TypeScript version, read once for the record of the build.
export const TYPESCRIPT_VERSION = JSON.parse(
  readFileSync(new URL("../../node_modules/typescript/package.json", import.meta.url), "utf8"),
).version;
