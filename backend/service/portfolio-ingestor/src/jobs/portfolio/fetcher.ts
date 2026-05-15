import {
  validateUrlSyntax,
  validateResolvedIp,
  validateRedirectUrl,
  SecurityError,
} from "./security.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FetchResult = {
  url: string;
  finalUrl: string;
  html: string;
  statusCode: number;
  contentType: string;
  byteLength: number;
  redirectCount: number;
  fetchedAt: Date;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_LIMITS = {
  timeoutMs: 15_000,
  maxBytes: 2 * 1024 * 1024, // 2MB per page
  maxRedirects: 3,
  userAgent: "PortfolioBot/2.0 (+https://yourapp.com/bot)",
};

// Only fetch parseable text-based responses
const ALLOWED_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "application/xml",
  "text/xml",
];

// HTTP status codes that are retryable
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

// ─── Main fetch ───────────────────────────────────────────────────────────────

/**
 * Fetches a URL with hard limits on bytes, time, and redirects.
 * Validates the URL, DNS resolution, and each redirect hop.
 * Streams the body to enforce the byte cap without buffering the full response.
 */
export async function fetchHtml(
  rawUrl: string,
  opts: Partial<typeof DEFAULT_LIMITS> = {},
): Promise<FetchResult> {
  const limits = { ...DEFAULT_LIMITS, ...opts };

  // Validate before anything touches the network
  const parsed = validateUrlSyntax(rawUrl);
  await validateResolvedIp(parsed.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);

  let response: Response;
  let redirectCount = 0;
  let currentUrl = rawUrl;

  try {
    response = await fetch(currentUrl, {
      signal: controller.signal,
      redirect: "manual", // We handle redirects manually for validation
      headers: {
        "User-Agent": limits.userAgent,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });

    // Follow redirects manually, validating each hop
    while (
      response.status >= 300 &&
      response.status < 400 &&
      redirectCount < limits.maxRedirects
    ) {
      const location = response.headers.get("location");
      if (!location) break;

      const originalParsed = validateUrlSyntax(currentUrl);
      const redirectParsed = validateRedirectUrl(originalParsed, location);

      // DNS-validate the redirect target — prevents DNS rebinding
      await validateResolvedIp(redirectParsed.hostname);

      currentUrl = redirectParsed.href;
      redirectCount++;

      response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": limits.userAgent,
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        },
      });
    }
  } finally {
    clearTimeout(timer);
  }

  // Exceeded redirect limit while still getting a redirect
  if (
    redirectCount >= limits.maxRedirects &&
    response.status >= 300 &&
    response.status < 400
  ) {
    throw Object.assign(
      new Error(`Too many redirects (>${limits.maxRedirects}) for ${rawUrl}`),
      { code: "MAX_REDIRECTS_EXCEEDED", permanent: false },
    );
  }

  if (response.status === 404) {
    throw Object.assign(new Error(`404 Not Found: ${currentUrl}`), {
      code: "NOT_FOUND",
      permanent: true,
    });
  }

  if (response.status === 410) {
    throw Object.assign(new Error(`410 Gone: ${currentUrl}`), {
      code: "GONE",
      permanent: true,
    });
  }

  if (response.status >= 400) {
    throw Object.assign(
      new Error(`HTTP ${response.status} from ${currentUrl}`),
      {
        code: `HTTP_${response.status}`,
        permanent: !RETRYABLE_STATUS_CODES.has(response.status),
      },
    );
  }

  // Validate content type — avoid binary files
  const contentType = response.headers.get("content-type") ?? "";
  const isAllowed = ALLOWED_CONTENT_TYPES.some((t) => contentType.includes(t));

  if (!isAllowed) {
    throw Object.assign(
      new Error(`Blocked content-type: "${contentType}" from ${currentUrl}`),
      { code: "BLOCKED_CONTENT_TYPE", permanent: true },
    );
  }

  // Early size check via Content-Length header (not always present)
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > limits.maxBytes) {
    throw Object.assign(
      new Error(
        `Content-Length ${contentLength} exceeds limit ${limits.maxBytes} for ${currentUrl}`,
      ),
      { code: "RESPONSE_TOO_LARGE", permanent: true },
    );
  }

  // Stream body with hard byte cap
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(`No response body from ${currentUrl}`);
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;

      if (totalBytes > limits.maxBytes) {
        reader.cancel().catch(() => {});
        throw Object.assign(
          new Error(
            `Response body exceeds ${limits.maxBytes} bytes from ${currentUrl}`,
          ),
          { code: "RESPONSE_TOO_LARGE", permanent: false },
        );
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  // Decode safely — replace invalid UTF-8 sequences rather than throwing
  const buffer = mergeChunks(chunks);
  const html = new TextDecoder("utf-8", { fatal: false }).decode(buffer);

  return {
    url: rawUrl,
    finalUrl: currentUrl,
    html,
    statusCode: response.status,
    contentType,
    byteLength: totalBytes,
    redirectCount,
    fetchedAt: new Date(),
  };
}

// ─── robots.txt ───────────────────────────────────────────────────────────────

/**
 * Fetches robots.txt for a hostname.
 * Never throws — returns null on any failure (missing, timeout, error).
 * Failure to fetch robots.txt should not block crawling; just log it.
 */
export async function fetchRobotsTxt(
  hostname: string,
  protocol = "https",
): Promise<string | null> {
  try {
    const result = await fetchHtml(`${protocol}://${hostname}/robots.txt`, {
      timeoutMs: 6_000,
      maxBytes: 128 * 1024, // 128KB — robots.txt should never be this big
    });
    return result.html;
  } catch {
    return null;
  }
}

/**
 * Checks whether a given path is allowed by robots.txt.
 * If robotsTxt is null (not found), allows everything.
 * Only processes User-agent: * and User-agent: PortfolioBot rules.
 */
export function isAllowedByRobots(
  robotsTxt: string | null,
  path: string,
  botName = "PortfolioBot",
): boolean {
  if (!robotsTxt) return true;

  const lines = robotsTxt
    .split("\n")
    .map((l) => l.split("#")[0].trim()) // Strip inline comments
    .filter(Boolean);

  const disallowed: string[] = [];
  const allowed: string[] = [];
  let applicable = false;

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (lower.startsWith("user-agent:")) {
      const agent = line.slice("user-agent:".length).trim().toLowerCase();
      applicable = agent === "*" || agent === botName.toLowerCase();
      continue;
    }

    if (!applicable) continue;

    if (lower.startsWith("disallow:")) {
      const rule = line.slice("disallow:".length).trim();
      if (rule) disallowed.push(rule);
    }

    if (lower.startsWith("allow:")) {
      const rule = line.slice("allow:".length).trim();
      if (rule) allowed.push(rule);
    }
  }

  // Specific Allow takes precedence over Disallow (standard behavior)
  const matchesAllow = allowed.some((a) => path.startsWith(a));
  if (matchesAllow) return true;

  return !disallowed.some((d) => d && path.startsWith(d));
}

// ─── Sitemap ──────────────────────────────────────────────────────────────────

/**
 * Fetches /sitemap.xml and extracts <loc> URLs.
 * Also follows sitemap index files one level deep.
 * Returns empty array on any failure — sitemap is best-effort.
 * Max 200 URLs returned to prevent sitemap bombs.
 */
export async function fetchSitemap(
  hostname: string,
  protocol = "https",
): Promise<string[]> {
  const urls: string[] = [];

  const processXml = (xml: string): void => {
    const matches = xml.matchAll(/<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi);
    for (const match of matches) {
      const url = match[1].trim();
      try {
        validateUrlSyntax(url);
        urls.push(url);
      } catch {
        // skip invalid sitemap URLs
      }
      if (urls.length >= 200) break;
    }
  };

  try {
    const result = await fetchHtml(
      `${protocol}://${hostname}/sitemap.xml`,
      { timeoutMs: 10_000, maxBytes: 1 * 1024 * 1024 }, // 1MB
    );

    // Check if this is a sitemap index (contains <sitemapindex>)
    const isIndex = /<sitemapindex/i.test(result.html);

    if (isIndex) {
      // Extract sub-sitemap URLs and fetch them (one level only)
      const subSitemaps: string[] = [];
      const subMatches = result.html.matchAll(
        /<sitemap>[\s\S]*?<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi,
      );

      for (const match of subMatches) {
        subSitemaps.push(match[1].trim());
        if (subSitemaps.length >= 10) break; // Don't follow too many subs
      }

      for (const subUrl of subSitemaps) {
        try {
          const sub = await fetchHtml(subUrl, {
            timeoutMs: 8_000,
            maxBytes: 512 * 1024,
          });
          processXml(sub.html);
          if (urls.length >= 200) break;
        } catch {
          // skip failed sub-sitemaps
        }
      }
    } else {
      processXml(result.html);
    }
  } catch {
    // No sitemap or fetch failed — that's fine
  }

  return urls;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function mergeChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
