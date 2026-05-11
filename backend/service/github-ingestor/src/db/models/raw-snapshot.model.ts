import mongoose, { InferSchemaType } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Only fetch metadata needed for scoring
 */
const FetchStatsSchema = new Schema(
  {
    rateLimitRemaining: { type: Number, required: true },
    requestsUsed: { type: Number, required: true },
    durationMs: { type: Number, required: true },
  },
  { _id: false }
);

/**
 * Aggregated activity (NOT raw events)
 */
const ActivitySchema = new Schema(
  {
    pushes: { type: Number, default: 0 },
    prs: { type: Number, default: 0 },
    issues: { type: Number, default: 0 },
    releases: { type: Number, default: 0 },
  },
  { _id: false }
);

/**
 * Repo aggregates (NOT full repo dump)
 */
const RepoStatsSchema = new Schema(
  {
    totalRepos: { type: Number, default: 0 },
    totalStars: { type: Number, default: 0 },
    totalForks: { type: Number, default: 0 },
    languages: { type: Map, of: Number, default: {} },
  },
  { _id: false }
);

const RawSnapshotSchema = new Schema(
  {
    developerId: {
      type: Schema.Types.ObjectId,
      ref: "Developer",
      required: true,
      index: true,
    },

    takenAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },

    pipelineVersion: {
      type: Number,
      required: true,
      default: 1,
    },

    /**
     * Minimal profile needed for scoring
     */
    profile: {
      id: Number,
      login: String,
      followers: Number,
      public_repos: Number,
      created_at: String,
    },

    repoStats: {
      type: RepoStatsSchema,
      required: true,
    },

    activity_30d: {
      type: ActivitySchema,
      required: true,
    },

    fetchStats: {
      type: FetchStatsSchema,
      required: true,
    },
  },
  {
    timestamps: true,

    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        const obj = ret as any;
        obj.id = obj._id.toString();
        delete obj._id;
        delete obj.__v;
        return obj;
      },
    },
  }
);

/**
 * Indexes
 */
RawSnapshotSchema.index({ developerId: 1, takenAt: -1 });
RawSnapshotSchema.index(
  { takenAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 180 } // 180 days retention
);

export type RawSnapshot = InferSchemaType<typeof RawSnapshotSchema>;

export const RawSnapshotModel =
  models.RawSnapshot ??
  model<RawSnapshot>("RawSnapshot", RawSnapshotSchema);