import mongoose from 'mongoose'
import type {InferSchemaType} from 'mongoose'

const { Schema, model, models } = mongoose
/**
 * Insight schema — generated from scored snapshots
 */
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

    generatedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },

    insightVersion: {
      type: String,
      required: true,
    },

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

    title: {
      type: String,
      required: true,
    },

    body: {
      type: String,
      required: true,
    },

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

    triggerTags: {
      type: [String],
      required: true,
      default: [],
    },

    priority: {
      type: Number,
      required: true,
      default: 0,
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
InsightSchema.index({ developerId: 1, generatedAt: -1 })
InsightSchema.index({ scoredSnapshotId: 1 })


export type Insight = InferSchemaType<typeof InsightSchema>

/**
 * Model export
 */
export const InsightModel =
  models.Insight ?? model<Insight>('Insight', InsightSchema)