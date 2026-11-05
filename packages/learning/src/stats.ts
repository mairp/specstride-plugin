/**
 * T009 — the statistics of learning (F106-FR-005): the percentile with linear
 * interpolation, the exact one-sided binomial tail and the exact rank test of
 * the critic-input-size guardrail.
 *
 * Ported unchanged from the baseline (`lib/learn.py` at the pinned commit
 * `9cab15d2`): `percentile`, `binom_upper`/`binom_lower` and the p of
 * `_size_guard`. The constants `tests/parity/106/stats.test.ts` asserts were
 * computed from that pinned reference — see the proof slice
 * `.specstride/features/106-learning/gates/proofs/T009-stats-reference.md`.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */

/**
 * The percentile of `values` at `pct`, linear interpolation between the sorted
 * samples, rounded to one decimal (the baseline's `percentile`); `null` for no
 * values.
 */
export function percentile(values: readonly number[], pct: number): number | null {
  if (values.length === 0) return null;
  const vs = [...values].sort((a, b) => a - b);
  const k = (vs.length - 1) * pct;
  const lo = Math.floor(k);
  const hi = Math.min(lo + 1, vs.length - 1);
  return round1(vs[lo]! + (vs[hi]! - vs[lo]!) * (k - lo));
}

/** Round to one decimal, the rounding every learning figure uses. */
export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** n choose k, exactly, as an unsigned big integer. */
export function comb(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let out = 1n;
  const take = Math.min(k, n - k);
  for (let i = 0; i < take; i++) {
    out = (out * BigInt(n - i)) / BigInt(i + 1);
  }
  return out;
}

/**
 * P(X ≥ k) for X ~ Binomial(n, p), exactly (the baseline's `binom_upper`): the
 * sum of the point probabilities from k to n, capped at 1.
 */
export function binomUpper(k: number, n: number, p: number): number {
  let sum = 0;
  for (let i = k; i <= n; i++) {
    sum += Number(comb(n, i)) * Math.pow(p, i) * Math.pow(1 - p, n - i);
  }
  return Math.min(1, sum);
}

/** P(X ≤ k) for X ~ Binomial(n, p), exactly (the baseline's `binom_lower`). */
export function binomLower(k: number, n: number, p: number): number {
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    sum += Number(comb(n, i)) * Math.pow(p, i) * Math.pow(1 - p, n - i);
  }
  return Math.min(1, sum);
}

/** The result of the exact rank test of the critic-input-size guardrail. */
export type RankTest = {
  /** The applied-arm prompts larger than every baseline prompt. */
  readonly k: number;
  /** P(K ≥ k) under exchangeability: C(n_a, k) / C(n_a + n_b, k). */
  readonly p: number;
};

/**
 * The exact rank test of `_size_guard` (05-evaluate-design.md §2.9): K counts
 * how many applied-arm prompts are larger than every baseline prompt; the k
 * largest prompts of both arms pooled are all applied exactly when K ≥ k, so
 * P(K ≥ k) = C(n_a, k) / C(n_a + n_b, k). `k = 0` is p = 1 (the baseline
 * writes the ratio only for k above zero, and 1 is its value there).
 */
export function exactRankTail(
  sizesApplied: readonly number[],
  sizesBaseline: readonly number[],
): RankTest {
  const nA = sizesApplied.length;
  const nB = sizesBaseline.length;
  if (nB === 0) return { k: 0, p: 1 };
  const top = Math.max(...sizesBaseline);
  const k = sizesApplied.filter((v) => v > top).length;
  if (k === 0) return { k: 0, p: 1 };
  const p = Number(comb(nA, k)) / Number(comb(nA + nB, k));
  return { k, p };
}
