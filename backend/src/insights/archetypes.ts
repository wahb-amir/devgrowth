// src/insights/archetypes.ts

/**
 * Archetype engine.
 *
 * An archetype is a human-readable identity derived from the combination of
 * sub-scores, their relationships, and activity shape — NOT just individual
 * thresholds. Each archetype has a title and a one-sentence description that
 * explains the profile without restating numbers.
 */

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
  title: string;
  description: string;
};

type ArchetypeInput = {
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
};

/**
 * Repo breadth proxy: many repos + high push count = broad spread.
 * Ratio of repos to pushes gives an inverse concentration signal.
 */
function repoBreadthScore(repos: number, pushes: number): number {
  if (pushes === 0) return 0;
  // More repos per push unit = more breadth
  return Math.min(100, (repos / Math.max(1, pushes)) * 200);
}

/**
 * Collaboration proxy: PRs + issues relative to total activity.
 */
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
  } = input;

  const breadth = repoBreadthScore(repos, pushes);
  const collab = collaborationRatio(pushes, prs, issues);
  const isHighActivity = activityScore >= 60;
  const isHighImpact = impactScore >= 55;
  const isHighConsistency = consistencyScore >= 55;
  const isHighReach = reachScore >= 50;
  const isRising =
    activityTrend > 0.06 || impactTrend > 0.06 || consistencyTrend > 0.06;
  const isLowSignal = totalScore < 30;
  const isVeryLowActivity = activityScore < 30;

  // Dormant: nothing happening across the board
  if (isVeryLowActivity && impactScore < 25 && consistencyScore < 25) {
    return {
      archetype: "dormant_profile",
      title: "Dormant profile",
      description:
        "Contribution activity is minimal across all tracked signals, suggesting the account is largely inactive in the observed period.",
    };
  }

  // High volume, low impact — activity not converting
  if (activityScore >= 55 && impactScore < 30 && reachScore < 30) {
    return {
      archetype: "high_volume_low_signal",
      title: "High-volume, low-signal contributor",
      description:
        "Commit volume is substantial but ecosystem impact and visibility remain limited, indicating work concentrated in private or low-traction repositories.",
    };
  }

  // Elite impact with selective, low activity
  if (isHighImpact && activityScore < 45 && stars >= 5) {
    return {
      archetype: "high_impact_researcher",
      title: "High-impact researcher",
      description:
        "A small number of high-visibility contributions are generating outsized ecosystem recognition, with low overall contribution frequency.",
    };
  }

  // Broad ecosystem participation, good reach, many repos
  if (isHighReach && breadth > 40 && repos >= 15 && collab > 20) {
    return {
      archetype: "ecosystem_builder",
      title: "Ecosystem builder",
      description:
        "Active across a wide surface area of repositories with meaningful reach, suggesting deliberate participation in the broader open-source ecosystem.",
    };
  }

  // Strong consistency, growing, not yet high reach
  if (
    isHighConsistency &&
    !isHighReach &&
    consistencyTrend >= 0 &&
    repos >= 5
  ) {
    return {
      archetype: "emerging_maintainer",
      title: "Emerging maintainer",
      description:
        "Consistent contribution cadence across multiple repositories points toward a stabilizing maintainer role, though ecosystem visibility is still developing.",
    };
  }

  // Reliable consistency + good impact, stable patterns
  if (isHighConsistency && isHighImpact && Math.abs(activityTrend) <= 0.04) {
    return {
      archetype: "reliable_maintainer",
      title: "Reliable maintainer",
      description:
        "Stable, high-quality contributions with strong consistency signals a developer trusted to maintain production-grade work over time.",
    };
  }

  // Infrastructure-leaning: low collab ratio, high consistency, low reach
  if (consistencyScore >= 50 && collab < 10 && !isHighReach) {
    return {
      archetype: "infrastructure_developer",
      title: "Infrastructure-focused developer",
      description:
        "Contribution patterns lean toward solitary, consistent output with limited public collaboration, often characteristic of infrastructure or tooling work.",
    };
  }

  // Rising across multiple vectors
  if (isRising && totalScore >= 30 && !isHighImpact) {
    return {
      archetype: "rising_oss_contributor",
      title: "Rising open-source contributor",
      description:
        "Multiple signals are improving simultaneously, suggesting an active growth phase with increasing ecosystem engagement.",
    };
  }

  // High activity, decent breadth, low impact — experimental
  if (isHighActivity && breadth > 30 && impactScore < 45) {
    return {
      archetype: "experimental_builder",
      title: "Experimental builder",
      description:
        "High activity spread across many repositories with modest impact suggests an exploratory phase — shipping often but not yet gaining ecosystem traction.",
    };
  }

  // Concentrated work, few repos, good scores
  if (repos <= 5 && activityScore >= 45 && impactScore >= 40) {
    return {
      archetype: "focused_contributor",
      title: "Focused contributor",
      description:
        "Contribution energy is concentrated in a small number of repositories, with meaningful output relative to scope.",
    };
  }

  // Wide repo spread, moderate everything
  if (breadth > 35 && repos >= 10) {
    return {
      archetype: "broad_spectrum_contributor",
      title: "Broad-spectrum contributor",
      description:
        "Activity is distributed across a large number of repositories with moderate depth in each, suggesting a generalist contributor style.",
    };
  }

  // Work with impact but low visibility
  if (impactScore >= 40 && reachScore < 30 && consistencyScore >= 40) {
    return {
      archetype: "low_visibility_specialist",
      title: "Low-visibility specialist",
      description:
        "Contribution quality is solid relative to ecosystem recognition — meaningful work is happening, but public reach has not scaled with it.",
    };
  }

  // Default fallback
  return {
    archetype: "focused_contributor",
    title: "Focused contributor",
    description:
      "Contribution patterns are stable without a dominant signal in any single dimension.",
  };
}