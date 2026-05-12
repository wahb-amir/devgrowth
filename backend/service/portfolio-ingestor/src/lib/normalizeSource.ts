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

export function normalizePortfolioUrl(input: string): string {
  const url = new URL(input.trim());
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}