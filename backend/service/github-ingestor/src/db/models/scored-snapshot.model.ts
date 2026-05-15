import mongoose, { InferSchemaType } from "mongoose";

const { Schema, model, models } = mongoose;

const ScoringSignalSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    rawValue: { type: Number, required: true },
    normalizedValue: { type: Number, required: true },
    pointsContributed: { type: Number, required: true },
    maxPoints: { type: Number, required: true },
  },
  { _id: false },
);

const SubScoreSchema = new Schema(
  {
    score: { type: Number, required: true, min: 0, max: 100 },
    weight: { type: Number, required: true },
    weightedScore: { type: Number, required: true },
    signals: { type: [ScoringSignalSchema], default: [] },
    tags: { type: [String], default: [] },
  },
  { _id: false },
);

const NormalizedProfileSchema = new Schema(
  {
    followers: { type: Number, default: 0 },
    repos: { type: Number, default: 0 },
    stars: { type: Number, default: 0 },
    forks: { type: Number, default: 0 },
    activity_30d: {
      pushes: { type: Number, default: 0 },
      prs: { type: Number, default: 0 },
      issues: { type: Number, default: 0 },
      releases: { type: Number, default: 0 },
    },
  },
  { _id: false },
);

const ScoredSnapshotSchema = new Schema(
  {
    developerId: {
      type: Schema.Types.ObjectId,
      ref: "Developer",
      required: true,
      index: true,
    },

    rawSnapshotId: {
      type: Schema.Types.ObjectId,
      ref: "RawSnapshot",
      required: true,
      index: true,
    },

    takenAt: {
      type: Date,
      required: true,
      index: true,
    },

    scoredAt: {
      type: Date,
      default: Date.now,
    },

    scorerVersion: {
      type: String,
      required: true,
    },

    totalScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      index: true,
    },

    percentileRank: {
      type: Number,
      default: null,
    },

    devType: {
      type: String,
      default: "balanced",
      index: true,
    },

    growthScore: {
      type: Number,
      default: 0,
    },

    subScores: {
      activity: { type: SubScoreSchema, required: true },
      impact: { type: SubScoreSchema, required: true },
      consistency: { type: SubScoreSchema, required: true },
      reach: { type: SubScoreSchema, required: true },
    },

    normalizedProfile: {
      type: NormalizedProfileSchema,
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
  },
);

ScoredSnapshotSchema.index({ developerId: 1, takenAt: -1 });
ScoredSnapshotSchema.index({ totalScore: -1, takenAt: -1 });

export type ScoredSnapshot = InferSchemaType<typeof ScoredSnapshotSchema>;

export const ScoredSnapshotModel =
  models.ScoredSnapshot ??
  model<ScoredSnapshot>("ScoredSnapshot", ScoredSnapshotSchema);
