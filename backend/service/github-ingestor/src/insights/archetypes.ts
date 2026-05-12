// src/insights/archetypes.ts

/**
 * Archetype engine.
 *
 * Archetypes are human-readable identity labels derived from the
 * combination of sub-scores, activity shape, and score band.
 *
 * Score band gates which archetypes are allowed to fire:
 *   low/average  → restrained archetypes only (see score-band.ts for titles)
 *   strong/elite → full archetype set
 *
 * The title and description returned here are used for strong/elite bands.
 * For low/average bands the job delegates to getConstrainedArchetypeTitle
 * in score-band.ts — the archetype key itself is still stored for analytics.
 */

import type { ScoreBand } from "./score-band.js";

export type Archetype =
  | "ecosystem_builder"
  | "emerging_maintainer"
  | "focused_contributor"
  | "high_impact_researcher"
  | "rising_oss_contributor"
  | "infrastructure_developer"
  | "experimental_builder"
  | "reliable_maintainer"
  | "low_visibility_specialist"
  | "broad_spectrum_contributor"
  | "high_volume_low_signal"
  | "dormant_profile";

export type ArchetypeResult = {
  archetype: Archetype;
  /** Full-fidelity title — may be overridden by score band constraints. */
  title: string;
  /** One-sentence analytical description. */
  description: string;
};

export type ArchetypeInput = {
  activityScore: number;
  impactScore: number;
  consistencyScore: number;
  reachScore: number;
  repos: number;
  stars: number;
  followers: number;
  pushes: number;
  prs: number;
  issues: number;
  activityTrend: number;
  impactTrend: number;
  consistencyTrend: number;
  reachTrend: number;
  totalScore: number;
  band: ScoreBand;
};

function repoBreadthScore(repos: number, pushes: number): number {
  if (pushes === 0) return 0;
  return Math.min(100, (repos / Math.max(1, pushes)) * 200);
}

function collaborationRatio(
  pushes: number,
  prs: number,
  issues: number
): number {
  const total = pushes + prs + issues;
  if (total === 0) return 0;
  return ((prs + issues) / total) * 100;
}

export function classifyArchetype(input: ArchetypeInput): ArchetypeResult {
  const {
    activityScore,
    impactScore,
    consistencyScore,
    reachScore,
    repos,
    stars,
    pushes,
    prs,
    issues,
    activityTrend,
    impactTrend,
    consistencyTrend,
    totalScore,
    band,
  } = input;

  const breadth = repoBreadthScore(repos, pushes);
  const collab = collaborationRatio(pushes, prs, issues);

  // Dormant: nothing happening across the board
  if (activityScore < 30 && impactScore < 25 && consistencyScore < 25) {
    return {
      archetype: "dormant_profile",
      title: "Dormant profile",
      description:
        "Contribution activity is minimal across all tracked signals, suggesting the account is largely inactive in the observed period.",
    };
  }

  // High volume, low impact — regardless of band, this combination is named.
  // Threshold is 45 (not 50) to align with the tension engine's activity threshold.
  if (activityScore >= 45 && impactScore < 32 && reachScore < 32) {
    return {
      archetype: "high_volume_low_signal",
      title: "High-volume, low-signal contributor",
      // Description is identity-level only. The tension card in engine.ts
      // explains the mechanism (why impact is low). Keeping both high-level
      // prevents the headline and tension from opening with the same sentence.
      description:
        "A profile with active commit history but limited ecosystem traction across impact and reach dimensions.",
    };
  }

  // Below here: strong/elite archetypes — gated by band
  // For low/average, the archetype key is still returned for analytics
  // but getConstrainedArchetypeTitle will override the displayed label.

  if (band === "low" || band === "average") {
    // Assign the analytically correct key without the rich label
    const fallback: Archetype =
      activityScore >= 45
        ? "rising_oss_contributor"
        : consistencyScore >= 40
        ? "emerging_maintainer"
        : "focused_contributor";

    const descriptions: Record<typeof fallback, string> = {
      rising_oss_contributor:
        "Activity signals are present but ecosystem impact and visibility have not yet developed.",
      emerging_maintainer:
        "Contribution cadence is developing, but recognition and impact remain limited.",
      focused_contributor:
        "Contribution patterns are forming without a dominant signal in any dimension.",
    };

    return {
      archetype: fallback,
      title: "Developing contributor", // overridden by band in engine
      description: descriptions[fallback],
    };
  }

  // ── Strong / elite archetypes ────────────────────────────────────────────

  if (impactScore >= 60 && activityScore < 45 && input.stars >= 5) {
    return {
      archetype: "high_impact_researcher",
      title: "High-impact researcher",
      description:
        "A small number of high-visibility contributions generate outsized ecosystem recognition relative to overall activity frequency.",
    };
  }

  if (reachScore >= 55 && breadth > 40 && repos >= 15 && collab > 20) {
    return {
      archetype: "ecosystem_builder",
      title: "Ecosystem builder",
      description:
        "Active across a wide surface area of repositories with meaningful reach, indicating deliberate participation in the broader open-source ecosystem.",
    };
  }

  if (consistencyScore >= 60 && !( reachScore >= 50) && repos >= 5) {
    return {
      archetype: "emerging_maintainer",
      title: "Emerging maintainer",
      description:
        "Consistent contribution cadence across multiple repositories points toward a stabilizing maintainer role, though ecosystem visibility is still developing.",
    };
  }

  if (consistencyScore >= 60 && impactScore >= 55 && Math.abs(activityTrend) <= 0.04) {
    return {
      archetype: "reliable_maintainer",
      title: "Reliable maintainer",
      description:
        "Stable, high-quality contributions with strong consistency signal a developer trusted to maintain production-grade work over time.",
    };
  }

  if (consistencyScore >= 50 && collab < 10 && reachScore < 50) {
    return {
      archetype: "infrastructure_developer",
      title: "Infrastructure-focused developer",
      description:
        "Contribution patterns lean toward solitary, consistent output with limited public collaboration — often characteristic of infrastructure or tooling work.",
    };
  }

  if (activityTrend > 0.06 && totalScore >= 40 && impactScore < impactScore + 15) {
    return {
      archetype: "rising_oss_contributor",
      title: "Rising open-source contributor",
      description:
        "Multiple signals are improving simultaneously, suggesting an active growth phase with increasing ecosystem engagement.",
    };
  }

  if (activityScore >= 65 && breadth > 30 && impactScore < 50) {
    return {
      archetype: "experimental_builder",
      title: "Experimental builder",
      description:
        "High activity spread across many repositories with moderate impact suggests an exploratory phase — shipping often but not yet generating significant ecosystem traction.",
    };
  }

  if (repos <= 5 && activityScore >= 50 && impactScore >= 45) {
    return {
      archetype: "focused_contributor",
      title: "Focused contributor",
      description:
        "Contribution energy is concentrated in a small number of repositories, with meaningful output relative to scope.",
    };
  }

  if (breadth > 35 && repos >= 10) {
    return {
      archetype: "broad_spectrum_contributor",
      title: "Broad-spectrum contributor",
      description:
        "Activity is distributed across many repositories with moderate depth in each, suggesting a generalist contributor style.",
    };
  }

  if (impactScore >= 45 && reachScore < 35 && consistencyScore >= 45) {
    return {
      archetype: "low_visibility_specialist",
      title: "Low-visibility specialist",
      description:
        "Contribution quality is solid relative to ecosystem recognition — meaningful work is occurring, but public reach has not scaled with it.",
    };
  }

  return {
    archetype: "focused_contributor",
    title: "Focused contributor",
    description:
      "Contribution patterns are stable without a dominant signal in any single dimension.",
  };
}