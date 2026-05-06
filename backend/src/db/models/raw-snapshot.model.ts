import mongoose from 'mongoose'
import type {InferSchemaType} from 'mongoose'

const { Schema, model, models } = mongoose

/**
 * Raw GitHub snapshots are intentionally untyped (Mixed)
 * to avoid fighting deeply nested API structures.
 */
const RawSnapshotSchema = new Schema(
  {
    developerId: {
      type: Schema.Types.ObjectId,
      ref: 'Developer',
      required: true,
      index: true,
    },

    takenAt: {
      type: Date,
      required: true,
      index: true,
    },

    pipelineVersion: {
      type: String,
      required: true,
    },

    profile: {
      type: Schema.Types.Mixed,
      required: true,
    },

    repos: {
      type: [Schema.Types.Mixed],
      required: true,
      default: [],
    },

    events: {
      type: [Schema.Types.Mixed],
      required: true,
      default: [],
    },

    externalPRs: {
      type: [Schema.Types.Mixed],
      required: true,
      default: [],
    },

    issues: {
      type: [Schema.Types.Mixed],
      required: true,
      default: [],
    },

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
        const obj = ret as any
        obj.id = obj._id.toString()
        delete obj._id
        delete obj.__v
        return obj
      },
    },
  }
)

/**
 * Indexes
 */
RawSnapshotSchema.index({ developerId: 1, takenAt: -1 })

RawSnapshotSchema.index(
  { takenAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 180 }
)


export type RawSnapshot = InferSchemaType<typeof RawSnapshotSchema>

/**
 * Model export
 */
export const RawSnapshotModel =
  models.RawSnapshot ?? model<RawSnapshot>('RawSnapshot', RawSnapshotSchema)