// Linting of the workspace (T007). Flat config, TypeScript in strict ECMAScript
// modules (tsconfig.base.json). Run with `npm run lint` at the root.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    // The specification tree, the as-is trees and the run artefacts are not
    // source code of the product.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "specs/**",
      "vendor/**",
      "old/**",
      "docs/**",
      ".specify/**",
      ".specstride/**",
      ".mixture-of-loops/**",
      "testautomation/**",
      "prompts/**",
      "packages/contracts/src/records/generated/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2023,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // The build output is generated: it is never linted.
    ignores: ["packages/cli/.build/**"],
  },
  {
    // The build workflow of the specification is configuration, not code.
    files: [".github/workflows/**"],
    languageOptions: { globals: { ...globals.node } },
  },
);
