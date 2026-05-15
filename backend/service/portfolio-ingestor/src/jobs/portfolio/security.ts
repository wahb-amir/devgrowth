import dns from "dns/promises";

// ─── Errors ───────────────────────────────────────────────────────────────────

export class SecurityError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly permanent = true,
  ) {
    super(message);
    this.name = "SecurityError";
  }
}

// ─── Blocked ranges ───────────────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "metadata.google.internal",
]);

// Covers RFC-1918, loopback, link-local, CGNAT, IPv6 ULA/link-local
const PRIVATE_IP_RANGES: RegExp[] = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^169\.254\./, // link-local / AWS metadata gateway
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT RFC-6598
  /^fc00:/i, // IPv6 ULA
  /^fe80:/i, // IPv6 link-local
  /^::1$/, // IPv6 loopback
];

// Known cloud metadata IPs — belt-and-suspenders after DNS check
const METADATA_IPS = new Set([
  "169.254.169.254", // AWS / GCP / Azure IMDS
  "169.254.170.2", // ECS task metadata
  "fd00:ec2::254", // AWS IPv6 IMDS
]);

// ─── URL syntax validation ─────────────────────────────────────────────────

/**
 * Parses and validates a URL string.
 * Throws SecurityError on any protocol other than http/https,
 * blocked hostnames, or metadata endpoints.
 */
export function validateUrlSyntax(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SecurityError(`Malformed URL: ${rawUrl}`, "INVALID_URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SecurityError(
      `Blocked protocol: ${parsed.protocol}`,
      "BLOCKED_PROTOCOL",
    );
  }

  if (BLOCKED_HOSTNAMES.has(parsed.hostname)) {
    throw new SecurityError(
      `Blocked hostname: ${parsed.hostname}`,
      "BLOCKED_HOSTNAME",
    );
  }

  if (METADATA_IPS.has(parsed.hostname)) {
    throw new SecurityError(
      `Blocked metadata endpoint: ${parsed.hostname}`,
      "BLOCKED_METADATA",
    );
  }

  return parsed;
}

// ─── DNS resolution validation ────────────────────────────────────────────────

/**
 * Resolves all IPs for a hostname and rejects if any resolve to
 * a private range, loopback, link-local, or metadata IP.
 *
 * Must be called AFTER the initial fetch AND after each redirect.
 */
export async function validateResolvedIp(hostname: string): Promise<void> {
  let addresses: string[];

  try {
    const result = await dns.lookup(hostname, { all: true });
    addresses = result.map((r) => r.address);
  } catch {
    throw new SecurityError(
      `DNS resolution failed for: ${hostname}`,
      "DNS_FAILURE",
      false, // temporary — retryable
    );
  }

  for (const addr of addresses) {
    if (METADATA_IPS.has(addr)) {
      throw new SecurityError(
        `DNS rebinding to metadata IP: ${addr}`,
        "DNS_REBIND_METADATA",
      );
    }

    for (const range of PRIVATE_IP_RANGES) {
      if (range.test(addr)) {
        throw new SecurityError(
          `DNS rebinding to private IP: ${addr}`,
          "DNS_REBIND_PRIVATE",
        );
      }
    }
  }
}

// ─── Redirect validation ──────────────────────────────────────────────────────

/**
 * Validates a redirect location against the original URL.
 * Blocks HTTPS → HTTP downgrades.
 * Re-validates protocol and hostname on the redirect target.
 */
export function validateRedirectUrl(original: URL, location: string): URL {
  const redirectParsed = validateUrlSyntax(location);

  if (original.protocol === "https:" && redirectParsed.protocol === "http:") {
    throw new SecurityError(
      `HTTPS → HTTP downgrade redirect blocked`,
      "REDIRECT_DOWNGRADE",
    );
  }

  return redirectParsed;
}

// ─── Domain helpers ───────────────────────────────────────────────────────────

/**
 * Returns true if `url` is on the same effective domain as `seedHostname`
 * (including subdomains). Strips leading www. from both sides.
 */
export function isSameDomain(url: URL, seedHostname: string): boolean {
  const host = url.hostname.replace(/^www\./, "");
  const seed = seedHostname.replace(/^www\./, "");
  return host === seed || host.endsWith(`.${seed}`);
}

// ─── Trap URL detection ───────────────────────────────────────────────────────

// Patterns that identify low-value or dangerous crawl targets
const TRAP_PATTERNS: RegExp[] = [
  /\/(login|logout|signin|signout|register|signup|auth)\b/i,
  /\/(admin|dashboard|panel|cms|wp-admin)\b/i,
  /\/(privacy|terms|legal|cookie|gdpr)\b/i,
  /\/(tag|category|label|archive|taxonomy)\//i,
  /\/(feed|rss|atom)(\/?$|\.xml)/i,
  /\/sitemap(\.xml|\/)/i,
  /\/(search|query|find)\b/i,
  /\/\?.*page=\d{3,}/, // deep pagination (page 100+)
  /\/\?.*p=\d{5,}/, // WordPress deep pagination
  /\.(zip|tar\.gz|exe|dmg|pkg|deb|rpm|iso|bin|apk)$/i,
  /\/(cart|checkout|billing|invoice|order)\b/i,
  /\/wp-content\/uploads\/\d{4}\/\d{2}\//i, // WordPress media flood
];

/**
 * Returns true if the URL matches a known crawl trap or low-value pattern.
 * Call this before enqueuing any discovered link.
 */
export function isTrapUrl(url: URL): boolean {
  const combined = (url.pathname + url.search).toLowerCase();
  return TRAP_PATTERNS.some((p) => p.test(combined));
}

// ─── Page value scoring ───────────────────────────────────────────────────────

// Ordered by typical information density for portfolio extraction
const HIGH_VALUE_PATTERNS: [RegExp, number][] = [
  [/^\/$/, 1.0], // root
  [/\/(projects?|work|portfolio)\b/i, 0.95],
  [/\/(case-stud(y|ies)|studies)\b/i, 0.9],
  [/\/(about|bio|me|myself|introduction)\b/i, 0.88],
  [/\/(skills?|tech|stack|tools?|expertise|technologies)\b/i, 0.8],
  [/\/(experience|career|jobs?|employment|history)\b/i, 0.78],
  [/\/(resume|cv)\b/i, 0.75],
  [/\/(education|academic|degree)\b/i, 0.6],
  [/\/(awards?|achievements?|recognition|honors?)\b/i, 0.65],
  [/\/(blog|writing|posts?|articles?|thoughts)\b/i, 0.45],
  [/\/(contact|hire|email|reach)\b/i, 0.4],
  [/\/(services?|offerings?|what-i-do)\b/i, 0.5],
];

/**
 * Scores a page URL by expected portfolio information value.
 * Returns 0.0–1.0. Use to prioritize crawl queue.
 */
export function scorePageUrl(url: URL): number {
  const path = url.pathname.toLowerCase();

  for (const [pattern, score] of HIGH_VALUE_PATTERNS) {
    if (pattern.test(path)) return score;
  }

  // Subpage with no recognized pattern — low but non-zero
  // (might be a project detail page like /projects/my-app)
  const depth = path.split("/").filter(Boolean).length;
  if (depth === 1) return 0.25; // top-level unknown
  if (depth === 2) return 0.35; // likely a project/case study detail
  return 0.1; // deep unknown
}
