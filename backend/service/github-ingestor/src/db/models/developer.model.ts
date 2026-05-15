import mongoose from "mongoose";
import type { InferSchemaType } from "mongoose";

const { Schema, model, models } = mongoose;

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
  { _id: false },
);

/**
 * 2. FAILURE DOC (NEW)
 * compact + strict + TTL-safe
 */
const FailureSchema = new Schema(
  {
    code: {
      type: String,
      enum: [
        "GITHUB_NOT_FOUND",
        "GITHUB_RATE_LIMIT",
        "GITHUB_FORBIDDEN",
        "GITHUB_SERVER_ERROR",
        "NETWORK_ERROR",
        "UNKNOWN_ERROR",
      ],
      required: true,
    },

    message: {
      type: String,
      required: false,
      default: null,
    },

    failedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },

    retryAt: {
      type: Date,
      required: true,
    },
  },
  { _id: false },
);

/**
 * 3. MAIN SCHEMA
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
      enum: ["pending", "running", "complete", "failed"],
      required: true,
      default: "pending",
      index: true,
    },

    metadata: { type: DeveloperMetadataSchema, required: true },

    //  NEW: compact failure tracking
    failure: {
      type: FailureSchema,
      default: null,
      index: true,
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

/**
 * 4. Types
 */
export type Developer = InferSchemaType<typeof DeveloperSchema>;
export type Failure = InferSchemaType<typeof FailureSchema>;
export type DeveloperMetadata = InferSchemaType<typeof DeveloperMetadataSchema>;

export const DeveloperModel =
  models.Developer ?? model("Developer", DeveloperSchema);
