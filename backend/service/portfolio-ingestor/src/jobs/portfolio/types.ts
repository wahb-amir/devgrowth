export interface AwardEntry {
  title: string | null;
  event: string | null;
  year: string | null;
  evidence: string | null;
}

export interface ProjectLinks {
  live_demo: string | null;
  code: string | null;
  case_study: string | null;
  other: string[];
}

export interface ProjectEntry {
  name: string | null;
  type: string | null;
  summary: string | null;
  problem: string | null;
  approach: string | null;
  impact: string | null;
  role: string | null;
  stack: string[];
  status: string | null;
  date: string | null;
  links: ProjectLinks;
  confidence: number;
}

export interface ProofData {
  github: string | null;
  linkedin: string | null;
  devpost: string | null;
  other_profiles: string[];
  awards: AwardEntry[];
  demos: string[];
  publications: string[];
  canons: string[];
}

export interface EvidenceEntry {
  label: string;
  text: string;
  href: string | null;
  source: "visible" | "meta" | "link" | "computed";
}

export interface PortfolioIdentity {
  name: string | null;
  alias: string | null;
  headline: string | null;
  bio_summary: string | null;
  location: string | null;
  canonical_identity: string | null;
}

export interface PortfolioPositioning {
  primary_positioning: string | null;
  secondary_positioning: string[];
  self_image_keywords: string[];
  tone: string | null;
  assertiveness: "low" | "medium" | "high" | null;
}

export interface PortfolioSkills {
  claimed: string[];
  stack: string[];
  categories: {
    frontend: string[];
    backend: string[];
    ai_ml: string[];
    databases: string[];
    devops: string[];
    other: string[];
  };
}

export interface PortfolioNarrative {
  structure: string | null;
  story_arc: string | null;
  has_problem_solution_flow: boolean | null;
  has_case_study_depth: boolean | null;
  has_timeline: boolean | null;
  depth_level: "shallow" | "medium" | "deep" | null;
}

export interface PortfolioSignals {
  strong_signals: string[];
  weak_signals: string[];
  generic_claims: string[];
  missing_information: string[];
  evidence: EvidenceEntry[];
}

export interface PortfolioQuality {
  overall_confidence: number;
  identity_confidence: number;
  skills_confidence: number;
  projects_confidence: number;
  proof_confidence: number;
  noise_level: "low" | "medium" | "high";
  extraction_risk: "low" | "medium" | "high";
}

export interface ParsedPortfolio {
  identity: PortfolioIdentity;
  positioning: PortfolioPositioning;
  skills: PortfolioSkills;
  projects: ProjectEntry[];
  proof: ProofData;
  narrative: PortfolioNarrative;
  signals: PortfolioSignals;
  quality: PortfolioQuality | null;
  warnings: string[];
}

export type ExtractionGaps = {
  needsBio: boolean;
  aboutText: string | null;
  needsProjectNarratives: boolean;
  projectSectionText: string | null;
  projectNames: string[];
};

export type DeterministicResult = {
  parsed: ParsedPortfolio;
  gaps: ExtractionGaps;
};
