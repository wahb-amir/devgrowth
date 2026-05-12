import mongoose, { Schema, type InferSchemaType } from "mongoose";

const PortfolioFailureSchema = new Schema(
  {
    code: { type: String, required: true },
    type: {
      type: String,
      enum: ["temporary", "permanent"],
      required: true,
    },
    message: { type: String, required: true },
    retryAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
  },
  { _id: false },
);

const PortfolioSectionsSchema = new Schema(
  {
    hero: { type: String, default: "" },
    about: { type: String, default: "" },
    skills: { type: String, default: "" },
    projects: { type: String, default: "" },
    footer: { type: String, default: "" },
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

    parseStatus: {
      type: String,
      enum: ["pending", "running", "complete", "failed"],
      default: "pending",
      index: true,
    },
    parsedAt: {
      type: Date,
      default: null,
    },
    parseFailure: {
      type: PortfolioFailureSchema,
      default: null,
    },

    pageTitle: {
      type: String,
      default: null,
    },
    metaDescription: {
      type: String,
      default: null,
    },
    sections: {
      type: PortfolioSectionsSchema,
      default: () => ({
        hero: "",
        about: "",
        skills: "",
        projects: "",
        footer: "",
      }),
    },

    lastQueuedAt: {
      type: Date,
      default: null,
    },
    lastFetchedAt: {
      type: Date,
      default: null,
    },
    failure: {
      type: PortfolioFailureSchema,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export type PortfolioDocument = InferSchemaType<typeof PortfolioSchema>;

export const PortfolioModel =
  mongoose.models.Portfolio || mongoose.model("Portfolio", PortfolioSchema);