import mongoose from 'mongoose'
import type {InferSchemaType} from 'mongoose'

const { Schema, model, models } = mongoose

/**
 * 1. Scoring Signal
 */
const ScoringSignalSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    rawValue: { type: Number, required: true },
    normalizedValue: { type: Number, required: true },
    pointsContributed: { type: Number, required: true },
    maxPoints: { type: Number, required: true },
  },
  { _id: false }
)

/**
 * 2. Sub Score
 */
const SubScoreSchema = new Schema(
  {
    score: { type: Number, required: true, min: 0, max: 100 },
    weight: { type: Number, required: true },
    weightedScore: { type: Number, required: true },
    signals: { type: [ScoringSignalSchema], required: true, default: [] },
    tags: { type: [String], required: true, default: [] },
  },
  { _id: false }
)

/**
 * 3. Main Scored Snapshot Schema
 */
const ScoredSnapshotSchema = new Schema(
  {
    developerId: {
      type: Schema.Types.ObjectId,
      ref: 'Developer',
      required: true,
      index: true,
    },

    rawSnapshotId: {
      type: Schema.Types.ObjectId,
      ref: 'RawSnapshot',
      required: true,
    },

    takenAt: { type: Date, required: true },
    scoredAt: { type: Date, required: true, default: Date.now },

    scorerVersion: { type: String, required: true },

    totalScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      index: true,
    },

    percentileRank: { type: Number, default: null },

    subScores: {
      activity: { type: SubScoreSchema, required: true },
      impact: { type: SubScoreSchema, required: true },
      consistency: { type: SubScoreSchema, required: true },
      reach: { type: SubScoreSchema, required: true },
    },

    normalizedProfile: {
      type: Schema.Types.Mixed,
      required: true,
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
 * 4. Indexes
 */
ScoredSnapshotSchema.index({ developerId: 1, takenAt: -1 })
ScoredSnapshotSchema.index({ totalScore: -1, takenAt: -1 })


export type ScoredSnapshot = InferSchemaType<typeof ScoredSnapshotSchema>

/**
 * 6. Model export
 */
export const ScoredSnapshotModel =
  models.ScoredSnapshot ??
  model<ScoredSnapshot>('ScoredSnapshot', ScoredSnapshotSchema)