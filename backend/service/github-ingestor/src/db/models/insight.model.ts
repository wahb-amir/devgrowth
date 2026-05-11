// src/db/models/insight.model.ts

import mongoose from "mongoose";
import type { InferSchemaType } from "mongoose";

const { Schema, model, models } = mongoose;

const InsightCardSchema = new Schema(
  {
    type: {
      type: String,
      enum: [
        "strength",
        "watch_area",
        "opportunity",
        "milestone",
        "neutral",
        "trajectory",
        "confidence"
      ],
      required: true,
    },
    category: {
      type: String,
      enum: ["activity", "impact", "consistency", "reach", "overall"],
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
      enum: ["activity", "impact", "consistency", "reach", "overall"],
      required: true,
    },
    triggerTags: { type: [String], required: true, default: [] },
    priority: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const InsightSchema = new Schema(
  {
    developerId: {
      type: Schema.Types.ObjectId,
      ref: "Developer",
      required: true,
      index: true,
    },
    scoredSnapshotId: {
      type: Schema.Types.ObjectId,
      ref: "ScoredSnapshot",
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

    // Top-level computed fields for quick reads
    devType: {
      type: String,
      enum: [
        "builder",
        "impact_dev",
        "maintainer",
        "rising_dev",
        "balanced",
        "watch_area",
      ],
      required: true,
    },
    trendLabel: {
      type: String,
      enum: ["improving", "stable", "declining"],
      required: true,
    },
    growthRate: { type: Number, required: true, default: 0 },
    keySignals: { type: [String], required: true, default: [] },
    warnings: { type: [String], required: true, default: [] },

    // All insight cards embedded — no separate documents
    cards: { type: [InsightCardSchema], required: true, default: [] },
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

// One insight document per developer+snapshot — enforced
InsightSchema.index({ developerId: 1, scoredSnapshotId: 1 }, { unique: true });
InsightSchema.index({ developerId: 1, generatedAt: -1 });

export type InsightCard = InferSchemaType<typeof InsightCardSchema>;
export type Insight = InferSchemaType<typeof InsightSchema>;

export const InsightModel =
  models.Insight ?? model<Insight>("Insight", InsightSchema);
