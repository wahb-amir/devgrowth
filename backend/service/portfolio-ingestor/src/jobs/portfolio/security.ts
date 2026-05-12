import dns from "node:dns/promises";
import net from "node:net";

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
}

export async function validateSafePortfolioUrl(input: string): Promise<URL> {
  const url = new URL(input);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw Object.assign(new Error("UNSUPPORTED_PROTOCOL"), {
      status: 400,
      retryable: false,
    });
  }

  const host = url.hostname.toLowerCase();

  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw Object.assign(new Error("LOCALHOST_BLOCKED"), {
      status: 400,
      retryable: false,
    });
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    if (isPrivateIPv4(host)) {
      throw Object.assign(new Error("PRIVATE_IP_BLOCKED"), {
        status: 400,
        retryable: false,
      });
    }
  } else {
    const addresses = await dns.lookup(host, { all: true });
    for (const addr of addresses) {
      if (net.isIPv4(addr.address) && isPrivateIPv4(addr.address)) {
        throw Object.assign(new Error("PRIVATE_NETWORK_BLOCKED"), {
          status: 400,
          retryable: false,
        });
      }
      if (net.isIPv6(addr.address) && isPrivateIPv6(addr.address)) {
        throw Object.assign(new Error("PRIVATE_NETWORK_BLOCKED"), {
          status: 400,
          retryable: false,
        });
      }
    }
  }

  return url;
}