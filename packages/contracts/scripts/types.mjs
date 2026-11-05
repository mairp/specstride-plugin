#!/usr/bin/env node
/**
 * T009 — generate the record types from the schema files.
 *
 * For every `packages/contracts/schemas/<stem>.schema.json` one TypeScript
 * type is generated into `src/records/generated/<stem>.ts`, an index is
 * generated into `src/records/generated/index.ts`, and the file map of the
 * package's own schemas is generated into `src/records/schema-map.ts` (the
 * lazy validator of T232 resolves a schema id through that map; no
 * `node:` import in the package, research.md D-1 and D-2).
 *
 * A type is built from the schema's `properties`, `required`,
 * `x-type-in-words` and `description` (each property keeps the meaning, the
 * type in words and the required cell of the annex as documentation).
 *
 * The script is run by the `build` script of the package; its output is
 * committed. Re-running it over the same schemas is byte-identical
 * (deterministic order, prettier-formatted).
 *
 * Usage: node scripts/types.mjs [--out <dir>]
 *   --out <dir>  write generated/ and schema-map.ts under <dir>
 *                (default: <package>/src/records)
 * Exit codes: 0 generated, 1 a schema file could not be read or parsed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const PKG_DIR = resolve(dirname(dirname(fileURLToPath(import.meta.url)))); // packages/contracts
const SCHEMAS_DIR = join(PKG_DIR, "schemas");
const requireFromPackage = createRequire(join(PKG_DIR, "package.json"));

function fail(message) {
  process.stderr.write(`types: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { out: join(PKG_DIR, "src", "records") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      if (argv[i + 1] === undefined) fail("--out needs a directory");
      out.out = resolve(argv[i + 1]);
      i++;
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      process.stdout.write("usage: types.mjs [--out <dir>]\n");
      process.exit(0);
    } else {
      fail(`unknown argument: ${argv[i]}`);
    }
  }
  return out;
}

/** `lease` -> `Lease`, `run-record` -> `RunRecord`, `yield-artifact` -> `YieldArtifact` */
function pascalCase(stem) {
  return stem
    .split(/[-_.]/)
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

/** Escape a string for use inside a JSDoc comment. */
function docEscape(text) {
  return String(text).replaceAll("*/", "*\\/");
}

/** A JSDoc block of comment lines, indented; empty string for no lines. */
function docComment(lines, indent) {
  if (lines.length === 0) return "";
  const inner = lines
    .map((line) => (line === "" ? `${indent} *` : `${indent} * ${line}`))
    .join("\n");
  return `${indent}/**\n${inner}\n${indent} */\n`;
}

function propertyDocLines(prop) {
  const lines = [];
  if (prop.description) lines.push(docEscape(prop.description));
  if (prop["x-type-in-words"])
    lines.push("", `Type in words: ${docEscape(prop["x-type-in-words"])}.`);
  return lines;
}

/**
 * Render the TypeScript type of one schema property. An object with
 * `properties` is rendered inline (nested), so one schema file is one
 * self-contained type file.
 */
function renderType(prop, indent) {
  if (prop.enum) {
    return prop.enum.map((value) => JSON.stringify(value)).join(" | ");
  }
  const types = Array.isArray(prop.type) ? prop.type : [prop.type];
  if (types.length === 0) return "unknown";
  return types
    .map((type) => {
      switch (type) {
        case "string":
          return "string";
        case "integer":
        case "number":
          return "number";
        case "boolean":
          return "boolean";
        case "null":
          return "null";
        case "array":
          return prop.items ? `Array<${renderType(prop.items, indent)}>` : "unknown[]";
        case "object":
          if (prop.properties) return renderObject(prop, indent);
          return "Record<string, unknown>";
        default:
          return "unknown";
      }
    })
    .join(" | ");
}

function renderObject(schema, indent) {
  const required = schema.required ?? [];
  const pad = `${indent}  `;
  const body = Object.entries(schema.properties)
    .map(([name, prop]) => {
      const doc = docComment(propertyDocLines(prop), pad);
      const optional = required.includes(name) ? "" : "?";
      return `${doc}${pad}${name}${optional}: ${renderType(prop, pad)};`;
    })
    .join("\n");
  return `{\n${body}\n${indent}}`;
}

function renderSchemaFile(schema, stem, schemaId) {
  const typeName = pascalCase(stem);
  const required = schema.required ?? [];
  const body = Object.entries(schema.properties ?? {})
    .map(([name, prop]) => {
      const doc = docComment(propertyDocLines(prop), "  ");
      const optional = required.includes(name) ? "" : "?";
      return `${doc}  ${name}${optional}: ${renderType(prop, "  ")};`;
    })
    .join("\n");
  const annex = schema["x-annex"] ? `, ${docEscape(schema["x-annex"])}` : "";
  return `/**
 * ${docEscape(schema.title ?? stem)} — the record type of schema id \`${schemaId}\`${annex}.
 *
 * Generated by \`scripts/types.mjs\` from \`schemas/${stem}.schema.json\` (research.md,
 * D-1) — do not edit; re-run the \`build\` script of the package instead. The
 * fields keep the meaning, the type in words and the required cell of the
 * annex as documentation.
 */
export interface ${typeName} {
${body}
}
`;
}

/** Format with the same options as the workspace .prettierrc (prettier 3 is async). */
async function format(code) {
  const prettier = requireFromPackage("prettier");
  return prettier.format(code, { parser: "typescript", printWidth: 100, endOfLine: "lf" });
}

async function main() {
  const { out } = parseArgs(process.argv.slice(2));
  if (!existsSync(SCHEMAS_DIR))
    fail(`the schemas directory is missing: ${SCHEMAS_DIR} (run sync.mjs first)`);

  const stems = readdirSync(SCHEMAS_DIR)
    .filter((name) => name.endsWith(".schema.json"))
    .map((name) => name.slice(0, -".schema.json".length))
    .sort();
  if (stems.length === 0) fail(`no schema files in ${SCHEMAS_DIR} (run sync.mjs first)`);

  const generatedDir = join(out, "generated");
  rmSync(generatedDir, { recursive: true, force: true });
  mkdirSync(generatedDir, { recursive: true });

  const map = {};
  const indexLines = [];
  for (const stem of stems) {
    const file = join(SCHEMAS_DIR, `${stem}.schema.json`);
    let schema;
    try {
      schema = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      fail(`cannot parse ${file}: ${String(err)}`);
    }
    const schemaId =
      schema["x-schema-id"] ??
      (schema["$id"] && schema["$id"].startsWith("urn:specstride:schema:")
        ? schema["$id"].slice("urn:specstride:schema:".length)
        : undefined);
    if (!schemaId) fail(`schema ${file} has no x-schema-id and no urn:specstride:schema: $id`);
    if (Object.hasOwn(map, schemaId)) fail(`schema id ${schemaId} is claimed twice (${file})`);
    map[schemaId] = schema;
    writeFileSync(
      join(generatedDir, `${stem}.ts`),
      await format(renderSchemaFile(schema, stem, schemaId)),
    );
    indexLines.push(`export type { ${pascalCase(stem)} } from "./${stem}.ts";`);
  }

  const indexHeader = `/**
 * The record types generated from every schema file of \`schemas/\` — one type
 * per schema (research.md, D-1). Generated by \`scripts/types.mjs\` — do not
 * edit; re-run the \`build\` script of the package instead.
 */
`;
  writeFileSync(join(generatedDir, "index.ts"), indexHeader + indexLines.join("\n") + "\n");

  const mapLines = Object.entries(map)
    .map(
      ([id, schema]) =>
        `  ${JSON.stringify(id)}: ${JSON.stringify(schema, null, 2).replace(/\n/g, "\n  ")},`,
    )
    .join("\n");
  const mapCode = `/**
 * Generated by \`scripts/types.mjs\` — do not edit; re-run the \`build\` script
 * of the package instead.
 *
 * The file map of the package's own schemas (F100-FR-048): every schema id
 * that a record carries in its \`schema\` field (the id with its major, for
 * example \`specstride.lease/1\`) mapped to the schema object read from
 * \`schemas/\`. The lazy validator of \`src/records/compile.ts\` resolves a
 * schema id through this map, so the package needs no \`node:\` import.
 */
export const schemaMap: Readonly<Record<string, unknown>> = {
${mapLines}
};
`;
  writeFileSync(join(out, "schema-map.ts"), await format(mapCode));

  process.stdout.write(
    `types: ${stems.length} types -> ${generatedDir} (plus index.ts), ` +
      `${Object.keys(map).length} schema ids -> ${join(out, "schema-map.ts")}\n`,
  );
}

main();
