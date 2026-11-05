/**
 * A bounded reader for the descriptor data files (F109-FR-023).
 *
 * The descriptors of this feature are DATA, and feature 110 owns the one
 * product dependency on the npm package `yaml` (decision D-8: the parser
 * is "a dependency of the package that loads configuration (owner 110)
 * and of no other package"). So the harness reads its descriptor files
 * with this small, closed reader instead: it accepts exactly the subset
 * the descriptors are written in — nested mappings, block sequences of
 * scalars or mappings, flow sequences and flow mappings, comments, and
 * plain, quoted, boolean, null and numeric scalars — and refuses
 * everything else with a thrown error, so an unexpected construct can
 * never be swallowed silently. Every leaf of the result is data: a
 * string, a number, a boolean or null (no constructor, no class).
 */

/** One significant line: its indentation and its text without the indent. */
type Line = { indent: number; text: string };

/** The lines a document is read from, and the index of the next line. */
type Reader = { lines: readonly Line[]; at: number };

/** Strip a trailing comment (` #` outside quotes) from one line. */
function stripComment(text: string): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === `"` || character === `'`) {
      quote = character;
    } else if (character === "#" && i > 0 && text[i - 1] === " ") {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}

/** The significant lines of a document: no blank line, no comment line. */
function significantLines(source: string): readonly Line[] {
  const lines: Line[] = [];
  for (const raw of source.split("\n")) {
    if (raw.trimStart().startsWith("#")) continue; // a whole-line comment
    const stripped = stripComment(raw);
    if (stripped.trim().length === 0) continue;
    const indent = stripped.length - stripped.trimStart().length;
    lines.push({ indent, text: stripped.trim() });
  }
  return lines;
}

/** A quoted or plain scalar: string, number, boolean or null. */
function scalar(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith(`"`) && trimmed.endsWith(`"`)) {
    return trimmed.slice(1, -1).replace(/\\"/g, `"`).replace(/\\\\/g, "\\");
  }
  if (trimmed.startsWith(`'`) && trimmed.endsWith(`'`)) {
    return trimmed.slice(1, -1).replace(/''/g, `'`);
  }
  if (trimmed === "" || trimmed === "null" || trimmed === "~") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

/** A flow collection: `[a, b]` or `{k: v}` on one line. */
function flow(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return scalar(trimmed);
  const open = trimmed[0];
  const close = open === "[" ? "]" : "}";
  if (!trimmed.endsWith(close)) {
    throw new Error(`the flow collection is not closed: ${trimmed}`);
  }
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return open === "[" ? [] : {};
  const items: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const character of inner) {
    if (quote !== null) {
      current += character;
      if (character === quote) quote = null;
    } else if (character === `"` || character === `'`) {
      quote = character;
      current += character;
    } else if (character === "[" || character === "{") {
      depth++;
      current += character;
    } else if (character === "]" || character === "}") {
      depth--;
      current += character;
    } else if (character === "," && depth === 0) {
      items.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim().length > 0) items.push(current.trim());
  if (open === "[") return items.map(flow);
  const entry: Record<string, unknown> = {};
  for (const item of items) {
    const separator = item.indexOf(":");
    if (separator < 0) throw new Error(`the flow mapping entry has no key: ${item}`);
    entry[item.slice(0, separator).trim()] = flow(item.slice(separator + 1));
  }
  return entry;
}

/** Where `key:` ends in `key: value` (or -1 where the line is no mapping entry). */
function keySeparator(text: string): number {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === `"` || character === `'`) {
      quote = character;
    } else if (character === ":" && (i === text.length - 1 || text[i + 1] === " ")) {
      return i;
    }
  }
  return -1;
}

/** Read a block (mapping or sequence) whose lines carry the given indent. */
function block(reader: Reader, indent: number): unknown {
  const first = reader.lines[reader.at];
  if (first === undefined) return null;
  if (first.text.startsWith("- ") || first.text === "-") return sequence(reader, indent);
  return mapping(reader, indent);
}

/** Read a block sequence at the given indent. */
function sequence(reader: Reader, indent: number): unknown {
  const items: unknown[] = [];
  while (reader.at < reader.lines.length) {
    const line = reader.lines[reader.at];
    if (line === undefined || line.indent < indent) break;
    if (line.indent > indent || !(line.text.startsWith("- ") || line.text === "-")) {
      throw new Error(`the sequence entry is not at one indent: ${line.text}`);
    }
    const rest = line.text === "-" ? "" : line.text.slice(2).trim();
    reader.at++;
    if (rest.length === 0) {
      items.push(block(reader, indent + 1));
      continue;
    }
    const separator = keySeparator(rest);
    if (separator < 0) {
      items.push(flow(rest));
      continue;
    }
    // `- key: value` opens a mapping whose indent is the column of `key`.
    const entryIndent = indent + 2;
    reader.at--;
    reader.lines = reader.lines
      .slice(0, reader.at)
      .concat([{ indent: entryIndent, text: rest }], reader.lines.slice(reader.at + 1));
    items.push(mapping(reader, entryIndent));
  }
  return items;
}

/** Read a block mapping at the given indent. */
function mapping(reader: Reader, indent: number): unknown {
  const entry: Record<string, unknown> = {};
  while (reader.at < reader.lines.length) {
    const line = reader.lines[reader.at];
    if (line === undefined || line.indent < indent) break;
    if (line.indent > indent) {
      throw new Error(`the mapping entry is over-indented: ${line.text}`);
    }
    const separator = keySeparator(line.text);
    if (separator < 0) {
      throw new Error(`the line is no mapping entry: ${line.text}`);
    }
    const key = line.text.slice(0, separator).trim();
    const rest = line.text.slice(separator + 1).trim();
    reader.at++;
    entry[key] = rest.length > 0 ? flow(rest) : nested(reader, indent);
  }
  return entry;
}

/** The value of `key:` with nothing after the colon: a nested block or null. */
function nested(reader: Reader, indent: number): unknown {
  const next = reader.lines[reader.at];
  if (next === undefined) return null;
  if (next.indent > indent) return block(reader, next.indent);
  // A sequence may sit at the indent of its key.
  if (next.indent === indent && (next.text.startsWith("- ") || next.text === "-")) {
    return sequence(reader, indent);
  }
  return null;
}

/**
 * Read one descriptor document: the whole text in, the data tree out.
 * A document that uses a construct outside the bounded subset throws.
 */
export function parseDescriptorYaml(source: string): unknown {
  const reader: Reader = { lines: significantLines(source), at: 0 };
  if (reader.lines.length === 0) return null;
  return block(reader, reader.lines[0]?.indent ?? 0);
}
