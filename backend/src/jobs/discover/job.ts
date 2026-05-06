import { DeveloperModel } from "../../db/models/developer.model.js";
import { jobQueue, JobHandler } from "../queue.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * discover:developer
 */
export const discoverDev: JobHandler = async (job) => {
  const start = Date.now();

  try {
    const { username, source } = job.payload || {};

    if (!username || typeof username !== "string") {
      return {
        success: false,
        error: "username_required",
        durationMs: Date.now() - start,
      };
    }

    const normalizedUsername = username.trim().toLowerCase();
    console.info(`[Job] discover:developer — ${normalizedUsername}`);

    const existing = await DeveloperModel.findOne({
      username: normalizedUsername,
    });

    // CASE A — Already processing
    if (existing?.ingestionStatus === "processing") {
      return {
        success: true,
        action: "skipped_processing",
        username: normalizedUsername,
        durationMs: Date.now() - start,
      };
    }

    // CASE B — Already fresh
    const isFresh =
      existing?.lastFetchedAt &&
      Date.now() - new Date(existing.lastFetchedAt).getTime() < DAY_MS;

    if (existing && existing.ingestionStatus === "completed" && isFresh) {
      return {
        success: true,
        action: "skipped_fresh",
        username: normalizedUsername,
        durationMs: Date.now() - start,
      };
    }

    // CASE C — Exists but stale
    if (existing) {
      await DeveloperModel.updateOne(
        { username: normalizedUsername },
        {
          $set: {
            ingestionStatus: "pending",
            lastQueuedAt: new Date(),
          },
        }
      );
    }

    // CASE D — New developer
    if (!existing) {
      await DeveloperModel.create({
        username: normalizedUsername,
        githubId: 0,
        ingestionStatus: "pending",
        source: source || "discovery",
        lastQueuedAt: new Date(),
        metadata: {
          avatarUrl: `https://github.com/identicons/${normalizedUsername}`,
          githubCreatedAt: new Date(),
        },
      });
    }

    // enqueue ingest
    await jobQueue.enqueue({
      name: "ingest:developer",
      payload: {
        username: normalizedUsername,
        priority: source === "manual" ? 10 : 5,
      },
    });

    return {
      success: true,
      action: "queued_ingest",
      username: normalizedUsername,
      durationMs: Date.now() - start,
    };
  } catch (error: unknown) {
    console.error("[Job] discover:developer failed:", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : "discover_developer_failed",
      durationMs: Date.now() - start,
    };
  }
};