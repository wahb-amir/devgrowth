import mongoose, { Schema, type InferSchemaType } from "mongoose";

const PortfolioFailureSchema = new Schema(
  {
    code: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["temporary", "permanent"],
      required: true,
    },
    message: { type: String, required: true, trim: true },
    retryAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
  },
  { _id: false },
);

const PortfolioLinkSetSchema = new Schema(
  {
    live_demo: { type: String, default: null, trim: true },
    code: { type: String, default: null, trim: true },
    case_study: { type: String, default: null, trim: true },
    other: { type: [String], default: [] },
  },
  { _id: false },
);

const PortfolioIdentitySchema = new Schema(
  {
    name: { type: String, default: null, trim: true },
    alias: { type: String, default: null, trim: true },
    headline: { type: String, default: null, trim: true },
    bio_summary: { type: String, default: null, trim: true },
    location: { type: String, default: null, trim: true },
    canonical_identity: { type: String, default: null, trim: true },
  },
  { _id: false },
);

const PortfolioPositioningSchema = new Schema(
  {
    primary_positioning: { type: String, default: null, trim: true },
    secondary_positioning: { type: [String], default: [] },
    self_image_keywords: { type: [String], default: [] },
    tone: { type: String, default: null, trim: true },
    assertiveness: {
      type: String,
      enum: ["low", "medium", "high", null],
      default: null,
    },
  },
  { _id: false },
);

const PortfolioSkillsSchema = new Schema(
  {
    claimed: { type: [String], default: [] },
    stack: { type: [String], default: [] },
    categories: {
      frontend: { type: [String], default: [] },
      backend: { type: [String], default: [] },
      ai_ml: { type: [String], default: [] },
      databases: { type: [String], default: [] },
      devops: { type: [String], default: [] },
      other: { type: [String], default: [] },
    },
  },
  { _id: false },
);

const PortfolioProjectSchema = new Schema(
  {
    name: { type: String, default: null, trim: true },
    type: { type: String, default: null, trim: true },
    summary: { type: String, default: null, trim: true },
    problem: { type: String, default: null, trim: true },
    approach: { type: String, default: null, trim: true },
    impact: { type: String, default: null, trim: true },
    role: { type: String, default: null, trim: true },
    stack: { type: [String], default: [] },
    status: { type: String, default: null, trim: true },
    date: { type: String, default: null, trim: true },
    links: { type: PortfolioLinkSetSchema, default: () => ({}) },
    confidence: { type: Number, default: 0 },
  },
  { _id: false },
);

const PortfolioProofEvidenceSchema = new Schema(
  {
    title: { type: String, default: null, trim: true },
    event: { type: String, default: null, trim: true },
    year: { type: String, default: null, trim: true },
    evidence: { type: String, default: null, trim: true },
  },
  { _id: false },
);

const PortfolioProofSchema = new Schema(
  {
    github: { type: String, default: null, trim: true },
    linkedin: { type: String, default: null, trim: true },
    devpost: { type: String, default: null, trim: true },
    other_profiles: { type: [String], default: [] },
    awards: { type: [PortfolioProofEvidenceSchema], default: [] },
    demos: { type: [String], default: [] },
    publications: { type: [String], default: [] },
    canons: { type: [String], default: [] },
  },
  { _id: false },
);

const PortfolioNarrativeSchema = new Schema(
  {
    structure: { type: String, default: null, trim: true },
    story_arc: { type: String, default: null, trim: true },
    has_problem_solution_flow: { type: Boolean, default: null },
    has_case_study_depth: { type: Boolean, default: null },
    has_timeline: { type: Boolean, default: null },
    depth_level: {
      type: String,
      enum: ["shallow", "medium", "deep", null],
      default: null,
    },
  },
  { _id: false },
);

const PortfolioSignalEvidenceSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    text: { type: String, required: true, trim: true },
    href: { type: String, default: null, trim: true },
    source: {
      type: String,
      enum: ["visible", "meta", "link", "computed"],
      default: "visible",
    },
  },
  { _id: false },
);

const PortfolioSignalsSchema = new Schema(
  {
    strong_signals: { type: [String], default: [] },
    weak_signals: { type: [String], default: [] },
    generic_claims: { type: [String], default: [] },
    missing_information: { type: [String], default: [] },
    evidence: { type: [PortfolioSignalEvidenceSchema], default: [] },
  },
  { _id: false },
);

const PortfolioQualitySchema = new Schema(
  {
    overall_confidence: { type: Number, required: true, min: 0, max: 1 },
    identity_confidence: { type: Number, required: true, min: 0, max: 1 },
    skills_confidence: { type: Number, required: true, min: 0, max: 1 },
    projects_confidence: { type: Number, required: true, min: 0, max: 1 },
    proof_confidence: { type: Number, required: true, min: 0, max: 1 },
    noise_level: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    extraction_risk: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
  },
  { _id: false },
);

const ParsedPortfolioSchema = new Schema(
  {
    identity: { type: PortfolioIdentitySchema, default: () => ({}) },
    positioning: { type: PortfolioPositioningSchema, default: () => ({}) },
    skills: { type: PortfolioSkillsSchema, default: () => ({}) },
    projects: { type: [PortfolioProjectSchema], default: [] },
    proof: { type: PortfolioProofSchema, default: () => ({}) },
    narrative: { type: PortfolioNarrativeSchema, default: () => ({}) },
    signals: { type: PortfolioSignalsSchema, default: () => ({}) },
    quality: { type: PortfolioQualitySchema, default: null },
    warnings: { type: [String], default: [] },
  },
  { _id: false },
);

const PortfolioSchema = new Schema(
  {
    sourceUrl: { type: String, required: true, trim: true },
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
    parserVersion: {
      type: String,
      default: "v1",
      index: true,
    },
    contentHash: {
      type: String,
      default: null,
      index: true,
      trim: true,
    },
    parsedAt: { type: Date, default: null },
    parseFailure: { type: PortfolioFailureSchema, default: null },
    pageTitle: { type: String, default: null, trim: true },
    metaDescription: { type: String, default: null, trim: true },
    canonicalUrl: { type: String, default: null, trim: true },
    parsed: { type: ParsedPortfolioSchema, default: null },
    lastQueuedAt: { type: Date, default: null },
    lastFetchedAt: { type: Date, default: null },
    failure: { type: PortfolioFailureSchema, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

PortfolioSchema.index({ hostname: 1, parseStatus: 1 });
PortfolioSchema.index({ contentHash: 1, parserVersion: 1 });
PortfolioSchema.index({ "parsed.identity.name": 1 });

export type PortfolioDocument = InferSchemaType<typeof PortfolioSchema>;

export const PortfolioModel =
  mongoose.models.Portfolio || mongoose.model("Portfolio", PortfolioSchema);
