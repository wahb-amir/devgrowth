import { RawSnapshotModel } from "../../db/models/raw-snapshot.model.js";
import { ScoredSnapshotModel } from "../../db/models/scored-snapshot.model.js";
import { DeveloperModel } from "../../db/models/developer.model.js";
import { JobHandler } from "../queue.js";

const clamp = (n: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, n));

const SCORER_VERSION = "v1.0.0";

/* ---------------- ACTIVITY ---------------- */
function calcActivity(snapshot: any) {
  const a = snapshot?.activity_30d || {};

  return clamp(
    (a.pushes || 0) * 1 +
      (a.prs || 0) * 2 +
      (a.issues || 0) * 1.5 +
      (a.releases || 0) * 5,
  );
}

/* ---------------- IMPACT ---------------- */
function calcImpact(snapshot: any) {
  const repo = snapshot?.repoStats || {};

  const stars = repo.totalStars || 0;
  const repos = repo.totalRepos || 0;

  const score = Math.log10(stars + 1) * 45 + Math.log10(repos + 1) * 20;

  return clamp(score);
}

/* ---------------- CONSISTENCY ---------------- */
function calcConsistency(snapshot: any) {
  const a = snapshot?.activity_30d || {};
  const total = (a.pushes || 0) + (a.prs || 0) + (a.issues || 0);

  // simple density-based consistency
  const score = Math.min(100, total * 2);

  return clamp(score);
}

/* ---------------- REACH ---------------- */
function calcReach(snapshot: any) {
  const profile = snapshot?.profile || {};

  const followers = profile.followers || 0;
  const repos = profile.public_repos || 0;

  return clamp(Math.log10(followers + 1) * 40 + Math.log10(repos + 1) * 20);
}

/* ---------------- DEV TYPE ---------------- */
function classifyDev(a: number, i: number, c: number) {
  if (a > 70 && i > 50) return "builder";
  if (i > 70 && a < 40) return "explorer";
  if (c > 70) return "consistent";
  if (a > 60) return "rising";
  return "balanced";
}

/* ---------------- GROWTH ---------------- */
async function calcGrowth(developerId: string, currentScore: number) {
  const prev = await ScoredSnapshotModel.findOne({ developerId })
    .sort({ takenAt: -1 })
    .skip(1)
    .lean();

  if (!prev?.totalScore) return 0;

  return currentScore - prev.totalScore;
}

/* ---------------- JOB ---------------- */
export const scoreDev: JobHandler = async (job) => {
  const start = Date.now();
  const { username } = job.payload || {};

  if (!username || typeof username !== "string") {
    throw new Error("username_required");
  }

  const normalized = username.trim().toLowerCase();

  const developer = await DeveloperModel.findOne({
    username: normalized,
  }).lean();
  if (!developer?._id) throw new Error("developer_not_found");

  const snapshot = await RawSnapshotModel.findOne({
    developerId: developer._id,
  })
    .sort({ takenAt: -1 })
    .lean();

  if (!snapshot) throw new Error("snapshot_not_found");

  /* ---------------- SCORES ---------------- */
  const activityScore = calcActivity(snapshot);
  const impactScore = calcImpact(snapshot);
  const consistencyScore = calcConsistency(snapshot);
  const reachScore = calcReach(snapshot);

  const baseScore =
    activityScore * 0.4 +
    impactScore * 0.35 +
    consistencyScore * 0.15 +
    reachScore * 0.1;

  const growthScore = await calcGrowth(String(developer._id), baseScore);

  const finalScore = clamp(baseScore + growthScore * 0.3);

  const devType = classifyDev(activityScore, impactScore, consistencyScore);

  /* ---------------- SAVE ---------------- */
  await ScoredSnapshotModel.create({
    developerId: developer._id,
    rawSnapshotId: snapshot._id,
    takenAt: new Date(),
    scorerVersion: SCORER_VERSION,

    totalScore: finalScore,
    percentileRank: null,
    growthScore,
    devType,

    normalizedProfile: {
      followers: snapshot.profile?.followers || 0,
      repos: snapshot.profile?.public_repos || 0,
      stars: snapshot.repoStats?.totalStars || 0,
      forks: snapshot.repoStats?.totalForks || 0,
      activity_30d: snapshot.activity_30d,
    },

    subScores: {
      activity: {
        score: activityScore,
        weight: 0.4,
        weightedScore: activityScore * 0.4,
        signals: [],
        tags: ["activity"],
      },
      impact: {
        score: impactScore,
        weight: 0.35,
        weightedScore: impactScore * 0.35,
        signals: [],
        tags: ["impact"],
      },
      consistency: {
        score: consistencyScore,
        weight: 0.15,
        weightedScore: consistencyScore * 0.15,
        signals: [],
        tags: ["consistency"],
      },
      reach: {
        score: reachScore,
        weight: 0.1,
        weightedScore: reachScore * 0.1,
        signals: [],
        tags: ["reach"],
      },
    },
  });

  await DeveloperModel.updateOne(
    { _id: developer._id },
    {
      $set: {
        "scoring.latestScore": finalScore,
        "scoring.devType": devType,
        "scoring.updatedAt": new Date(),
      },
    },
  );

  return {
    success: true,
    username: normalized,
    finalScore,
    devType,
    durationMs: Date.now() - start,
  };
};
