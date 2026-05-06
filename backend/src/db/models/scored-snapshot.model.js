import mongoose from 'mongoose'

const { Schema, model, models } = mongoose

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

const SubScoreSchema = new Schema(
  {
    score: { type: Number, required: true, min: 0, max: 100 },
    weight: { type: Number, required: true },
    weightedScore: { type: Number, required: true },
    signals: { type: [ScoringSignalSchema], required: true, default: [] },
    // Tags produced by the scorer — consumed by the insight engine
    // e.g. ["high-consistency", "streak-at-risk", "low-external-contribution"]
    tags: { type: [String], required: true, default: [] },
  },
  { _id: false }
)

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
    totalScore: { type: Number, required: true, min: 0, max: 100, index: true },
    percentileRank: { type: Number, default: null },
    subScores: {
      activity: { type: SubScoreSchema, required: true },
      impact: { type: SubScoreSchema, required: true },
      consistency: { type: SubScoreSchema, required: true },
      reach: { type: SubScoreSchema, required: true },
    },
    // Embedded normalized profile — avoids joins when rendering the score breakdown
    normalizedProfile: { type: Schema.Types.Mixed, required: true },
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

// Score history for a developer (chronological, for charts)
ScoredSnapshotSchema.index({ developerId: 1, takenAt: -1 })
// Global leaderboard queries
ScoredSnapshotSchema.index({ totalScore: -1, takenAt: -1 })

export const ScoredSnapshotModel =
  models['ScoredSnapshot'] ?? model('ScoredSnapshot', ScoredSnapshotSchema)
