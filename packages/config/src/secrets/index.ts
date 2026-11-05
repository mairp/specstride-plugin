/**
 * T031, T032 — the secret references and the three resolvers of Wave 1
 * (F110-FR-027 to F110-FR-035).
 *
 * - `reference.ts`  the grammar of a reference, the four operations, the three
 *                   errors (F110-FR-027, F110-FR-028)
 * - `env.ts`        the scheme `env:` (F110-FR-029)
 * - `file.ts`       the scheme `file:` (F110-FR-030)
 * - `keychain.ts`   the scheme `keychain:` (F110-FR-031)
 * - `binding.ts`    the bound host of a declaration (F110-FR-033)
 * - `registry.ts`   the open registry, inline detection through the redactor,
 *                   the missing-secret handling and the rules of use
 *                   (F110-FR-027, F110-FR-032, F110-FR-034, F110-FR-035)
 */
export * from "./reference.ts";
export * from "./env.ts";
export * from "./file.ts";
export * from "./keychain.ts";
export * from "./binding.ts";
export * from "./registry.ts";
