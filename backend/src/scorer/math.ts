// ============================================================
// math.ts — Pure math utilities (no I/O, fully testable)
// ============================================================

/** Clamp a value between [min, max] */
export const clamp = (n: number, min = 0, max = 1): number =>
  Math.max(min, Math.min(max, n));

/**
 * Sigmoid normalisation.
 *
 * σ(x) = 1 / (1 + e^(-k * (x - mu)))
 *
 * Maps any real number → (0, 1).
 * k  → steepness; higher k = sharper transition
 * mu → inflection midpoint (value that maps to 0.5)
 */
export function sigmoid(x: number, k: number, mu: number): number {
  return 1 / (1 + Math.exp(-k * (x - mu)));
}

/**
 * Exponential time-decay weight.
 *
 * w(t) = e^(-t / halfLifeDays * ln2)
 *       = 0.5 when t === halfLifeDays
 */
export function decayWeight(ageDays: number, halfLifeDays = 10): number {
  return Math.exp((-ageDays / halfLifeDays) * Math.LN2);
}

/** Population mean */
export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

/** Population standard deviation */
export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
}

/**
 * Exponential Moving Average series.
 *
 * EMA_n = α · S_n + (1 - α) · EMA_{n-1}
 * α     = 2 / (N + 1)   (standard span formula)
 *
 * Returns an array of the same length as `values`.
 */
export function ema(values: number[], span = 3): number[] {
  if (values.length === 0) return [];
  const α = 2 / (span + 1);
  const result: number[] = [values[0]!];
  for (let i = 1; i < values.length; i++) {
    result.push(α * values[i]! + (1 - α) * result[i - 1]!);
  }
  return result;
}

/**
 * Ordinary Least Squares slope over (index, value) pairs.
 *
 * slope = (N·Σxy - Σx·Σy) / (N·Σx² - (Σx)²)
 *
 * Positive → upward trend, negative → downward trend.
 */
export function lsSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i]!;
    sumXY += i * values[i]!;
    sumX2 += i * i;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Linear percentile rank of `value` within an array of peer scores.
 * Returns a value in [0, 100].
 */
export function percentileRankIn(value: number, peers: number[]): number {
  if (peers.length === 0) return 50; // neutral fallback
  const below = peers.filter((p) => p < value).length;
  return clamp((below / peers.length) * 100, 0, 100);
}