import mongoose from 'mongoose'

const { Schema, model, models } = mongoose

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

const DeveloperSchema = new Schema(
  {
    githubId: { type: Number, required: true, unique: true, index: true },
    username: { type: String, required: true, unique: true, index: true, lowercase: true },
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
        ret.id = ret._id.toString()
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  }
)

// For the daily ingestion job: find tracked developers due for a refresh
DeveloperSchema.index({ trackingEnabled: 1, lastFetchedAt: 1, ingestionStatus: 1 })
// For the dashboard: recently claimed developers
DeveloperSchema.index({ claimed: 1, claimedAt: -1 })

export const DeveloperModel = models['Developer'] ?? model('Developer', DeveloperSchema)
