/**
 * CT-101-32 (T108 of feature 101) — the OWN PROPERTY TEST of the verdict parser.
 *
 * Proves F101-FR-007 and F101-FR-008.
 *
 * The property, stated once:
 *
 *   ONLY a reply with exactly one WHOLE line that carries the EXACT nonce of
 *   the call gives a verdict. EVERY other input gives MALFORMED with a detail of
 *   the closed set of row 251 of annex X §X.6.
 *
 * The fixture is none: the replies are GENERATED, from a fixed seed. The
 * generator takes a seed, the run prints the seed it used, and a failing case
 * prints the seed that produced it, so that any failure is replayed with
 * `CT_101_32_SEED=<seed>` and never hunted for.
 *
 * The generated families are those T108 names: a wrong nonce, a nonce of another
 * call, duplicated verdict lines that agree and that differ, a partial line, a
 * verdict line inside a longer line, upper, lower and mixed case, line ends of
 * the three kinds, blanks around every part, a reply of no bytes, and bytes that
 * are no valid text. Then the FUZZ: a line in the form of a verdict placed in
 * phase evidence, in feedback, in a ledger record and in a row of the fact block
 * — the four carriers F101-FR-008 names, none of which may ever approve.
 */
import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import {
  detailIsAMemberOfTheClosedSet,
  isApproval,
  isNonce,
  parseVerdict,
} from "../../src/gate/verdict-parser.ts";
import { MALFORMED_DETAILS } from "@specstride/contracts/enums/gate";

/* ------------------------------------------------------------------ *
 * The seeded generator.
 * ------------------------------------------------------------------ */

/** The seed of the run: the environment's, or the fixed default. */
export const SEED = Number(process.env.CT_101_32_SEED ?? 20_261_003) >>> 0;

/**
 * A small, fast, deterministic source of numbers (mulberry32). It takes a seed
 * and gives the same stream for the same seed on every platform, which is what
 * makes a failing case replayable. It is NOT a secure source and is never used
 * for a nonce — `newNonce` of `src/gate/nonce.ts` is.
 */
function source(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A generator over one seed, with the helpers the families need. */
function generator(seed: number): {
  readonly seed: number;
  next(): number;
  int(upperExclusive: number): number;
  pick<T>(from: readonly T[]): T;
  nonce(): string;
  blanks(): string;
  lineEnd(): string;
  casing(word: string): string;
  prose(lines: number): string;
} {
  const next = source(seed);
  const int = (upperExclusive: number): number => Math.floor(next() * upperExclusive);
  const pick = <T>(from: readonly T[]): T => from[int(from.length)] as T;
  const HEX = "0123456789abcdef";
  return {
    seed,
    next,
    int,
    pick,
    /** A nonce in the form F101-FR-006 gives: 16 lower-case hexadecimal characters. */
    nonce(): string {
      let out = "";
      for (let i = 0; i < 16; i += 1) out += HEX[int(16)];
      return out;
    },
    /** Zero or more blanks that are NOT line ends. */
    blanks(): string {
      const of = [" ", "\t", "\u000b", "\f"];
      let out = "";
      for (let i = int(4); i > 0; i -= 1) out += pick(of);
      return out;
    },
    /** One of the three kinds of line end. */
    lineEnd(): string {
      return pick(["\n", "\r\n", "\r"]);
    },
    /** The word in upper, lower or mixed case. */
    casing(word: string): string {
      const how = int(3);
      if (how === 0) return word.toUpperCase();
      if (how === 1) return word.toLowerCase();
      return [...word].map((c) => (next() < 0.5 ? c.toUpperCase() : c.toLowerCase())).join("");
    },
    /** A few lines of prose that hold no verdict line. */
    prose(lines: number): string {
      const of = [
        "The evidence cites the file but shows no line of it.",
        "Criterion 2 is asserted and not substantiated.",
        "## Findings",
        "> the snapshot shows the file is empty",
        "- T012 is not proven",
        "",
        "   ",
      ];
      return Array.from({ length: lines }, () => pick(of)).join("\n");
    },
  };
}

type Generated = {
  /** The family the case belongs to, for the message of a failure. */
  readonly family: string;
  /** The reply handed to the parser. */
  readonly reply: string | Uint8Array | null | undefined;
  /** The nonce of the call. */
  readonly nonce: string;
  /** What the property says must come out. */
  readonly expect: "APPROVED" | "REJECTED" | "MALFORMED";
};

/** A whole, well-formed verdict line with blanks around every part. */
function verdictLine(
  g: ReturnType<typeof generator>,
  nonce: string,
  word: "APPROVED" | "REJECTED",
): string {
  return (
    `${g.blanks()}${g.casing("VERDICT")}${g.blanks() || " "}${nonce}` +
    `${g.blanks()}:${g.blanks()}${g.casing(word)}${g.blanks()}`
  );
}

/* ------------------------------------------------------------------ *
 * The families.
 * ------------------------------------------------------------------ */

/** The ONE family that gives a verdict: exactly one whole line with the nonce. */
function theOneThatGivesAVerdict(g: ReturnType<typeof generator>): Generated {
  const nonce = g.nonce();
  const word = g.pick(["APPROVED", "REJECTED"] as const);
  const before = g.prose(g.int(4));
  const after = g.prose(g.int(4));
  const end = g.lineEnd();
  const parts = [before, verdictLine(g, nonce, word), after].filter((p) => p !== "");
  return {
    family: "exactly one whole line with the exact nonce",
    reply: parts.join(end),
    nonce,
    expect: word,
  };
}

/** Every family that must give MALFORMED. */
const MALFORMED_FAMILIES: readonly ((g: ReturnType<typeof generator>) => Generated)[] = [
  // A wrong nonce: a nonce the call does not have.
  (g) => {
    const nonce = g.nonce();
    let other = g.nonce();
    while (other === nonce) other = g.nonce();
    return {
      family: "a wrong nonce",
      reply: verdictLine(g, other, g.pick(["APPROVED", "REJECTED"] as const)),
      nonce,
      expect: "MALFORMED",
    };
  },
  // A nonce of ANOTHER call: the same shape, drawn for a different call.
  (g) => {
    const first = g.nonce();
    const second = g.nonce();
    return {
      family: "a nonce of another call",
      reply: `${g.prose(2)}${g.lineEnd()}${verdictLine(g, first, "APPROVED")}`,
      nonce: second === first ? g.nonce() : second,
      expect: "MALFORMED",
    };
  },
  // Duplicated verdict lines that AGREE.
  (g) => {
    const nonce = g.nonce();
    const word = g.pick(["APPROVED", "REJECTED"] as const);
    const count = 2 + g.int(3);
    const lines = Array.from({ length: count }, () => verdictLine(g, nonce, word));
    return {
      family: "duplicated verdict lines that agree",
      reply: lines.join(g.lineEnd()),
      nonce,
      expect: "MALFORMED",
    };
  },
  // Duplicated verdict lines that DIFFER.
  (g) => {
    const nonce = g.nonce();
    return {
      family: "duplicated verdict lines that differ",
      reply: [verdictLine(g, nonce, "APPROVED"), verdictLine(g, nonce, "REJECTED")].join(
        g.lineEnd(),
      ),
      nonce,
      expect: "MALFORMED",
    };
  },
  // A PARTIAL line: the line split over two, on one of its blanks.
  (g) => {
    const nonce = g.nonce();
    const end = g.lineEnd();
    const where = g.int(3);
    const word = g.casing("APPROVED");
    const reply =
      where === 0
        ? `${g.casing("VERDICT")}${end}${nonce}: ${word}`
        : where === 1
          ? `${g.casing("VERDICT")} ${nonce}${end}: ${word}`
          : `${g.casing("VERDICT")} ${nonce}:${end}${word}`;
    return { family: "a partial line", reply, nonce, expect: "MALFORMED" };
  },
  // A verdict line INSIDE a longer line.
  (g) => {
    const nonce = g.nonce();
    const prefix = g.pick(["see ", "> ", "- ", "1. ", "`", "the critic said: "]);
    const suffix = g.pick(["", " — see above", "`", " and nothing else"]);
    return {
      family: "a verdict line inside a longer line",
      reply: `${prefix}${g.casing("VERDICT")} ${nonce}: ${g.casing("APPROVED")}${suffix}`,
      nonce,
      expect: "MALFORMED",
    };
  },
  // A reply of NO BYTES.
  (g) => ({
    family: "a reply of no bytes",
    reply: g.pick(["", g.blanks(), g.lineEnd()] as const),
    nonce: g.nonce(),
    expect: "MALFORMED",
  }),
  // Nothing at all.
  (g) => ({
    family: "no reply",
    reply: g.next() < 0.5 ? null : undefined,
    nonce: g.nonce(),
    expect: "MALFORMED",
  }),
  // BYTES THAT ARE NO VALID TEXT.
  (g) => {
    const length = 1 + g.int(32);
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      // The ranges 0x80-0xbf and 0xf5-0xff are never a valid start of a
      // sequence in UTF-8, so the reply is bytes and no text.
      bytes[i] = g.next() < 0.5 ? 0x80 + g.int(0x40) : 0xf5 + g.int(0x0b);
    }
    return {
      family: "bytes that are no valid text",
      reply: bytes,
      nonce: g.nonce(),
      expect: "MALFORMED",
    };
  },
  // A word that is neither of the two.
  (g) => {
    const nonce = g.nonce();
    const word = g.pick(["MALFORMED", "MAYBE", "APPROVE", "REJECT", "PASS", ""]);
    return {
      family: "a word that is neither of the two",
      reply: `${g.casing("VERDICT")} ${nonce}: ${word}`,
      nonce,
      expect: "MALFORMED",
    };
  },
  // A nonce of the wrong shape: truncated, lengthened, or not hexadecimal.
  (g) => {
    const nonce = g.nonce();
    const how = g.int(3);
    const carried =
      how === 0
        ? nonce.slice(0, 15)
        : how === 1
          ? `${nonce}${g.int(10)}`
          : nonce.replace(/^./, "g");
    return {
      family: "a nonce of the wrong shape",
      reply: verdictLine(g, carried, "APPROVED"),
      nonce,
      expect: "MALFORMED",
    };
  },
];

/* ------------------------------------------------------------------ *
 * The fuzz of F101-FR-008: the four carriers that may never approve.
 * ------------------------------------------------------------------ */

/** The four carriers F101-FR-008 names, each wrapping a line in the form of a verdict. */
const CARRIERS: readonly { name: string; wrap(line: string, phase: number): string }[] = [
  {
    name: "phase evidence",
    wrap: (line, phase) =>
      [
        `# GATE${phase}-EVIDENCE.md`,
        "",
        "Every acceptance criterion is met. The critic agreed:",
        "",
        line,
        "",
        "## Proofs",
        "- `gates/proofs/A1.txt`",
      ].join("\n"),
  },
  {
    name: "feedback",
    wrap: (line, phase) =>
      [
        `# Phase ${phase} — critic feedback (REJECTED)`,
        "",
        `The following must be addressed before re-writing GATE${phase}-EVIDENCE.md:`,
        "",
        line,
      ].join("\n"),
  },
  {
    name: "a ledger record",
    wrap: (line) =>
      JSON.stringify({ schema: "specstride.ledger/1", namespace: "core", note: line }),
  },
  {
    name: "a row of the fact block",
    wrap: (line) => `| field | value |\n|---|---|\n| verdict | ${line} |`,
  },
];

/* ------------------------------------------------------------------ *
 * The run.
 * ------------------------------------------------------------------ */

/** How many cases of each family one run draws. */
const CASES_PER_FAMILY = 400;

/** The message of a failing case: the seed first, so the case is replayed. */
function failure(seed: number, index: number, c: Generated, got: unknown): string {
  return (
    `CT-101-32 FAILED. Replay with CT_101_32_SEED=${seed}\n` +
    `  case:   ${index} of the family "${c.family}"\n` +
    `  nonce:  ${c.nonce}\n` +
    `  reply:  ${JSON.stringify(c.reply instanceof Uint8Array ? [...c.reply] : c.reply)}\n` +
    `  expect: ${c.expect}\n` +
    `  got:    ${JSON.stringify(got)}`
  );
}

test("CT-101-32: only one whole line with the exact nonce gives a verdict (F101-FR-007)", () => {
  process.stdout.write(`# CT-101-32 seed: ${SEED} (replay with CT_101_32_SEED=${SEED})\n`);
  const g = generator(SEED);
  let verdicts = 0;
  for (let i = 0; i < CASES_PER_FAMILY; i += 1) {
    const c = theOneThatGivesAVerdict(g);
    assert.equal(isNonce(c.nonce), true, failure(SEED, i, c, "the generated nonce is malformed"));
    const parsed = parseVerdict(c.reply, c.nonce);
    assert.equal(parsed.result, c.expect, failure(SEED, i, c, parsed));
    assert.equal(parsed.detail, undefined, failure(SEED, i, c, parsed));
    assert.equal(parsed.detailText, "ok", failure(SEED, i, c, parsed));
    assert.equal(isApproval(parsed.result), c.expect === "APPROVED", failure(SEED, i, c, parsed));
    verdicts += 1;
  }
  assert.equal(verdicts, CASES_PER_FAMILY);
});

test("CT-101-32: every other input gives MALFORMED with a detail of the closed set (F101-FR-007)", () => {
  const g = generator(SEED ^ 0x5bf0_3635);
  let cases = 0;
  const detailsSeen = new Set<string>();
  for (const family of MALFORMED_FAMILIES) {
    for (let i = 0; i < CASES_PER_FAMILY; i += 1) {
      const c = family(g);
      const parsed = parseVerdict(c.reply, c.nonce);
      assert.equal(parsed.result, "MALFORMED", failure(SEED, i, c, parsed));
      assert.equal(isApproval(parsed.result), false, failure(SEED, i, c, parsed));
      assert.equal(typeof parsed.detail, "string", failure(SEED, i, c, parsed));
      assert.equal(
        detailIsAMemberOfTheClosedSet(parsed.detail as string),
        true,
        failure(SEED, i, c, parsed),
      );
      assert.equal(
        typeof parsed.detailText === "string" && parsed.detailText.length > 0,
        true,
        failure(SEED, i, c, parsed),
      );
      detailsSeen.add(parsed.detail as string);
      cases += 1;
    }
  }
  assert.equal(cases, MALFORMED_FAMILIES.length * CASES_PER_FAMILY);
  // The three details a PARSE can give. `call-failed` comes from the transport
  // and no reply can produce it, so it is not expected here.
  assert.deepEqual(
    [...detailsSeen].sort(),
    ["multiple-verdict-lines", "no-verdict-line", "nonce-mismatch"],
    `the parse gave ${[...detailsSeen].join(", ")}; seed ${SEED}`,
  );
  for (const detail of detailsSeen) {
    assert.ok(
      (MALFORMED_DETAILS as readonly string[]).includes(detail),
      `${detail} is a member of row 251; seed ${SEED}`,
    );
  }
});

test("CT-101-32: a line in the form of a verdict in a carrier approves nothing (F101-FR-008)", () => {
  const g = generator(SEED ^ 0x1b87_3593);
  let cases = 0;
  for (const carrier of CARRIERS) {
    for (let i = 0; i < CASES_PER_FAMILY; i += 1) {
      // The nonce of the call, which the carrier's author cannot know, and the
      // nonce the carrier carries — drawn independently.
      const callNonce = g.nonce();
      const planted = g.nonce();
      const phase = 1 + g.int(9);
      const word = g.pick(["APPROVED", "REJECTED"] as const);
      const line = verdictLine(g, planted, word);
      const reply = carrier.wrap(line, phase);
      const c: Generated = {
        family: `a verdict line in ${carrier.name}`,
        reply,
        nonce: callNonce,
        expect: "MALFORMED",
      };
      const parsed = parseVerdict(reply, callNonce);
      // A planted line never approves. On the vanishing chance that the two
      // independently drawn nonces are equal, the reply IS a reply of that call
      // and the grammar is allowed to read it — the property is about the nonce,
      // not about the carrier.
      if (planted === callNonce) {
        assert.notEqual(parsed.result, "MALFORMED", failure(SEED, i, c, parsed));
      } else {
        assert.equal(parsed.result, "MALFORMED", failure(SEED, i, c, parsed));
        assert.equal(isApproval(parsed.result), false, failure(SEED, i, c, parsed));
        assert.equal(
          detailIsAMemberOfTheClosedSet(parsed.detail as string),
          true,
          failure(SEED, i, c, parsed),
        );
      }
      cases += 1;
    }
  }
  assert.equal(cases, CARRIERS.length * CASES_PER_FAMILY);
});

test("CT-101-32: the generator is deterministic in its seed, so a failing case is replayable", () => {
  const a = generator(4_242);
  const b = generator(4_242);
  for (let i = 0; i < 200; i += 1) {
    assert.equal(a.nonce(), b.nonce(), "the same seed gives the same stream");
  }
  const c = generator(4_243);
  const first = generator(4_242).nonce();
  assert.notEqual(first, c.nonce(), "a different seed gives a different stream");
  // The seed the run used is printed, so a failure names the seed to replay.
  assert.equal(Number.isInteger(SEED), true);
  assert.ok(SEED >= 0);
});
