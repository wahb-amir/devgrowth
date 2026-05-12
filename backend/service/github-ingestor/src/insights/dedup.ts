// src/insights/dedup.ts

/**
 * Concept deduplication registry.
 *
 * Tracks which semantic concepts have already been expressed in the
 * current insight document. Before a card is added to the output, its
 * concept keys are checked here. If any key is already registered, the
 * card is suppressed.
 *
 * This is the single mechanism that prevents:
 *   - "activity is rising" appearing in both a strength card and a trajectory card
 *   - "impact is weak" appearing in both a tension card and a watch area card
 *   - "low confidence" being mentioned in more than one card
 *
 * Concept keys are coarse-grained by design. The goal is semantic
 * uniqueness, not exact string deduplication.
 */

export type ConceptKey =
  | "activity_positive"
  | "activity_negative"
  | "impact_positive"
  | "impact_negative"
  | "impact_weak_vs_activity"   // tension: volume ≠ impact
  | "consistency_positive"
  | "consistency_negative"
  | "reach_positive"
  | "reach_negative"
  | "reach_weak_vs_consistency" // tension: consistent but invisible
  | "reach_weak_vs_reach_score" // watch area: reach is low
  | "collaboration_low"
  | "low_total_score"
  | "overall_score_low"         // claimed by low/average headline; blocks generic score watch area
  | "watch_area_slot"           // claimed by first admitted watch area; prevents a second one
  | "confidence_limited"
  | "trajectory_positive"
  | "trajectory_negative"
  | "trajectory_mixed";

export class ConceptRegistry {
  private used = new Set<ConceptKey>();

  /**
   * Returns true if ALL given keys are unused (card may be added).
   * Returns false if ANY key is already registered (card is suppressed).
   */
  canUse(keys: ConceptKey[]): boolean {
    return keys.every((k) => !this.used.has(k));
  }

  /** Register keys after a card is accepted. */
  register(keys: ConceptKey[]): void {
    for (const k of keys) this.used.add(k);
  }

  /**
   * Convenience: try to claim keys. Returns true and registers them
   * if all are free; returns false and registers nothing if any clash.
   */
  claim(keys: ConceptKey[]): boolean {
    if (!this.canUse(keys)) return false;
    this.register(keys);
    return true;
  }
}