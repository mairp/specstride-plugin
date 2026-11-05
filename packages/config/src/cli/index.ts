/**
 * T018, T020 — the two configuration commands of annex G §G.1: `config show`
 * (F110-FR-025) and `config schema` (F110-FR-012), with the byte budget their
 * owner derives from annex G §G.5 (F100-FR-187).
 */
export * from "./budget.ts";
export * from "./show.ts";
export * as configSchema from "./schema.ts";
