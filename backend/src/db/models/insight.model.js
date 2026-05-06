import mongoose from 'mongoose'

const { Schema, model, models } = mongoose

const InsightSchema = new Schema(
  {
    developerId: {
      type: Schema.Types.ObjectId,
      ref: 'Developer',
      required: true,
      index: true,
    },
    scoredSnapshotId: {
      type: Schema.Types.ObjectId,
      ref: 'ScoredSnapshot',
      required: true,
    },
    generatedAt: { type: Date, required: true, default: Date.now },
    insightVersion: { type: String, required: true },
    // Visual treatment in the UI:
    //   strength    → green  (doing well)
    //   watch_area  → amber  (declining or inconsistent)
    //   opportunity → blue   (actionable suggestion)
    //   milestone   → violet (threshold crossed)
    //   neutral     → gray   (informational)
    type: {
      type: String,
      enum: ['strength', 'watch_area', 'opportunity', 'milestone', 'neutral'],
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: ['activity', 'impact', 'consistency', 'reach', 'overall'],
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    cta: {
      label: String,
      url: String,
      external: Boolean,
    },
    relatedSubScore: {
      type: String,
      enum: ['activity', 'impact', 'consistency', 'reach', 'overall'],
      required: true,
    },
    triggerTags: { type: [String], required: true, default: [] },
    priority: { type: Number, required: true, default: 0 },
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

// Insight feed for a developer, newest first
InsightSchema.index({ developerId: 1, generatedAt: -1 })
// All insights for a specific scored snapshot
InsightSchema.index({ scoredSnapshotId: 1 })

export const InsightModel = models['Insight'] ?? model('Insight', InsightSchema)
