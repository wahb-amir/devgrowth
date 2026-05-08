// =============================================================
// math.ts — Pure math primitives for V3
// =============================================================

/**
 * Clamp a value to [min, max].
 */
export const clamp = (n: number, min = 0, max = 100): number =>
  Math.max(min, Math.min(max, n));

/**
 * Standard logistic sigmoid: σ(x) = 1 / (1 + e^-x)
 * Domain: ℝ → (0, 1)
 */
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * Calibrated sigmoid for scoring: sig(x / k)
 *
 * Transforms a raw metric x with anchor k into (0, 1) where:
 *   x = 0   → 0.500  (never collapses to zero — prevents impact collapse)
 *   x = k   → 0.731  (mid-tier dev)
 *   x = 2k  → 0.880  (strong dev)
 *   x = 3k  → 0.953  (elite dev, diminishing returns here)
 *
 * Steepness=4 produces a curve that is linear around the midpoint
 * and compresses gracefully at the extremes.
 *
 * @param raw   Raw metric value (e.g. 115 pushes)
 * @param k     Anchor constant = "what a mid-tier dev produces"
 */
export const sig = (raw: number, k: number): number =>
  sigmoid((raw / k - 1) * 4);

/**
 * Exponential time decay.
 * w(t) = e^(-t / halfLife)
 *
 * halfLife=10 days → w(10d) = 0.368, w(30d) = 0.050
 * This is harsher than the v2 half-life (which used ln2 scaling).
 * Rationale: 30-day-old activity should contribute < 5% to current score.
 */
export const decay = (ageDays: number, halfLife = 10): number =>
  Math.exp(-ageDays / halfLife);

/**
 * Population mean.
 */
export const mean = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
};

/**
 * Population standard deviation.
 */
export const stdDev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
};

/**
 * Coefficient of variation: stdDev / mean.
 * Used to measure consistency variance.
 * Returns 0 when mean is 0 (no activity → no variance penalty).
 */
export const cov = (xs: number[]): number => {
  const m = mean(xs);
  if (m === 0) return 0;
  return stdDev(xs) / m;
};

/**
 * EMA-based trend.
 * trend = α·current + (1-α)·previous
 * With α=0.7, recent score dominates.
 *
 * Returns the delta: positive = growing, negative = declining.
 */
export const emaTrend = (
  current: number,
  previous: number,
  alpha = 0.7
): number => {
  const ema = alpha * current + (1 - alpha) * previous;
  return ema - previous; // delta against the stable baseline
};

/**
 * Confidence score.
 * clamp(log(snapshots + 1) / log(20))
 *
 * snapshots=0  → 0.000
 * snapshots=1  → 0.153
 * snapshots=5  → 0.389
 * snapshots=10 → 0.535
 * snapshots=19 → 1.000  (asymptote target)
 * snapshots=50 → 1.000  (clamped)
 */
export const confidence = (snapshotCount: number): number =>
  clamp(Math.log(snapshotCount + 1) / Math.log(20), 0, 1);

/**
 * Final distribution shaper.
 * Applies sigmoid to the composite to stretch the tails:
 *   - Compresses 40–60 (average band)
 *   - Expands 70–90 (strong band), making elite separation visible
 *
 * Input:  0–100 (linear composite)
 * Output: 0–100 (shaped)
 *
 * Derivation:
 *   raw sigmoid maps [0,100] → (0.5, 0.731) — too narrow.
 *   Re-centre to [-1, 1] before sigmoid, then re-expand to [0,100]:
 *   shaped = sigmoid((x/100 - 0.5) * 6) * 100
 *
 *   This gives:
 *     x=20  → ~11  (weak, pushed down)
 *     x=50  → ~50  (neutral midpoint is preserved)
 *     x=70  → ~73  (strong, pushed up slightly)
 *     x=85  → ~88  (elite, expanded)
 */
export const shapeDistribution = (rawScore: number): number => {
  const centred = (rawScore / 100 - 0.5) * 6;
  return clamp(sigmoid(centred) * 100);
};