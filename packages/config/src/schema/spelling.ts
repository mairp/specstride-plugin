/**
 * T009 — the rules of spelling of §K.2 (F110-FR-002).
 *
 * | # | Rule | Here |
 * |---|---|---|
 * | 1 | the schema is a closed list of exact spellings | `catalogue.ts` |
 * | 2 | an unknown key refuses the launch, naming the file, the key and the nearest known key, found ignoring case and underscores | `nearestKey` |
 * | 3 | the environment name of a key | `derivedEnvironmentName`, `environmentNameOf` |
 * | 4 | `--set <path>=<value>`, repeatable, for every key | `setFlagFor`, `parseSetFlag` |
 * | 5 | keys under `x-` at any depth are free for the consumer and ignored | `isIgnoredExtensionKey` |
 */
import { CATALOGUE_KEYS, matchCatalogueKey } from "./catalogue.ts";

/**
 * The form in which two spellings are compared: case and underscores are
 * ignored (§K.2 rule 2), so `closingCheck` and `closing_check` are the same
 * word. Dots are kept: they separate the segments of the path.
 */
export function comparableSpelling(key: string): string {
  return key.toLowerCase().replace(/_/g, "");
}

/** Rule 5 — a key with a segment under `x-` at any depth is free and ignored. */
export function isIgnoredExtensionKey(key: string): boolean {
  return key.split(".").some((segment) => segment.startsWith("x-"));
}

/** The edit distance of two words, used only to rank candidate spellings. */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let previous = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const current = [i, ...Array.from({ length: n }, () => 0)];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[n] ?? n;
}

/** How far a candidate may be from the written key and still be suggested. */
export function suggestionLimit(written: string): number {
  return Math.max(3, Math.ceil(written.length / 4));
}

/**
 * Rule 2 — the nearest known key of a spelling the schema does not hold, found
 * ignoring case and underscores.
 *
 * The order is: the same word; then a key whose last segments are the word, so
 * that `closingCheck` suggests `loop.micro.closing_check`; then the key at the
 * smallest edit distance, where that distance is within `suggestionLimit`.
 * `undefined` where nothing is near enough — the message then says only that the
 * schema is a closed list.
 */
export function nearestKey(
  written: string,
  keys: readonly string[] = CATALOGUE_KEYS,
): string | undefined {
  const target = comparableSpelling(written);
  const pairs = keys.map((key) => ({ key, cmp: comparableSpelling(key) }));

  const same = pairs.find((p) => p.cmp === target);
  if (same !== undefined) return same.key;

  // The written key names the tail of a known key: the consumer left the
  // namespace off, or wrote only the last segment.
  const tail = pairs.filter((p) => p.cmp === target || p.cmp.endsWith(`.${target}`));
  if (tail.length > 0) {
    return tail.sort((a, b) => a.key.length - b.key.length)[0]?.key;
  }
  // The written key is the head of a known key, or holds it.
  const partial = pairs.filter(
    (p) => p.cmp.startsWith(`${target}.`) || target.endsWith(`.${p.cmp}`),
  );
  if (partial.length > 0) {
    return partial.sort((a, b) => a.key.length - b.key.length)[0]?.key;
  }

  let best: { key: string; distance: number } | undefined;
  for (const p of pairs) {
    const distance = editDistance(target, p.cmp);
    if (best === undefined || distance < best.distance) best = { key: p.key, distance };
  }
  if (best === undefined || best.distance > suggestionLimit(target)) return undefined;
  return best.key;
}

/** The prefix of every environment name of the product (§K.2 rule 3). */
export const ENVIRONMENT_PREFIX = "SPECSTRIDE_";

/**
 * Rule 3 — the environment name of a key: `SPECSTRIDE_` followed by the path in
 * upper case, with each dot replaced by an underscore and each camelCase
 * boundary split by an underscore.
 *
 * `loop.maxIter` gives `SPECSTRIDE_LOOP_MAX_ITER`;
 * `roles.proposer.timeoutSec` gives `SPECSTRIDE_ROLES_PROPOSER_TIMEOUT_SEC`;
 * the underscores that §K.2 rule 1 keeps (`loop.micro.closing_check`) are
 * already boundaries and are not doubled. The parameter of a template key keeps
 * its angle brackets (`phases.<N>.critic.timeoutSec` gives
 * `SPECSTRIDE_PHASES_<N>_CRITIC_TIMEOUT_SEC`), because the name is complete only
 * once the caller binds it.
 */
export function derivedEnvironmentName(key: string): string {
  const body = key
    .split(".")
    .map((segment) =>
      /^<[A-Za-z]+>$/.test(segment)
        ? segment.toUpperCase()
        : segment.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase(),
    )
    .join("_")
    .replace(/_{2,}/g, "_");
  return `${ENVIRONMENT_PREFIX}${body}`;
}

/**
 * Rule 3, second sentence — where the baseline has a name for the key, that name
 * is the environment name (the alias of §K.8) and the derived name is not read.
 *
 * The alias table itself is `contracts/alias-table.tsv`, which task T005
 * completed and task T026 loads; this function takes the aliases it needs, so
 * that the rule holds wherever the table comes from.
 */
export function environmentNameOf(
  key: string,
  aliases: ReadonlyMap<string, string> = new Map(),
): string {
  return aliases.get(key) ?? derivedEnvironmentName(key);
}

/** Rule 4 — the flag that sets a key: `--set <path>=<value>`, repeatable. */
export function setFlagFor(key: string, value: string): string {
  return `--set ${key}=${value}`;
}

/** One `--set` flag, read into the key it names and the text of its value. */
export interface SetFlag {
  readonly key: string;
  /** The value as the consumer wrote it; the schema coerces it by the key's type. */
  readonly rawValue: string;
}

/**
 * Rule 4 — read one `--set <path>=<value>`. The argument may be the whole flag
 * or only its `<path>=<value>` part; the value may hold `=` and is split at the
 * first one only. A missing `=` is no `--set` at all.
 */
export function parseSetFlag(argument: string): SetFlag | undefined {
  const body = argument.startsWith("--set=")
    ? argument.slice("--set=".length)
    : argument.startsWith("--set ")
      ? argument.slice("--set ".length)
      : argument;
  const at = body.indexOf("=");
  if (at <= 0) return undefined;
  return Object.freeze({ key: body.slice(0, at).trim(), rawValue: body.slice(at + 1) });
}

/** What the schema makes of a key a consumer wrote. */
export type KeyVerdict =
  /** The schema knows the key (rule 1). */
  | { readonly kind: "known"; readonly key: string }
  /** The key is under `x-` and is ignored (rule 5). */
  | { readonly kind: "ignored"; readonly key: string }
  /** The schema does not know the key; the nearest one, where there is one (rule 2). */
  | { readonly kind: "unknown"; readonly key: string; readonly nearest: string | undefined };

/**
 * Rules 1, 2 and 5 together: what the loader does with a key it reads from a
 * file, the environment or a flag.
 */
export function classifyKey(key: string): KeyVerdict {
  if (isIgnoredExtensionKey(key)) return Object.freeze({ kind: "ignored", key });
  if (matchCatalogueKey(key) !== undefined) return Object.freeze({ kind: "known", key });
  return Object.freeze({ kind: "unknown", key, nearest: nearestKey(key) });
}
