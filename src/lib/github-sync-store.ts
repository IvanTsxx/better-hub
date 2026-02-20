import { prisma } from "./db";

export type GithubSyncJobStatus = "pending" | "running" | "failed";

export interface GithubCacheEntry<T> {
  data: T;
  syncedAt: string;
  etag: string | null;
}

export interface GithubSyncJob<TPayload = unknown> {
  id: number;
  userId: string;
  dedupeKey: string;
  jobType: string;
  payload: TPayload;
  attempts: number;
}

const MAX_ATTEMPTS = 8;
const RUNNING_JOB_TIMEOUT_MS = 10 * 60 * 1000;

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export async function getGithubCacheEntry<T>(
  userId: string,
  cacheKey: string
): Promise<GithubCacheEntry<T> | null> {
  const row = await prisma.githubCacheEntry.findUnique({
    where: { userId_cacheKey: { userId, cacheKey } },
  });

  if (!row) return null;

  return {
    data: parseJson<T>(row.dataJson),
    syncedAt: row.syncedAt,
    etag: row.etag ?? null,
  };
}

export async function upsertGithubCacheEntry<T>(
  userId: string,
  cacheKey: string,
  cacheType: string,
  data: T,
  etag: string | null = null
) {
  const now = new Date().toISOString();
  const dataJson = JSON.stringify(data);

  await prisma.githubCacheEntry.upsert({
    where: { userId_cacheKey: { userId, cacheKey } },
    create: { userId, cacheKey, cacheType, dataJson, syncedAt: now, etag },
    update: { cacheType, dataJson, syncedAt: now, etag },
  });
}

export async function touchGithubCacheEntrySyncedAt(
  userId: string,
  cacheKey: string
) {
  const now = new Date().toISOString();
  await prisma.githubCacheEntry.update({
    where: { userId_cacheKey: { userId, cacheKey } },
    data: { syncedAt: now },
  });
}

export async function deleteGithubCacheByPrefix(
  userId: string,
  prefix: string
) {
  await prisma.githubCacheEntry.deleteMany({
    where: { userId, cacheKey: { startsWith: prefix } },
  });
}

export async function enqueueGithubSyncJob<TPayload>(
  userId: string,
  dedupeKey: string,
  jobType: string,
  payload: TPayload
) {
  const now = new Date().toISOString();

  // Use upsert to mimic INSERT OR IGNORE on the unique constraint
  await prisma.githubSyncJob.upsert({
    where: { userId_dedupeKey: { userId, dedupeKey } },
    create: {
      userId,
      dedupeKey,
      jobType,
      payloadJson: JSON.stringify(payload),
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    },
    update: {},
  });
}

async function recoverTimedOutRunningJobs(userId: string) {
  const threshold = new Date(
    Date.now() - RUNNING_JOB_TIMEOUT_MS
  ).toISOString();
  const now = new Date().toISOString();

  await prisma.githubSyncJob.updateMany({
    where: {
      userId,
      status: "running",
      startedAt: { not: null, lte: threshold },
    },
    data: { status: "pending", startedAt: null, updatedAt: now },
  });
}

export async function claimDueGithubSyncJobs<TPayload>(
  userId: string,
  limit = 5
): Promise<GithubSyncJob<TPayload>[]> {
  const now = new Date().toISOString();

  await recoverTimedOutRunningJobs(userId);

  const rows = await prisma.githubSyncJob.findMany({
    where: {
      userId,
      status: "pending",
      nextAttemptAt: { lte: now },
    },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    take: limit,
  });

  if (rows.length === 0) return [];

  const claimed: GithubSyncJob<TPayload>[] = [];

  for (const row of rows) {
    const result = await prisma.githubSyncJob.updateMany({
      where: { id: row.id, status: "pending" },
      data: { status: "running", startedAt: now, updatedAt: now },
    });

    if (result.count === 0) continue;

    claimed.push({
      id: row.id,
      userId: row.userId,
      dedupeKey: row.dedupeKey,
      jobType: row.jobType,
      payload: parseJson<TPayload>(row.payloadJson),
      attempts: row.attempts,
    });
  }

  return claimed;
}

export async function markGithubSyncJobSucceeded(id: number) {
  await prisma.githubSyncJob.delete({ where: { id } });
}

export async function markGithubSyncJobFailed(
  id: number,
  attempts: number,
  error: string
) {
  const nextAttempts = attempts + 1;
  const now = Date.now();
  const status: GithubSyncJobStatus =
    nextAttempts >= MAX_ATTEMPTS ? "failed" : "pending";

  const backoffSeconds = Math.min(15 * 60, Math.max(5, 2 ** nextAttempts));
  const nextAttemptAt = new Date(now + backoffSeconds * 1000).toISOString();
  const nowIso = new Date(now).toISOString();

  await prisma.githubSyncJob.update({
    where: { id },
    data: {
      status,
      attempts: nextAttempts,
      nextAttemptAt,
      startedAt: null,
      lastError: error.slice(0, 2000),
      updatedAt: nowIso,
    },
  });
}
