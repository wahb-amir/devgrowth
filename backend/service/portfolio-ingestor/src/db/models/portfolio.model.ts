import mongoose, { Schema, type InferSchemaType } from "mongoose";

const PortfolioSchema = new Schema(
  {
    sourceUrl: { type: String, required: true, trim: true },
    normalizedUrl: { type: String, required: true, unique: true, index: true },
    hostname: { type: String, required: true, index: true },

    source: {
      type: String,
      enum: ["manual", "search", "import", "discovery"],
      default: "discovery",
      index: true,
    },

    ingestionStatus: {
      type: String,
      enum: ["pending", "running", "complete", "failed"],
      default: "pending",
      index: true,
    },

    lastQueuedAt: { type: Date, default: null },
    lastFetchedAt: { type: Date, default: null },

    failure: {
      code: String,
      type: { type: String, enum: ["temporary", "permanent"] },
      message: String,
      retryAt: Date,
      failedAt: Date,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const PortfolioModel =
  mongoose.models.Portfolio ||
  mongoose.model("Portfolio", PortfolioSchema);

export type PortfolioDocument = InferSchemaType<typeof PortfolioSchema>;