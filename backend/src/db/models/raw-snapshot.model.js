import mongoose from 'mongoose'

const { Schema, model, models } = mongoose

// Raw GitHub API responses are stored as Mixed (untyped).
// TypeScript types in packages/types validate the shapes — Mongoose doesn't need to.
// This keeps the model flexible and avoids fighting schema validation for deeply nested API shapes.

const RawSnapshotSchema = new Schema(
  {
    developerId: {
      type: Schema.Types.ObjectId,
      ref: 'Developer',
      required: true,
      index: true,
    },
    takenAt: { type: Date, required: true, index: true },
    pipelineVersion: { type: String, required: true },
    profile: { type: Schema.Types.Mixed, required: true },
    repos: { type: [Schema.Types.Mixed], required: true, default: [] },
    events: { type: [Schema.Types.Mixed], required: true, default: [] },
    externalPRs: { type: [Schema.Types.Mixed], required: true, default: [] },
    issues: { type: [Schema.Types.Mixed], required: true, default: [] },
    fetchStats: {
      totalRepos: { type: Number, required: true },
      totalEvents: { type: Number, required: true },
      totalExternalPRs: { type: Number, required: true },
      totalIssues: { type: Number, required: true },
      rateLimitRemaining: { type: Number, required: true },
      requestsUsed: { type: Number, required: true },
      durationMs: { type: Number, required: true },
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id.toString()
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  }
)

// Most common query: latest snapshot for a developer
RawSnapshotSchema.index({ developerId: 1, takenAt: -1 })

// TTL: automatically remove raw snapshots older than 180 days.
// Scored snapshots (much smaller) are kept indefinitely for history.
RawSnapshotSchema.index({ takenAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 })

export const RawSnapshotModel = models['RawSnapshot'] ?? model('RawSnapshot', RawSnapshotSchema)
