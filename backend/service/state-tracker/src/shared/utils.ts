import { v4 as uuidv4 } from "uuid";

export const generateId = (): string => uuidv4();

export const safeAsync = async <T>(
  fn: () => Promise<T>,
  fallback?: T,
): Promise<T | undefined> => {
  try {
    return await fn();
  } catch (err) {
    console.error("[safeAsync] Non-blocking error suppressed:", err);
    return fallback;
  }
};

export const nowUtc = (): Date => new Date();
