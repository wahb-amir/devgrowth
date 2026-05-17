type HttpOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: any;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
};

export async function http<T>(
  url: string,
  options: HttpOptions = {}
): Promise<T> {
  const {
    method = "GET",
    body,
    headers = {},
    timeoutMs = 8000,
    retries = 2,
  } = options;

  let attempt = 0;

  while (attempt <= retries) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`HTTP_ERROR:${res.status}`);
      }

      return await res.json();
    } catch (err) {
      attempt++;

      if (attempt > retries) {
        throw err;
      }
    }
  }

  throw new Error("UNREACHABLE_HTTP_STATE");
}