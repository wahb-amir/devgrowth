export async function fetchHtmlLimited(
  url: string,
  maxBytes = 1_500_000,
  timeoutMs = 12_000,
): Promise<{ html: string; finalUrl: string; contentType: string | null; bytes: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "PortfolioScanner/2.0",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en;q=0.9",
      },
    });

    if (!res.ok) {
      const err = new Error(`HTTP_${res.status}`);
      (err as any).status = res.status;
      (err as any).retryable = res.status >= 500 || res.status === 429 || res.status === 403;
      throw err;
    }

    const contentType = res.headers.get("content-type");
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      const err = new Error("UNSUPPORTED_CONTENT_TYPE");
      (err as any).status = 415;
      (err as any).retryable = false;
      throw err;
    }

    if (!res.body) {
      const html = await res.text();
      return { html, finalUrl: res.url, contentType, bytes: new TextEncoder().encode(html).byteLength };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let total = 0;
    let html = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          const err = new Error("PAGE_TOO_LARGE");
          (err as any).status = 413;
          (err as any).retryable = false;
          throw err;
        }
        html += decoder.decode(value, { stream: true });
      }
    }

    html += decoder.decode();

    return { html, finalUrl: res.url, contentType, bytes: total };
  } finally {
    clearTimeout(timeout);
  }
}