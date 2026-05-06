import mongoose from 'mongoose'
import type {InferSchemaType} from 'mongoose'

const { Schema, model, models } = mongoose
/**
 * 1. Metadata Type
 */
const DeveloperMetadataSchema = new Schema(
  {
    name: { type: String, default: null },
    avatarUrl: { type: String, required: true },
    bio: { type: String, default: null },
    location: { type: String, default: null },
    company: { type: String, default: null },
    blog: { type: String, default: null },
    email: { type: String, default: null },
    twitterUsername: { type: String, default: null },
    hireable: { type: Boolean, default: null },
    githubCreatedAt: { type: Date, required: true },
  },
  { _id: false }
)

/**
 * 2. Main Schema
 */
const DeveloperSchema = new Schema(
  {
    githubId: { type: Number, required: true, unique: true, index: true },
    username: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
    },
    indexedAt: { type: Date, required: true, default: Date.now },
    lastFetchedAt: { type: Date, default: null },
    trackingEnabled: { type: Boolean, required: true, default: true },
    claimed: { type: Boolean, required: true, default: false },
    claimedAt: { type: Date },

    ingestionStatus: {
      type: String,
      enum: ['pending', 'running', 'complete', 'failed'],
      required: true,
      default: 'pending',
      index: true,
    },

    metadata: { type: DeveloperMetadataSchema, required: true },
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
}
    },
  }
)

/**
 * 3. Indexes
 */
DeveloperSchema.index({
  trackingEnabled: 1,
  lastFetchedAt: 1,
  ingestionStatus: 1,
})

DeveloperSchema.index({
  claimed: 1,
  claimedAt: -1,
})


export type Developer = InferSchemaType<typeof DeveloperSchema>

/**
 * 5. Model export (safe for hot reload / Next.js / Fastify)
 */
export const DeveloperModel =
  models.Developer ?? model('Developer', DeveloperSchema)