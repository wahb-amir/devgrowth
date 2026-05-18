export function getAndValidateHostname(input:string): string | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  // Trim whitespace
  const sanitizedInput = input.trim();

  // 1. Try parsing as a full URL
  try {
    // We check if it looks like it has a protocol. If not, URL() will throw an error.
    if (sanitizedInput.includes('://') || sanitizedInput.startsWith('//')) {
      const urlObj = new URL(sanitizedInput);
      return urlObj.hostname;
    }
  } catch (e) {
    // If URL parsing failed despite having a protocol, it's a bad input
    return null;
  }

  // 2. If it's not a full URL, validate it as a standalone hostname/domain
  // This regex validates standard domain names (e.g., xyz.com, sub.domain.co.uk)
  const hostnameRegex = /^(?!-)[A-Za-z0-9-]+([\-\.]{1}[a-z0-9]+)*\.[A-Za-z]{2,63}$/;
  
  if (hostnameRegex.test(sanitizedInput)) {
    return sanitizedInput;
  }

  // If it matches neither, it's invalid
  return null;
}
