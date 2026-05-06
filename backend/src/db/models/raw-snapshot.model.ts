import mongoose, { InferSchemaType } from "mongoose";

const { Schema, model, models } = mongoose;

const FetchStatsSchema = new Schema(
  {
    totalRepos: { type: Number, required: true },
    totalEvents: { type: Number, required: true },
    totalExternalPRs: { type: Number, required: true },
    totalIssues: { type: Number, required: true },
    rateLimitRemaining: { type: Number, required: true },
    requestsUsed: { type: Number, required: true },
    durationMs: { type: Number, required: true },
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
      index: true,
      default: Date.now,
    },

    // Use Number if you're storing versions like 1, 2, 3
    pipelineVersion: {
      type: Number,
      required: true,
      default: 1,
    },

    profile: {
      type: Schema.Types.Mixed,
      required: true,
    },

    repos: {
      type: [Schema.Types.Mixed],
      default: [],
    },

    events: {
      type: [Schema.Types.Mixed],
      default: [],
    },

    externalPRs: {
      type: [Schema.Types.Mixed],
      default: [],
    },

    issues: {
      type: [Schema.Types.Mixed],
      default: [],
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

RawSnapshotSchema.index({ developerId: 1, takenAt: -1 });
RawSnapshotSchema.index(
  { takenAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 180 }
);

export type RawSnapshot = InferSchemaType<typeof RawSnapshotSchema>;

export const RawSnapshotModel =
  models.RawSnapshot ?? model<RawSnapshot>("RawSnapshot", RawSnapshotSchema);