import { Schema, model, type InferSchemaType } from "mongoose";

const FailureSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["temporary", "permanent"],
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    retryAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

const PortfolioSchema = new Schema(
  {
    sourceUrl: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedUrl: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    hostname: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    ingestionStatus: {
      type: String,
      enum: ["pending", "running", "complete", "failed"],
      default: "pending",
      index: true,
    },
    lastFetchedAt: {
      type: Date,
      default: null,
    },
    source: {
      type: String,
      enum: ["manual", "search", "import", "discovery","user"],
      default: "discovery",
    },
    lastQueuedAt: {
      type: Date,
      default: null,
    },
    failure: {
      type: FailureSchema,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export type PortfolioDocument = InferSchemaType<typeof PortfolioSchema>;

export const PortfolioModel = model("Portfolio", PortfolioSchema);
