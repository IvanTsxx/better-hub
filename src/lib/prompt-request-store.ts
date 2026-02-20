import { prisma } from "./db";

export type PromptRequestStatus = "open" | "processing" | "completed" | "rejected";

export interface PromptRequest {
  id: string;
  userId: string;
  owner: string;
  repo: string;
  title: string;
  body: string;
  status: PromptRequestStatus;
  prNumber: number | null;
  conversationId: string | null;
  errorMessage: string | null;
  ghostTabId: string | null;
  progress: string | null;
  createdAt: string;
  updatedAt: string;
}

function toPromptRequest(row: {
  id: string;
  userId: string;
  owner: string;
  repo: string;
  title: string;
  body: string;
  status: string;
  prNumber: number | null;
  conversationId: string | null;
  errorMessage: string | null;
  ghostTabId: string | null;
  progress: string | null;
  createdAt: string;
  updatedAt: string;
}): PromptRequest {
  return {
    id: row.id,
    userId: row.userId,
    owner: row.owner,
    repo: row.repo,
    title: row.title,
    body: row.body,
    status: row.status as PromptRequestStatus,
    prNumber: row.prNumber,
    conversationId: row.conversationId,
    errorMessage: row.errorMessage,
    ghostTabId: row.ghostTabId,
    progress: row.progress ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createPromptRequest(
  userId: string,
  owner: string,
  repo: string,
  title: string,
  body: string,
  conversationId?: string
): Promise<PromptRequest> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const created = await prisma.promptRequest.create({
    data: {
      id,
      userId,
      owner,
      repo,
      title,
      body,
      status: "open",
      conversationId: conversationId ?? null,
      createdAt: now,
      updatedAt: now,
    },
  });

  return toPromptRequest(created);
}

export async function getPromptRequest(
  id: string
): Promise<PromptRequest | null> {
  const row = await prisma.promptRequest.findUnique({ where: { id } });
  return row ? toPromptRequest(row) : null;
}

export async function listPromptRequests(
  owner: string,
  repo: string,
  opts?: { status?: PromptRequestStatus }
): Promise<PromptRequest[]> {
  const rows = await prisma.promptRequest.findMany({
    where: { owner, repo, ...(opts?.status ? { status: opts.status } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toPromptRequest);
}

export async function countPromptRequests(
  owner: string,
  repo: string,
  status?: PromptRequestStatus
): Promise<number> {
  return prisma.promptRequest.count({
    where: { owner, repo, ...(status ? { status } : {}) },
  });
}

export async function updatePromptRequestStatus(
  id: string,
  status: PromptRequestStatus,
  opts?: { prNumber?: number; errorMessage?: string | null }
): Promise<PromptRequest | null> {
  const now = new Date().toISOString();

  await prisma.promptRequest.update({
    where: { id },
    data: {
      status,
      ...(opts?.prNumber != null ? { prNumber: opts.prNumber } : {}),
      errorMessage: opts?.errorMessage ?? null,
      updatedAt: now,
    },
  });

  return getPromptRequest(id);
}

export async function updatePromptRequestContent(
  id: string,
  updates: { title?: string; body?: string }
): Promise<PromptRequest | null> {
  const now = new Date().toISOString();
  const data: Record<string, unknown> = { updatedAt: now };

  if (updates.title !== undefined) data.title = updates.title;
  if (updates.body !== undefined) data.body = updates.body;

  await prisma.promptRequest.update({ where: { id }, data });

  return getPromptRequest(id);
}

export async function setPromptRequestGhostTabId(
  id: string,
  ghostTabId: string
): Promise<void> {
  await prisma.promptRequest.update({
    where: { id },
    data: { ghostTabId },
  });
}

export async function updatePromptRequestProgress(
  id: string,
  progress: string | null
): Promise<void> {
  await prisma.promptRequest.update({
    where: { id },
    data: { progress, updatedAt: new Date().toISOString() },
  });
}

export async function deletePromptRequest(id: string): Promise<void> {
  await prisma.promptRequest.delete({ where: { id } });
}
