// =============================================================
// math.ts — All mathematical primitives for V3
// =============================================================

export const ε = 1e-9;

export const clamp = (n: number, min = 0, max = 100): number =>
  Math.max(min, Math.min(max, n));

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// ── Sigmoid family ────────────────────────────────────────────

/** Standard logistic: σ(x) = 1 / (1 + e^-x) */
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * Calibrated scoring sigmoid: sig(x, k)
 *   = sigmoid((x/k − 1) × 4)
 *
 * Properties:
 *   x = 0   → 0.018  (floor — never collapses)
 *   x = k   → 0.500  (50th-percentile anchor)
 *   x = 2k  → 0.982  (strong; diminishing returns)
 *   x → ∞   → 1.000  (ceiling)
 */
export const sig = (x: number, k: number): number => sigmoid((x / k - 1) * 4);

/**
 * Distribution shaper.
 * Maps a linear 0–100 composite onto a shaped 0–100 curve
 * that compresses mid-range and expands tail separation.
 *
 *   shaped = sigmoid((x/100 − 0.5) × 6) × 100
 *
 *   x=20 → ~14  (weak, pushed down)
 *   x=50 → ~50  (neutral midpoint preserved)
 *   x=80 → ~86  (strong, expanded)
 *   x=95 → ~97  (elite separation)
 */
export const shapeDistribution = (raw: number): number =>
  clamp(sigmoid((raw / 100 - 0.5) * 6) * 100);

// ── Decay functions ───────────────────────────────────────────

/**
 * Exponential decay: e^(-t / halfLife)
 *
 * τ_fast = 14 days → event recency (yesterday >> last month)
 * τ_slow = 90 days → heat/presence decay (still around?)
 */
export const decay = (ageDays: number, halfLife: number): number =>
  Math.exp(-ageDays / halfLife);

/**
 * Age normalization factor — sub-linear compression.
 *
 * factor = 1 / (accountAgeDays ^ 0.4)
 *
 * Prevents legacy advantage: doubling account age raises the
 * denominator by only 2^0.4 ≈ 1.32, not 2×.
 * Result is multiplied into activity to get per-unit-time rate.
 */
export const ageNormFactor = (accountAgeDays: number): number =>
  1 / Math.max(1, Math.pow(accountAgeDays, 0.4));

// ── Statistics ────────────────────────────────────────────────

export const mean = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
};

export const stdDev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
};

export const cov = (xs: number[]): number => {
  const m = mean(xs);
  return m === 0 ? 0 : stdDev(xs) / m;
};

/**
 * EMA series: α · xₙ + (1 − α) · EMAₙ₋₁
 * Returns array of same length as input.
 */
export const emaSeries = (xs: number[], alpha: number): number[] => {
  if (xs.length === 0) return [];
  const out = [xs[0]!];
  for (let i = 1; i < xs.length; i++) {
    out.push(alpha * xs[i]! + (1 - alpha) * out[i - 1]!);
  }
  return out;
};

/**
 * Student's t critical value (95% CI, two-tailed) lookup.
 * Approximation for N ≥ 30 uses 1.96.
 */
export const tCritical95 = (n: number): number => {
  if (n <= 1) return 12.706;
  if (n === 2) return 4.303;
  if (n === 3) return 3.182;
  if (n === 4) return 2.776;
  if (n === 5) return 2.571;
  if (n <= 10) return 2.228;
  if (n <= 20) return 2.086;
  if (n <= 30) return 2.042;
  return 1.96;
};

/**
 * 95% confidence interval around a mean given a sample.
 * Returns [lower, upper] clamped to [0, 100].
 */
export const confidenceInterval = (
  scores: number[],
  currentScore: number,
): [number, number] => {
  const n = scores.length;
  if (n < 2)
    return [Math.max(0, currentScore - 25), Math.min(100, currentScore + 25)];

  const sd = stdDev(scores);
  const t = tCritical95(n);
  const margin = (sd / Math.sqrt(n)) * t;

  return [
    Math.max(0, Math.round((currentScore - margin) * 10) / 10),
    Math.min(100, Math.round((currentScore + margin) * 10) / 10),
  ];
};

/**
 * Percentile rank of value within a peer array.
 * Returns 0–100.
 */
export const percentileRank = (value: number, peers: number[]): number => {
  if (peers.length === 0) return 50;
  const below = peers.filter((p) => p < value).length;
  return clamp((below / peers.length) * 100);
};

/**
 * Confidence level label from snapshot count and data quality.
 */
export const confidenceLevel = (
  snapshotCount: number,
  dataQuality: number,
): import("./types.js").ConfidenceLevel => {
  const raw = (Math.log(snapshotCount + 1) / Math.log(20)) * dataQuality;
  if (raw < 0.15) return "very_low";
  if (raw < 0.35) return "low";
  if (raw < 0.6) return "medium";
  if (raw < 0.8) return "high";
  return "very_high";
};

/** Scalar confidence 0–1 */
export const confidenceScore = (
  snapshotCount: number,
  dataQuality: number,
): number =>
  clamp01((Math.log(snapshotCount + 1) / Math.log(20)) * dataQuality);
