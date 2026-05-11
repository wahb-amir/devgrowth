export type PortfolioSource =
  | "manual"
  | "search"
  | "import"
  | "discovery";

export function normalizeSource(source?: string): PortfolioSource {
  switch (source) {
    case "user":
    case "manual":
      return "manual";

    case "search":
      return "search";

    case "import":
      return "import";

    default:
      return "discovery";
  }
}